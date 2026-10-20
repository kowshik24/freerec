import { getFolder, folderPermission, pickFolder, setFolder, formatBytes, formatDuration } from './lib/store.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const highlight = params.get('new');
const KINDS = { videos: /\.(webm|mp4|mkv|mov)$/i, screenshots: /\.(png|jpe?g|webp)$/i };
const urls = new Set();
let tab = params.get('tab') === 'screenshots' || /\.(png|jpe?g)$/i.test(highlight || '') ? 'screenshots' : 'videos';
let entries = []; // { handle, file }
let dir = null;

function objectUrl(file) {
  const u = URL.createObjectURL(file);
  urls.add(u);
  return u;
}

function relative(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'just now';
  const units = [[60, 'min'], [3600, 'hour'], [86400, 'day'], [604800, 'week'], [2629800, 'month'], [31557600, 'year']];
  let [div, name] = units[0];
  for (const u of units) if (s >= u[0]) [div, name] = u;
  const n = Math.floor(s / div);
  return `${n} ${name}${n === 1 ? '' : 's'} ago`;
}

const shortDuration = (sec) => (sec < 60 ? `${Math.round(sec)} sec` : formatDuration(sec * 1000));

function openViewer(file, name) {
  const body = $('modal-body');
  body.replaceChildren();
  const media = KINDS.videos.test(name) ? Object.assign(document.createElement('video'), { controls: true, autoplay: true }) : document.createElement('img');
  media.src = objectUrl(file);
  body.append(media);
  $('modal-title').textContent = name;
  $('modal').hidden = false;
}

function closeViewer() {
  $('modal').hidden = true;
  $('modal-body').replaceChildren();
}
$('modal-close').onclick = closeViewer;
$('modal').onclick = (e) => { if (e.target === $('modal')) closeViewer(); };
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeViewer(); });

function card({ handle, file }) {
  const isVideo = KINDS.videos.test(handle.name);
  const el = document.createElement('div');
  el.className = 'item';
  if (handle.name === highlight) el.classList.add('new');

  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  if (isVideo) {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.src = `${objectUrl(file)}#t=0.5`;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.hidden = true;
    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration)) {
        badge.textContent = shortDuration(v.duration);
        badge.hidden = false;
      }
    };
    thumb.append(v, badge);
  } else {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = objectUrl(file);
    thumb.append(img);
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = handle.name.replace(/\.[^.]+$/, '');
  name.title = handle.name;
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = `${relative(file.lastModified)} · ${formatBytes(file.size)}`;
  sub.title = new Date(file.lastModified).toLocaleString();
  meta.append(name, sub);

  const acts = document.createElement('div');
  acts.className = 'acts';
  const rename = Object.assign(document.createElement('button'), { textContent: 'Rename' });
  const del = Object.assign(document.createElement('button'), { textContent: 'Delete' });
  acts.append(rename, del);

  rename.onclick = async (e) => {
    e.stopPropagation();
    const ext = handle.name.match(/\.[^.]+$/)?.[0] || '';
    const next = prompt('New name', handle.name.slice(0, handle.name.length - ext.length));
    if (!next) return;
    try {
      if (!handle.move) throw new Error('Renaming needs a newer Chrome version.');
      await handle.move(next.endsWith(ext) ? next : next + ext);
      load();
    } catch (err) {
      alert(`Rename failed: ${err.message}`);
    }
  };
  del.onclick = async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete “${handle.name}” from disk? This can't be undone.`)) return;
    await dir.removeEntry(handle.name);
    entries = entries.filter((x) => x.handle !== handle);
    render();
  };
  el.onclick = () => openViewer(file, handle.name);
  el.append(thumb, meta, acts);
  return el;
}

