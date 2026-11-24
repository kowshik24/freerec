"""Record the FreeRec product demo video.

Drives the unpacked extension in Playwright's Chromium (fake webcam + mic), films
whichever tab is "on camera" through the CDP screencast, then adds narration,
sound effects and a music bed and encodes an MP4.

    python scripts/demo/record.py                 # -> docs/freerec-demo.mp4
    python scripts/demo/record.py --no-music      # narration + effects only
    python scripts/demo/record.py --remix         # re-mix audio / re-encode, no browser run

See scripts/demo/README.md for setup.
"""
import argparse
import asyncio
import base64
import functools
import http.server
import json
import os
import re
import shutil
import subprocess
import threading
import time
from urllib.parse import quote

import imageio_ffmpeg
from playwright.async_api import async_playwright

import audio
from avatar import build_avatar

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
EXT = REPO
BUILD = os.path.join(HERE, "build")
WWW = os.path.join(BUILD, "www")
FRAMES = os.path.join(BUILD, "frames")
PROFILE = os.path.join(BUILD, "profile")
SHOTS = os.path.join(BUILD, "shots")
DL = os.path.join(BUILD, "downloads")
AVATAR = os.path.join(BUILD, "avatar.y4m")
TIMELINE = os.path.join(BUILD, "timeline.json")
W, H = 1280, 720
PORT = 8765
BASE = f"http://127.0.0.1:{PORT}"
DEMO_URL = f"{BASE}/index.html"
DEMO_TITLE = "Acme Launch Plan"  # <title> of site/index.html, used to auto-pick the tab to capture

# Narration, keyed by scene. On-screen captions are shorter; see the caption() calls.
VO = {
    "intro": "Meet FreeRec. A free, private screen and camera recorder for Chrome.",
    "open": "Open FreeRec from the toolbar, or press Alt, Shift, O.",
    "source": "Record your full screen, a single window, just this tab, or only your camera.",
    "effects": "Your camera bubble gets filters and virtual backgrounds, processed right on your device.",
    "start": "When you're ready, hit Start Recording.",
    "folder": "The first time, choose a folder, or simply save to Downloads.",
    "countdown": "A three second countdown, and you're live.",
    "present": "Present as usual. Scroll, click, and talk.",
    "drag": "Drag the camera bubble anywhere you like.",
    "controls": "Pause, resume, restart, or discard, right from the control bar.",
    "finish": "Click finish, and the video is already saved.",
    "library": "Your recordings show up in the library, ready to play, rename, or save.",
    "playback": "And here's the actual recording. A real WebM file, with a proper, seekable duration.",
    "screenshot": "Need a screenshot? Grab a custom area, or the whole tab.",
    "canvas": "Want slides? Present on the built-in canvas.",
    "templates": "Pick a template, a background, or a text layout, with your camera right on top.",
    "outro": "FreeRec. No account, no upload, no watermark, and no time limit. Free and open source.",
}


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=WWW)).serve_forever()


# Fake cursor, click ripple and caption bar drawn into whichever page is filmed.
OVERLAY_JS = r"""
() => {
  if (!document.getElementById('demo-style')) {
    const st = document.createElement('style'); st.id = 'demo-style';
    st.textContent = `
      #demo-cursor{position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;
        transform:translate(-3px,-2px);filter:drop-shadow(0 2px 3px rgb(0 0 0/35%))}
      #demo-ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;z-index:2147483646;pointer-events:none;
        background:rgb(91 76 240/35%);border:2px solid rgb(91 76 240/80%);transform:scale(.2);opacity:0}
      #demo-ripple.go{animation:demoRip .45s ease-out}
      @keyframes demoRip{0%{transform:scale(.2);opacity:1}100%{transform:scale(1.25);opacity:0}}
      #demo-caption{position:fixed;left:50%;bottom:34px;transform:translateX(-50%) translateY(12px);z-index:2147483646;pointer-events:none;
        background:rgb(18 18 24/88%);color:#fff;font:600 21px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;
        padding:13px 24px;border-radius:14px;box-shadow:0 12px 34px rgb(0 0 0/30%);opacity:0;transition:opacity .35s,transform .35s;
        white-space:nowrap}
      #demo-caption.on{opacity:1;transform:translateX(-50%) translateY(0)}
      #demo-caption b{color:#b9adff}`;
    document.documentElement.append(st);
  }
  for (const id of ['demo-ripple', 'demo-caption', 'demo-cursor']) {
    let n = document.getElementById(id);
    if (!n) {
      n = document.createElement('div'); n.id = id;
      if (id === 'demo-cursor') {
        n.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2.5v17.2l4.6-4.3 3 6.6 3.1-1.4-3-6.5 6.3-.3z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
        if (window.__demoPos) { n.style.left = __demoPos[0] + 'px'; n.style.top = __demoPos[1] + 'px'; }
      }
    }
    document.documentElement.append(n); // stay above anything mounted later
  }
}
"""

