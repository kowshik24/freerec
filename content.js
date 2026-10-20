// FreeRec on-page UI: control panel (extension iframe), draggable camera bubble,
// vertical recording controls, 3-2-1 countdown, screenshot area picker, toast.
// Injected by the service worker; also loaded directly by canvas.html.
(() => {
  if (window.__freerec) return;

  const LIVE = ['countdown', 'recording', 'paused'];
  const SIZES = { small: 140, medium: 220, large: 320 };
  const NEXT_SIZE = { small: 'medium', medium: 'large', large: 'small' };
  const url = (p) => chrome.runtime.getURL(p);
  const isExtensionPage = location.protocol === 'chrome-extension:';
  // On the Canvas page the bubble is always shown, like a presenter view.
  const isCanvas = isExtensionPage && location.pathname.endsWith('/canvas.html');

  const s = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const ICON = {
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4.2" height="15" rx="1.4"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.4"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.5 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8a1 1 0 0 0-1.5.86z"/></svg>',
    restart: s('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4"/>'),
    close: s('<path d="M6 6l12 12M18 6 6 18"/>'),
    cam: s('<rect x="3" y="6" width="12.5" height="12" rx="2.5"/><path d="m15.5 10.5 5-3v9l-5-3"/>'),
    resize: s('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>'),
  };

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    [hidden] { display: none !important; }
    svg { width: 22px; height: 22px; display: block; }
    .panel { position: fixed; top: 0; right: 0; z-index: 2147483647; border: 0; width: 348px; height: 620px; background: transparent; color-scheme: normal; }

    .bubble { position: fixed; z-index: 2147483645; border-radius: 50%; overflow: hidden; background: #1d2b4a; cursor: grab; touch-action: none; box-shadow: 0 10px 30px rgb(0 0 0 / 28%); }
    .bubble:hover { overflow: visible; }
    .bubble.dragging { cursor: grabbing; }
    .bubble iframe { width: 100%; height: 100%; border: 0; border-radius: 50%; pointer-events: none; display: block; background: transparent; }
    .bubble .tools { position: absolute; top: 6%; right: 6%; display: none; }
    .bubble:hover .tools { display: block; }
    .bubble .tools button { all: unset; cursor: pointer; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: rgb(23 24 28 / 85%); }
    .bubble .tools svg { width: 18px; height: 18px; }

    .bar {
      position: fixed; z-index: 2147483647; left: 16px; top: 50%; transform: translateY(-50%);
      width: 64px; padding: 10px 8px; display: flex; flex-direction: column; align-items: center; gap: 6px;
      background: #2b2c30; border: 1px solid #45464c; border-radius: 22px; color: #a9abb2;
      box-shadow: 0 10px 30px rgb(0 0 0 / 30%); user-select: none; touch-action: none; cursor: grab;
    }
    .bar button { all: unset; cursor: pointer; width: 46px; height: 46px; border-radius: 14px; display: grid; place-items: center; color: #a9abb2; position: relative; }
    .bar button:hover { background: #3a3b41; color: #fff; }
    .bar .stop { background: #3a3b41; }
    .bar .stop span { width: 20px; height: 20px; border-radius: 5px; background: #e5484d; }
    .bar .stop:hover { background: #4a2a2b; }
    .bar .time { font: 700 15px/1 ui-monospace, Menlo, monospace; color: #d5d6da; padding: 4px 0 6px; }
    .bar.paused .time { color: #f5a524; }
    .bar hr { width: 40px; border: 0; border-top: 1px solid #4a4b52; margin: 2px 0; }
    .bar button.armed { background: #e5484d; color: #fff; }
    .bar button.off { color: #6b6d75; }
    .bar button[data-tip]:hover::after {
      content: attr(data-tip); position: absolute; left: 56px; top: 50%; transform: translateY(-50%);
      white-space: nowrap; background: #17181c; color: #fff; font-size: 12px; font-weight: 600; padding: 5px 8px; border-radius: 8px;
    }

    .countdown { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; background: rgb(15 16 20 / 45%); }
    .countdown .ring { position: relative; width: 200px; height: 200px; }
    .countdown .ring svg { width: 200px; height: 200px; transform: rotate(-90deg); }
    .countdown .ring circle { fill: rgb(23 24 28 / 88%); stroke: rgb(255 255 255 / 18%); stroke-width: 8; }
    .countdown .ring circle.p { fill: none; stroke: #e5484d; stroke-dasharray: 578; stroke-dashoffset: 578; }
    .countdown .ring.tick circle.p { animation: sweep 1s linear forwards; }
    .countdown .num { position: absolute; inset: 0; display: grid; place-items: center; color: #fff; font: 800 96px/1 system-ui, sans-serif; }
    .countdown .num.pop { animation: pop .35s ease-out; }
    .countdown .hint { position: absolute; top: calc(50% + 124px); left: 0; right: 0; text-align: center; color: #fff; font-size: 14px; font-weight: 600; text-shadow: 0 1px 3px rgb(0 0 0 / 50%); }
    @keyframes sweep { to { stroke-dashoffset: 0; } }
    @keyframes pop { from { transform: scale(1.35); opacity: 0; } to { transform: scale(1); opacity: 1; } }

    .select { position: fixed; inset: 0; z-index: 2147483647; cursor: crosshair; background: rgb(0 0 0 / 35%); }
    .select.dragging { background: transparent; }
    .select .rect { position: fixed; border: 2px solid #fff; box-shadow: 0 0 0 9999px rgb(0 0 0 / 35%); border-radius: 2px; }
    .select .help { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #17181c; color: #fff; padding: 8px 14px; border-radius: 10px; font-size: 14px; font-weight: 600; }

    .toast {
      position: fixed; z-index: 2147483647; bottom: 28px; left: 50%; transform: translateX(-50%);
      display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 14px;
      background: #17181c; color: #fff; font-size: 14px; box-shadow: 0 10px 30px rgb(0 0 0 / 30%);
    }
    .toast button { all: unset; cursor: pointer; color: #8fb8f6; font-weight: 700; }
  `;

  let host, root, ui = null;
  let rec = { status: 'idle' };
  let settings = {};
  let prefs = { cameraHidden: false, bubbleSize: null, bubblePos: null };
  let panelOpen = false;
  let startingUntil = 0;
  let holdUntil = 0; // keep the UI mounted for toasts / area selection
  let tickId = null;
  let lastNum = null;

  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);
  const toRecorder = (cmd) => send({ target: 'recorder', cmd });
  const savePrefs = (patch) => {
    prefs = { ...prefs, ...patch };
    chrome.storage.local.set({ overlayPrefs: prefs });
  };

  function el(tag, props = {}, html = '') {
    const n = document.createElement(tag);
    Object.assign(n, props);
    if (html) n.innerHTML = html;
    return n;
  }

  function makeDraggable(node, onEnd, { keepTransform = false } = {}) {
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault();
      const rect = node.getBoundingClientRect();
      const dx = e.clientX - rect.left;
      const dy = e.clientY - rect.top;
      node.classList.add('dragging');
      node.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const x = Math.min(Math.max(0, ev.clientX - dx), innerWidth - rect.width);
        const y = Math.min(Math.max(0, ev.clientY - dy), innerHeight - rect.height);
        Object.assign(node.style, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto' });
        if (!keepTransform) node.style.transform = 'none';
      };
      const up = () => {
        node.classList.remove('dragging');
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', up);
        onEnd?.(node.getBoundingClientRect());
      };
      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', up);
    });
  }

  // --- mount -----------------------------------------------------------------

  function mount() {
    if (ui) return;
    host = el('freerec-ui');
    root = host.attachShadow({ mode: 'closed' });
    root.append(el('style', { textContent: CSS }));

    const panel = el('iframe', { className: 'panel', title: 'FreeRec', allow: 'camera; microphone' });
    panel.hidden = true;

    const bar = el('div', { className: 'bar' });
    bar.innerHTML = `
      <button class="stop" data-tip="Finish recording"><span></span></button>
      <div class="time">0:00</div>
      <button class="pause" data-tip="Pause">${ICON.pause}</button>
      <button class="restart" data-tip="Restart">${ICON.restart}</button>
      <button class="cancel" data-tip="Discard">${ICON.close}</button>
      <hr>
      <button class="cam" data-tip="Hide camera">${ICON.cam}</button>`;
    bar.hidden = true;
    makeDraggable(bar);
    const q = (c) => bar.querySelector(c);
    q('.stop').onclick = () => toRecorder('stop');
    q('.pause').onclick = () => toRecorder('togglePause');
    armed(q('.restart'), 'Click again to restart', () => toRecorder('restart'));
    armed(q('.cancel'), 'Click again to discard', () => toRecorder('cancel'));
    q('.cam').onclick = () => { savePrefs({ cameraHidden: !prefs.cameraHidden }); render(); };

    const countdown = el('div', { className: 'countdown' }, `
      <div class="ring"><svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="92"/><circle class="p" cx="100" cy="100" r="92"/></svg><div class="num">3</div></div>
      <div class="hint">Recording starts soon · Esc to cancel</div>`);
    countdown.hidden = true;

    root.append(panel, bar, countdown);
    ui = { panel, bar, countdown, bubble: null, time: q('.time'), pause: q('.pause'), cam: q('.cam') };
    document.documentElement.append(host);
    tickId = setInterval(tick, 200);
  }

  function armed(button, tip, run) {
    const original = button.dataset.tip;
    let timer = null;
    button.onclick = () => {
      if (button.classList.contains('armed')) {
        clearTimeout(timer);
        button.classList.remove('armed');
        button.dataset.tip = original;
        run();
        return;
      }
      button.classList.add('armed');
      button.dataset.tip = tip;
      timer = setTimeout(() => { button.classList.remove('armed'); button.dataset.tip = original; }, 3000);
    };
  }

  function unmount() {
    clearInterval(tickId);
    host?.remove();
    host = root = ui = null;
  }

  // --- bubble ----------------------------------------------------------------

  const bubbleSize = () => SIZES[prefs.bubbleSize || settings.bubbleSize] || SIZES.medium;

  function placeBubble(node) {
    const size = bubbleSize();
    node.style.width = node.style.height = `${size}px`;
    const pos = prefs.bubblePos;
    const x = pos ? Math.min(pos.x, innerWidth - size) : 24;
    const y = pos ? Math.min(pos.y, innerHeight - size) : innerHeight - size - 24;
    Object.assign(node.style, { left: `${Math.max(0, x)}px`, top: `${Math.max(0, y)}px` });
  }

  function showBubble(show) {
    if (!show) {
      ui.bubble?.remove();
      ui.bubble = null;
      return;
    }
    if (ui.bubble) return;
    const bubble = el('div', { className: 'bubble' });
    const frame = el('iframe', { src: url('camera.html'), allow: 'camera', title: 'FreeRec camera' });
    const tools = el('div', { className: 'tools' });
    const resize = el('button', { title: 'Change size' }, ICON.resize);
    resize.onclick = () => {
      savePrefs({ bubbleSize: NEXT_SIZE[prefs.bubbleSize || settings.bubbleSize || 'medium'] });
      placeBubble(bubble);
    };
    tools.append(resize);
    bubble.append(frame, tools);
    placeBubble(bubble);
    makeDraggable(bubble, (r) => savePrefs({ bubblePos: { x: r.left, y: r.top } }));
    root.insertBefore(bubble, ui.panel);
    ui.bubble = bubble;
  }

  // --- render ----------------------------------------------------------------

  function tick() {
    if (!ui) return;
    const counting = rec.status === 'countdown' && rec.countdownEnd > Date.now();
    ui.countdown.hidden = !counting;
    if (counting) {
      const n = Math.ceil((rec.countdownEnd - Date.now()) / 1000);
      if (n !== lastNum) {
        lastNum = n;
        const num = ui.countdown.querySelector('.num');
        num.textContent = String(n);
        num.classList.remove('pop');
        void num.offsetWidth;
        num.classList.add('pop');
        const ring = ui.countdown.querySelector('.ring');
        ring.classList.remove('tick');
        void ring.offsetWidth;
        ring.classList.add('tick');
      }
    } else {
      lastNum = null;
    }
    let ms = 0;
    if (rec.startedAt) {
      const end = rec.status === 'paused' && rec.pausedAt ? rec.pausedAt : Date.now();
      ms = end - rec.startedAt - (rec.pausedTotal || 0);
    }
    const sec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    ui.time.textContent = `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(sec % 60).padStart(2, '0')}`;
  }

  function render() {
    const onPageRecording = rec.mode !== 'camera';
    const live = LIVE.includes(rec.status) && onPageRecording;
    const preparing = (rec.status === 'preparing' && onPageRecording) || Date.now() < startingUntil;
    const canvasBubble = isCanvas && settings.cameraOn && settings.source !== 'camera';
    const needUi = panelOpen || live || preparing || canvasBubble || Date.now() < holdUntil;
    if (!needUi) {
      unmount();
      return;
    }
    mount();

    const showPanel = panelOpen && !live && rec.status !== 'preparing' && rec.status !== 'saving';
    if (showPanel && !ui.panel.src) ui.panel.src = url(`panel.html${panelOpen === 'screenshot' ? '?view=screenshot' : ''}`);
    ui.panel.hidden = !showPanel;

    ui.bar.hidden = !live;
    ui.bar.classList.toggle('paused', rec.status === 'paused');
    ui.pause.innerHTML = rec.status === 'paused' ? ICON.play : ICON.pause;
    ui.pause.dataset.tip = rec.status === 'paused' ? 'Resume' : 'Pause';
    const recordingCamera = live ? rec.cameraOn !== false && rec.mode === 'screen-camera' : settings.cameraOn;
    ui.cam.hidden = !(live && rec.mode === 'screen-camera');
    ui.cam.classList.toggle('off', prefs.cameraHidden);
    ui.cam.dataset.tip = prefs.cameraHidden ? 'Show camera' : 'Hide camera';

    const wantBubble = settings.cameraOn && (
      (showPanel && settings.source !== 'camera')
      || (preparing && settings.source !== 'camera')
      || (canvasBubble && !live)
      || (live && recordingCamera && !prefs.cameraHidden)
    );
    showBubble(wantBubble && document.visibilityState === 'visible');
    tick();
  }

  // --- screenshot ------------------------------------------------------------

  function selectArea() {
    return new Promise((resolve) => {
      const layer = el('div', { className: 'select' }, '<div class="help">Drag to select an area · Esc to cancel</div>');
      const box = el('div', { className: 'rect' });
      box.hidden = true;
      layer.append(box);
      root.append(layer);
      let start = null;
      const done = (r) => {
        layer.remove();
        removeEventListener('keydown', onKey, true);
        resolve(r);
      };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(null); } };
      addEventListener('keydown', onKey, true);
      layer.addEventListener('pointerdown', (e) => {
        start = { x: e.clientX, y: e.clientY };
        layer.setPointerCapture(e.pointerId);
        layer.classList.add('dragging');
        box.hidden = false;
      });
      layer.addEventListener('pointermove', (e) => {
        if (!start) return;
        Object.assign(box.style, {
          left: `${Math.min(start.x, e.clientX)}px`, top: `${Math.min(start.y, e.clientY)}px`,
          width: `${Math.abs(e.clientX - start.x)}px`, height: `${Math.abs(e.clientY - start.y)}px`,
        });
      });
      layer.addEventListener('pointerup', (e) => {
        if (!start) return;
        const r = { x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY), w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y) };
        done(r.w > 4 && r.h > 4 ? r : null);
      });
    });
  }

  const frames = (n) => new Promise((r) => { const step = () => (n-- <= 0 ? setTimeout(r, 60) : requestAnimationFrame(step)); step(); });

  async function screenshot(kind) {
    panelOpen = false;
    holdUntil = Date.now() + 120_000;
    render();
    let rect = null;
    if (kind === 'area') {
      rect = await selectArea();
      if (!rect) { holdUntil = 0; panelOpen = 'screenshot'; render(); return; }
    }
    host.style.display = 'none';
    await frames(2);
    const res = await send({ target: 'sw', cmd: 'screenshot', rect, dpr: devicePixelRatio });
    host.style.display = '';
    toast(res?.error ? `Screenshot failed: ${res.error}` : `Screenshot saved to ${res?.folder || 'Downloads/FreeRec'}`, res?.name && {
      label: 'Open',
      run: () => send({ target: 'sw', cmd: 'open', path: `library.html?tab=screenshots&new=${encodeURIComponent(res.name)}` }),
    });
  }

  function toast(text, action) {
    holdUntil = Date.now() + 5000;
    mount();
    const t = el('div', { className: 'toast' });
    t.append(el('span', { textContent: text }));
    if (action) {
      const b = el('button', { textContent: action.label });
      b.onclick = () => { action.run(); t.remove(); };
      t.append(b);
    }
    root.append(t);
    setTimeout(() => { t.remove(); render(); }, 5000);
  }

  // --- events ----------------------------------------------------------------

  addEventListener('message', (e) => {
    if (!ui || e.source !== ui.panel.contentWindow || e.data?.freerec !== 'panel') return;
    const { type } = e.data;
    if (type === 'size') {
      ui.panel.style.width = `${e.data.width}px`;
      ui.panel.style.height = `${e.data.height}px`;
    } else if (type === 'close') {
      panelOpen = false;
      if (e.data.keepBubble) startingUntil = Date.now() + 8000;
      render();
    } else if (type === 'screenshot') {
      screenshot(e.data.kind);
    }
  });

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && rec.status === 'countdown') toRecorder('cancel');
  }, true);

  function togglePanel(view) {
    if (LIVE.includes(rec.status)) return;
    panelOpen = panelOpen ? false : (view || true);
    if (!panelOpen && ui) ui.panel.removeAttribute('src');
    render();
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.freerec === 'toggle-panel' && (!isExtensionPage || msg.tabId === window.__freerec.tabId)) {
      togglePanel(msg.view);
      sendResponse({ ok: true });
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.overlayPrefs) {
      prefs = { ...prefs, ...changes.overlayPrefs.newValue };
      if (ui?.bubble && !ui.bubble.classList.contains('dragging')) placeBubble(ui.bubble);
    }
    if (changes.settings) settings = { ...settings, ...changes.settings.newValue };
    if (changes.rec) {
      rec = changes.rec.newValue || { status: 'idle' };
      if (rec.status !== 'idle') startingUntil = 0;
    }
    if (changes.rec || changes.overlayPrefs || changes.settings) render();
  });
  document.addEventListener('visibilitychange', render);
  addEventListener('resize', () => ui?.bubble && placeBubble(ui.bubble));

  window.__freerec = { togglePanel, tabId: null };

  (async () => {
    try {
      const data = await chrome.storage.local.get(['rec', 'overlayPrefs', 'settings']);
      rec = data.rec || { status: 'idle' };
      prefs = { ...prefs, ...data.overlayPrefs };
      settings = { cameraOn: true, source: 'screen', bubbleSize: 'medium', ...data.settings };
      if (isExtensionPage) window.__freerec.tabId = (await chrome.tabs.getCurrent())?.id ?? null;
      render();
    } catch {
      unmount(); // extension reloaded; this context is dead
    }
  })();
})();