function render() {
  $('title').textContent = tab === 'videos' ? 'Videos' : 'Screenshots';
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  const q = $('search').value.trim().toLowerCase();
  const list = entries.filter((x) => KINDS[tab].test(x.handle.name) && x.handle.name.toLowerCase().includes(q));
  const sort = $('sort').value;
  list.sort((a, b) => (sort === 'old' ? a.file.lastModified - b.file.lastModified
    : sort === 'big' ? b.file.size - a.file.size
      : sort === 'name' ? a.handle.name.localeCompare(b.handle.name)
        : b.file.lastModified - a.file.lastModified));
  for (const u of urls) URL.revokeObjectURL(u);
  urls.clear();
  $('grid').replaceChildren(...list.map(card));
  const noun = tab === 'videos' ? 'video' : 'screenshot';
  $('count').textContent = dir ? `${list.length} ${noun}${list.length === 1 ? '' : 's'}` : '';
  $('empty').hidden = list.length > 0 || !dir;
  $('empty').textContent = q ? 'Nothing matches your search.' : `No ${noun}s yet. Click the FreeRec icon in the toolbar to make one.`;
}

function needAccess(text, label, run) {
  $('need-text').textContent = text;
  $('need-btn').textContent = label;
  $('need-btn').onclick = async () => {
    try { await run(); } catch (e) { if (e.name !== 'AbortError') alert(e.message); }
  };
  $('need').hidden = false;
}

async function load() {
  $('need').hidden = true;
  dir = await getFolder();
  entries = [];
  if (!dir) {
    needAccess('Recordings are going to Downloads/FreeRec. Choose a folder to save into and browse it here.', 'Choose folder…', async () => {
      await setFolder(await pickFolder());
      load();
    });
    dir = null;
    render();
    return;
  }
  if (!(await folderPermission(dir))) {
    const name = dir.name;
    dir = null;
    needAccess(`Allow FreeRec to read “${name}” to show your recordings.`, 'Allow access', async () => {
      const d = await getFolder();
      if (await folderPermission(d, true)) load();
    });
    render();
    return;
  }
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file' && !name.startsWith('.') && (KINDS.videos.test(name) || KINDS.screenshots.test(name))) {
      entries.push({ handle, file: await handle.getFile() });
    }
  }
  render();
  if (highlight && !load.shown) {
    load.shown = true;
    const hit = entries.find((x) => x.handle.name === highlight);
    if (hit) openViewer(hit.file, highlight);
  }
}

async function renderOpfs() {
  const root = await navigator.storage.getDirectory();
  const files = [];
  for await (const [name, handle] of root.entries()) if (handle.kind === 'file' && KINDS.videos.test(name)) files.push(handle);
  $('opfs-section').hidden = files.length === 0;
  const rows = await Promise.all(files.map(async (h) => {
    const file = await h.getFile();
    const row = document.createElement('div');
    row.className = 'card row';
    const label = Object.assign(document.createElement('div'), { className: 'grow', textContent: `${h.name} · ${formatBytes(file.size)}` });
    const play = Object.assign(document.createElement('button'), { textContent: 'Play' });
    play.onclick = () => openViewer(file, h.name);
    const save = Object.assign(document.createElement('button'), { textContent: 'Save to Downloads', className: 'primary' });
    save.onclick = () => chrome.downloads.download({ url: URL.createObjectURL(file), filename: `FreeRec/${h.name}`, conflictAction: 'uniquify' });
    const del = Object.assign(document.createElement('button'), { textContent: 'Delete' });
    del.onclick = async () => {
      if (!confirm(`Delete “${h.name}”?`)) return;
      await root.removeEntry(h.name);
      renderOpfs();
    };
    row.append(label, play, save, del);
    return row;
  }));
  $('opfs-grid').replaceChildren(...rows);
}

document.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; render(); }; });
$('sort').onchange = render;
$('search').oninput = render;
$('change-folder').onclick = async () => {
  try {
    await setFolder(await pickFolder());
    load();
  } catch (e) {
    if (e.name !== 'AbortError') alert(e.message);
  }
};

const downloaded = params.get('downloaded');
if (downloaded) {
  $('notice').textContent = `Saved “${highlight}” to Downloads/FreeRec. `;
  const show = Object.assign(document.createElement('button'), { textContent: 'Show in folder' });
  show.onclick = () => chrome.downloads.show(Number(downloaded));
  $('notice').append(show);
  $('notice').hidden = false;
} else if (highlight) {
  $('notice').textContent = `Saved “${highlight}”.`;
  $('notice').hidden = false;
}

await Promise.all([load(), renderOpfs()]);
