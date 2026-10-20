// Shared helpers: settings (chrome.storage) and the chosen folder handle (IndexedDB).

const DB_NAME = 'freerec';
const STORE = 'kv';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const idbGet = (key) => idb('readonly', (s) => s.get(key));
export const idbSet = (key, value) => idb('readwrite', (s) => s.put(value, key));
export const idbDel = (key) => idb('readwrite', (s) => s.delete(key));

export const QUALITY = {
  '720': { width: 1280, height: 720, bitrate: 2_500_000, label: '720p' },
  '1080': { width: 1920, height: 1080, bitrate: 5_000_000, label: '1080p' },
  '1440': { width: 2560, height: 1440, bitrate: 8_000_000, label: '1440p' },
  '2160': { width: 3840, height: 2160, bitrate: 16_000_000, label: '4K' },
};

export const DEFAULTS = {
  source: 'screen', // 'screen' | 'window' | 'tab' | 'camera'
  cameraOn: true,
  cameraLabel: '',
  micEnabled: true,
  micLabel: '',
  quality: '1080',
  format: 'webm', // 'webm' | 'mp4'
  countdown: true,
  bubbleSize: 'medium',
  keepRecorderTab: true,
  theme: 'light', // panel theme: 'light' | 'dark'
  screenshotType: 'area', // 'area' | 'tab'
};

export const EFFECT_DEFAULTS = { filter: 'none', background: 'none' };

// 'mode' is what the recorder/overlay act on; derived from source + camera.
export function recordingMode(s) {
  if (s.source === 'camera') return 'camera';
  return s.cameraOn ? 'screen-camera' : 'screen';
}

export async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  if (settings.mode && !settings.source) {
    // v1.0 settings
    settings.source = settings.mode === 'camera' ? 'camera' : 'screen';
    settings.cameraOn = settings.mode !== 'screen';
    delete settings.mode;
  }
  return { ...DEFAULTS, ...settings };
}

export async function getEffects() {
  const { effects } = await chrome.storage.local.get('effects');
  return { ...EFFECT_DEFAULTS, ...effects };
}

export async function saveEffects(patch) {
  const next = { ...(await getEffects()), ...patch };
  await chrome.storage.local.set({ effects: next });
  return next;
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export const getFolder = () => idbGet('dirHandle');
// The folder name is mirrored into chrome.storage for embedded pages (panel).
export async function setFolder(handle) {
  await idbSet('dirHandle', handle);
  await chrome.storage.local.set({ folderName: handle.name });
}
export async function clearFolder() {
  await idbDel('dirHandle');
  await chrome.storage.local.remove('folderName');
}

export async function folderPermission(handle, request = false) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if (!request) return false;
  return (await handle.requestPermission(opts)) === 'granted';
}

export function pickFolder() {
  return window.showDirectoryPicker({ id: 'freerec', mode: 'readwrite', startIn: 'videos' });
}

// Device IDs are per-origin/partition, so devices are remembered by label.
export async function deviceIdForLabel(kind, label) {
  const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === kind);
  return (list.find((d) => d.label === label) || list[0])?.deviceId || null;
}

export function mp4Supported() {
  return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a.40.2');
}

export function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function elapsedMs(rec, now = Date.now()) {
  if (!rec?.startedAt) return 0;
  const end = rec.status === 'paused' && rec.pausedAt ? rec.pausedAt : now;
  return end - rec.startedAt - (rec.pausedTotal || 0);
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
