import {
  getSettings, getFolder, setFolder, folderPermission, pickFolder,
  deviceIdForLabel, QUALITY, formatDuration, elapsedMs, formatBytes, recordingMode,
} from './lib/store.js';
import { prepareWebmHeader, durationBytes } from './lib/webm.js';

const $ = (id) => document.getElementById(id);

class Canceled extends Error {
  constructor() { super('Canceled'); this.name = 'Canceled'; }
}

const CANCEL_BUTTON = { label: 'Cancel', kind: 'ghost', run: async () => { throw new Canceled(); } };

let myTabId = null;
let session = null; // one recording at a time
let rec = { status: 'idle' }; // mirrored to chrome.storage.local.rec for panel/overlay/badge
let timer = null;

// --- shared state ----------------------------------------------------------

async function setRec(patch, replace = false) {
  rec = replace ? patch : { ...rec, ...patch };
  await chrome.storage.local.set({ rec });
  $('btn-pause').textContent = rec.status === 'paused' ? 'Resume' : 'Pause';
}

function setStatus(title, detail = '') {
  $('status').textContent = title;
  $('detail').textContent = detail;
}

// This tab stays in the background unless it needs a click, Chrome's share
// picker, or shows the camera-only preview.
async function focusSelf() {
  if (myTabId == null) return;
  const tab = await chrome.tabs.update(myTabId, { active: true }).catch(() => null);
  if (tab) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
}

async function returnTo(tabId) {
  if (tabId == null || tabId === myTabId) return;
  const tab = await chrome.tabs.update(tabId, { active: true }).catch(() => null);
  if (tab) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
}

async function needsPrompt(name) {
  try {
    return (await navigator.permissions.query({ name })).state !== 'granted';
  } catch {
    return true;
  }
}

function showError(e) {
  console.error(e);
  $('error').textContent = e?.message || String(e);
  $('error').hidden = false;
  setStatus('Recording failed', 'Fix the problem above and start again from the FreeRec icon.');
}

function startTimer() {
  $('timer').hidden = false;
  const tick = () => { $('timer').textContent = formatDuration(elapsedMs(rec)); };
  tick();
  timer = setInterval(tick, 500);
}

function stopTimer() {
  clearInterval(timer);
  timer = null;
  $('timer').hidden = true;
}

// --- prompts that need a user click (permission requests, folder picker) ---

function ask(text, buttons) {
  const s = session;
  focusSelf();
  return new Promise((resolve, reject) => {
    const hide = () => { $('prompt').hidden = true; s.rejectPrompt = null; };
    $('prompt-text').textContent = text;
    $('prompt-actions').replaceChildren(...buttons.map((b) => {
      const el = document.createElement('button');
      el.textContent = b.label;
      if (b.kind) el.className = b.kind;
      el.onclick = async () => {
        try {
          const value = await b.run();
          if (value === undefined) return; // keep the prompt open
          hide();
          resolve(value);
        } catch (e) {
          if (e?.name === 'AbortError') return; // closed a native picker
          hide();
          reject(e);
        }
      };
      return el;
    }));
    $('prompt').hidden = false;
    s.rejectPrompt = (e) => { hide(); reject(e); };
  });
}

// --- where to save ---------------------------------------------------------

async function chooseNewFolder() {
  const dir = await pickFolder();
  await setFolder(dir);
  return { dir, opfs: false, label: dir.name };
}

async function useDownloads() {
  return { dir: await navigator.storage.getDirectory(), opfs: true, label: 'Downloads/FreeRec' };
}

async function prepareTarget() {
  const dir = await getFolder();
  if (dir && (await folderPermission(dir))) return { dir, opfs: false, label: dir.name };
  const downloads = { label: 'Save to Downloads instead', run: useDownloads };
  if (dir) {
    return ask(`FreeRec needs your OK to save into the folder “${dir.name}”.`, [
      {
        label: `Allow “${dir.name}”`,
        kind: 'primary',
        run: async () => ((await folderPermission(dir, true)) ? { dir, opfs: false, label: dir.name } : undefined),
      },
      { label: 'Choose another folder…', run: chooseNewFolder },
      downloads,
      CANCEL_BUTTON,
    ]);
  }
  return ask('Choose the folder where your recordings should be saved.', [
    { label: 'Choose folder…', kind: 'primary', run: chooseNewFolder },
    downloads,
    CANCEL_BUTTON,
  ]);
}

function stamp(prefix = 'FreeRec') {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${prefix} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} at ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}

