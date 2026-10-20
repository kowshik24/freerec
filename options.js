import { getSettings, saveSettings, getFolder, setFolder, clearFolder, folderPermission, pickFolder } from './lib/store.js';

const $ = (id) => document.getElementById(id);

if (new URLSearchParams(location.search).get('welcome')) $('welcome').hidden = false;

async function permState(name) {
  try {
    return (await navigator.permissions.query({ name })).state;
  } catch {
    return 'prompt';
  }
}

async function renderPermissions() {
  const [cam, mic] = await Promise.all([permState('camera'), permState('microphone')]);
  const word = { granted: '✅ allowed', denied: '⛔ blocked', prompt: 'not asked yet' };
  $('perm-status').textContent = `Camera: ${word[cam]} · Microphone: ${word[mic]}`;
  const done = cam === 'granted' && mic === 'granted';
  $('perm-num').classList.toggle('done', done);
  $('perm-num').textContent = done ? '✓' : '1';
  $('grant').hidden = done;
  if (cam === 'denied' || mic === 'denied') {
    $('perm-status').textContent += ' — unblock it via the camera icon in the address bar, then reload.';
  }
}

async function renderFolder() {
  const dir = await getFolder();
  const granted = dir ? await folderPermission(dir) : false;
  $('folder-status').innerHTML = '';
  const b = document.createElement('strong');
  b.textContent = dir ? `📁 ${dir.name}` : '📁 Downloads/FreeRec (default)';
  $('folder-status').append(b);
  if (dir && !granted) $('folder-status').append(' — access will be confirmed when you start a recording.');
  $('folder-num').classList.add('done');
  $('folder-num').textContent = '✓';
  $('clear').hidden = !dir;
  $('choose').textContent = dir ? 'Change folder…' : 'Choose folder…';
}

$('grant').onclick = async () => {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    s.getTracks().forEach((t) => t.stop());
  } catch {
    // Try each separately so a missing camera doesn't block the mic.
    for (const c of [{ audio: true }, { video: true }]) {
      try { (await navigator.mediaDevices.getUserMedia(c)).getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    }
  }
  renderPermissions();
};

$('choose').onclick = async () => {
  try {
    await setFolder(await pickFolder());
  } catch (e) {
    if (e.name !== 'AbortError') alert(`Could not use that folder: ${e.message}`);
  }
  renderFolder();
};

$('clear').onclick = async () => {
  await clearFolder();
  renderFolder();
};

$('shortcuts').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });

const settings = await getSettings();
$('countdown').checked = settings.countdown;
$('keep').checked = settings.keepRecorderTab;
$('bubble').value = settings.bubbleSize;
$('countdown').onchange = () => saveSettings({ countdown: $('countdown').checked });
$('keep').onchange = () => saveSettings({ keepRecorderTab: $('keep').checked });
$('bubble').onchange = () => saveSettings({ bubbleSize: $('bubble').value });

renderPermissions();
renderFolder();
if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
