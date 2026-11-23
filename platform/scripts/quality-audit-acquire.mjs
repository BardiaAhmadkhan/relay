import fs from 'node:fs/promises';
import sharp from 'sharp';
import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const ids = [
  69409165, 129606783, 129606784, 129606789, 129606790, 129606786, 129606787, 144449167, 190813222,
  26263046, 27775126, 44052614, 67629210, 76563971, 115130310, 115130340, 35473757, 35474327,
  131157828, 147279719, 147279725, 147279727, 544815, 1865395, 3267333, 6534813, 25256979, 38906303,
  38906305, 43902550, 140124512, 170450201, 170450451, 170450643, 198116972, 1865442, 3267394,
  25358451, 28131848, 49920811, 72671245, 97770212, 163212027, 12884693, 146357843, 83524047,
  83524096, 83524106, 83524109, 65678828, 6942533, 118271207, 33401550, 30172197, 65204152,
  80506678, 89831461, 93642798, 104519017, 133877793, 142945399, 148206729, 148206738, 185184534,
  11974487, 15805302, 17788009, 37559267, 45178885, 45178886, 45178892, 45178894, 59095559,
  59663121, 61210492, 65090858, 69272730, 69272796, 71221705, 91987500, 95100020, 96268278,
  126763715, 137941834, 159715479, 56144215, 61828935, 61831143, 61876048, 69598401, 171239271,
  171239720, 76263582, 54510702, 54511871, 54513895, 54513905, 54732632, 54732636, 153034556,
  57818151, 94960913, 57818106, 194443119, 105538569,
];
const dir = 'datasets/quality-audit-01/images/commons';
await fs.mkdir(dir, { recursive: true });
const all = new Map();
for (const name of ['commons-candidates', 'commons-specific-candidates']) {
  const p = JSON.parse(await fs.readFile('experiments/quality-audit-01/' + name + '.json', 'utf8'));
  for (const page of p.pages) all.set(page.pageid, page);
}
const prior = new Set();
for (const file of [
  'assets/fixtures/round-02/acquisition.json',
  'assets/fixtures/round-05/acquisition.json',
  'assets/fixtures/round-05/acquisition-public-domain.json',
]) {
  const j = JSON.parse(await fs.readFile(file, 'utf8'));
  for (const r of j.acquired ?? []) prior.add(r.title);
}
const selected = ids
  .map((id) => all.get(id))
  .filter((p) => p && !prior.has(p.title.replace('File:', '')))
  .slice(0, 100);
await fs.writeFile(
  'experiments/quality-audit-01/commons-selection.json',
  JSON.stringify(
    {
      at: new Date().toISOString(),
      basis:
        'Item/detail photographs selected by source title and eligibility, before inspecting system output. Includes difficult normal construction, tears, worn surfaces and related views. Not a prevalence sample.',
      pageIds: selected.map((p) => p.pageid),
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
const plain = (s) =>
  String(s ?? '')
    .replace(/<[^>]*>/g, '')
    .replaceAll('&amp;', '&')
    .replaceAll('&#39;', "'")
    .trim();
const records = [],
  excluded = [],
  sha1s = new Set();
for (const [index, p] of selected.entries()) {
  const id = 'commons-' + String(index + 1).padStart(3, '0');
  const info = p.imageinfo[0],
    meta = info.extmetadata;
  const license = plain(meta.LicenseShortName?.value),
    author = plain(meta.Artist?.value),
    licenseUrl = plain(meta.LicenseUrl?.value).replace(/^http:/, 'https:');
  try {
    if (
      !/^(CC BY-SA [234]\.0|CC BY [234]\.0|CC0)$/.test(license) ||
      !author ||
      !licenseUrl.startsWith('https://creativecommons.org/')
    )
      throw new Error('Unresolved licence');
    if (sha1s.has(info.sha1)) throw new Error('Exact original duplicate');
    const url = new URL(info.thumburl ?? info.url);
    url.search = '';
    if (!['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname))
      throw new Error('Unexpected asset host');
    await delay(1500);
    let response = await fetch(url, {
      headers: { 'User-Agent': 'RelayQualityAudit/1.0 (licensed960px research thumbnails)' },
      signal: AbortSignal.timeout(35000),
    });
    if (response.status === 429) {
      const wait = Number(response.headers.get('retry-after'));
      if (Number.isFinite(wait) && wait > 0 && wait <= 45) {
        await delay(wait * 1000);
        response = await fetch(url, {
          headers: { 'User-Agent': 'RelayQualityAudit/1.0 (licensed960px research thumbnails)' },
          signal: AbortSignal.timeout(35000),
        });
      }
    }
    if (!response.ok) throw new Error('Image HTTP ' + response.status);
    const raw = Buffer.from(await response.arrayBuffer());
    if (raw.length > 15_000_000) throw new Error('Asset size cap');
    const image = await sharp(raw, { limitInputPixels: 25_000_000 })
      .rotate()
      .resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 92 })
      .toBuffer();
    const m = await sharp(image).metadata();
    const file = `${dir}/${id}.jpg`;
    await fs.writeFile(file, image, { flag: 'wx' });
    sha1s.add(info.sha1);
    records.push({
      id,
      pageId: p.pageid,
      title: p.title.replace('File:', ''),
      domain: 'garment_or_gear',
      file,
      source: info.descriptionurl,
      author,
      license,
      licenseUrl,
      revision: p.revisions?.[0]?.revid,
      originalSha1: info.sha1,
      downloadUrl: url.toString(),
      downloadSha256: crypto.createHash('sha256').update(raw).digest('hex'),
      sha256: crypto.createHash('sha256').update(image).digest('hex'),
      width: m.width,
      height: m.height,
      description: plain(meta.ImageDescription?.value).slice(0, 1800),
      group: 'commons-' + p.pageid,
      groupReviewPending: true,
      transform:
        'Commons thumbnail, EXIF orientation, longest edge<=960, JPEG92, metadata omitted. No generative editing.',
    });
    console.log(id, p.title);
  } catch (e) {
    excluded.push({ id, pageId: p.pageid, title: p.title, error: String(e.message) });
    console.log('excluded', id, e.message);
  }
  await fs.writeFile(
    'experiments/quality-audit-01/commons-acquisition.partial.json',
    JSON.stringify({ at: new Date().toISOString(), records, excluded }, null, 2) + '\n',
  );
}
await fs.writeFile(
  'experiments/quality-audit-01/commons-acquisition.json',
  JSON.stringify({ at: new Date().toISOString(), records, excluded }, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(JSON.stringify({ acquired: records.length, excluded: excluded.length }));
