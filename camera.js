// Camera bubble rendered inside the on-page overlay iframe, with live effects.
import { EffectsRenderer } from './lib/effects.js';
import { getEffects, getSettings } from './lib/store.js';

const video = document.getElementById('v');
const canvas = document.getElementById('c');
const msg = document.getElementById('msg');
const renderer = new EffectsRenderer(video, canvas);
let stream = null;
let label = null;

async function findDevice(wanted) {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.find((d) => d.kind === 'videoinput' && d.label === wanted)?.deviceId || null;
}

function open(deviceId) {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: 640 },
      height: { ideal: 640 },
      frameRate: { ideal: 30 },
    },
  });
}

async function openCamera(wanted) {
  label = wanted;
  stream?.getTracks().forEach((t) => t.stop());
  try {
    let id = await findDevice(wanted);
    stream = await open(id);
    // Labels may only become visible after the first grant; switch if needed.
    if (!id && wanted) {
      id = await findDevice(wanted);
      if (id && stream.getVideoTracks()[0]?.getSettings().deviceId !== id) {
        stream.getTracks().forEach((t) => t.stop());
        stream = await open(id);
      }
    }
    video.srcObject = stream;
    await video.play().catch(() => {});
    msg.style.display = 'none';
    renderer.start();
  } catch (e) {
    msg.textContent = e.name === 'NotAllowedError' ? 'Camera blocked' : 'Camera unavailable';
    msg.style.display = 'grid';
  }
}

async function applyEffects() {
  const [effects, { customBg }] = await Promise.all([getEffects(), chrome.storage.local.get('customBg')]);
  await renderer.setEffects(effects, customBg);
}

// The panel asks for snapshots to preview filters/backgrounds on your face.
const channel = new BroadcastChannel('freerec-camera');
channel.onmessage = (e) => {
  if (e.data?.type !== 'snapshot-request' || !video.videoWidth) return;
  const size = 160;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const s = Math.min(video.videoWidth, video.videoHeight);
  ctx.translate(size, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, (video.videoWidth - s) / 2, (video.videoHeight - s) / 2, s, s, 0, 0, size, size);
  channel.postMessage({ type: 'snapshot', url: c.toDataURL('image/jpeg', 0.75) });
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.effects || changes.customBg) applyEffects();
  const next = changes.settings?.newValue?.cameraLabel;
  if (next !== undefined && next !== label) openCamera(next);
});

addEventListener('pagehide', () => stream?.getTracks().forEach((t) => t.stop()));

const settings = await getSettings();
openCamera(settings.cameraLabel);
applyEffects();
