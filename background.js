// Service worker: opens the on-page panel, keeps the recorder tab
// (recorder.html, does all media + file work) alive, relays shortcuts, keeps
// the badge in sync and re-injects the overlay into whichever tab is active
// while recording.

const EXT = chrome.runtime.getURL('');
const RECORDER_URL = chrome.runtime.getURL('recorder.html');
const LIVE = ['countdown', 'recording', 'paused'];

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await chrome.storage.local.set({ rec: { status: 'idle' } });
  if (reason === 'install') chrome.tabs.create({ url: 'options.html?welcome=1' });
});

chrome.runtime.onStartup.addListener(() => chrome.storage.local.set({ rec: { status: 'idle' } }));

// --- recorder tab ----------------------------------------------------------

async function pingRecorder() {
  try {
    const res = await chrome.runtime.sendMessage({ target: 'recorder', cmd: 'ping' });
    return res?.tabId != null ? res : null;
  } catch {
    return null;
  }
}

async function ensureRecorder() {
  const alive = await pingRecorder();
  if (alive) return alive;
  await chrome.tabs.create({ url: RECORDER_URL, pinned: true, index: 0, active: false });
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const res = await pingRecorder();
    if (res) return res;
  }
  throw new Error('Recorder tab did not start');
}

async function startRecording(returnTabId) {
  await ensureRecorder();
  await chrome.runtime.sendMessage({ target: 'recorder', cmd: 'start', returnTabId }).catch(() => {});
}

async function focusRecorder() {
  const r = await pingRecorder();
  if (!r) return;
  const tab = await chrome.tabs.update(r.tabId, { active: true });
  chrome.windows.update(tab.windowId, { focused: true });
}

// --- panel -----------------------------------------------------------------

async function openPanel(tab, view) {
  const { rec } = await chrome.storage.local.get('rec');
  if (rec?.mode === 'camera' && rec.status !== 'idle') return focusRecorder();
  if (tab.url?.startsWith(`${EXT}canvas.html`)) {
    chrome.runtime.sendMessage({ freerec: 'toggle-panel', tabId: tab.id, view }).catch(() => {});
    return;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tab.id, { freerec: 'toggle-panel', view });
  } catch {
    // chrome://, Web Store, PDF viewer… can't host the panel: use the canvas page.
    chrome.tabs.create({ url: 'canvas.html?panel=1', index: tab.index + 1 });
  }
}

chrome.action.onClicked.addListener((tab) => openPanel(tab));

// --- screenshots -----------------------------------------------------------

async function screenshot(sender, rect, dpr) {
  const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
  await ensureRecorder();
  return chrome.runtime.sendMessage({ target: 'recorder', cmd: 'saveScreenshot', dataUrl, rect, dpr });
}

// --- messages --------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== 'sw') return;
  const reply = (p) => p.then(sendResponse, (e) => sendResponse({ error: e?.message || String(e) }));
  switch (msg.cmd) {
    case 'start':
      reply(startRecording(msg.returnTabId ?? sender.tab?.id ?? null).then(() => ({ ok: true })));
      return true;
    case 'screenshot':
      reply(screenshot(sender, msg.rect, msg.dpr));
      return true;
    case 'open':
      chrome.tabs.create({ url: chrome.runtime.getURL(msg.path) });
      break;
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

// --- overlay injection while recording -------------------------------------

async function injectOverlay(tabId) {
  const { rec } = await chrome.storage.local.get('rec');
  if (!rec || !LIVE.includes(rec.status) || rec.mode === 'camera') return;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch {
    // restricted page or one of our own pages (canvas.html loads it itself)
  }
}

async function injectActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id != null) injectOverlay(tab.id);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.rec) return;
  const next = changes.rec.newValue;
  updateBadge(next);
  if (LIVE.includes(next?.status) && !LIVE.includes(changes.rec.oldValue?.status)) injectActiveTab();
});

chrome.tabs.onActivated.addListener(({ tabId }) => injectOverlay(tabId));
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab.active) injectOverlay(tabId);
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) injectActiveTab();
});