# Chrome's fake devices are labelled "fake_device_0" / a file path; show friendly names.
# Patched in every frame so the panel and recorder agree (the recorder looks devices up by label).
LABELS_JS = r"""
(() => {
  const md = navigator.mediaDevices; if (!md || md.__demo) return; md.__demo = true;
  const orig = md.enumerateDevices.bind(md);
  const name = { videoinput: 'HD Webcam', audioinput: 'Built-in Microphone', audiooutput: 'Speakers' };
  md.enumerateDevices = async () => (await orig()).map((d) => {
    if (!d.label) return d;
    const o = { deviceId: d.deviceId, groupId: d.groupId, kind: d.kind, label: name[d.kind] || d.label, toJSON() { return this; } };
    if (d.getCapabilities) o.getCapabilities = d.getCapabilities.bind(d);
    return o;
  });
})();
"""

OPEN_PANEL = """async (u) => {
  const [t] = await chrome.tabs.query({ url: u });
  await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content.js'] });
  await chrome.tabs.sendMessage(t.id, { freerec: 'toggle-panel' });
}"""


class Demo:
    def __init__(self, ctx, narrator):
        self.ctx = ctx
        self.narrator = narrator
        self.frames = []  # (monotonic t, jpeg path)
        self.events = []  # (monotonic t, kind, name, gain)
        self.n = 0
        self.cdp = None
        self.page = None
        self.pos = (W * 0.55, H * 0.45)
        self.voice_until = 0.0
        self.voice_files = {}

    # ---- capture -------------------------------------------------------
    async def film(self, page, whoosh=False):
        if self.cdp:
            try:
                await self.cdp.send("Page.stopScreencast")
                await self.cdp.detach()
            except Exception:
                pass
        if whoosh:
            self.sfx("whoosh", 0.8)
        self.page = page
        await page.bring_to_front()
        self.cdp = cdp = await self.ctx.new_cdp_session(page)

        def on_frame(p):
            path = os.path.join(FRAMES, f"{self.n:06d}.jpg")
            self.n += 1
            with open(path, "wb") as f:
                f.write(base64.b64decode(p["data"]))
            self.frames.append((time.monotonic(), path))
            asyncio.ensure_future(cdp.send("Page.screencastFrameAck", {"sessionId": p["sessionId"]})).add_done_callback(
                lambda f: f.exception())  # ignore acks to tabs that already closed

        cdp.on("Page.screencastFrame", on_frame)
        await cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92, "maxWidth": W, "maxHeight": H})
        await self.overlay()
        await self.set_cursor(*self.pos)

    async def overlay(self):
        try:
            await self.page.evaluate(f"window.__demoPos=[{self.pos[0]},{self.pos[1]}]")
            await self.page.evaluate(OVERLAY_JS)
        except Exception as e:
            print("overlay:", e)

    async def hide_cursor(self):
        await self.page.evaluate("document.getElementById('demo-cursor').style.display='none'")

    # ---- audio events --------------------------------------------------
    def sfx(self, name, gain=1.0, at=None):
        self.events.append((at if at is not None else time.monotonic(), "sfx", name, gain))

    async def voice_wait(self, extra=0.0):
        delay = self.voice_until + extra - time.monotonic()
        if delay > 0:
            await asyncio.sleep(delay)

    async def say(self, key):
        """Start a narration line; the next line waits until this one has finished."""
        if not self.narrator:
            return
        await self.voice_wait()
        path, seconds = self.narrator.line(VO[key])
        self.voice_files[key] = path
        self.events.append((time.monotonic(), "voice", key, 1.0))
        self.voice_until = time.monotonic() + seconds + 0.35

    # ---- pointer -------------------------------------------------------
    async def set_cursor(self, x, y):
        await self.page.evaluate(
            "([x,y])=>{window.__demoPos=[x,y];const c=document.getElementById('demo-cursor');if(c){c.style.left=x+'px';c.style.top=y+'px'}}",
            [x, y])

    async def move(self, x, y, dur=0.7):
        await self.overlay()
        x0, y0 = self.pos
        steps = max(8, int(dur * 40))
        start = time.monotonic()
        for i in range(1, steps + 1):
            k = i / steps
            e = k * k * (3 - 2 * k)
            cx, cy = x0 + (x - x0) * e, y0 + (y - y0) * e
            await self.page.mouse.move(cx, cy)
            await self.set_cursor(cx, cy)
            delay = start + dur * k - time.monotonic()
            if delay > 0:
                await asyncio.sleep(delay)
        self.pos = (x, y)

    async def ripple(self, sound="click"):
        if sound:
            self.sfx(sound)
        x, y = self.pos
        await self.page.evaluate(
            "([x,y])=>{const r=document.getElementById('demo-ripple');if(!r)return;r.style.left=x+'px';r.style.top=y+'px';r.classList.remove('go');void r.offsetWidth;r.classList.add('go')}",
            [x, y])

    async def click_at(self, x, y, dur=0.7, pause=0.35):
        await self.move(x, y, dur)
        await asyncio.sleep(0.12)
        await self.ripple()
        await self.page.mouse.click(x, y)
        await asyncio.sleep(pause)

    async def click(self, locator, dur=0.7, pause=0.35):
        await locator.wait_for(state="visible", timeout=15000)
        b = await locator.bounding_box()
        await self.click_at(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2, dur, pause)

    async def drag(self, x0, y0, x1, y1, dur=1.2):
        await self.move(x0, y0, 0.6)
        self.sfx("soft")
        await self.page.mouse.down()
        await asyncio.sleep(0.15)
        await self.move(x1, y1, dur)
        await asyncio.sleep(0.1)
        self.sfx("soft")
        await self.page.mouse.up()

    # ---- captions --------------------------------------------------------
    async def caption(self, html, vo=None):
        """Show a caption; with vo, also start that narration line (after the previous one ends)."""
        if vo:
            await self.voice_wait()
        await self.overlay()
        await self.page.evaluate(
            "(h)=>{const c=document.getElementById('demo-caption');c.classList.remove('on');setTimeout(()=>{c.innerHTML=h;c.classList.add('on')},120)}",
            html)
        if vo:
            await self.say(vo)

    async def no_caption(self):
        await self.page.evaluate("()=>{const c=document.getElementById('demo-caption');c&&c.classList.remove('on')}")

    async def shot(self, name):
        await self.page.screenshot(path=os.path.join(SHOTS, name + ".png"))


