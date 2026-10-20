// In-page control panel (lives in an extension iframe injected by content.js).
import { getSettings, saveSettings, getEffects, saveEffects, recordingMode } from './lib/store.js';
import { FILTERS, BACKGROUNDS, backgroundTile } from './lib/catalog.js';
import { BG_IMAGES, TEMPLATES, renderStage } from './lib/stage.js';
import { ICONS } from './lib/icons.js';

const root = document.getElementById('panel');
const fileInput = document.getElementById('file');

const SOURCES = [
  { id: 'screen', label: 'Full Screen', icon: ICONS.monitor },
  { id: 'window', label: 'Window', icon: ICONS.window },
  { id: 'tab', label: 'Current tab', icon: ICONS.tab },
  { id: 'camera', label: 'Camera only', icon: ICONS.user },
];

const state = {
  view: 'record', // record | screenshot | effects
  effectsTab: 'backgrounds',
  menu: null, // source | camera | mic | more
  settings: await getSettings(),
  effects: await getEffects(),
  cams: [],
  mics: [],
  labelsOk: true,
  folderName: null,
  snapshot: null,
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const post = (type, data = {}) => parent.postMessage({ freerec: 'panel', type, ...data }, '*');

const tiles = new Map();
const tileFor = (id) => {
  if (!tiles.has(id)) tiles.set(id, backgroundTile(id));
  return tiles.get(id);
};

// Neutral face-and-desk illustration used to preview filters while the camera is off.
const SAMPLE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#d9b48f"/><rect y="62" width="100" height="38" fill="#7a5a3a"/><rect x="8" y="12" width="26" height="40" fill="#f2e6d0"/><rect x="66" y="10" width="26" height="22" fill="#4f7cac"/><circle cx="50" cy="44" r="16" fill="#f1c7a3"/><path d="M28 100c2-20 11-30 22-30s20 10 22 30z" fill="#3e6fb0"/><path d="M34 40c0-12 8-18 16-18s16 6 16 18c-4-6-10-8-16-8s-12 2-16 8z" fill="#3b2a20"/></svg>')}`;

// --- data -----------------------------------------------------------------

async function loadDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  state.cams = devices.filter((d) => d.kind === 'videoinput');
  state.mics = devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications');
  state.labelsOk = devices.length > 0 && devices.some((d) => d.label);
  const { folderName } = await chrome.storage.local.get('folderName');
  state.folderName = folderName || null;
}

const setSettings = async (patch) => {
  state.settings = await saveSettings(patch);
  render();
};
const setEffects = async (patch) => {
  state.effects = await saveEffects(patch);
  render();
};

const deviceName = (list, label, fallback) => {
  const d = list.find((x) => x.label === label) || list[0];
  return d?.label || fallback;
};

// --- views ----------------------------------------------------------------

function head() {
  const s = state.view === 'screenshot';
  return `<div class="head">
    <button class="icon-btn" data-act="home" title="My recordings">${ICONS.home}</button>
    <div class="switcher" role="group" aria-label="Mode">
      <button data-act="view-record" aria-pressed="${!s}" title="Record video">${ICONS.video}</button>
      <button data-act="view-screenshot" aria-pressed="${s}" title="Screenshot">${ICONS.camera}</button>
    </div>
    <button class="icon-btn" data-act="close" title="Close">${ICONS.close}</button>
  </div>`;
}

function menuHtml(kind, top) {
  const { settings } = state;
  const tick = (on) => (on ? `<span class="tick">${ICONS.check}</span>` : '');
  let items = '';
  if (kind === 'source') {
    items = SOURCES.map((x, i) => `${i === 3 ? '<hr>' : ''}<button data-act="source" data-v="${x.id}">${x.icon}<span class="label">${x.label}</span>${tick(settings.source === x.id)}</button>`).join('');
  } else if (kind === 'camera') {
    items = state.cams.map((d, i) => `<button data-act="camera" data-v="${esc(d.label)}">${ICONS.video}<span class="label">${esc(d.label || `Camera ${i + 1}`)}</span>${tick(settings.cameraOn && deviceName(state.cams, settings.cameraLabel) === d.label)}</button>`).join('')
      + `<hr><button data-act="camera-off">${ICONS.camOff}<span class="label">No Camera</span>${tick(!settings.cameraOn)}</button>`;
  } else if (kind === 'mic') {
    items = state.mics.map((d, i) => `<button data-act="mic" data-v="${esc(d.label)}">${ICONS.mic}<span class="label">${esc(d.label || `Microphone ${i + 1}`)}</span>${tick(settings.micEnabled && deviceName(state.mics, settings.micLabel) === d.label)}</button>`).join('')
      + `<hr><button data-act="mic-off">${ICONS.micOff}<span class="label">No Microphone</span>${tick(!settings.micEnabled)}</button>`;
  } else if (kind === 'more') {
    const dark = settings.theme === 'dark';
    items = `<button data-act="settings">${ICONS.gear}<span class="label">Settings</span></button>
      <button data-act="home">${ICONS.library}<span class="label">My recordings</span></button>
      <button data-act="help">${ICONS.help}<span class="label">Help</span></button>
      <button data-act="theme">${ICONS.contrast}<span class="label">Switch to ${dark ? 'light' : 'dark'}</span></button>
      <button data-act="close">${ICONS.close}<span class="label">Close</span></button>`;
  }
  return `<div class="menu" style="${top}">${items}</div>`;
}

