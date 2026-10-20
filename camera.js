// Camera bubble rendered inside the on-page overlay iframe.
const label = new URLSearchParams(location.search).get('label') || '';
const video = document.getElementById('v');
const msg = document.getElementById('msg');

async function findDevice() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.find((d) => d.kind === 'videoinput' && d.label === label)?.deviceId || null;
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

(async () => {
  try {
    let id = await findDevice();
    let stream = await open(id);
    // Labels may only become visible after the first grant; switch if needed.
    if (!id && label) {
      id = await findDevice();
      if (id && stream.getVideoTracks()[0]?.getSettings().deviceId !== id) {
        stream.getTracks().forEach((t) => t.stop());
        stream = await open(id);
      }
    }
    video.srcObject = stream;
    addEventListener('pagehide', () => stream.getTracks().forEach((t) => t.stop()));
  } catch (e) {
    msg.textContent = e.name === 'NotAllowedError' ? 'Camera blocked on this page' : 'Camera unavailable';
    msg.style.display = 'grid';
  }
})();
