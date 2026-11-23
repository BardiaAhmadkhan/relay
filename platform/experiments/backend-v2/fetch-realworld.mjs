// Download real-world gear candidates (Commons categories, plus the Openverse set's manifest) for
// visual review, with attribution. Pixels go to datasets/realworld-v3/images/ (git-ignored); the manifest
// keeps licence, author and source. Each file is decoded and re-encoded by sharp before use.
// Obvious non-gear titles are skipped before download (historical uniforms, logos, maps, drawings).
// [RELAY_UA_CONTACT=<contact>] node experiments/backend-v2/fetch-realworld.mjs [--new-sheets]
//
// Wikimedia's User-Agent policy asks scripts for contact information (an email address, a website or a
// wiki user, e.g. "User:Name") and says scripts without it "may be blocked without notice"
// (foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy, read 2026-11-18). No
// contact is sent unless the owner sets RELAY_UA_CONTACT; it is the owner's to publish, not the script's.
//
// Wikimedia serves thumbnails only at standard widths (20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920,
// 3840 px; mediawiki.org/wiki/Common_thumbnail_sizes, read 2026-11-18). For a file narrower than the
// 1280 px asked for, imageinfo returns the ORIGINAL ("thumbnail_unscaled"), and direct requests for
// originals are rate-limited: the first run lost all but 14 of 135 such files to HTTP 429 with
// "Retry-After: 600". So a file wider than 960 px is fetched as the standard 960 px thumbnail, and a
// narrower one as the original, honouring Retry-After. The manifest records the original's size next to
// the fetched size, so every analysis can tell a thumbnail from an original.
// Files already on disk are kept, and ids are stable (the same candidates in the same order). With
// --new-sheets, contact sheets are made only for the files this run downloaded (review/new-NN.jpg), so
// sheets already reviewed keep their layout.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { OUT, ROOT, args } from './lib.mjs';

const a = args();
const dir = path.join(ROOT, 'datasets', 'realworld-v3');
const images = path.join(dir, 'images'),
  review = path.join(dir, 'review');
await fs.mkdir(images, { recursive: true });
await fs.mkdir(review, { recursive: true });
// Every candidate file written by discover-commons-categories.mjs (the first harvest and the gloves and boots one).
const files = [];
for (const name of ['commons-category-candidates.json', 'commons-category-candidates-2.json'])
  if (fsSync.existsSync(path.join(OUT, name)))
    files.push(...JSON.parse(await fs.readFile(path.join(OUT, name), 'utf8')).files);
// Historical archives, uniforms and scenes of riders on motorcycles do not look like intake photographs.
const SKIP_CATEGORY = /NSKK|^History of|Helma motocyklov|together with motorcycles|People with motorcycle helmets|Motorcycling in leather pants|helmet airbags/i;
const SKIP = /nskk|wehrmacht|1930|1940|194\d|logo|map|drawing|diagram|poster|stamp|coat of arms|patent|advert|museum|statue|painting|cartoon|icon\b|svg/i;
const contact = process.env.RELAY_UA_CONTACT?.trim();
const UA = contact
  ? `gear-recognition-lab-bot/0.1 (${contact}) Node.js/${process.versions.node}`
  : 'gear-recognition-lab research script (non-commercial evaluation)';
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
/** The URL to fetch: the standard 960 px thumbnail for an unscaled original wider than 960 px. */
function sourceUrl(f) {
  if (!/thumbnail_unscaled/.test(f.thumb) || !(f.width > 960)) return f.thumb;
  const original = f.thumb.split('?')[0];
  const name = original.slice(original.lastIndexOf('/') + 1);
  return original.replace('/wikipedia/commons/', '/wikipedia/commons/thumb/') + '/960px-' + name;
}
async function download(url) {
  let r = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) });
    if (r.status !== 429) break;
    // Honour the server's Retry-After (600 s on originals), capped at 11 minutes.
    const wait = Math.min(660, Number(r.headers.get('retry-after')) || 60);
    console.log('  429, waiting', wait, 's');
    await sleep(wait * 1000);
  }
  if (!r.ok) throw new Error('http ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}
const manifest = [],
  downloaded = [];
let k = 0;
for (const f of files) {
  if (!f.thumb || !/jpe?g|png/.test(f.mime ?? '') || SKIP.test(f.title) || SKIP_CATEGORY.test(f.category ?? '')) continue;
  const id = 'cm-' + String(++k).padStart(3, '0');
  const file = path.join(images, id + '.jpg');
  try {
    if (!fsSync.existsSync(file)) {
      const url = sourceUrl(f);
      const bytes = await download(url);
      await sharp(bytes, { limitInputPixels: 60_000_000, failOn: 'error' })
        .rotate()
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 92 })
        .toFile(file);
      downloaded.push(id);
      console.log(id, url === f.thumb ? 'as listed' : '960 px thumbnail', f.title);
      // Originals and uncached thumbnails are both rate-limited; three seconds apart stayed under it.
      await sleep(url === f.thumb && /thumbnail_unscaled/.test(f.thumb) ? 5000 : 3000);
    }
    const meta = await sharp(file).metadata();
    manifest.push({
      id,
      file: path.relative(ROOT, file).replaceAll('\\', '/'),
      sha256: createHash('sha256').update(await fs.readFile(file)).digest('hex'),
      width: meta.width,
      height: meta.height,
      originalWidth: f.width,
      originalHeight: f.height,
      // Rotation can swap the axes, so compare long edges.
      fetched: Math.max(meta.width, meta.height) === Math.max(f.width, f.height) ? 'original' : 'thumbnail',
      title: f.title,
      category: f.category,
      license: f.license,
      licenseUrl: f.licenseUrl,
      author: f.artist,
      source: f.page,
      description: f.description,
    });
  } catch (error) {
    manifest.push({ id, title: f.title, error: String(error.message ?? error) });
    console.log(id, 'failed', String(error.message ?? error));
  }
}
await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ fetched: new Date().toISOString(), images: manifest }, null, 1) + '\n');
const ok = manifest.filter((m) => !m.error);
const onSheets = a['new-sheets'] ? ok.filter((m) => downloaded.includes(m.id)) : ok;
const prefix = a['new-sheets'] ? 'new-' : 'sheet-';
const TILE = 300,
  COLS = 5,
  ROWS = 4;
for (let s = 0; s * COLS * ROWS < onSheets.length; s++) {
  const page = onSheets.slice(s * COLS * ROWS, (s + 1) * COLS * ROWS);
  const composites = [];
  for (const [i, m] of page.entries()) {
    const tile = await sharp(path.join(ROOT, m.file))
      .resize(TILE, TILE - 24, { fit: 'contain', background: '#202020' })
      .extend({ top: 24, background: '#202020' })
      .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="24"><text x="6" y="18" font-family="Arial" font-size="16" fill="#ffffff">${m.id}</text></svg>`), top: 0, left: 0 }])
      .jpeg()
      .toBuffer();
    composites.push({ input: tile, left: (i % COLS) * TILE, top: Math.floor(i / COLS) * TILE });
  }
  await sharp({ create: { width: COLS * TILE, height: ROWS * TILE, channels: 3, background: '#000000' } })
    .composite(composites)
    .jpeg({ quality: 78 })
    .toFile(path.join(review, prefix + String(s + 1).padStart(2, '0') + '.jpg'));
}
console.log(JSON.stringify({ fetched: ok.length, failed: manifest.length - ok.length, downloadedNow: downloaded.length, sheets: Math.ceil(onSheets.length / 20) }));