function recordView() {
  const { settings } = state;
  const source = SOURCES.find((x) => x.id === settings.source) || SOURCES[0];
  const camName = settings.cameraOn ? deviceName(state.cams, settings.cameraLabel, 'Camera') : 'No Camera';
  const micName = settings.micEnabled ? deviceName(state.mics, settings.micLabel, 'Microphone') : 'No Microphone';
  const cameraOnly = settings.source === 'camera';
  const noCams = state.cams.length === 0;
  const blurOn = state.effects.background === 'blur';
  const where = state.folderName ? `Saving to “${esc(state.folderName)}”` : 'Saving to Downloads/FreeRec';
  const menuTop = { source: 'top: 132px', camera: 'top: 200px', mic: 'top: 268px', more: 'bottom: 64px' }[state.menu] || '';

  return `${head()}
    ${state.labelsOk ? '' : `<div class="banner">Camera &amp; mic need permission. <button data-act="permissions">Allow access</button></div>`}
    <button class="row" data-act="menu-source">${source.icon}<span class="label">${source.label}</span>${ICONS.chevron}</button>
    <button class="row" data-act="menu-camera" ${noCams ? 'disabled' : ''}>
      ${settings.cameraOn && !noCams ? ICONS.video : `<span class="danger">${ICONS.camOff}</span>`}
      <span class="label">${esc(noCams ? 'No camera found' : camName)}</span>
      ${cameraOnly || noCams ? '' : `<span class="pill ${settings.cameraOn ? 'on' : 'off'}" data-act="toggle-camera">${settings.cameraOn ? 'On' : 'Off'}</span>`}
    </button>
    <button class="row" data-act="menu-mic">
      ${settings.micEnabled ? ICONS.mic : `<span class="danger">${ICONS.micOff}</span>`}
      <span class="label">${esc(micName)}</span>
      <span class="pill ${settings.micEnabled ? 'on' : 'off'}" data-act="toggle-mic">${settings.micEnabled ? 'On' : 'Off'}</span>
    </button>
    <button class="record-btn" data-act="start" ${cameraOnly && noCams ? 'disabled' : ''}>Start Recording</button>
    <div class="sub" title="${where}">No time limit · ${where}</div>
    <div class="footer">
      <button data-act="effects" ${cameraOnly ? 'disabled title="Effects are for the camera bubble"' : ''}>${ICONS.palette}Effects</button>
      <button data-act="blur" class="${blurOn ? 'active' : ''}" ${cameraOnly || !settings.cameraOn ? 'disabled' : ''}>${ICONS.blur}Blur</button>
      <button data-act="folder" title="${where}">${ICONS.folder}Folder</button>
      <button data-act="menu-more">${ICONS.more}More</button>
    </div>
    ${state.menu ? menuHtml(state.menu, menuTop) : ''}`;
}

function screenshotView() {
  const area = state.settings.screenshotType !== 'tab';
  return `${head()}
    <h2>Screenshot type</h2>
    <div class="choices">
      <button class="choice" data-act="shot-area" aria-pressed="${area}"><span class="box">${ICONS.area}</span>Custom area</button>
      <button class="choice" data-act="shot-tab" aria-pressed="${!area}"><span class="box">${ICONS.rect}</span>Current tab</button>
    </div>
    <button class="record-btn" data-act="screenshot">${area ? 'Select area' : 'Take screenshot'}</button>
    <div class="sub">${state.folderName ? `Saving to “${esc(state.folderName)}”` : 'Saving to Downloads/FreeRec'}</div>`;
}

