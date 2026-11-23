// E18 inputs: "needle in a haystack" mosaics, to measure whether damage that fills a small share of the
// frame (a tear on a whole jacket) is still caught at the v3 first-stage size (512 px) and at 1600 px.
//
// Every tile comes from ONE capture session of the fabric corpus (fd-capture-2024-02-11: 45 damaged and
// 27 clean photographs of the same material under the same light), so a mosaic looks like one larger
// piece of the same fabric. A damaged mosaic holds one damaged tile, cropped so that its largest
// publisher box stays inside, among clean tiles; a clean mosaic holds only clean tiles and measures the
// false alarms caused by the tile seams themselves. Grids of 3x3, 4x4 and 6x6 at 1600 x 1600 px.
// The share of the frame the defect covers is recorded from the publisher's box.
//
// node experiments/backend-v2/make-mosaics.mjs   -> datasets/needle-v3/ (images git-ignored)
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT, loadCases } from './lib.mjs';

const SESSION = 'fd-capture-2024-02-11',
  SIZE = 1600,
  GRIDS = [3, 4, 6],
  CLEAN_PER_GRID = 20;
let s = 20261118;
const random = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
const dir = path.join(ROOT, 'datasets', 'needle-v3');
await fs.mkdir(path.join(dir, 'images'), { recursive: true });
const cases = (await loadCases()).filter((c) => c.group === SESSION && c.domain === 'fabric_closeup');
const damaged = cases.filter((c) => c.condition === 'visible_defect' && c.publisherBoxes?.some((b) => b[0] >= 1));
const clean = cases.filter((c) => c.condition === 'no_visible_defect');
const meta = new Map();
for (const c of [...damaged, ...clean]) meta.set(c.id, await sharp(path.join(ROOT, c.file)).rotate().metadata());

/** A square crop of one photograph, resized to the cell. For a damaged photograph the window is
 * placed so the centre of its largest defect box is inside; returns the box's share of the crop. */
async function tile(c, cell, keepBox) {
  const m = meta.get(c.id);
  const W = m.width,
    H = m.height,
    side = Math.floor(Math.min(W, H) * (keepBox ? 1 : 0.7 + random() * 0.3));
  let left = Math.floor(random() * (W - side + 1)),
    top = Math.floor(random() * (H - side + 1)),
    share = 0;
  if (keepBox) {
    const box = c.publisherBoxes.filter((b) => b[0] >= 1).sort((a, b) => b[3] * b[4] - a[3] * a[4])[0];
    const [, cx, cy, bw, bh] = box;
    left = Math.min(Math.max(0, Math.round(cx * W - side / 2)), W - side);
    top = Math.min(Math.max(0, Math.round(cy * H - side / 2)), H - side);
    // Share of the crop the box covers (clipped to the crop).
    const x1 = Math.max(left, (cx - bw / 2) * W),
      x2 = Math.min(left + side, (cx + bw / 2) * W),
      y1 = Math.max(top, (cy - bh / 2) * H),
      y2 = Math.min(top + side, (cy + bh / 2) * H);
    share = Math.max(0, x2 - x1) * Math.max(0, y2 - y1) / (side * side);
  }
  const buffer = await sharp(path.join(ROOT, c.file))
    .rotate()
    .extract({ left, top, width: side, height: side })
    .resize(cell, cell)
    .toBuffer();
  return { buffer, share };
}
async function mosaic(id, n, defect) {
  const cell = Math.floor(SIZE / n),
    at = Math.floor(random() * n * n);
  const composites = [];
  let share = 0;
  for (let k = 0; k < n * n; k++) {
    const isDefect = defect && k === at;
    const source = isDefect ? defect : clean[Math.floor(random() * clean.length)];
    const t = await tile(source, cell, isDefect);
    if (isDefect) share = t.share / (n * n);
    composites.push({ input: t.buffer, left: (k % n) * cell, top: Math.floor(k / n) * cell });
  }
  const file = path.join(dir, 'images', id + '.jpg');
  await sharp({ create: { width: cell * n, height: cell * n, channels: 3, background: '#808080' } })
    .composite(composites)
    .jpeg({ quality: 92 })
    .toFile(file);
  return { file: path.relative(ROOT, file).replaceAll('\\', '/'), share };
}
const out = [];
for (const n of GRIDS) {
  for (const d of damaged) {
    const id = `needle-${n}x${n}-${d.id}`;
    const { file, share } = await mosaic(id, n, d);
    out.push({ id, file, domain: 'mosaic_fabric', group: 'needle-' + d.id, condition: 'visible_defect', subject: 'fabric_sample', view: 'front', grid: n, defectShare: +share.toFixed(5), sourceId: d.id });
  }
  for (let i = 0; i < CLEAN_PER_GRID; i++) {
    const id = `needle-${n}x${n}-clean-${String(i + 1).padStart(2, '0')}`;
    const { file } = await mosaic(id, n, null);
    out.push({ id, file, domain: 'mosaic_fabric', group: id, condition: 'no_visible_defect', subject: 'fabric_sample', view: 'front', grid: n, defectShare: 0, sourceId: null });
  }
}
await fs.writeFile(
  path.join(dir, 'labels.json'),
  JSON.stringify({ frozenAt: new Date().toISOString(), session: SESSION, size: SIZE, grids: GRIDS, cases: out }, null, 1) + '\n',
);
const shares = out.filter((c) => c.defectShare > 0).map((c) => c.defectShare).sort((a, b) => a - b);
console.log(JSON.stringify({ mosaics: out.length, damaged: damaged.length, cleanTiles: clean.length, defectShare: { min: shares[0], median: shares[Math.floor(shares.length / 2)], max: shares.at(-1) } }));