def card_url(kind, title, sub=""):
    return f"{BASE}/card.html?k={kind}&t={quote(title)}&s={quote(sub)}"


async def wait_page(ctx, part, timeout=20):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        for p in ctx.pages:
            if part in p.url:
                return p
        await asyncio.sleep(0.1)
    raise RuntimeError(f"no page {part}: {[p.url for p in ctx.pages]}")


async def panel_frame(page, timeout=15):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        for f in page.frames:
            if "panel.html" in f.url:
                try:
                    await f.wait_for_selector(".record-btn, .tabs", timeout=3000)
                    return f
                except Exception:
                    pass
        await asyncio.sleep(0.1)
    raise RuntimeError("panel frame missing")


async def newest_download(timeout=20):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        files = [os.path.join(DL, f) for f in os.listdir(DL)]
        files = [f for f in files if os.path.getsize(f) > 0]
        if files:
            f = max(files, key=os.path.getmtime)
            size = os.path.getsize(f)
            await asyncio.sleep(0.5)
            if os.path.getsize(f) == size:
                return f
        await asyncio.sleep(0.3)
    raise RuntimeError("recording was not downloaded")


async def bar_buttons(page):
    """The recording bar lives in a closed shadow root: find it by hit-testing the host."""
    top = await page.evaluate("""() => {
      const host = document.querySelector('freerec-ui');
      for (let y = 0; y < innerHeight; y++) if (document.elementFromPoint(48, y) === host) return y;
      return null;
    }""")
    # bar layout (content.js): padding 10, stop 46, gap 6, time ~25, gap 6, pause 46
    return {"stop": (48, top + 1 + 10 + 23), "pause": (48, top + 1 + 10 + 46 + 6 + 25 + 6 + 23)}


