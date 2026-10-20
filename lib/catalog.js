// Camera filters, virtual backgrounds and canvas templates. Backgrounds are
// drawn procedurally so the same function renders the picker tile and the
// real background behind the person.

export const FILTERS = [
  { id: 'none', name: 'None', css: 'none' },
  { id: 'pop', name: 'Pop', css: 'contrast(1.2) saturate(1.35)' },
  { id: 'mono', name: 'Mono', css: 'grayscale(1) contrast(1.1)' },
  { id: 'golden', name: 'Golden', css: 'brightness(1.05) contrast(1.08) saturate(1.2) sepia(0.15)' },
  { id: 'soft', name: 'Soft', css: 'brightness(1.1) contrast(0.92) saturate(0.8) sepia(0.08)' },
  { id: 'ember', name: 'Ember', css: 'brightness(0.98) contrast(1.2) saturate(1.25) sepia(0.1)' },
  { id: 'tide', name: 'Tide', css: 'brightness(1.08) contrast(1.05) saturate(1.1) hue-rotate(5deg)' },
  { id: 'film', name: 'Film', css: 'brightness(1.06) contrast(1.02) saturate(0.95) sepia(0.18)' },
  { id: 'bold', name: 'Bold', css: 'contrast(1.5) saturate(1.1)' },
  { id: 'vintage', name: 'Vintage', css: 'sepia(0.3) contrast(1.3) saturate(1.2)' },
];

export const filterCss = (id) => FILTERS.find((f) => f.id === id)?.css || 'none';

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function linear(ctx, w, h, angleDeg, stops) {
  const a = (angleDeg * Math.PI) / 180;
  const dx = (Math.sin(a) * w) / 2;
  const dy = (-Math.cos(a) * h) / 2;
  const g = ctx.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy);
  stops.forEach(([at, c]) => g.addColorStop(at, c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function blobs(ctx, w, h, seed, count, colors, minR, maxR, blur) {
  const rnd = seeded(seed);
  ctx.save();
  ctx.filter = `blur(${Math.round(blur * Math.min(w, h))}px)`;
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = 0.35 + rnd() * 0.5;
    ctx.fillStyle = colors[i % colors.length];
    ctx.beginPath();
    ctx.arc(rnd() * w, rnd() * h, (minR + rnd() * (maxR - minR)) * Math.min(w, h), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

const SCENES = {
  sunset: (c, w, h) => linear(c, w, h, 180, [[0, '#2878c8'], [0.55, '#f08a3c'], [1, '#ffd45e']]),
  neon: (c, w, h) => linear(c, w, h, 135, [[0, '#ff3cac'], [0.5, '#784ba0'], [1, '#2b86c5']]),
  mint: (c, w, h) => linear(c, w, h, 135, [[0, '#a8edea'], [1, '#fed6e3']]),
  bokeh: (c, w, h) => {
    linear(c, w, h, 160, [[0, '#3a3138'], [1, '#8d7a76']]);
    blobs(c, w, h, 7, 26, ['#ffe2c4', '#ffd0a8', '#fff3e0'], 0.03, 0.08, 0.01);
  },
  leaves: (c, w, h) => {
    linear(c, w, h, 160, [[0, '#2f5d1e'], [1, '#9cc65b']]);
    blobs(c, w, h, 3, 18, ['#c9e78a', '#5e8f2e', '#e9f7b8'], 0.08, 0.2, 0.04);
  },
  city: (c, w, h) => {
    linear(c, w, h, 180, [[0, '#0b1a33'], [1, '#1d3557']]);
    blobs(c, w, h, 11, 30, ['#ffb347', '#ff6f61', '#7ad3ff', '#fff1a8'], 0.02, 0.06, 0.012);
  },
  dawn: (c, w, h) => {
    linear(c, w, h, 180, [[0, '#ffc3a0'], [1, '#ffafbd']]);
    c.save();
    c.filter = `blur(${Math.round(0.03 * Math.min(w, h))}px)`;
    c.fillStyle = '#fff4d6';
    c.beginPath();
    c.arc(w * 0.72, h * 0.32, Math.min(w, h) * 0.16, 0, Math.PI * 2);
    c.fill();
    c.restore();
  },
  studio: (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h * 0.4, Math.max(w, h) * 0.75);
    g.addColorStop(0, '#f4f1ec');
    g.addColorStop(1, '#a9a49b');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  },
};

export const BACKGROUNDS = {
  top: ['none', 'blur', 'sunset', 'neon', 'mint'],
  scenes: ['bokeh', 'leaves', 'city', 'dawn', 'studio'],
  colors: ['#d0e0fa', '#2f6bd9', '#f8d3cf', '#c9372c', '#3f8460', '#292a2e', '#c9c3f5', '#6a5ef0', '#f8e6ad', '#f0a83a', '#b6b8bd'],
};

/** Paint a background id ('sunset', '#hex', 'custom') into ctx. */
export function drawBackground(ctx, w, h, id, customImage) {
  if (id.startsWith('#')) {
    ctx.fillStyle = id;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (id === 'custom' && customImage) {
    const s = Math.max(w / customImage.width, h / customImage.height);
    const iw = customImage.width * s;
    const ih = customImage.height * s;
    ctx.drawImage(customImage, (w - iw) / 2, (h - ih) / 2, iw, ih);
    return;
  }
  (SCENES[id] || SCENES.studio)(ctx, w, h);
}

export function backgroundTile(id, size = 96) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  drawBackground(canvas.getContext('2d'), size, size, id);
  return canvas.toDataURL('image/png');
}