function effectsView() {
  const tab = state.effectsTab;
  const t = (id, label) => `<button data-act="eff-tab" data-v="${id}" aria-selected="${tab === id}">${label}</button>`;
  let body = '';
  const cameraHint = state.settings.cameraOn ? '' : '<div class="hint">Turn your camera on to preview the effect.</div>';
  if (tab === 'backgrounds') {
    const bg = state.effects.background;
    const tile = (id) => {
      if (id === 'none') return `<button class="tile none" data-act="bg" data-v="none" aria-pressed="${bg === 'none'}">None</button>`;
      if (id === 'blur') return `<button class="tile blur" data-act="bg" data-v="blur" aria-pressed="${bg === 'blur'}">Blur</button>`;
      return `<button class="tile" data-act="bg" data-v="${id}" aria-pressed="${bg === id}" style="background-image:url(${tileFor(id)})" title="${id}"></button>`;
    };
    body = `<div class="section">Top picks</div>${cameraHint}
      <div class="grid">${BACKGROUNDS.top.map(tile).join('')}</div>
      <div class="section">Scenes</div>
      <div class="grid">${BACKGROUNDS.scenes.map(tile).join('')}</div>
      <div class="section">Colors</div>
      <div class="grid">${BACKGROUNDS.colors.map((c) => `<button class="tile" data-act="bg" data-v="${c}" aria-pressed="${bg === c}" style="background:${c}" title="${c}"></button>`).join('')}</div>
      <div class="section">Your image</div>
      <div class="grid">
        <button class="tile upload" data-act="upload" title="Upload an image">${ICONS.upload}</button>
        ${state.customBg ? `<button class="tile" data-act="bg" data-v="custom" aria-pressed="${bg === 'custom'}" style="background-image:url(${state.customBg})"></button>` : ''}
      </div>`;
  } else if (tab === 'filters') {
    const img = state.snapshot || SAMPLE;
    body = `<div class="section">Top picks</div>${cameraHint}
      <div class="grid">${FILTERS.map((f) => (f.id === 'none'
        ? `<button class="tile none" data-act="filter" data-v="none" aria-pressed="${state.effects.filter === 'none'}">None</button>`
        : `<button class="tile" data-act="filter" data-v="${f.id}" aria-pressed="${state.effects.filter === f.id}" title="${f.name}"><img src="${img}" style="filter:${f.css}" alt=""><span class="name">${f.name}</span></button>`)).join('')}</div>`;
  } else {
    const card = (v, name, stage) => `<button class="card" data-act="canvas" data-v="${v}"><span class="thumb" data-stage='${esc(JSON.stringify(stage))}'></span>${esc(name)}</button>`;
    body = `<div class="hint">Record a slide-like page with your camera bubble on top.</div>
      <div class="section">Templates</div>
      <div class="cards">${Object.entries(TEMPLATES).map(([id, t]) => card(`t:${id}`, t.name, { template: id })).join('')}</div>
      <div class="section">Backgrounds</div>
      <div class="cards">${Object.entries(BG_IMAGES).map(([id, b]) => card(`b:${id}`, b.name, { bg: { type: 'image', value: id }, layout: 'blank' })).join('')}</div>`;
  }
  return `<div class="eff-head"><button class="icon-btn" data-act="view-record" title="Back">${ICONS.back}</button>Effects</div>
    <div class="tabs" role="tablist">${t('backgrounds', 'Backgrounds')}${t('filters', 'Filters')}${t('canvas', 'Canvas')}</div>
    <div class="scroll">${body}</div>`;
}

function render() {
  document.documentElement.dataset.theme = state.settings.theme;
  root.classList.toggle('wide', state.view === 'effects');
  root.innerHTML = state.view === 'screenshot' ? screenshotView() : state.view === 'effects' ? effectsView() : recordView();
  root.querySelectorAll('[data-stage]').forEach((el) => renderStage(el, { texts: {}, ...JSON.parse(el.dataset.stage) }, { thumbBubble: true }));
  requestAnimationFrame(reportSize);
}

function reportSize() {
  const pad = 24;
  let bottom = root.getBoundingClientRect().bottom;
  root.querySelectorAll('.menu').forEach((m) => { bottom = Math.max(bottom, m.getBoundingClientRect().bottom); });
  post('size', { width: Math.ceil(root.offsetWidth + pad * 2), height: Math.ceil(bottom + pad) });
}