async def countdown_sfx(d, sw):
    """Tick on 3-2-1 and chime at 'go', aligned to the recorder's own countdown clock."""
    for _ in range(100):
        rec = await sw.evaluate("async()=>(await chrome.storage.local.get('rec')).rec")
        if rec and rec.get("countdownEnd"):
            offset = time.time() - time.monotonic()
            end = rec["countdownEnd"] / 1000 - offset
            for k in (3, 2, 1):
                d.sfx("tick", at=end - k)
            d.sfx("go", at=end)
            return
        await asyncio.sleep(0.05)


async def capture(narrator):
    for path in (FRAMES, PROFILE, SHOTS, DL, WWW):
        shutil.rmtree(path, ignore_errors=True)
        os.makedirs(path)
    shutil.copytree(os.path.join(HERE, "site"), WWW, dirs_exist_ok=True)
    shutil.copy(os.path.join(REPO, "icons", "icon128.png"), os.path.join(WWW, "icon.png"))
    threading.Thread(target=serve, daemon=True).start()

    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            PROFILE, channel="chromium", headless=True,
            # No viewport emulation: with it, tab capture makes the filmed tab render zoomed,
            # and DPR emulation mis-sizes the extension's out-of-process iframes.
            no_viewport=True, accept_downloads=True, downloads_path=DL,
            args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}",
                  "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
                  f"--use-file-for-fake-video-capture={AVATAR}",
                  f"--auto-select-tab-capture-source-by-title={DEMO_TITLE}",
                  "--auto-accept-this-tab-capture", "--hide-scrollbars",
                  "--disable-features=WebContentsCaptureHiDpi",
                  f"--window-size={W},{H + 87}"])  # headless window chrome is 87px tall
        await ctx.add_init_script(LABELS_JS)
        sw = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event("serviceworker")
        await asyncio.sleep(1.5)
        for pg in list(ctx.pages):
            if "options.html" in pg.url:  # welcome tab opened on install
                await pg.close()
        await sw.evaluate("""() => chrome.storage.local.set({ settings: {
          source: 'screen', cameraOn: true, micEnabled: true, countdown: true, theme: 'light',
          bubbleSize: 'medium', keepRecorderTab: false, quality: '720' } })""")

        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        d = Demo(ctx, narrator)

        # 1. title card
        await page.goto(card_url("title", "FreeRec", "Free, private screen & camera recorder for Chrome"))
        await d.film(page)
        await d.hide_cursor()
        await asyncio.sleep(0.5)
        await d.say("intro")
        await d.voice_wait(0.2)

        # 2. open the panel on the demo page
        await page.goto(DEMO_URL)
        await d.overlay()
        d.sfx("whoosh", 0.8)
        await asyncio.sleep(0.7)
        await d.caption("Open FreeRec from the toolbar or press <b>Alt+Shift+O</b>", vo="open")
        await d.move(W - 60, 40, 1.0)
        await asyncio.sleep(0.4)
        await d.ripple()
        await sw.evaluate(OPEN_PANEL, "http://127.0.0.1/*")
        d.sfx("pop")
        panel = await panel_frame(page)
        await asyncio.sleep(1.2)
        await d.shot("01-panel")

        # 3. source menu
        await d.caption("Record your <b>full screen</b>, a <b>window</b>, the <b>current tab</b> or <b>camera only</b>", vo="source")
        await d.click(panel.locator('[data-act="menu-source"]'), pause=1.6)
        await d.shot("02-source-menu")
        await d.click(panel.locator('.menu [data-act="source"][data-v="tab"]'), pause=0.9)

        # 4. effects
        await d.caption("Camera bubble with on-device <b>filters</b> and <b>backgrounds</b>", vo="effects")
        await d.click(panel.locator('[data-act="effects"]'), pause=1.0)
        await d.click(panel.locator('[data-act="eff-tab"][data-v="filters"]'), pause=1.2)
        tiles = panel.locator('[data-act="filter"]')
        for i in (2, 4, 6):
            await d.click(tiles.nth(i), dur=0.5, pause=1.1)
        await d.shot("03-filters")
        await d.click(panel.locator('[data-act="filter"][data-v="none"]'), dur=0.5, pause=0.6)
        await d.click(panel.locator('[data-act="eff-tab"][data-v="backgrounds"]'), pause=1.0)
        await d.click(panel.locator('[data-act="bg"][data-v="sunset"]'), dur=0.5, pause=1.8)
        await d.shot("04-background")
        await d.click(panel.locator('[data-act="bg"][data-v="none"]'), dur=0.5, pause=0.6)
        await d.click(panel.locator('.eff-head [data-act="view-record"]'), pause=0.8)

        # 5. start recording
        await d.caption("Hit <b>Start Recording</b>", vo="start")
        await asyncio.sleep(0.8)
        await d.click(panel.locator('[data-act="start"]'), pause=0.3)
        rec_page = await wait_page(ctx, "recorder.html")
        await rec_page.wait_for_selector("#prompt:not([hidden])", timeout=20000)
        await d.film(rec_page, whoosh=True)
        await d.caption("First time only: pick a folder, or save to <b>Downloads</b>", vo="folder")
        await asyncio.sleep(1.4)
        await d.shot("05-folder-prompt")
        await d.voice_wait(-0.6)
        await d.click(rec_page.locator("#prompt-actions button", has_text="Downloads"), pause=0.2)
        await d.film(page)  # the recorder switches back to the demo tab for the countdown
        await countdown_sfx(d, sw)
        await d.caption("3 · 2 · 1 countdown, then you're live", vo="countdown")
        await asyncio.sleep(1.2)
        await d.shot("06-countdown")
        await asyncio.sleep(2.4)
        await d.shot("07-recording")

        # 6. while recording
        await d.caption("Present as usual: scroll, click, talk", vo="present")
        await d.move(W * 0.55, H * 0.55, 0.8)
        for _ in range(14):
            await page.mouse.wheel(0, 45)
            await asyncio.sleep(0.06)
        await asyncio.sleep(1.2)
        await d.caption("Drag the camera bubble anywhere", vo="drag")
        await d.drag(134, H - 134, W - 170, H - 170, 1.4)
        await asyncio.sleep(1.0)
        await d.shot("08-bubble-moved")
        await d.caption("<b>Pause</b>, resume, restart or discard from the control bar", vo="controls")
        bar = await bar_buttons(page)
        await d.click_at(*bar["pause"], pause=1.8)
        await d.shot("09-paused")
        await d.click_at(*bar["pause"], pause=1.0)
        for _ in range(14):
            await page.mouse.wheel(0, 50)
            await asyncio.sleep(0.06)
        await asyncio.sleep(0.8)
        await d.caption("Finish, and the video is already in your folder", vo="finish")
        await asyncio.sleep(0.6)
        await d.click_at(*bar["stop"], pause=0.2)

        # 7. library + the real file
        lib = await wait_page(ctx, "library.html")
        await lib.wait_for_load_state()
        await asyncio.sleep(0.6)
        await d.film(lib, whoosh=True)
        d.sfx("success")
        await d.caption("Your recordings, ready to play, rename or save", vo="library")
        await asyncio.sleep(1.4)
        await d.shot("10-library")
        rec_file = await newest_download()
        m = re.search(r'(FreeRec [^"“”]+?\.(?:webm|mp4))', await lib.locator("#notice").inner_text())
        name = m.group(1) if m else "FreeRec recording.webm"
        shutil.copy(rec_file, os.path.join(WWW, "rec.webm"))
        await d.voice_wait(-0.8)
        await d.move(260, 128, 0.8)
        await d.ripple()
        await asyncio.sleep(0.4)
        player = await ctx.new_page()
        await player.goto(f"{BASE}/player.html?n={quote(name)}")
        await d.film(player)
        await player.evaluate("()=>{const c=document.getElementById('demo-caption');c.style.bottom='auto';c.style.top='66px'}")
        await d.caption("The real recording: WebM with a proper, seekable duration", vo="playback")
        await player.evaluate("()=>document.querySelector('video').play()")
        await asyncio.sleep(7.0)
        await d.voice_wait(0.3)
        await d.shot("11-playback")
        await player.close()

        # 8. screenshots
        await page.evaluate("window.scrollTo({top:0})")
        await d.film(page, whoosh=True)
        await d.no_caption()
        await asyncio.sleep(0.4)
        await sw.evaluate(OPEN_PANEL, "http://127.0.0.1/*")
        d.sfx("pop")
        panel = await panel_frame(page)
        await asyncio.sleep(0.8)
        await d.caption("Screenshots too: pick an area or the whole tab", vo="screenshot")
        await d.click(panel.locator('[data-act="view-screenshot"]'), pause=1.0)
        await d.click(panel.locator('[data-act="shot-area"]'), dur=0.5, pause=0.6)
        await d.shot("12-screenshot-panel")
        await d.click(panel.locator('[data-act="screenshot"]'), pause=0.5)
        await d.no_caption()
        await asyncio.sleep(0.4)
        await d.drag(92, 300, 1190, 470, 1.4)
        d.sfx("shutter")
        await asyncio.sleep(2.0)
        await d.shot("13-screenshot-saved")
        await asyncio.sleep(3.4)  # let the "Screenshot saved" toast finish

        # 9. canvas
        await sw.evaluate(OPEN_PANEL, "http://127.0.0.1/*")
        d.sfx("pop")
        panel = await panel_frame(page)
        await asyncio.sleep(0.6)
        await d.caption("Need slides? Present on the built-in <b>Canvas</b>", vo="canvas")
        await d.click(panel.locator('[data-act="view-record"]').first, pause=0.6)
        await d.click(panel.locator('[data-act="effects"]'), pause=0.7)
        await d.click(panel.locator('[data-act="eff-tab"][data-v="canvas"]'), pause=1.4)
        await d.shot("14-canvas-templates")
        await d.click(panel.locator('[data-act="canvas"]').first, pause=0.3)
        canvas = await wait_page(ctx, "canvas.html")
        await canvas.wait_for_load_state()
        await asyncio.sleep(1.0)
        await d.film(canvas, whoosh=True)
        try:
            cp = await panel_frame(canvas, timeout=4)
            await asyncio.sleep(0.6)
            await d.click(cp.locator('[data-act="close"]').first, pause=0.6)
        except Exception as e:
            print("canvas panel:", e)
        await d.caption("Templates, backgrounds and text layouts with your camera on top", vo="templates")
        await asyncio.sleep(3.8)
        await d.voice_wait(0.2)
        await d.shot("15-canvas")

        # 10. end card
        await d.no_caption()
        await asyncio.sleep(0.3)
        end = await ctx.new_page()
        await end.goto(card_url("end", "FreeRec", "No account · No upload · No watermark · No time limit"))
        await d.film(end, whoosh=True)
        await d.hide_cursor()
        await asyncio.sleep(0.6)
        await d.say("outro")
        await d.voice_wait(1.4)
        d.frames.append((time.monotonic(), d.frames[-1][1]))
        await ctx.close()

    t0 = d.frames[0][0]
    with open(os.path.join(BUILD, "frames.txt"), "w") as f:
        for (t, path), (t2, _) in zip(d.frames, d.frames[1:]):
            f.write(f"file '{path}'\nduration {max(t2 - t, 0.001):.4f}\n")
        f.write(f"file '{d.frames[-1][1]}'\n")
    timeline = {
        "duration": d.frames[-1][0] - t0,
        "events": [{"t": max(0.0, t - t0), "kind": k, "name": n, "gain": g} for t, k, n, g in d.events],
        "voice_files": d.voice_files,
    }
    with open(TIMELINE, "w") as f:
        json.dump(timeline, f, indent=1)
    print(f"Captured {len(d.frames)} frames, {timeline['duration']:.1f}s")


