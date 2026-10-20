// On-page overlay shown while recording a screen/tab: draggable camera bubble,
// control bar and the 3-2-1 countdown. Injected by the service worker into the
// active tab; safe to inject repeatedly.
(() => {
  if (window.__freerecOverlay) {
    window.__freerecOverlay.refresh();
    return;
  }

  const LIVE = ['countdown', 'recording', 'paused'];
  const SIZES = { small: 120, medium: 200, large: 300 };
  const NEXT_SIZE = { small: 'medium', medium: 'large', large: 'small' };

  const ICON = {
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
    cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/></svg>',
    resize: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>',
    grip: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  };

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .bubble {
      position: fixed; z-index: 2147483646; border-radius: 50%; cursor: grab;
      box-shadow: 0 6px 24px rgb(0 0 0 / 35%); background: #222; touch-action: none;
    }
    .bubble.dragging { cursor: grabbing; }
    .bubble iframe { width: 100%; height: 100%; border: 0; border-radius: 50%; pointer-events: none; display: block; background: transparent; }
    .bubble .tools { position: absolute; top: -6px; right: -6px; display: none; gap: 4px; }
    .bubble:hover .tools { display: flex; }
    .tools button, .bar button {
      all: unset; cursor: pointer; display: grid; place-items: center;
      width: 32px; height: 32px; border-radius: 50%; color: #fff; background: rgb(30 30 36 / 92%);
    }
    .tools button:hover, .bar button:hover { background: rgb(60 60 70 / 95%); }
    svg { width: 16px; height: 16px; }
    .bar {
      position: fixed; z-index: 2147483647; left: 20px; bottom: 20px;
      display: flex; align-items: center; gap: 4px; padding: 6px;
      background: rgb(20 20 24 / 92%); color: #fff; border-radius: 999px;
      box-shadow: 0 6px 24px rgb(0 0 0 / 35%); user-select: none; touch-action: none;
    }
    .bar .grip { width: 18px; color: #888; cursor: grab; display: grid; place-items: center; }
    .bar .time { font: 600 13px ui-monospace, Menlo, monospace; padding: 0 8px; display: flex; align-items: center; gap: 6px; min-width: 64px; }
    .bar .dot { width: 8px; height: 8px; border-radius: 50%; background: #e5484d; }
    .bar.paused .dot { background: #d97706; }
    .bar:not(.paused) .dot { animation: blink 1.2s infinite; }
    .bar button.stop { background: #e5484d; }
    .bar button.stop:hover { background: #f25c61; }
    .bar button.armed { background: #e5484d; width: auto; padding: 0 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
    .bar button.off { color: #777; }
    @keyframes blink { 50% { opacity: .3; } }
    .countdown {
      position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center;
      background: rgb(0 0 0 / 35%); pointer-events: none;
    }
    .countdown span {
      width: 180px; height: 180px; border-radius: 50%; display: grid; place-items: center;
      background: rgb(20 20 24 / 85%); color: #fff; font: 700 96px system-ui, sans-serif;
    }
  `;

  let host = null;
  let root = null;
  let rec = null;
  let prefs = { cameraHidden: false, bubbleSize: null, bubblePos: null };
  let ui = null;
  let tickId = null;

  const send = (cmd) => chrome.runtime.sendMessage({ target: 'recorder', cmd }).catch(() => {});
  const savePrefs = (patch) => {
    prefs = { ...prefs, ...patch };
    chrome.storage.local.set({ overlayPrefs: prefs });
  };

  function el(tag, attrs = {}, html = '') {
    const node = document.createElement(tag);
    Object.assign(node, attrs);
    if (html) node.innerHTML = html;
    return node;
  }

  function makeDraggable(node, handle, onEnd) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault();
      const rect = node.getBoundingClientRect();
      const dx = e.clientX - rect.left;
      const dy = e.clientY - rect.top;
      node.classList.add('dragging');
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const x = Math.min(Math.max(0, ev.clientX - dx), innerWidth - rect.width);
        const y = Math.min(Math.max(0, ev.clientY - dy), innerHeight - rect.height);
        Object.assign(node.style, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto' });
      };
      const up = () => {
        node.classList.remove('dragging');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        onEnd?.(node.getBoundingClientRect());
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  function mount() {
    host = el('freerec-overlay');
    root = host.attachShadow({ mode: 'closed' });
    root.append(el('style', { textContent: CSS }));

    const bar = el('div', { className: 'bar' });
    const grip = el('div', { className: 'grip', title: 'Drag' }, ICON.grip);
    const time = el('div', { className: 'time' }, '<span class="dot"></span><span class="t">0:00</span>');
    const pause = el('button', { title: 'Pause / resume (Alt+Shift+P)' }, ICON.pause);
    const stop = el('button', { className: 'stop', title: 'Finish & save (Alt+Shift+X)' }, ICON.stop);
    const trash = el('button', { title: 'Discard recording' }, ICON.trash);
    const cam = el('button', { title: 'Show / hide camera' }, ICON.cam);
    bar.append(grip, time, pause, stop, trash, cam);
    makeDraggable(bar, grip);

    pause.onclick = () => send('togglePause');
    stop.onclick = () => send('stop');
    let armTimer = null;
    trash.onclick = () => {
      if (trash.classList.contains('armed')) {
        send('cancel');
        return;
      }
      trash.classList.add('armed');
      trash.textContent = 'Discard?';
      armTimer = setTimeout(() => {
        trash.classList.remove('armed');
        trash.innerHTML = ICON.trash;
      }, 3000);
    };
    cam.onclick = () => {
      savePrefs({ cameraHidden: !prefs.cameraHidden });
      render();
    };

    const countdown = el('div', { className: 'countdown' }, '<span></span>');
    root.append(bar, countdown);
    ui = { bar, time: time.querySelector('.t'), pause, cam, countdown, bubble: null, armTimer };
    document.documentElement.append(host);
    tickId = setInterval(tick, 250);
  }

  function unmount() {
    clearInterval(tickId);
    host?.remove();
    host = root = ui = null;
  }

  function bubbleSize() {
    return SIZES[prefs.bubbleSize || rec.bubbleSize] || SIZES.medium;
  }

  function placeBubble(node) {
    const size = bubbleSize();
    node.style.width = node.style.height = `${size}px`;
    const pos = prefs.bubblePos;
    const x = pos ? Math.min(pos.x, innerWidth - size) : 24;
    const y = pos ? Math.min(pos.y, innerHeight - size) : innerHeight - size - 80;
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
    const frame = el('iframe', {
      src: chrome.runtime.getURL(`camera.html?label=${encodeURIComponent(rec.cameraLabel || '')}`),
      allow: 'camera',
      title: 'FreeRec camera',
    });
    const tools = el('div', { className: 'tools' });
    const resize = el('button', { title: 'Change size' }, ICON.resize);
    resize.onclick = () => {
      const current = prefs.bubbleSize || rec.bubbleSize || 'medium';
      savePrefs({ bubbleSize: NEXT_SIZE[current] });
      placeBubble(bubble);
    };
    tools.append(resize);
    bubble.append(frame, tools);
    placeBubble(bubble);
    makeDraggable(bubble, bubble, (r) => savePrefs({ bubblePos: { x: r.left, y: r.top } }));
    root.append(bubble);
    ui.bubble = bubble;
  }

  function tick() {
    if (!rec || !ui) return;
    const left = (rec.countdownEnd || 0) - Date.now();
    const counting = rec.status === 'countdown' && left > 0;
    ui.countdown.hidden = !counting;
    ui.countdown.style.display = counting ? '' : 'none';
    if (counting) ui.countdown.firstChild.textContent = String(Math.ceil(left / 1000));
    let ms = 0;
    if (rec.startedAt) {
      const end = rec.status === 'paused' && rec.pausedAt ? rec.pausedAt : Date.now();
      ms = end - rec.startedAt - (rec.pausedTotal || 0);
    }
    const s = Math.max(0, Math.floor(ms / 1000));
    ui.time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function render() {
    const live = rec && LIVE.includes(rec.status) && rec.mode !== 'camera';
    if (!live) {
      unmount();
      return;
    }
    if (!ui) mount();
    const paused = rec.status === 'paused';
    ui.bar.classList.toggle('paused', paused);
    ui.pause.innerHTML = paused ? ICON.play : ICON.pause;
    ui.cam.hidden = !rec.cameraOn;
    ui.cam.classList.toggle('off', prefs.cameraHidden);
    // Only the visible tab keeps the camera open.
    showBubble(Boolean(rec.cameraOn) && !prefs.cameraHidden && document.visibilityState === 'visible');
    tick();
  }

  async function refresh() {
    try {
      const data = await chrome.storage.local.get(['rec', 'overlayPrefs']);
      rec = data.rec;
      prefs = { ...prefs, ...data.overlayPrefs };
      render();
    } catch {
      unmount(); // extension reloaded; this context is dead
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.overlayPrefs) prefs = { ...prefs, ...changes.overlayPrefs.newValue };
    if (changes.rec) rec = changes.rec.newValue;
    if (changes.rec || changes.overlayPrefs) render();
  });
  document.addEventListener('visibilitychange', render);
  addEventListener('resize', () => ui?.bubble && placeBubble(ui.bubble));

  window.__freerecOverlay = { refresh };
  refresh();
})();