async function uniqueName(dir, ext, prefix) {
  const base = stamp(prefix);
  for (let i = 1; ; i++) {
    const name = i === 1 ? `${base}.${ext}` : `${base} (${i}).${ext}`;
    try {
      await dir.getFileHandle(name);
    } catch {
      return name;
    }
  }
}

// --- media -----------------------------------------------------------------

async function getMic(label) {
  const deviceId = await deviceIdForLabel('audioinput', label);
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
}

async function getCamera(label, q) {
  const deviceId = await deviceIdForLabel('videoinput', label);
  return navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: q.width },
      height: { ideal: q.height },
      frameRate: { ideal: 30 },
    },
  });
}

// The camera bubble is an extension iframe; it uses this origin's camera
// permission, so make sure it is granted while this tab is in front.
async function ensureCameraPermission() {
  try {
    if ((await navigator.permissions.query({ name: 'camera' })).state === 'granted') return true;
  } catch { /* query unsupported */ }
  try {
    await focusSelf();
    const s = await navigator.mediaDevices.getUserMedia({ video: true });
    s.getTracks().forEach((t) => t.stop());
    return true;
  } catch (e) {
    return ask(`Camera unavailable (${e.name}). Record without the camera bubble?`, [
      { label: 'Continue without camera', kind: 'primary', run: async () => false },
      CANCEL_BUTTON,
    ]);
  }
}

// "Current tab": capture the tab the panel was opened on, no picker needed.
async function captureTab(tabId, q) {
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId, consumerTabId: myTabId });
  const source = { chromeMediaSource: 'tab', chromeMediaSourceId: streamId };
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: source },
    video: { mandatory: { ...source, maxWidth: q.width, maxHeight: q.height, maxFrameRate: 30 } },
  });
  // Tab capture silences the tab for you; play its sound back.
  if (stream.getAudioTracks().length) {
    const ctx = new AudioContext();
    ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(ctx.destination);
    ctx.resume().catch(() => {});
    session.playbackCtx = ctx;
  }
  return stream;
}

async function pickDesktop(q, sources) {
  const s = session;
  await focusSelf();
  return new Promise((resolve, reject) => {
    s.desktopRequest = chrome.desktopCapture.chooseDesktopMedia(
      sources,
      async (streamId, options) => {
        s.desktopRequest = null;
        if (!streamId) return reject(new Canceled());
        try {
          const audio = options?.canRequestAudioTrack
            ? { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: streamId } }
            : false;
          resolve(await navigator.mediaDevices.getUserMedia({
            audio,
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: streamId,
                maxWidth: q.width,
                maxHeight: q.height,
                maxFrameRate: 30,
              },
            },
          }));
        } catch (e) {
          reject(e);
        }
      },
    );
  });
}

function buildStream(video, mic) {
  const tracks = [...video.getVideoTracks()];
  const system = video.getAudioTracks();
  const micTracks = mic ? mic.getAudioTracks() : [];
  if (system.length && micTracks.length) {
    const ctx = new AudioContext({ sampleRate: 48000 });
    const dest = ctx.createMediaStreamDestination();
    ctx.createMediaStreamSource(new MediaStream(system)).connect(dest);
    ctx.createMediaStreamSource(new MediaStream(micTracks)).connect(dest);
    ctx.resume();
    session.audioCtx = ctx;
    tracks.push(...dest.stream.getAudioTracks());
  } else {
    tracks.push(...system, ...micTracks);
  }
  return new MediaStream(tracks);
}

function pickMime(format, hasAudio) {
  const webm = hasAudio
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8'];
  const mp4 = hasAudio ? ['video/mp4;codecs=avc1,mp4a.40.2'] : ['video/mp4;codecs=avc1'];
  const candidates = [
    ...(format === 'mp4' ? mp4.map((m) => [m, 'mp4']) : []),
    ...webm.map((m) => [m, 'webm']),
  ];
  for (const [mime, ext] of candidates) if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  return { mime: 'video/webm', ext: 'webm' };
}

function stopTracks(s) {
  for (const stream of [s.video, s.mic, s.stream]) stream?.getTracks().forEach((t) => t.stop());
}

function showPreview(stream) {
  $('preview').srcObject = stream;
  $('preview-wrap').hidden = false;
}