def encode(out, voice, sfx, music):
    with open(TIMELINE) as f:
        tl = json.load(f)
    dur = tl["duration"]
    has_audio = voice or sfx or music
    mix_wav = os.path.join(BUILD, "mix.wav")
    if has_audio:
        print("Mixing audio…")
        audio.mix(dur, tl["events"], tl["voice_files"], mix_wav, voice=voice, sfx=sfx, music=music)
    vf = (f"scale=1920:1080:flags=lanczos:in_range=full:out_range=tv,unsharp=5:5:0.4:5:5:0.0,fps=30,"
          f"fade=t=in:st=0:d=0.6,fade=t=out:st={dur - 0.8:.2f}:d=0.8,format=yuv420p")
    cmd = [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
           "-f", "concat", "-safe", "0", "-i", os.path.join(BUILD, "frames.txt")]
    if has_audio:
        cmd += ["-i", mix_wav]
    cmd += ["-vf", vf, "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
            "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-profile:v", "high"]
    if has_audio:
        af = f"loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:st=0:d=0.3,afade=t=out:st={dur - 0.8:.2f}:d=0.8,aresample=48000"
        cmd += ["-af", af, "-c:a", "aac", "-b:a", "192k"]
    cmd += ["-movflags", "+faststart", "-t", f"{dur:.2f}", out]
    print("Encoding…")
    subprocess.run(cmd, check=True)
    print("Wrote", out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=os.path.join(REPO, "docs", "freerec-demo.mp4"))
    ap.add_argument("--no-voice", action="store_true", help="no narration")
    ap.add_argument("--no-sfx", action="store_true", help="no sound effects")
    ap.add_argument("--no-music", action="store_true", help="no background music")
    ap.add_argument("--voice", default=audio.KOKORO_VOICE, help="Kokoro voice, e.g. af_heart, am_michael, bf_emma")
    ap.add_argument("--remix", action="store_true", help="reuse the last capture; only redo audio + encode")
    a = ap.parse_args()
    os.makedirs(BUILD, exist_ok=True)
    if not a.remix:
        if not os.path.exists(AVATAR):
            print("Rendering fake webcam feed…")
            build_avatar(AVATAR)
        narrator = None if a.no_voice else audio.Narrator(BUILD, a.voice)
        if narrator:
            print("Synthesizing narration…")
            for text in VO.values():
                narrator.line(text)
        asyncio.run(capture(narrator))
    encode(a.out, not a.no_voice, not a.no_sfx, not a.no_music)


if __name__ == "__main__":
    main()