// --- actions --------------------------------------------------------------

const open = (path) => chrome.tabs.create({ url: chrome.runtime.getURL(path) });

const actions = {
  home: () => open('library.html'),
  close: () => post('close'),
  'view-record': () => { state.view = 'record'; render(); },
  'view-screenshot': () => { state.view = 'screenshot'; state.menu = null; render(); },
  'menu-source': () => toggleMenu('source'),
  'menu-camera': () => toggleMenu('camera'),
  'menu-mic': () => toggleMenu('mic'),
  'menu-more': () => toggleMenu('more'),
  source: (v) => setSettings({ source: v }),
  camera: (v) => setSettings({ cameraOn: true, cameraLabel: v }),
  'camera-off': () => setSettings({ cameraOn: false }),
  mic: (v) => setSettings({ micEnabled: true, micLabel: v }),
  'mic-off': () => setSettings({ micEnabled: false }),
  'toggle-camera': () => setSettings({ cameraOn: !state.settings.cameraOn }),
  'toggle-mic': () => setSettings({ micEnabled: !state.settings.micEnabled }),
  permissions: () => open('options.html#permissions'),
  settings: () => open('options.html'),
  folder: () => open('options.html#folder'),
  help: () => open('options.html#help'),
  theme: () => setSettings({ theme: state.settings.theme === 'dark' ? 'light' : 'dark' }),
  start: async () => {
    post('close', { keepBubble: recordingMode(state.settings) === 'screen-camera' });
    await chrome.runtime.sendMessage({ target: 'sw', cmd: 'start' });
  },
  effects: () => { state.view = 'effects'; render(); requestSnapshot(); },
  blur: () => setEffects({ background: state.effects.background === 'blur' ? 'none' : 'blur' }),
  'shot-area': () => setSettings({ screenshotType: 'area' }),
  'shot-tab': () => setSettings({ screenshotType: 'tab' }),
  screenshot: () => post('screenshot', { kind: state.settings.screenshotType === 'tab' ? 'tab' : 'area' }),
  'eff-tab': (v) => { state.effectsTab = v; render(); },
  bg: (v) => setEffects({ background: v }),
  filter: (v) => setEffects({ filter: v }),
  upload: () => fileInput.click(),
  canvas: (v) => {
    const [kind, id] = v.split(':');
    open(`canvas.html?${kind === 't' ? 'template' : 'bg'}=${id}`);
  },
};

function toggleMenu(kind) {
  state.menu = state.menu === kind ? null : kind;
  render();
}

root.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) {
    if (state.menu && !e.target.closest('.menu')) { state.menu = null; render(); }
    return;
  }
  e.stopPropagation();
  const act = el.dataset.act;
  if (state.menu && !el.closest('.menu') && !act.startsWith('menu-') && !act.startsWith('toggle-')) state.menu = null;
  else if (el.closest('.menu')) state.menu = null;
  actions[act]?.(el.dataset.v);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (state.menu) { state.menu = null; render(); } else post('close');
  }
});

fileInput.onchange = async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  state.customBg = c.toDataURL('image/jpeg', 0.85);
  await chrome.storage.local.set({ customBg: state.customBg });
  setEffects({ background: 'custom' });
};

// Live face snapshots from the camera bubble for filter previews.
const channel = new BroadcastChannel('freerec-camera');
channel.onmessage = (e) => {
  if (e.data?.type === 'snapshot' && state.view === 'effects') {
    state.snapshot = e.data.url;
    if (state.effectsTab === 'filters') {
      root.querySelectorAll('.tile img').forEach((img) => { img.src = e.data.url; });
    }
  }
};
function requestSnapshot() {
  if (state.view !== 'effects') return;
  channel.postMessage({ type: 'snapshot-request' });
  setTimeout(requestSnapshot, 2500);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) state.settings = { ...state.settings, ...changes.settings.newValue };
  if (changes.effects) state.effects = { ...state.effects, ...changes.effects.newValue };
  if (changes.folderName) state.folderName = changes.folderName.newValue || null;
  if (changes.settings || changes.effects || changes.folderName) render();
});
navigator.mediaDevices.addEventListener?.('devicechange', async () => { await loadDevices(); render(); });

new ResizeObserver(() => reportSize()).observe(root);

const { customBg } = await chrome.storage.local.get('customBg');
state.customBg = customBg || null;
const initial = new URLSearchParams(location.search).get('view');
if (initial === 'screenshot') state.view = 'screenshot';
await loadDevices();
render();
