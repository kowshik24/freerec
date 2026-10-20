import { getSettings, saveSettings, getFolder, mp4Supported, elapsedMs, formatDuration } from './lib/store.js';

const $ = (id) => document.getElementById(id);
const LIVE = ['preparing', 'countdown', 'recording', 'paused', 'saving'];

let settings = await getSettings();

function fillSelect(select, devices, selected, extra = []) {
  select.replaceChildren(
    ...extra.map(([value, text]) => new Option(text, value)),
    ...devices.map((d, i) => new Option(d.label || `Device ${i + 1}`, d.label)),
  );
  const values = [...select.options].map((o) => o.value);
  select.value = values.includes(selected) ? selected : values[extra.length] ?? values[0] ?? '';
}

async function loadDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter((d) => d.kind === 'videoinput');
  const mics = devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications');
  const labelled = devices.some((d) => d.label);
  $('perm').hidden = labelled;

  fillSelect($('camera'), cams, settings.cameraLabel);
  fillSelect($('mic'), mics, settings.micEnabled ? settings.micLabel : '__none__', [['__none__', 'No microphone']]);
  if (!settings.micEnabled) $('mic').value = '__none__';
  if (!cams.length) {
    $('camera').replaceChildren(new Option('No camera found', ''));
    if (settings.mode !== 'screen') setMode('screen');
    document.querySelectorAll('[data-mode="screen-camera"],[data-mode="camera"]').forEach((b) => { b.disabled = true; });
  }
}

function setMode(mode) {
  settings.mode = mode;
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  $('camera-field').hidden = mode === 'screen';
}

async function persist() {
  const mic = $('mic').value;
  settings = await saveSettings({
    mode: settings.mode,
    cameraLabel: $('camera').value,
    micEnabled: mic !== '__none__',
    micLabel: mic === '__none__' ? settings.micLabel : mic,
    quality: $('quality').value,
    format: $('format').value,
  });
}

async function renderFolder() {
  const dir = await getFolder();
  $('folder').textContent = dir ? dir.name : 'Downloads/FreeRec';
  $('folder').title = dir ? 'Chosen folder' : 'No folder chosen — saving to Chrome downloads';
}

function renderLive(rec) {
  const live = LIVE.includes(rec?.status);
  $('setup').hidden = live;
  $('live').hidden = !live;
  if (!live) return;
  const labels = { preparing: 'Getting ready…', countdown: 'Starting…', recording: 'Recording', paused: 'Paused', saving: 'Saving…' };
  $('live-status').textContent = labels[rec.status];
  $('live-time').textContent = formatDuration(elapsedMs(rec));
  $('live-pause').textContent = rec.status === 'paused' ? 'Resume' : 'Pause';
  const active = rec.status === 'recording' || rec.status === 'paused';
  $('live-pause').disabled = !active;
  $('live-stop').disabled = !active;
}

const send = (cmd) => chrome.runtime.sendMessage({ target: 'recorder', cmd }).catch(() => {});

// --- wiring ----------------------------------------------------------------

document.querySelectorAll('[data-mode]').forEach((b) => {
  b.onclick = () => { setMode(b.dataset.mode); persist(); };
});
for (const id of ['camera', 'mic', 'quality', 'format']) $(id).onchange = persist;

$('grant').onclick = () => chrome.tabs.create({ url: 'options.html#permissions' });
$('change-folder').onclick = () => chrome.tabs.create({ url: 'options.html#folder' });

$('start').onclick = async () => {
  await persist();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.runtime.sendMessage({ target: 'sw', cmd: 'start', returnTabId: tab?.id ?? null });
  window.close();
};

$('live-pause').onclick = () => send('togglePause');
$('live-stop').onclick = () => { send('stop'); window.close(); };
$('live-cancel').onclick = () => {
  if ($('live-cancel').dataset.armed) { send('cancel'); window.close(); return; }
  $('live-cancel').dataset.armed = '1';
  $('live-cancel').textContent = 'Click again to discard';
};
$('live-open').onclick = async () => {
  const res = await chrome.runtime.sendMessage({ target: 'recorder', cmd: 'ping' }).catch(() => null);
  if (res?.tabId != null) {
    const tab = await chrome.tabs.update(res.tabId, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
  }
  window.close();
};

// --- init ------------------------------------------------------------------

$('quality').value = settings.quality;
$('format').value = settings.format;
if (!mp4Supported()) {
  $('format').querySelector('[value="mp4"]').disabled = true;
  $('format').value = 'webm';
}
setMode(settings.mode);
await Promise.all([loadDevices(), renderFolder()]);

let { rec } = await chrome.storage.local.get('rec');
if (LIVE.includes(rec?.status)) {
  // Recorder tab was closed or crashed mid-recording: clear the stale state.
  const alive = await chrome.runtime.sendMessage({ target: 'recorder', cmd: 'ping' }).catch(() => null);
  if (!alive?.busy) {
    rec = { status: 'idle' };
    await chrome.storage.local.set({ rec });
  }
}
renderLive(rec);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.rec) { rec = changes.rec.newValue; renderLive(rec); }
});
setInterval(() => renderLive(rec), 500);
