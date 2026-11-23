// Real-world gear photographs from Wikimedia Commons CATEGORIES (2026-11-18). Keyword search returned
// mostly irrelevant files (research-sources.md section 8); categories are curated by subject, so their
// members are mostly the thing named. Metadata only: licence, author, description, a 1280 px thumbnail
// URL. Every Commons file is freely licensed; the licence of each is recorded.
// node experiments/backend-v2/discover-commons-categories.mjs [--max 900]
import fs from 'node:fs/promises';
import path from 'node:path';
import { OUT, args } from './lib.mjs';

const a = args();
const MAX = Number(a.max ?? 900);
const out = path.join(OUT, a.out ?? 'commons-category-candidates.json');
const UA = 'gear-recognition-lab research script (non-commercial evaluation)';
// [category, depth of subcategories to follow]
const ROOTS = [
  ['Motorcycle protective clothing', 2],
  ['Motorcycle leather clothing', 1],
  ['Motorcycle leather jackets', 1],
  ['Alpinestars leather jackets', 0],
  ['Motorcycle gloves', 1],
  ['Motorcycle boots', 1],
  ['Motocross boots', 0],
  ['Alpinestars boots', 0],
  ['Motorcycle helmets', 0],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(params) {
  const url =
    'https://commons.wikimedia.org/w/api.php?' +
    new URLSearchParams({ format: 'json', maxlag: '5', ...params });
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (r?.ok) {
      const j = await r.json();
      if (!j.error) return j;
    }
    await sleep(3000 * (attempt + 1));
  }
  return null;
}
const files = new Map(),
  visited = new Set();
const save = () =>
  fs.writeFile(out, JSON.stringify({ retrieved: new Date().toISOString(), roots: ROOTS, files: [...files.values()] }, null, 1) + '\n');
async function walk(category, depth, via) {
  if (visited.has(category) || files.size >= MAX) return;
  visited.add(category);
  let cont = {};
  const subcats = [];
  do {
    const j = await api({ action: 'query', list: 'categorymembers', cmtitle: 'Category:' + category, cmlimit: '200', cmtype: 'file|subcat', ...cont });
    if (!j) break;
    for (const m of j.query.categorymembers) {
      if (m.ns === 14) subcats.push(m.title.replace(/^Category:/, ''));
      else if (m.ns === 6 && /\.(jpe?g|png)$/i.test(m.title) && !files.has(m.title))
        files.set(m.title, { title: m.title, category, via });
    }
    cont = j.continue ? { cmcontinue: j.continue.cmcontinue } : {};
    await sleep(400);
  } while (cont.cmcontinue && files.size < MAX);
  await save();
  console.log(category, 'files so far', files.size);
  if (depth > 0) for (const sub of subcats) await walk(sub, depth - 1, via);
}
// --only 'A,B' walks just those roots (depth 1), for a second harvest after the cap was reached.
const roots = a.only ? String(a.only).split(',').map((r) => [r.trim(), 1]) : ROOTS;
for (const [root, depth] of roots) await walk(root, depth, root);
// Image information for every file, 50 titles per request.
const list = [...files.values()];
for (let i = 0; i < list.length; i += 50) {
  const batch = list.slice(i, i + 50);
  const j = await api({ action: 'query', prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '1280', titles: batch.map((f) => f.title).join('|') });
  for (const p of Object.values(j?.query?.pages ?? {})) {
    const info = p.imageinfo?.[0],
      f = files.get(p.title);
    if (!info || !f) continue;
    const meta = info.extmetadata ?? {};
    Object.assign(f, {
      width: info.width,
      height: info.height,
      mime: info.mime,
      thumb: info.thumburl,
      page: info.descriptionurl,
      license: meta.LicenseShortName?.value ?? null,
      licenseUrl: meta.LicenseUrl?.value ?? null,
      artist: (meta.Artist?.value ?? '').replace(/<[^>]+>/g, '').trim().slice(0, 120),
      description: (meta.ImageDescription?.value ?? '').replace(/<[^>]+>/g, '').trim().slice(0, 240),
    });
  }
  await save();
  await sleep(500);
}
console.log(JSON.stringify({ out, categories: visited.size, files: files.size }));
