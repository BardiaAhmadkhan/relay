import fs from 'node:fs/promises';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const definitions = [
  {
    id: 'biker-black',
    title: 'Black leather biker jacket.jpg',
    author: 'Jtdirl',
    group: 'new-biker-black',
    revision: 825175635,
  },
  {
    id: 'schott-613',
    title: '70s Schott 613.jpg',
    author: 'Zeus Cervas / Crippe',
    group: 'new-schott-613',
    revision: 950021757,
  },
];
const url = new URL('https://commons.wikimedia.org/w/api.php');
Object.entries({
  action: 'query',
  format: 'json',
  formatversion: '2',
  prop: 'imageinfo|revisions',
  rvprop: 'ids|timestamp',
  iiprop: 'url|extmetadata|size|sha1',
  iiurlwidth: '960',
  titles: definitions.map((d) => 'File:' + d.title).join('|'),
}).forEach(([k, v]) => url.searchParams.set(k, v));
const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
const data = await response.json();
const rows = [];
for (const d of definitions) {
  const page = data.query.pages.find((p) => p.title === 'File:' + d.title);
  const info = page.imageinfo[0];
  if (info.extmetadata.LicenseShortName?.value !== 'Public domain')
    throw Error('Source declaration changed');
  const u = new URL(info.thumburl ?? info.url);
  u.search = '';
  if (
    !['thumb.wikimedia.org', 'upload.wikimedia.org'].includes(u.hostname) ||
    u.protocol !== 'https:'
  )
    throw Error('Unexpected source host');
  await delay(1500);
  const r = await fetch(u, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw Error('Image HTTP ' + r.status + '; no early retry');
  const downloaded = Buffer.from(await r.arrayBuffer());
  const bytes = await sharp(downloaded)
    .rotate()
    .flatten({ background: '#fff' })
    .resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  const file = 'assets/fixtures/round-05/' + d.id + '.jpg';
  await fs.writeFile(file, bytes, { flag: 'wx' });
  rows.push({
    ...d,
    file,
    license: 'Public domain - released by author',
    licenceBasis:
      'The primary file page explicitly records release by author for any purpose. Independently read before acquiring; initial strict CC-only acquisition excluded these.',
    sourceUrl:
      'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(d.title.replaceAll(' ', '_')),
    pageRevision: page.revisions[0].revid,
    retrievedAt: new Date().toISOString(),
    downloadUrl: u.toString(),
    downloadSha256: createHash('sha256').update(downloaded).digest('hex'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    transformation: 'Rotate, resize <=960px, JPEG88, strip metadata.',
  });
}
await fs.writeFile(
  'assets/fixtures/round-05/acquisition-public-domain.json',
  JSON.stringify({ at: new Date().toISOString(), acquired: rows }, null, 2),
  { flag: 'wx' },
);
const tiles = await Promise.all(
  rows.map(async (d, i) => ({
    input: await sharp(d.file)
      .resize(400, 400, { fit: 'contain', background: '#f4f4f4' })
      .jpeg()
      .toBuffer(),
    left: i * 400,
    top: 0,
  })),
);
await sharp({ create: { width: 800, height: 400, channels: 3, background: '#f4f4f4' } })
  .composite(tiles)
  .jpeg()
  .toFile('experiments/round-05/public-domain-contact.jpg');
console.log(rows.map((r) => r.id));
