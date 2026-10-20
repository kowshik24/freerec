// MediaRecorder WebM output has no Duration element, so players can't show
// length or seek well. While recording we insert a Duration placeholder into the
// Segment Info of the first chunk, remember its file offset, and overwrite the
// value in place when the recording finishes (no re-copy of the file).

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Info: 0x1549a966,
  Cluster: 0x1f43b675,
  TimecodeScale: 0x2ad7b1,
  Duration: 0x4489,
};

function readVint(buf, pos) {
  if (pos >= buf.length) return null;
  const first = buf[pos];
  let len = 1;
  let mask = 0x80;
  while (len <= 8 && !(first & mask)) { mask >>= 1; len++; }
  if (len > 8 || pos + len > buf.length) return null;
  let value = first & (mask - 1);
  let unknown = value === mask - 1;
  for (let i = 1; i < len; i++) {
    value = value * 256 + buf[pos + i];
    if (buf[pos + i] !== 0xff) unknown = false;
  }
  return { value, length: len, unknown };
}

function readId(buf, pos) {
  const v = readVint(buf, pos);
  if (!v) return null;
  let id = 0;
  for (let i = 0; i < v.length; i++) id = id * 256 + buf[pos + i];
  return { id, length: v.length };
}

function readElement(buf, pos) {
  const id = readId(buf, pos);
  if (!id) return null;
  const size = readVint(buf, pos + id.length);
  if (!size) return null;
  const dataStart = pos + id.length + size.length;
  return { id: id.id, idLength: id.length, size, sizePos: pos + id.length, dataStart, end: dataStart + size.value };
}

function encodeSize(value, len) {
  if (value > 2 ** (7 * len) - 2) return null;
  const out = new Uint8Array(len);
  let v = value;
  for (let i = len - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
  out[0] |= 0x80 >> (len - 1);
  return out;
}

function readUint(buf, pos, len) {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + buf[pos + i];
  return v;
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/**
 * @param {Uint8Array} buf first chunk emitted by MediaRecorder
 * @returns {{bytes: Uint8Array, durationOffset: number, durationSize: number, timecodeScale: number} | null}
 */
export function prepareWebmHeader(buf) {
  const ebml = readElement(buf, 0);
  if (!ebml || ebml.id !== ID.EBML) return null;
  const seg = readElement(buf, ebml.end);
  if (!seg || seg.id !== ID.Segment) return null;

  let p = seg.dataStart;
  while (p < buf.length) {
    const el = readElement(buf, p);
    if (!el || el.id === ID.Cluster) return null;
    if (el.size.unknown) return null;
    if (el.id !== ID.Info) { p = el.end; continue; }
    if (el.end > buf.length) return null;

    let timecodeScale = 1_000_000;
    let q = el.dataStart;
    while (q < el.end) {
      const child = readElement(buf, q);
      if (!child) return null;
      if (child.id === ID.TimecodeScale) timecodeScale = readUint(buf, child.dataStart, child.size.value);
      if (child.id === ID.Duration && (child.size.value === 4 || child.size.value === 8)) {
        return { bytes: buf, durationOffset: child.dataStart, durationSize: child.size.value, timecodeScale };
      }
      q = child.end;
    }

    // Duration element: ID 0x4489, size 8, float64 placeholder.
    const durEl = new Uint8Array([0x44, 0x89, 0x88, 0, 0, 0, 0, 0, 0, 0, 0]);
    const newInfoSize = el.size.value + durEl.length;
    const infoSizeBytes = encodeSize(newInfoSize, el.size.length) || encodeSize(newInfoSize, 8);
    const delta = infoSizeBytes.length - el.size.length + durEl.length;

    let segSizeBytes = buf.subarray(seg.sizePos, seg.dataStart);
    if (!seg.size.unknown) {
      segSizeBytes = encodeSize(seg.size.value + delta, seg.size.length);
      if (!segSizeBytes) return null;
    }

    const head = concat([
      buf.subarray(0, seg.sizePos),
      segSizeBytes,
      buf.subarray(seg.dataStart, el.sizePos),
      infoSizeBytes,
      buf.subarray(el.dataStart, el.end),
    ]);
    const bytes = concat([head, durEl, buf.subarray(el.end)]);
    return { bytes, durationOffset: head.length + 3, durationSize: 8, timecodeScale };
  }
  return null;
}

export function durationBytes(ms, info) {
  const value = (ms * 1_000_000) / info.timecodeScale;
  const out = new Uint8Array(info.durationSize);
  const view = new DataView(out.buffer);
  if (info.durationSize === 4) view.setFloat32(0, value);
  else view.setFloat64(0, value);
  return out;
}
