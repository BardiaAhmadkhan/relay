import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const dir = 'assets/fixtures/round-05';
await fs.mkdir(dir, { recursive: true });
const definitions = [
  {
    id: 'worn-detail-2',
    title: 'Black worn leather jacket detail 2.jpg',
    group: 'worn',
    relation: 'Same garment/source session as old worn-detail; not independent.',
  },
  {
    id: 'worn-detail-3',
    title: 'Black worn leather jacket detail 3.jpg',
    group: 'worn',
    relation: 'Same garment/source session as old worn-detail; not independent.',
  },
  { id: 'biker-black', title: 'Black leather biker jacket.jpg', group: 'new-biker-black' },
  { id: 'schott-613', title: '70s Schott 613.jpg', group: 'new-schott-613' },
  { id: 'lewis-vintage', title: 'D Lewis vintage style.jpg', group: 'new-lewis-vintage' },
];
await fs.writeFile(
  'experiments/round-05/acquisition-plan.json',
  JSON.stringify(
    {
      at: new Date().toISOString(),
      purpose:
        'Additional hard low-resolution material/normal-feature controls; label by visual review before any inference.',
      definitions,
    },
    null,
    2,
  ),
  { flag: 'wx' },
);
const api = new URL('https://commons.wikimedia.org/w/api.php');
for (const [k, v] of Object.entries({
  action: 'query',
  format: 'json',
  formatversion: '2',
  prop: 'imageinfo|revisions',
  rvprop: 'ids|timestamp',
  iiprop: 'url|extmetadata|size|sha1',
  iiurlwidth: '960',
  titles: definitions.map((d) => 'File:' + d.title).join('|'),
}))
  api.searchParams.set(k, v);
const response = await fetch(api, {
  headers: { 'User-Agent': 'GearRecognitionLab/0.5 (small licensed local image evaluation)' },
  signal: AbortSignal.timeout(30000),
});
if (!response.ok) throw Error('Source metadata HTTP ' + response.status);
const data = await response.json();
const plain = (s) =>
  String(s ?? '')
    .replace(/<[^>]*>/g, '')
    .replaceAll('&amp;', '&')
    .trim();
const acquired = [],
  excluded = [];
for (const definition of definitions) {
  try {
    const page = data.query.pages.find((p) => p.title === 'File:' + definition.title);
    const info = page?.imageinfo?.[0];
    if (!info) throw Error('Missing source');
    const license = plain(info.extmetadata.LicenseShortName?.value),
      licenseUrl = plain(info.extmetadata.LicenseUrl?.value).replace(/^http:/, 'https:');
    const author = plain(info.extmetadata.Artist?.value);
    if (
      !/^(CC BY-SA [234]\.0|CC BY [234]\.0|CC0)$/.test(license) ||
      !licenseUrl.startsWith('https://creativecommons.org/') ||
      !author
    )
      throw Error('Unresolved attribution/licence ' + license);
    const url = new URL(info.thumburl ?? info.url);
    url.search = '';
    if (
      !['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname) ||
      url.protocol !== 'https:'
    )
      throw Error('Unexpected source host');
    await delay(1500);
    const r = await fetch(url, {
      headers: { 'User-Agent': 'GearRecognitionLab/0.5 (licensed960px thumbnails)' },
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok)
      throw Error(
        'Image HTTP ' +
          r.status +
          '; Retry-After=' +
          r.headers.get('retry-after') +
          '; no early retry',
      );
    const original = Buffer.from(await r.arrayBuffer());
    if (original.length > 20_000_000) throw Error('Download cap exceeded');
    const image = await sharp(original, { limitInputPixels: 24_000_000 })
      .rotate()
      .resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#fff' })
      .jpeg({ quality: 88 })
      .toBuffer();
    const file = dir + '/' + definition.id + '.jpg';
    await fs.writeFile(file, image, { flag: 'wx' });
    const meta = await sharp(image).metadata();
    acquired.push({
      ...definition,
      author,
      license,
      licenseUrl,
      sourceUrl:
        'https://commons.wikimedia.org/wiki/File:' +
        encodeURIComponent(definition.title.replaceAll(' ', '_')),
      pageRevision: page.revisions?.[0]?.revid,
      downloadUrl: url.toString(),
      retrievedAt: new Date().toISOString(),
      downloadSha256: createHash('sha256').update(original).digest('hex'),
      file,
      sha256: createHash('sha256').update(image).digest('hex'),
      width: meta.width,
      height: meta.height,
      transformation: '960px Commons thumbnail; rotate, sRGB JPEG88 <=960px, metadata stripped.',
      label: null,
    });
    console.log('Acquired ' + definition.id + ' ' + license);
  } catch (e) {
    excluded.push({ ...definition, reason: String(e) });
    console.log('Excluded ' + definition.id + ' ' + e);
  }
}
await fs.writeFile(
  dir + '/acquisition.json',
  JSON.stringify({ at: new Date().toISOString(), acquired, excluded }, null, 2),
  { flag: 'wx' },
);
const tiles = await Promise.all(
  acquired.map(async (c, i) => ({
    input: await sharp(c.file)
      .resize(300, 300, { fit: 'contain', background: '#f4f4f4' })
      .jpeg()
      .toBuffer(),
    left: (i % 3) * 300,
    top: Math.floor(i / 3) * 300,
  })),
);
await sharp({
  create: {
    width: 900,
    height: Math.ceil(acquired.length / 3) * 300,
    channels: 3,
    background: '#f4f4f4',
  },
})
  .composite(tiles)
  .jpeg()
  .toFile('experiments/round-05/acquired-contact.jpg');
