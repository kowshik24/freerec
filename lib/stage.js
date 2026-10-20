// Canvas stage: background colours/images, text layouts and templates.
// renderStage() draws the same markup for the live canvas page and for the
// small picker thumbnails (sizes are in container units, see stage.css).

const svgUrl = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function archSvg() {
  const colors = ['#c9c3f5', '#e57c5c', '#f6c35b', '#f8d3cf', '#f6f3ec'];
  const paths = colors.map((c, i) => {
    const r = 52 - i * 9;
    return `<path d="M${80 - r} 100V${100 - r * 0.9}a${r} ${r} 0 0 1 ${r * 2} 0V100z" fill="${c}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100" preserveAspectRatio="xMidYMax slice"><rect width="160" height="100" fill="#6b5ef0"/>${paths}</svg>`;
}

function paintSvg() {
  const rnd = seeded(5);
  const colors = ['#ff4f9a', '#ffd23f', '#3ec6e0', '#7b5cff', '#ff7a45', '#29d39a'];
  let blobs = '';
  for (let i = 0; i < 70; i++) {
    const edge = i % 4;
    const t = rnd() * 160;
    const d = rnd() * 9;
    const [x, y] = edge === 0 ? [t, d] : edge === 1 ? [t, 100 - d] : edge === 2 ? [d, t * 0.625] : [160 - d, t * 0.625];
    blobs += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1.5 + rnd() * 5).toFixed(1)}" fill="${colors[i % colors.length]}" opacity="${(0.55 + rnd() * 0.45).toFixed(2)}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100" preserveAspectRatio="none"><defs><filter id="b"><feGaussianBlur stdDeviation="1.1"/></filter></defs><rect width="160" height="100" fill="#fff"/><g filter="url(#b)">${blobs}</g></svg>`;
}

function dashesSvg() {
  const rnd = seeded(9);
  let lines = '';
  for (let y = 6; y < 74; y += 6) {
    for (let x = 5; x < 88; x += 6) {
      const a = Math.sin(x / 14 + y / 20) * 70 + rnd() * 20;
      lines += `<line x1="-1.8" x2="1.8" transform="translate(${x} ${y}) rotate(${a.toFixed(0)})" stroke="#e8e8f2" stroke-width=".7" stroke-linecap="round"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100" preserveAspectRatio="none"><rect width="160" height="100" fill="#e3805f"/><rect width="92" height="78" fill="#2d2b45"/><rect x="92" width="68" height="78" fill="#6f68f5"/><rect y="78" width="22" height="22" fill="#f6c35b"/>${lines}</svg>`;
}

function floralSvg() {
  const rnd = seeded(13);
  let flowers = '';
  for (let i = 0; i < 46; i++) {
    const edge = i % 4;
    const t = rnd();
    const d = rnd() * 14;
    const [x, y] = edge === 0 ? [t * 160, d] : edge === 1 ? [t * 160, 100 - d] : edge === 2 ? [d, t * 100] : [160 - d, t * 100];
    const r = 1.2 + rnd() * 1.6;
    const c = ['#8f7fc4', '#b6a8de', '#efe7f9', '#7d9b6c'][i % 4];
    flowers += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(rnd() * 72).toFixed(0)})">${[0, 72, 144, 216, 288].map((a) => `<ellipse rx="${(r * 0.55).toFixed(2)}" ry="${r.toFixed(2)}" cy="${(-r).toFixed(2)}" transform="rotate(${a})" fill="${c}"/>`).join('')}<circle r="${(r * 0.5).toFixed(2)}" fill="#f4d58d"/></g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice"><rect width="160" height="100" fill="#ddd3f0"/>${flowers}</svg>`;
}

function leavesSvg() {
  const rnd = seeded(21);
  let leaves = '';
  for (let i = 0; i < 40; i++) {
    const x = rnd() * 160;
    const y = rnd() * 100;
    const c = ['#2f5d34', '#3f7a43', '#1f4527', '#56915a'][i % 4];
    leaves += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(4 + rnd() * 6).toFixed(1)}" ry="${(18 + rnd() * 16).toFixed(1)}" transform="rotate(${(rnd() * 180).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="${c}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice"><rect width="160" height="100" fill="#173520"/>${leaves}</svg>`;
}

function helloSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#f6efe6"/><g font-family="Snell Roundhand, Brush Script MT, cursive" font-size="22" font-weight="700"><text x="4" y="24" fill="#bfd6ea">Hello</text><text x="64" y="54" fill="#f2c4c4">Hello</text></g></svg>`;
}

function shapesSvg() {
  const rnd = seeded(33);
  const colors = ['#f25c78', '#ffd23f', '#3ec6e0', '#7b5cff', '#ff8a3d', '#e9e9f2', '#4361ee'];
  let out = '';
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + rnd() * 0.2;
    const d = 22 + rnd() * 17;
    const x = 80 + Math.cos(a) * d * 1.05;
    const y = 50 + Math.sin(a) * d * 0.95;
    const s = 2 + rnd() * 5;
    const c = colors[i % colors.length];
    const kind = i % 4;
    out += kind === 0 ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(s / 1.6).toFixed(1)}" fill="${c}"/>`
      : kind === 1 ? `<rect x="${(x - s / 2).toFixed(1)}" y="${(y - s / 2).toFixed(1)}" width="${s.toFixed(1)}" height="${s.toFixed(1)}" fill="${c}" transform="rotate(${(rnd() * 90).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`
        : kind === 2 ? `<path d="M${x.toFixed(1)} ${(y - s).toFixed(1)}l${s.toFixed(1)} ${(s * 1.7).toFixed(1)}h${(-s * 2).toFixed(1)}z" fill="${c}"/>`
          : `<rect x="${(x - s).toFixed(1)}" y="${(y - s / 4).toFixed(1)}" width="${(s * 2).toFixed(1)}" height="${(s / 2).toFixed(1)}" rx=".5" fill="${c}" transform="rotate(${(a * 57).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  }
  const gear = Array.from({ length: 16 }, (_, i) => `<rect x="78" y="25.5" width="4" height="5" fill="#6c63ff" transform="rotate(${i * 22.5} 80 50)"/>`).join('');
  return `<svg class="abs shapes" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100" preserveAspectRatio="xMidYMid meet">${out}${gear}<circle cx="80" cy="50" r="21" fill="#6c63ff"/></svg>`;
}

function wreathSvg() {
  const leaves = Array.from({ length: 28 }, (_, i) => {
    const a = (i / 28) * 360;
    return `<ellipse cx="50" cy="6" rx="2.6" ry="6" fill="${i % 2 ? '#c4a574' : '#d8bf8f'}" transform="rotate(${a} 50 50) rotate(${i % 2 ? 25 : -25} 50 6)"/>`;
  }).join('');
  return `<svg class="abs wreath" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${leaves}<circle cx="50" cy="50" r="40" fill="none" stroke="#d6c39e" stroke-width="1" stroke-dasharray="2 2"/></svg>`;
}

// --- backgrounds -------------------------------------------------------------

export const BG_COLORS = ['#ffffff', '#f1f2f4', '#ebe9fb', '#c9c3f5', '#6058e8', '#ef6b4a', '#f8d6d2', '#d3e1fa'];

export const BG_IMAGES = {
  pastel: { name: 'Pastel', css: 'radial-gradient(at 15% 15%, #c8fff4 0, transparent 55%), radial-gradient(at 75% 35%, #f4b3d4 0, transparent 50%), radial-gradient(at 80% 95%, #fff59c 0, transparent 55%), linear-gradient(135deg, #d9f7ff, #f9d3e8 55%, #fff6b0)' },
  rainbow: { name: 'Rainbow', css: `${svgUrl(archSvg())} center bottom / cover no-repeat, #6b5ef0` },
  paint: { name: 'Paint', css: `${svgUrl(paintSvg())} center / 100% 100% no-repeat, #fff` },
  lagoon: { name: 'Lagoon', css: 'radial-gradient(ellipse at 50% 105%, #fff59c 0, #d8ec9e 25%, transparent 55%), linear-gradient(175deg, #2e8fb0, #56c1d6 40%, #8fd3c7 70%, #3d8fb8)' },
  dashes: { name: 'Dashes', css: `${svgUrl(dashesSvg())} center / 100% 100% no-repeat`, ink: '#ffffff' },
  floral: { name: 'Floral', css: `${svgUrl(floralSvg())} center / cover no-repeat, #ddd3f0` },
};

function inkFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum < 0.55 ? '#ffffff' : '#292a2e';
}

// --- text layouts --------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function slot(name, tag, value, editable, ph = '') {
  const ce = editable ? ' contenteditable="true" spellcheck="false"' : '';
  if (Array.isArray(value)) {
    return `<${tag} data-slot="${name}" data-list="1"${ce}>${value.map((v) => `<li>${esc(v)}</li>`).join('')}</${tag}>`;
  }
  return `<${tag} data-slot="${name}" data-ph="${esc(ph)}"${ce}>${esc(value)}</${tag}>`;
}

export const LAYOUTS = {
  blank: { name: 'Blank', defaults: {}, html: () => '' },
  hello: { name: 'Say hello', defaults: { text: 'Say hello!' }, html: (t, e) => `<div class="l-hello">${slot('text', 'div', t.text, e, 'Say hello!')}</div>` },
  'big-top': {
    name: 'Big idea',
    defaults: { title: 'Share your big idea here', sub: 'Share a smaller idea here' },
    html: (t, e) => `<div class="l-big-top">${slot('title', 'h1', t.title, e, 'Title')}${slot('sub', 'p', t.sub, e, 'Subtitle')}</div>`,
  },
  'big-left': {
    name: 'Big idea, left',
    defaults: { title: 'Share your big idea here', sub: 'Share a smaller idea here' },
    html: (t, e) => `<div class="l-big-left">${slot('title', 'h1', t.title, e, 'Title')}${slot('sub', 'p', t.sub, e, 'Subtitle')}</div>`,
  },
  bullets: {
    name: 'Bullet points',
    defaults: { list: ['Add a topic', 'And another one', 'And another one'] },
    html: (t, e) => `<div class="l-bullets">${slot('list', 'ul', t.list, e)}</div>`,
  },
  'pros-cons': {
    name: 'Pros and cons',
    defaults: { prosTitle: 'List your pros', pros: ['Add a key point', 'And another one'], consTitle: 'List your cons', cons: ['Add a key point', 'And another one'] },
    html: (t, e) => `<div class="l-pros"><div>${slot('prosTitle', 'h3', t.prosTitle, e)}${slot('pros', 'ul', t.pros, e)}</div><div>${slot('consTitle', 'h3', t.consTitle, e)}${slot('cons', 'ul', t.cons, e)}</div></div>`,
  },
};

// --- templates -----------------------------------------------------------------
// bubble: where the camera bubble goes, as a fraction of the page (centre point).

export const TEMPLATES = {
  meeting: {
    name: 'Meeting',
    bg: '#fadf96',
    bubble: { x: 0.12, y: 0.82 },
    defaults: { hi: "Hello! I'm Alex Rivera.", role: "I'm a product designer at Example Co.", msg: "Here's my message to all of you: thanks for a great quarter. Stay curious and keep shipping!" },
    html: (t, e) => `<div class="t-meeting"><div class="abs sun"></div>
      <div class="abs bar orange">☰ ${slot('hi', 'span', t.hi, e)}</div>
      <div class="abs bar purple">↳ ${slot('role', 'span', t.role, e)}</div>
      <div class="abs accent"></div>
      <div class="abs note">${slot('msg', 'p', t.msg, e)}</div></div>`,
  },
  standup: {
    name: 'Standup',
    bg: `${svgUrl(leavesSvg())} center / cover, #173520`,
    bubble: { x: 0.125, y: 0.72 },
    defaults: { msg: 'Hello! Here is a message just for you, from me. Today: wins, plans and blockers.' },
    html: (t, e) => `<div class="t-standup">
      <div class="abs win main"><div class="tb">Message <span><i></i><i></i><i></i></span></div><div class="body">${slot('msg', 'div', t.msg, e)}</div></div>
      <div class="abs win video"><div class="tb">Video <span><i></i><i></i><i></i></span></div></div></div>`,
  },
  celebration: {
    name: 'Celebration',
    bg: '#f7eded',
    bubble: { x: 0.5, y: 0.61 },
    defaults: { title: 'Congratulations!', sub: 'You did something wonderful.' },
    html: (t, e) => `<div class="t-celebration"><div class="abs frame"></div><div class="abs frame2"></div>
      ${slot('title', 'h1', t.title, e)}${wreathSvg()}${slot('sub', 'p', t.sub, e)}</div>`,
  },
  news: {
    name: 'News',
    bg: '#fde9ec',
    bubble: { x: 0.31, y: 0.56 },
    defaults: { title: 'Breaking News', list: ['This exciting new development means big things', "Keep doing what we're doing, it's working!", 'Reviews have been approved', 'Good job team!'] },
    html: (t, e) => `<div class="t-news">
      <div class="abs blob" style="left:4cqw;top:58cqh;width:30cqw;height:30cqh"></div>
      <div class="abs blob" style="left:66cqw;top:6cqh;width:28cqw;height:24cqh"></div>
      <div class="abs paper p3"></div><div class="abs paper p2"></div><div class="abs paper"></div>
      ${slot('title', 'h1', t.title, e)}${slot('list', 'ul', t.list, e)}</div>`,
  },
  hello: {
    name: 'Intro',
    bg: `${svgUrl(helloSvg())} 0 0 / 18% auto repeat, #f6efe6`,
    bubble: { x: 0.31, y: 0.6 },
    defaults: { title: '— Hello —', list: ['My name is …', 'Today is …', 'I work on …', 'Fun fact: …'] },
    html: (t, e) => `<div class="t-hello"><div class="abs card"></div>${slot('title', 'h1', t.title, e)}<div class="abs inner"></div>${slot('list', 'ul', t.list, e)}</div>`,
  },
  bubble: {
    name: 'Bubble',
    bg: '#2c2a4f',
    bubble: { x: 0.5, y: 0.5 },
    defaults: {},
    html: () => `<div class="t-bubble">${shapesSvg()}</div>`,
  },
};

/**
 * @param {HTMLElement} el
 * @param {{bg:{type:'color'|'image',value:string}, layout:string, template:string|null, texts:object}} state
 */
export function renderStage(el, state, { editable = false, thumbBubble = false } = {}) {
  const tpl = state.template && TEMPLATES[state.template];
  let bg;
  let ink;
  if (tpl) {
    bg = tpl.bg;
    ink = '#292a2e';
  } else if (state.bg?.type === 'color') {
    bg = state.bg.value;
    ink = inkFor(state.bg.value);
  } else {
    const img = BG_IMAGES[state.bg?.value] || BG_IMAGES.pastel;
    bg = img.css;
    ink = img.ink || '#292a2e';
  }
  const key = tpl ? `t:${state.template}` : `l:${state.layout}`;
  const def = tpl || LAYOUTS[state.layout] || LAYOUTS.blank;
  const texts = { ...def.defaults, ...(state.texts?.[key] || {}) };
  el.classList.add('stage');
  el.style.setProperty('--bg', bg);
  el.style.setProperty('--ink', ink);
  el.innerHTML = def.html(texts, editable);
  if (thumbBubble) {
    const pos = tpl?.bubble || { x: 0.12, y: 0.82 };
    el.insertAdjacentHTML('beforeend', `<span class="thumb-bubble" style="left:${pos.x * 100}%;top:${pos.y * 100}%"></span>`);
  }
  return key;
}

export function readSlots(el) {
  const out = {};
  el.querySelectorAll('[data-slot]').forEach((n) => {
    out[n.dataset.slot] = n.dataset.list
      ? [...n.querySelectorAll('li')].map((li) => li.textContent.trim()).filter(Boolean)
      : n.textContent.trim();
  });
  return out;
}