function countdown(s, ms) {
  return new Promise((resolve) => {
    const end = Date.now() + ms;
    const el = $('countdown');
    const id = setInterval(() => {
      const left = end - Date.now();
      if (left <= 0 || s.canceled) {
        clearInterval(id);
        el.hidden = true;
        resolve();
        return;
      }
      el.hidden = false;
      el.textContent = String(Math.ceil(left / 1000));
    }, 100);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- lifecycle -------------------------------------------------------------

async function start(returnTabId) {
  if (session) return;
  const s = { canceled: false, returnTabId };
  session = s;
  const check = () => { if (session !== s || s.canceled) throw new Canceled(); };
  $('error').hidden = true;

  try {
    const settings = await getSettings();
    s.settings = settings;
    const mode = recordingMode(settings);
    const cameraOnly = mode === 'camera';
    let bubble = mode === 'screen-camera';
    await setRec({ status: 'preparing', mode }, true);
    setStatus('Getting ready…');

    s.target = await prepareTarget();
    check();

    let mic = null;
    if (settings.micEnabled) {
      try {
        if (await needsPrompt('microphone')) await focusSelf();
        mic = await getMic(settings.micLabel);
      } catch (e) {
        await ask(`Microphone unavailable (${e.name}). Record without microphone?`, [
          { label: 'Continue without mic', kind: 'primary', run: async () => true },
          CANCEL_BUTTON,
        ]);
      }
      check();
    }
    s.mic = mic;

    const q = QUALITY[settings.quality] || QUALITY['1080'];
    if (cameraOnly) {
      await focusSelf();
      setStatus('Starting camera…');
      s.video = await getCamera(settings.cameraLabel, q);
      showPreview(s.video);
    } else {
      if (bubble) bubble = await ensureCameraPermission();
      check();
      if (settings.source === 'tab' && returnTabId != null && returnTabId !== myTabId) {
        try {
          s.video = await captureTab(returnTabId, q);
        } catch (e) {
          console.warn('FreeRec: tab capture failed, falling back to the picker', e);
        }
      }
      if (!s.video) {
        setStatus('Choose what to share', 'Pick what to record in the Chrome dialog. Tick “Share audio” to include its sound.');
        const sources = { screen: ['screen', 'audio'], window: ['window', 'audio'], tab: ['tab', 'audio'] }[settings.source];
        s.video = await pickDesktop(q, sources || ['screen', 'window', 'tab', 'audio']);
      }
    }
    check();

    s.stream = buildStream(s.video, mic);
    const { mime, ext } = pickMime(settings.format, s.stream.getAudioTracks().length > 0);
    s.mime = mime;
    s.ext = ext;
    s.name = await uniqueName(s.target.dir, ext);
    s.fileHandle = await s.target.dir.getFileHandle(s.name, { create: true });
    s.writable = await s.fileHandle.createWritable();
    s.bytes = 0;
    s.chain = Promise.resolve();
    s.video.getVideoTracks()[0]?.addEventListener('ended', () => stop()); // "Stop sharing"
    check();

    if (!cameraOnly) await returnTo(returnTabId);
    const overlay = { cameraOn: bubble, cameraLabel: settings.cameraLabel, bubbleSize: settings.bubbleSize };
    if (settings.countdown) {
      await setRec({ status: 'countdown', countdownEnd: Date.now() + 3000, ...overlay });
      setStatus('Starting…');
      await countdown(s, 3000);
      check();
      await sleep(150); // let the on-page countdown disappear before the first frame
      check();
    } else {
      Object.assign(rec, overlay);
    }
    begin(s, q);
  } catch (e) {
    await teardown(s, true);
    if (e instanceof Canceled) setStatus('Ready', 'Recording canceled.');
    else showError(e);
  }
}

function begin(s, q) {
  const recorder = new MediaRecorder(s.stream, {
    mimeType: s.mime,
    videoBitsPerSecond: q.bitrate,
    audioBitsPerSecond: 128_000,
  });
  s.recorder = recorder;
  let first = true;
  recorder.ondataavailable = (e) => {
    if (!e.data?.size) return;
    const blob = e.data;
    const isFirst = first;
    first = false;
    s.chain = s.chain.then(() => writeChunk(s, blob, isFirst)).catch((err) => {
      if (!s.writeError) {
        s.writeError = err;
        stop();
      }
    });
  };
  recorder.onstop = () => finalize(s);
  recorder.onerror = (e) => {
    s.writeError ||= e.error || new Error('Recorder error');
    stop();
  };
  recorder.start(1000);
  setRec({ status: 'recording', startedAt: Date.now(), pausedTotal: 0, pausedAt: null, countdownEnd: null });
  setStatus('Recording', `Saving to ${s.target.label}/${s.name}`);
  $('controls').hidden = false;
  startTimer();
}

async function writeChunk(s, blob, isFirst) {
  if (isFirst && s.ext === 'webm') {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const info = prepareWebmHeader(bytes);
    const out = info ? info.bytes : bytes;
    if (info) s.durationInfo = { ...info, offset: s.bytes + info.durationOffset };
    await s.writable.write(out);
    s.bytes += out.length;
    return;
  }
  await s.writable.write(blob);
  s.bytes += blob.size;
}

function pause() {
  const s = session;
  if (s?.recorder?.state !== 'recording') return;
  s.recorder.pause();
  setRec({ status: 'paused', pausedAt: Date.now() });
  setStatus('Paused', `Saving to ${s.target.label}/${s.name}`);
}

function resume() {
  const s = session;
  if (s?.recorder?.state !== 'paused') return;
  s.recorder.resume();
  setRec({ status: 'recording', pausedTotal: (rec.pausedTotal || 0) + (Date.now() - rec.pausedAt), pausedAt: null });
  setStatus('Recording', `Saving to ${s.target.label}/${s.name}`);
}

async function restart() {
  const s = session;
  if (!s?.recorder || s.stopping || s.restarting || rec.status === 'countdown') return;
  s.restarting = true;
  const old = s.recorder;
  old.ondataavailable = null;
  old.onstop = null;
  old.onerror = null;
  if (old.state !== 'inactive') old.stop();
  stopTimer();
  $('controls').hidden = true;
  await discardFile(s);
  s.name = await uniqueName(s.target.dir, s.ext);
  s.fileHandle = await s.target.dir.getFileHandle(s.name, { create: true });
  s.writable = await s.fileHandle.createWritable();
  s.bytes = 0;
  s.chain = Promise.resolve();
  s.durationInfo = null;
  s.writeError = null;
  s.restarting = false;
  if (s.settings.countdown) {
    await setRec({ status: 'countdown', countdownEnd: Date.now() + 3000, startedAt: null, pausedTotal: 0, pausedAt: null });
    setStatus('Restarting…');
    await countdown(s, 3000);
    if (session !== s || s.canceled) return;
    await sleep(150);
    if (session !== s || s.canceled) return;
  }
  begin(s, QUALITY[s.settings.quality] || QUALITY['1080']);
}

function stop() {
  const s = session;
  if (!s) return;
  if (!s.recorder || rec.status === 'countdown') { cancel(); return; }
  if (s.stopping) return;
  s.stopping = true;
  s.durationMs = elapsedMs(rec);
  stopTimer();
  $('controls').hidden = true;
  setRec({ status: 'saving' });
  setStatus('Saving…', `${s.target.label}/${s.name}`);
  if (s.recorder.state !== 'inactive') s.recorder.stop();
}

async function cancel() {
  const s = session;
  if (!s || s.stopping) return;
  s.canceled = true;
  s.rejectPrompt?.(new Canceled());
  if (s.desktopRequest != null) chrome.desktopCapture.cancelChooseDesktopMedia(s.desktopRequest);
  if (!s.recorder) return; // start() notices the flag and cleans up
  s.recorder.onstop = null;
  s.recorder.ondataavailable = null;
  if (s.recorder.state !== 'inactive') s.recorder.stop();
  await teardown(s, true);
  setStatus('Ready', 'Recording discarded.');
}

async function discardFile(s) {
  try { await s.chain; } catch { /* ignore */ }
  try { await s.writable?.abort(); } catch { /* ignore */ }
  if (s.name) {
    try { await s.target.dir.removeEntry(s.name); } catch { /* ignore */ }
  }
}

async function teardown(s, discard) {
  if (session === s) session = null;
  stopTimer();
  $('controls').hidden = true;
  $('prompt').hidden = true;
  $('preview-wrap').hidden = true;
  $('preview').srcObject = null;
  stopTracks(s);
  s.audioCtx?.close().catch(() => {});
  s.playbackCtx?.close().catch(() => {});
  if (discard) await discardFile(s);
  await setRec({ status: 'idle' }, true);
}

async function finalize(s) {
  let ok = false;
  try {
    await s.chain;
    if (s.durationInfo && !s.writeError) {
      await s.writable.write({ type: 'write', position: s.durationInfo.offset, data: durationBytes(s.durationMs, s.durationInfo) });
    }
    await s.writable.close();
    if (s.writeError) throw new Error(`Recording was cut short: ${s.writeError.message || s.writeError}`);

    let downloadId = null;
    if (s.target.opfs) downloadId = await exportToDownloads(s);
    const entry = { name: s.name, folder: s.target.label, opfs: s.target.opfs, durationMs: s.durationMs, size: s.bytes, at: Date.now(), downloadId };
    const { recent = [] } = await chrome.storage.local.get('recent');
    await chrome.storage.local.set({ recent: [entry, ...recent].slice(0, 50) });
    addRecent(entry);

    setStatus('Saved', `${s.target.label}/${s.name}`);
    const params = new URLSearchParams({ new: s.name });
    if (downloadId != null) params.set('downloaded', String(downloadId));
    await chrome.tabs.create({ url: `library.html?${params}` });
    ok = true;
  } catch (e) {
    showError(e);
  } finally {
    await teardown(s, false);
    if (ok && !s.settings.keepRecorderTab) setTimeout(() => window.close(), 300);
  }
}

// Fallback mode: the file was streamed into the extension's private storage;
// hand it to Chrome's downloader (Downloads/FreeRec/…) and then delete it.
async function exportToDownloads(s) {
  const file = await s.fileHandle.getFile();
  const url = URL.createObjectURL(file);
  try {
    const id = await chrome.downloads.download({ url, filename: `FreeRec/${s.name}`, conflictAction: 'uniquify', saveAs: false });
    const state = await new Promise((resolve) => {
      const listener = (delta) => {
        if (delta.id === id && delta.state && delta.state.current !== 'in_progress') {
          chrome.downloads.onChanged.removeListener(listener);
          resolve(delta.state.current);
        }
      };
      chrome.downloads.onChanged.addListener(listener);
    });
    if (state !== 'complete') throw new Error('Saving to Downloads failed. The recording is kept in “My recordings → Stored in browser”.');
    await s.target.dir.removeEntry(s.name).catch(() => {});
    return id;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function addRecent(entry) {
  const li = document.createElement('li');
  li.textContent = `${entry.folder}/${entry.name} · ${formatDuration(entry.durationMs)} · ${formatBytes(entry.size)}`;
  $('recent').querySelector('ul').prepend(li);
  $('recent').hidden = false;
}

// --- screenshots -------------------------------------------------------------

async function saveScreenshot({ dataUrl, rect, dpr = 1 }) {
  const img = await createImageBitmap(await (await fetch(dataUrl)).blob());
  let [sx, sy, sw, sh] = [0, 0, img.width, img.height];
  if (rect) {
    sx = Math.max(0, Math.round(rect.x * dpr));
    sy = Math.max(0, Math.round(rect.y * dpr));
    sw = Math.min(img.width - sx, Math.round(rect.w * dpr));
    sh = Math.min(img.height - sy, Math.round(rect.h * dpr));
  }
  const canvas = new OffscreenCanvas(sw, sh);
  canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  const blob = await canvas.convertToBlob({ type: 'image/png' });

  const dir = await getFolder();
  if (dir && (await folderPermission(dir))) {
    const name = await uniqueName(dir, 'png', 'Screenshot');
    const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await w.write(blob);
    await w.close();
    return { name, folder: dir.name };
  }
  const name = `${stamp('Screenshot')}.png`;
  const url = URL.createObjectURL(blob);
  const downloadId = await chrome.downloads.download({ url, filename: `FreeRec/${name}`, conflictAction: 'uniquify', saveAs: false });
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { name, folder: 'Downloads/FreeRec', downloadId };
}

// --- wiring ----------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'recorder') return;
  switch (msg.cmd) {
    case 'ping': sendResponse({ tabId: myTabId, busy: !!session }); return;
    case 'start': start(msg.returnTabId); break;
    case 'stop': stop(); break;
    case 'pause': pause(); break;
    case 'resume': resume(); break;
    case 'togglePause': rec.status === 'paused' ? resume() : pause(); break;
    case 'cancel': cancel(); break;
    case 'restart': restart(); break;
    case 'saveScreenshot':
      saveScreenshot(msg).then(sendResponse, (e) => sendResponse({ error: e?.message || String(e) }));
      return true;
  }
  sendResponse({ ok: true });
});

$('btn-pause').onclick = () => (rec.status === 'paused' ? resume() : pause());
$('btn-stop').onclick = () => stop();
$('btn-cancel').onclick = () => cancel();

window.addEventListener('beforeunload', (e) => {
  if (session?.recorder) e.preventDefault();
});

(async () => {
  const tab = await chrome.tabs.getCurrent();
  myTabId = tab?.id ?? null;
  if (myTabId != null) chrome.tabs.update(myTabId, { autoDiscardable: false }).catch(() => {});
  await setRec({ status: 'idle' }, true);

  const params = new URLSearchParams(location.search);
  if (params.get('start')) {
    history.replaceState(null, '', 'recorder.html');
    const ret = params.get('returnTab');
    start(ret ? Number(ret) : null);
  }
})();
