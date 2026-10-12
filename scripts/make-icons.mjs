// Dev-only: renders the GeekSync icon to PNG with no dependencies (supersampled vector shapes).
// Usage: node scripts/make-icons.mjs   → icons/{16,32,48,128}.png and assets/logo-512.png
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const BG_A = hex('#7C4DFF'); // violet (top-left)
const BG_B = hex('#2563EB'); // blue (bottom-right)

function inRoundRect(x, y, r) {
  const dx = Math.max(r - x, 0, x - (1 - r)), dy = Math.max(r - y, 0, y - (1 - r));
  return dx * dx + dy * dy <= r * r;
}
function inTriangle(px, py, [a, b, c]) {
  const s = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const d1 = s([px, py], a, b), d2 = s([px, py], b, c), d3 = s([px, py], c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
function nearSegment(px, py, [ax, ay], [bx, by], hw) {
  const vx = bx - ax, vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  const dx = px - (ax + t * vx), dy = py - (ay + t * vy);
  return dx * dx + dy * dy <= hw * hw;
}
const angIn = (a, from, to) => { a = ((a % TAU) + TAU) % TAU; return from <= to ? a >= from && a <= to : a >= from || a <= to; };

/** Is (x,y) in [0,1]² covered by the white glyph? `bold` thickens strokes for tiny sizes. */
function glyph(x, y, bold) {
  const cx = 0.5, cy = 0.5, R = 0.31, th = bold ? 0.10 : 0.07;
  const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
  const deg = (v) => (v * Math.PI) / 180;
  // two sync arcs (screen angles, clockwise), each ending in an arrowhead
  const arcs = [[deg(200), deg(318)], [deg(20), deg(138)]];
  for (const [from, to] of arcs) {
    if (Math.abs(d - R) <= th / 2 && angIn(a, from, to)) return true;
    const P = [cx + R * Math.cos(to), cy + R * Math.sin(to)];
    const n = [Math.cos(to), Math.sin(to)], t = [-Math.sin(to), Math.cos(to)];
    const h = bold ? 0.15 : 0.12, w = bold ? 0.13 : 0.10;
    const tri = [[P[0] + t[0] * h, P[1] + t[1] * h], [P[0] + n[0] * w, P[1] + n[1] * w], [P[0] - n[0] * w, P[1] - n[1] * w]];
    if (inTriangle(x, y, tri)) return true;
  }
  if (bold) return false; // chevrons are illegible at 16px
  // </> chevrons in the middle
  const hw = 0.028;
  const lt = [[0.395, 0.42], [0.315, 0.5], [0.395, 0.58]];
  const gt = [[0.605, 0.42], [0.685, 0.5], [0.605, 0.58]];
  for (const pts of [lt, gt]) {
    if (nearSegment(x, y, pts[0], pts[1], hw) || nearSegment(x, y, pts[1], pts[2], hw)) return true;
  }
  return nearSegment(x, y, [0.535, 0.405], [0.465, 0.595], hw); // the "/" in </>
}

function render(size) {
  const SS = 4, bold = size <= 24, px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let cover = 0, white = 0;
    for (let sj = 0; sj < SS; sj++) for (let si = 0; si < SS; si++) {
      const x = (i + (si + 0.5) / SS) / size, y = (j + (sj + 0.5) / SS) / size;
      if (!inRoundRect(x, y, 0.22)) continue;
      cover++;
      if (glyph(x, y, bold)) white++;
    }
    const t = (i + j) / (2 * size), o = (j * size + i) * 4;
    const k = cover ? white / cover : 0;
    for (let c = 0; c < 3; c++) px[o + c] = Math.round(lerp(lerp(BG_A[c], BG_B[c], t), 255, k));
    px[o + 3] = Math.round((cover / (SS * SS)) * 255);
  }
  return png(size, px);
}

function png(size, rgba) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const root = new URL('..', import.meta.url);
mkdirSync(new URL('assets/', root), { recursive: true });
for (const s of [16, 32, 48, 128]) writeFileSync(new URL(`icons/${s}.png`, root), render(s));
writeFileSync(new URL('assets/logo-512.png', root), render(512));
console.log('icons written');
