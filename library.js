import { getFolder, folderPermission, pickFolder, setFolder, formatBytes, formatDuration } from './lib/store.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const highlight = params.get('new');
const VIDEO = /\.(webm|mp4|mkv|mov)$/i;
const urls = new Set();

function objectUrl(file) {
  const url = URL.createObjectURL(file);
  urls.add(url);
  return url;
}

function play(file, name) {
  $('player').src = objectUrl(file);
  $('player-title').textContent = name;
  $('player-card').hidden = false;
  $('player').play().catch(() => {});
  $('player-card').scrollIntoView({ behavior: 'smooth' });
}

$('player-close').onclick = () => {
  $('player').pause();
  $('player').removeAttribute('src');
  $('player-card').hidden = true;
};

function needAccess(text, label, run) {
  $('need-text').textContent = text;
  $('need-btn').textContent = label;
  $('need-btn').onclick = async () => {
    try { await run(); } catch (e) { if (e.name !== 'AbortError') alert(e.message); }
  };
  $('need').hidden = false;
}

async function card(dir, handle) {
  const file = await handle.getFile();
  const el = document.createElement('div');
  el.className = 'card item';
  if (handle.name === highlight) el.classList.add('new');

  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  const v = document.createElement('video');
  v.preload = 'metadata';
  v.muted = true;
  v.src = `${objectUrl(file)}#t=0.5`;
  const dur = document.createElement('span');
  dur.className = 'dur';
  dur.hidden = true;
  v.onloadedmetadata = () => {
    if (Number.isFinite(v.duration)) {
      dur.textContent = formatDuration(v.duration * 1000);
      dur.hidden = false;
    }
  };
  thumb.append(v, dur);

  const meta = document.createElement('div');
  meta.className = 'meta';
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = handle.name;
  name.title = handle.name;
  const info = document.createElement('div');
  info.className = 'muted small';
  info.textContent = `${new Date(file.lastModified).toLocaleString()} · ${formatBytes(file.size)}`;
  meta.append(name, info);

  const actions = document.createElement('div');
  actions.className = 'item-actions';
  const rename = document.createElement('button');
  rename.textContent = 'Rename';
  const del = document.createElement('button');
  del.textContent = 'Delete';
  actions.append(rename, del);

  rename.onclick = async (e) => {
    e.stopPropagation();
    const ext = handle.name.match(/\.[^.]+$/)?.[0] || '';
    const next = prompt('New name', handle.name.slice(0, -ext.length || undefined));
    if (!next) return;
    const target = next.endsWith(ext) ? next : next + ext;
    try {
      if (handle.move) await handle.move(target);
      else throw new Error('Renaming needs a newer Chrome version.');
      render();
    } catch (err) {
      alert(`Rename failed: ${err.message}`);
    }
  };
  del.onclick = async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete “${handle.name}” from disk? This can't be undone.`)) return;
    await dir.removeEntry(handle.name);
    el.remove();
  };
  el.onclick = () => play(file, handle.name);
  el.append(thumb, meta, actions);
  return { el, modified: file.lastModified };
}

async function listVideos(dir) {
  const out = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file' && VIDEO.test(name) && !name.startsWith('.')) out.push(handle);
  }
  return out;
}

async function renderFolder() {
  $('need').hidden = true;
  const dir = await getFolder();
  if (!dir) {
    $('folder-title').textContent = 'Downloads/FreeRec';
    $('empty').hidden = true;
    needAccess('Recordings are going to your Downloads/FreeRec folder. Choose a folder to browse and play them here.', 'Choose folder…', async () => {
      await setFolder(await pickFolder());
      render();
    });
    return;
  }
  $('folder-title').textContent = `📁 ${dir.name}`;
  if (!(await folderPermission(dir))) {
    needAccess(`Allow FreeRec to read “${dir.name}” to show your recordings.`, 'Allow access', async () => {
      if (await folderPermission(dir, true)) render();
    });
    return;
  }
  const cards = await Promise.all((await listVideos(dir)).map((h) => card(dir, h)));
  cards.sort((a, b) => b.modified - a.modified);
  $('grid').replaceChildren(...cards.map((c) => c.el));
  $('empty').hidden = cards.length > 0;
  if (highlight && !shownHighlight) {
    shownHighlight = true;
    const handle = await dir.getFileHandle(highlight).catch(() => null);
    if (handle) play(await handle.getFile(), highlight);
  }
}

let shownHighlight = false;

async function renderOpfs() {
  const root = await navigator.storage.getDirectory();
  const files = await listVideos(root);
  $('opfs-section').hidden = files.length === 0;
  const rows = await Promise.all(files.map(async (h) => {
    const file = await h.getFile();
    const row = document.createElement('div');
    row.className = 'card row';
    const label = document.createElement('div');
    label.className = 'grow';
    label.textContent = `${h.name} · ${formatBytes(file.size)}`;
    const playBtn = document.createElement('button');
    playBtn.textContent = 'Play';
    playBtn.onclick = () => play(file, h.name);
    const save = document.createElement('button');
    save.textContent = 'Save to Downloads';
    save.className = 'primary';
    save.onclick = () => chrome.downloads.download({ url: objectUrl(file), filename: `FreeRec/${h.name}`, conflictAction: 'uniquify' });
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.onclick = async () => {
      if (!confirm(`Delete “${h.name}”?`)) return;
      await root.removeEntry(h.name);
      renderOpfs();
    };
    row.append(label, playBtn, save, del);
    return row;
  }));
  $('opfs-grid').replaceChildren(...rows);
}

async function render() {
  for (const u of urls) URL.revokeObjectURL(u);
  urls.clear();
  await Promise.all([renderFolder(), renderOpfs()]);
}

const downloaded = params.get('downloaded');
if (downloaded) {
  const id = Number(downloaded);
  $('notice').textContent = `Saved “${highlight}” to Downloads/FreeRec. `;
  const show = document.createElement('button');
  show.textContent = 'Show in folder';
  show.onclick = () => chrome.downloads.show(id);
  $('notice').append(show);
  $('notice').hidden = false;
} else if (highlight) {
  $('notice').textContent = `Saved “${highlight}”.`;
  $('notice').hidden = false;
}

await render();
