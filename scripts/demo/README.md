# Demo video

`record.py` produces `docs/freerec-demo.mp4`: a ~2 minute narrated walkthrough of FreeRec
(1920×1080, H.264 + AAC). It is a real run of the extension, not a mock-up:

1. Loads the unpacked extension into Playwright's Chromium (headless) with Chrome's fake
   webcam and microphone. The webcam is fed an animated illustrated presenter
   (`site/avatar.html`) instead of Chrome's green test pattern.
2. Drives the panel, effects, a tab recording, the library, screenshots and the canvas on a
   fictional dashboard page (`site/index.html`), drawing a cursor and captions on top.
3. Films whichever tab is on screen through the CDP screencast.
4. Adds narration, synthesized sound effects (clicks, countdown ticks, shutter, chimes) and a
   ducked music bed (levels: `SFX_GAIN` / `MUSIC_GAIN` in `audio.py`), then encodes the MP4
   with loudness normalized to about -16 LUFS.

Captions and narration are in `record.py` (`VO` dict and the `caption()` calls). Each narration
line finishes before the next caption appears, so editing the text re-times the video.

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r scripts/demo/requirements.txt
.venv/bin/python -m playwright install chromium
```

`kokoro-onnx` gives a natural neural voice ([Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M),
Apache-2.0, so fine for commercial use). The model (~340 MB) is downloaded on first run into
`scripts/demo/build/voices/`. Without it, narration falls back to macOS `say`. Pick another
voice with `--voice` (`am_michael`, `af_bella`, `bf_emma`, `bm_george`, …).

## Run

```bash
.venv/bin/python scripts/demo/record.py                # full run -> docs/freerec-demo.mp4
.venv/bin/python scripts/demo/record.py --no-music     # also: --no-voice, --no-sfx
.venv/bin/python scripts/demo/record.py --remix        # reuse last capture, redo audio + encode
.venv/bin/python scripts/demo/record.py --voice am_michael
.venv/bin/python scripts/demo/record.py --out demo.mp4
```

A full run takes about 3 minutes. Intermediate files (frames, Chromium profile, review
screenshots in `build/shots/`) go to `scripts/demo/build/`, which is git-ignored.

## Things that look staged, on purpose

- Device names show as "HD Webcam" / "Built-in Microphone" (Chrome's fake devices are labelled
  with a file path and "Fake Default Audio Input").
- Recording quality is set to 720p so the captured tab matches the 1280×720 viewport; the
  video is upscaled to 1080p when encoding.
- The library has no folder chosen, so the recording is saved to Downloads; the playback scene
  plays that downloaded file in `site/player.html`.

## Gotchas found while building this

- Don't use Playwright viewport or `deviceScaleFactor` emulation. Extension iframes (panel,
  camera bubble) are out-of-process and get mis-sized, and tab capture makes the filmed tab
  render zoomed. The script uses `no_viewport` and `--window-size` (headless adds 87 px of
  window chrome) plus `--disable-features=WebContentsCaptureHiDpi`.
- The recording bar is in a closed shadow root, so its buttons are found by hit-testing.
