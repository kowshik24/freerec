// Service worker: thin orchestrator. The recorder tab (recorder.html) owns all
// media + file work; this worker opens it, relays shortcuts, keeps the badge in
// sync, and injects the on-page overlay (camera bubble + controls) into
// whichever tab is active while recording.

const RECORDER_URL = chrome.runtime.getURL('recorder.html');
const LIVE = ['countdown', 'recording', 'paused'];

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await chrome.storage.local.set({ rec: { status: 'idle' } });
  if (reason === 'install') chrome.tabs.create({ url: 'options.html?welcome=1' });
});

chrome.runtime.onStartup.addListener(() => chrome.storage.local.set({ rec: { status: 'idle' } }));

async function findRecorder() {
  try {
    const res = await chrome.runtime.sendMessage({ target: 'recorder', cmd: 'ping' });
    return res?.tabId ?? null;
  } catch {
    return null;
  }
}

async function startRecording(returnTabId) {
  const tabId = await findRecorder();
  if (tabId == null) {
    const params = new URLSearchParams({ start: '1' });
    if (returnTabId != null) params.set('returnTab', String(returnTabId));
    await chrome.tabs.create({ url: `${RECORDER_URL}?${params}`, pinned: true, index: 0, active: true });
    return;
  }
  const tab = await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.runtime.sendMessage({ target: 'recorder', cmd: 'start', returnTabId }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'sw') return;
  if (msg.cmd === 'start') {
    startRecording(msg.returnTabId).then(() => sendResponse({ ok: true }), (e) => sendResponse({ error: String(e) }));
    return true;
  }
});

chrome.commands.onCommand.addListener((command) => {
  const cmd = { 'stop-recording': 'stop', 'toggle-pause': 'togglePause', 'cancel-recording': 'cancel' }[command];
  if (cmd) chrome.runtime.sendMessage({ target: 'recorder', cmd }).catch(() => {});
});

// --- badge -----------------------------------------------------------------

function updateBadge(rec) {
  const status = rec?.status;
  const text = status === 'recording' ? 'REC' : status === 'paused' ? '❚❚' : status === 'countdown' ? '…' : '';
  chrome.action.setBadgeText({ text });
  if (text) chrome.action.setBadgeBackgroundColor({ color: status === 'paused' ? '#d97706' : '#e5484d' });
}

// --- overlay injection -----------------------------------------------------

async function injectOverlay(tabId) {
  const { rec } = await chrome.storage.local.get('rec');
  if (!rec || !LIVE.includes(rec.status) || rec.mode === 'camera') return;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch {
    // chrome://, Web Store and other restricted pages can't be scripted.
  }
}

async function injectActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id != null) injectOverlay(tab.id);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.rec) return;
  const next = changes.rec.newValue;
  const prev = changes.rec.oldValue;
  updateBadge(next);
  if (LIVE.includes(next?.status) && !LIVE.includes(prev?.status)) injectActiveTab();
});

chrome.tabs.onActivated.addListener(({ tabId }) => injectOverlay(tabId));
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab.active) injectOverlay(tabId);
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) injectActiveTab();
});
