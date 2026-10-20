// Renders the camera with a colour filter and an optional virtual background
// (blur / colour / scene / custom image). Person segmentation uses MediaPipe's
// selfie segmenter, loaded lazily the first time a background is chosen.

import { filterCss, drawBackground } from './catalog.js';

const MP = chrome.runtime.getURL('vendor/mediapipe/');

let segmenterPromise = null;
function loadSegmenter() {
  segmenterPromise ||= (async () => {
    const { ImageSegmenter } = await import(`${MP}vision_bundle.mjs`);
    const fileset = { wasmLoaderPath: `${MP}wasm/vision_wasm_internal.js`, wasmBinaryPath: `${MP}wasm/vision_wasm_internal.wasm` };
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: `${MP}selfie_segmenter.tflite`, delegate },
      runningMode: 'VIDEO',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });
    try {
      return await ImageSegmenter.createFromOptions(fileset, options('GPU'));
    } catch {
      return ImageSegmenter.createFromOptions(fileset, options('CPU'));
    }
  })();
  return segmenterPromise;
}

export class EffectsRenderer {
  constructor(video, canvas) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mask = document.createElement('canvas');
    this.person = document.createElement('canvas');
    this.effects = { filter: 'none', background: 'none' };
    this.customImage = null;
    this.segmenter = null;
    this.lastTs = 0;
    this.running = false;
  }

  async setEffects(effects, customImageUrl) {
    this.effects = { ...this.effects, ...effects };
    if (this.effects.background === 'custom' && customImageUrl && customImageUrl !== this.customUrl) {
      this.customUrl = customImageUrl;
      const img = new Image();
      img.src = customImageUrl;
      await img.decode().catch(() => {});
      this.customImage = img;
    }
    if (this.effects.background !== 'none' && !this.segmenter) {
      try {
        this.segmenter = await loadSegmenter();
      } catch (e) {
        console.warn('FreeRec: background effects unavailable', e);
      }
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.draw();
      this.video.requestVideoFrameCallback(loop);
    };
    this.video.requestVideoFrameCallback(loop);
  }

  stop() {
    this.running = false;
  }

  draw() {
    const { video, canvas, ctx } = this;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = this.mask.width = this.person.width = w;
      canvas.height = this.mask.height = this.person.height = h;
    }
    const filter = filterCss(this.effects.filter);
    const bg = this.effects.background;

    if (bg === 'none' || !this.segmenter) {
      ctx.filter = filter;
      ctx.drawImage(video, 0, 0, w, h);
      ctx.filter = 'none';
      return;
    }

    let ts = performance.now();
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    const result = this.segmenter.segmentForVideo(video, ts);
    const confidence = result.confidenceMasks?.[0];
    if (!confidence) {
      ctx.drawImage(video, 0, 0, w, h);
      return;
    }
    const values = confidence.getAsFloat32Array();
    const mw = confidence.width;
    const mh = confidence.height;
    confidence.close();
    result.close?.();

    // Confidence mask -> alpha channel.
    const tmp = this.maskData?.width === mw && this.maskData.height === mh ? this.maskData : (this.maskData = new ImageData(mw, mh));
    const px = tmp.data;
    for (let i = 0, j = 3; i < values.length; i++, j += 4) px[j] = values[i] * 255;
    const small = this.maskSmall?.width === mw && this.maskSmall.height === mh ? this.maskSmall : (this.maskSmall = new OffscreenCanvas(mw, mh));
    small.getContext('2d').putImageData(tmp, 0, 0);

    const mctx = this.mask.getContext('2d');
    mctx.clearRect(0, 0, w, h);
    mctx.filter = 'blur(2px)';
    mctx.drawImage(small, 0, 0, w, h);
    mctx.filter = 'none';

    // Person layer: frame clipped to mask.
    const pctx = this.person.getContext('2d');
    pctx.globalCompositeOperation = 'copy';
    pctx.drawImage(this.mask, 0, 0);
    pctx.globalCompositeOperation = 'source-in';
    pctx.filter = filter;
    pctx.drawImage(video, 0, 0, w, h);
    pctx.filter = 'none';
    pctx.globalCompositeOperation = 'source-over';

    // Background layer.
    ctx.globalCompositeOperation = 'source-over';
    if (bg === 'blur') {
      ctx.filter = `blur(${Math.round(w / 40)}px) ${filter === 'none' ? '' : filter}`;
      ctx.drawImage(video, 0, 0, w, h);
      ctx.filter = 'none';
    } else {
      const key = `${bg}|${w}x${h}|${bg === 'custom' ? this.customUrl : ''}`;
      if (this.bgKey !== key) {
        this.bgCache ||= document.createElement('canvas');
        this.bgCache.width = w;
        this.bgCache.height = h;
        drawBackground(this.bgCache.getContext('2d'), w, h, bg, this.customImage);
        this.bgKey = key;
      }
      ctx.drawImage(this.bgCache, 0, 0);
    }
    ctx.drawImage(this.person, 0, 0);
  }
}
