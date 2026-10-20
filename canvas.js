// Canvas: a slide-like page to record with your camera bubble on top.
import { BG_COLORS, BG_IMAGES, LAYOUTS, TEMPLATES, renderStage, readSlots } from './lib/stage.js';
import { getSettings, saveSettings } from './lib/store.js';

const $ = (id) => document.getElementById(id);
const KEY = 'freerec-canvas';
const LIVE = ['countdown', 'recording', 'paused'];
const BUBBLE_SIZES = { small: 140, medium: 220, large: 320 };
const PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';

let state = { bg: { type: 'image', value: 'pastel' }, layout: 'blank', template: null, texts: {}, customColors: [] };
try {
  state = { ...state, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
} catch { /* fresh state */ }

const save = () => {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage blocked */ }
};

let slotKey = null;
function render() {
  slotKey = renderStage($('stage'), state, { editable: true });
  save();
}

// Edits are kept per layout/template so switching back restores them.
$('stage').addEventListener('input', () => {
  state.texts[slotKey] = readSlots($('stage'));
  save();
});
$('stage').addEventListener('focusin', (e) => {
  const list = e.target.closest('[data-list]');
  if (list && !list.children.length) list.innerHTML = '<li></li>';
});

// Templates choose where the camera bubble sits.
async function placeBubble(pos) {
  if (!pos) return;
  const [{ overlayPrefs = {} }, settings] = await Promise.all([chrome.storage.local.get('overlayPrefs'), getSettings()]);
  const size = BUBBLE_SIZES[overlayPrefs.bubbleSize || settings.bubbleSize] || BUBBLE_SIZES.medium;
  const bubblePos = { x: Math.round(pos.x * innerWidth - size / 2), y: Math.round(pos.y * innerHeight - size / 2) };
  await chrome.storage.local.set({ overlayPrefs: { ...overlayPrefs, bubblePos } });
}

// --- sheets ------------------------------------------------------------------

function thumb(act, value, pressed, stageState) {
  const b = document.createElement('button');
  b.className = 'thumb';
  b.dataset.act = act;
  b.dataset.v = value;
  b.setAttribute('aria-pressed', String(pressed));
  const s = document.createElement('div');
  renderStage(s, { texts: {}, ...stageState }, { thumbBubble: true });
  b.append(s);
  return b;
}

const SHEETS = {
  background() {
    const frag = document.createDocumentFragment();
    const h = (t) => Object.assign(document.createElement('h2'), { textContent: t });
    const colors = document.createElement('div');
    colors.className = 'colors';
    const add = Object.assign(document.createElement('button'), { className: 'swatch add', title: 'Custom colour', innerHTML: PLUS });
    add.dataset.act = 'pick-color';
    colors.append(add);
    for (const c of [...BG_COLORS, ...state.customColors]) {
      const sw = Object.assign(document.createElement('button'), { className: 'swatch', title: c });
      sw.style.background = c;
      sw.dataset.act = 'color';
      sw.dataset.v = c;
      sw.setAttribute('aria-pressed', String(!state.template && state.bg.type === 'color' && state.bg.value === c));
      colors.append(sw);
    }
    const grid = document.createElement('div');
    grid.className = 'thumbs';
    for (const id of Object.keys(BG_IMAGES)) {
      grid.append(thumb('image', id, !state.template && state.bg.type === 'image' && state.bg.value === id, { bg: { type: 'image', value: id }, layout: 'blank' }));
    }
    frag.append(h('Background color'), colors, h('Background image'), grid);
    return frag;
  },
  layout() {
    const frag = document.createDocumentFragment();
    frag.append(Object.assign(document.createElement('h2'), { textContent: 'Text layout' }));
    const grid = document.createElement('div');
    grid.className = 'thumbs layouts';
    for (const id of Object.keys(LAYOUTS)) {
      grid.append(thumb('layout', id, !state.template && state.layout === id, { bg: { type: 'color', value: '#f6f5f0' }, layout: id }));
    }
    frag.append(grid);
    return frag;
  },
  templates() {
    const frag = document.createDocumentFragment();
    frag.append(Object.assign(document.createElement('h2'), { textContent: 'Templates' }));
    const grid = document.createElement('div');
    grid.className = 'thumbs';
    for (const id of Object.keys(TEMPLATES)) grid.append(thumb('template', id, state.template === id, { template: id }));
    frag.append(grid);
    return frag;
  },
};

let open = null;
function showSheet(name) {
  open = name;
  document.querySelectorAll('[data-sheet]').forEach((b) => b.setAttribute('aria-expanded', String(b.dataset.sheet === open)));
  $('sheet').hidden = !open;
  if (open) $('sheet-body').replaceChildren(SHEETS[open]());
}

document.querySelectorAll('[data-sheet]').forEach((b) => {
  b.onclick = () => showSheet(open === b.dataset.sheet ? null : b.dataset.sheet);
});
$('sheet-close').onclick = () => showSheet(null);
addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) showSheet(null); });

$('sheet').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const v = b.dataset.v;
  switch (b.dataset.act) {
    case 'pick-color':
      $('color').click();
      return;
    case 'color':
      state.template = null;
      state.bg = { type: 'color', value: v };
      break;
    case 'image':
      state.template = null;
      state.bg = { type: 'image', value: v };
      break;
    case 'layout':
      state.template = null;
      state.layout = v;
      break;
    case 'template':
      state.template = v;
      placeBubble(TEMPLATES[v].bubble);
      break;
  }
  render();
  showSheet(open);
});

$('color').addEventListener('change', () => {
  const c = $('color').value;
  if (!BG_COLORS.includes(c) && !state.customColors.includes(c)) state.customColors = [...state.customColors, c].slice(-6);
  state.template = null;
  state.bg = { type: 'color', value: c };
  render();
  showSheet(open);
});

// The toolbar and sheets hide while recording so they aren't in the video.
function syncRecording(rec) {
  const live = LIVE.includes(rec?.status);
  document.body.classList.toggle('hidden-ui', live);
  if (live) document.activeElement?.blur();
}
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.rec) syncRecording(c.rec.newValue); });
chrome.storage.local.get('rec').then(({ rec }) => syncRecording(rec));

// --- start -----------------------------------------------------------------

const params = new URLSearchParams(location.search);
const tpl = params.get('template');
const bg = params.get('bg');
if (tpl && TEMPLATES[tpl]) {
  state.template = tpl;
  placeBubble(TEMPLATES[tpl].bubble);
}
if (bg && BG_IMAGES[bg]) {
  state.template = null;
  state.bg = { type: 'image', value: bg };
}
render();

if (params.size) {
  history.replaceState(null, '', 'canvas.html');
  await saveSettings({ source: 'tab' });
  const openPanel = () => (window.__freerec ? window.__freerec.togglePanel() : setTimeout(openPanel, 50));
  setTimeout(openPanel, 300);
}
