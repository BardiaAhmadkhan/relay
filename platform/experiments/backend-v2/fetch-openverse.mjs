// Download the Openverse candidates (discover-openverse.mjs) for visual review, with attribution.
// Images go to datasets/gear-v2-openverse/images/ (git-ignored: several licences are non-commercial,
// so the pixels stay on this machine); the manifest with licence and source is kept.
// Each image is decoded and re-encoded by sharp, so nothing downloaded is used as-is.
// node experiments/backend-v2/fetch-openverse.mjs
//   [--candidates openverse-candidates-2.json --dataset realworld-v3 --prefix ox --manifest manifest-openverse.json]
// The options (added 2026-11-18 for E19) put a second harvest beside the real-world set; the defaults are unchanged.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { OUT, ROOT, args } from './lib.mjs';

const a = args();

const dir = path.join(ROOT, 'datasets', a.dataset ?? 'gear-v2-openverse');
const prefix = a.prefix ?? 'ov';
const images = path.join(dir, 'images'),
  review = path.join(dir, 'review');
await fs.mkdir(images, { recursive: true });
await fs.mkdir(review, { recursive: true });
const { candidates, retrieved } = JSON.parse(
  await fs.readFile(path.join(OUT, a.candidates ?? 'openverse-candidates.json'), 'utf8'),
);
const manifest = [];
for (const [i, c] of candidates.entries()) {
  const id = prefix + '-' + String(i + 1).padStart(3, '0');
  const file = path.join(images, id + '.jpg');
  try {
    if (!fsSync.existsSync(file)) {
      const response = await fetch(c.url, {
        headers: { 'User-Agent': 'gear-recognition-lab research script' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error('http ' + response.status);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 15_000_000) throw new Error('too large');
      await sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'error' })
        .rotate()
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 92 })
        .toFile(file);
    }
    const meta = await sharp(file).metadata();
    manifest.push({
      id,
      file: path.relative(ROOT, file).replaceAll('\\', '/'),
      sha256: createHash('sha256').update(await fs.readFile(file)).digest('hex'),
      width: meta.width,
      height: meta.height,
      openverseId: c.openverseId,
      title: c.title,
      creator: c.creator,
      license: c.license,
      licenseVersion: c.licenseVersion,
      licenseUrl: c.licenseUrl,
      source: c.source,
      landingUrl: c.landingUrl,
      queries: c.queries,
    });
  } catch (error) {
    manifest.push({ id, openverseId: c.openverseId, title: c.title, error: String(error.message ?? error) });
  }
}
await fs.writeFile(
  path.join(dir, a.manifest ?? 'manifest.json'),
  JSON.stringify({ retrieved, fetched: new Date().toISOString(), images: manifest }, null, 1) + '\n',
);
// Contact sheets: 20 numbered tiles per sheet, for labelling by eye.
const ok = manifest.filter((m) => !m.error);
const TILE = 300,
  COLS = 5,
  ROWS = 4;
for (let s = 0; s * COLS * ROWS < ok.length; s++) {
  const page = ok.slice(s * COLS * ROWS, (s + 1) * COLS * ROWS);
  const composites = [];
  for (const [k, m] of page.entries()) {
    const tile = await sharp(path.join(ROOT, m.file))
      .resize(TILE, TILE - 24, { fit: 'contain', background: '#202020' })
      .extend({ top: 24, background: '#202020' })
      .composite([
        {
          input: Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="24"><text x="6" y="18" font-family="Arial" font-size="16" fill="#ffffff">${m.id}</text></svg>`,
          ),
          top: 0,
          left: 0,
        },
      ])
      .jpeg()
      .toBuffer();
    composites.push({ input: tile, left: (k % COLS) * TILE, top: Math.floor(k / COLS) * TILE });
  }
  await sharp({
    create: { width: COLS * TILE, height: ROWS * TILE, channels: 3, background: '#000000' },
  })
    .composite(composites)
    .jpeg({ quality: 80 })
    .toFile(path.join(review, (a.prefix ? prefix + '-sheet-' : 'sheet-') + (s + 1) + '.jpg'));
}
console.log(
  JSON.stringify({ fetched: ok.length, failed: manifest.length - ok.length, sheets: Math.ceil(ok.length / 20) }),
);
