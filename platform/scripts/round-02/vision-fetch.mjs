import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../../', import.meta.url));
const base = path.join(root, 'assets/fixtures/round-02');
const definitions = [
  {
    id: 'helmet-fullface',
    title: 'Full-Face Helmet 9274.jpg',
    group: 'new-helmet-ashley',
    category: 'helmet',
    view: 'front',
    notes: 'Source explicitly identifies a full-face motorcycle helmet.',
  },
  {
    id: 'helmet-black',
    title: 'BlackFullCoverageMotorcycleHelmet.jpg',
    group: 'new-helmet-amoore',
    category: 'helmet',
    view: 'front',
    notes: 'Source explicitly identifies a full-face motorcycle helmet.',
  },
  {
    id: 'hyod-a',
    title: 'Hyod racing gloves (26301938210).jpg',
    group: 'new-hyod-pair',
    category: 'gloves',
    view: 'front',
    notes: 'Group with alternate Hyod view from same photographer/session.',
  },
  {
    id: 'hyod-b',
    title: 'Hyod racing gloves (26574882235).jpg',
    group: 'new-hyod-pair',
    category: 'gloves',
    view: 'back',
    notes: 'Same pair as hyod-a; not an independent item.',
  },
  {
    id: 'boots-axo',
    title: 'AXO touring boots.jpg',
    group: 'new-axo-pair',
    category: 'boots',
    view: 'front',
    notes: 'Touring boots; one pair treated as one category item.',
  },
  {
    id: 'boots-alpinestars',
    title: 'Alpinestars S-MX Motorcycle boots.jpg',
    group: 'new-alpinestars-pair',
    category: 'boots',
    view: 'front',
    notes: 'Source describes S-MX3 motorcycle boots.',
  },
  {
    id: 'heated-trousers',
    title: 'Carbon fiber heated trousers.jpg',
    group: 'new-heated-trousers',
    category: 'trousers',
    view: 'front',
    notes:
      'Source describes motorcycle heated trousers. Modified/heated construction is not evidence of protective performance.',
  },
  {
    id: 'jean-jacket',
    title: 'Jean jacket.jpg',
    group: 'new-denim-jacket',
    category: 'other',
    view: 'front',
    notes:
      'Source describes ordinary jean jacket. Weak out-of-domain category reference; no claim about hidden protection.',
  },
  {
    id: 'winter-kit',
    title: 'Motorkleding winterpak.JPG',
    group: 'new-piero-kit',
    category: null,
    view: 'front',
    notes:
      'Pending visual taxonomy review before freeze; same photographer kit conservatively grouped with salopette.',
  },
  {
    id: 'salopette',
    title: 'Motorkleding Salopette.JPG',
    group: 'new-piero-kit',
    category: null,
    view: 'front',
    notes: 'Pending visual taxonomy review before freeze; conservatively grouped with winter-kit.',
  },
  {
    id: 'helmet-label',
    title: 'Ece-Sticker.JPG',
    group: 'new-helmet-label',
    category: null,
    view: 'label',
    notes:
      'Real helmet marking close-up; label role should not establish garment category or certification authenticity.',
  },
  {
    id: 'boot-shin-detail',
    title: 'MotorcycleRacingBootShin.jpg',
    group: 'new-thermos-boot',
    category: null,
    view: 'detail',
    notes: 'Source-identified boot detail; no overview category expected in the workflow.',
  },
  {
    id: 'worn-jacket',
    title: 'Black worn leather jacket.jpg',
    group: 'new-wcarter-jacket',
    category: null,
    view: 'front',
    notes:
      'Leather jacket category is visually clear but motorcycle-specific design is unverified; unscored ambiguity control.',
  },
  {
    id: 'worn-jacket-detail',
    title: 'Black worn leather jacket detail 1.jpg',
    group: 'new-wcarter-jacket',
    category: null,
    view: 'detail',
    notes: 'Actual detail view of the same leather jacket; no damage or safety ground truth.',
  },
  {
    id: 'mixed-riding-gear',
    title: 'Motorbike safety gear 2.jpg',
    group: 'new-steve-gear',
    category: 'multiple',
    view: 'front',
    authorOverride: 'Steve Parker',
    notes:
      'Primary page identifies Steve Parker and motorcycle leathers/other gear; visual review required before freeze.',
  },
];
const sha = (b, a = 'sha256') => createHash(a).update(b).digest('hex');
const plain = (s) =>
  String(s ?? '')
    .replace(/<[^>]*>/g, '')
    .replaceAll('&amp;', '&')
    .trim();
await fs.mkdir(path.join(base, 'sources'), { recursive: true });
const manifestPath = path.join(base, 'acquisition.json');
if (
  await fs.access(manifestPath).then(
    () => true,
    () => false,
  )
)
  throw new Error('Acquisition manifest exists; preserve it.');
const api = new URL('https://commons.wikimedia.org/w/api.php');
Object.entries({
  action: 'query',
  format: 'json',
  formatversion: '2',
  prop: 'imageinfo|revisions',
  rvprop: 'ids|timestamp',
  iiprop: 'url|extmetadata|size|sha1',
  iiurlwidth: '960',
  titles: definitions.map((d) => 'File:' + d.title).join('|'),
}).forEach(([k, v]) => api.searchParams.set(k, v));
const metadataResponse = await fetch(api, {
  headers: { 'User-Agent': 'GearRecognitionLab/0.2 (small licensed robustness evaluation)' },
  signal: AbortSignal.timeout(30000),
});
if (!metadataResponse.ok) throw new Error('Metadata HTTP ' + metadataResponse.status);
const metadata = await metadataResponse.json();
const acquired = [],
  excluded = [];
for (const definition of definitions) {
  try {
    const page = metadata.query.pages.find((p) => p.title === 'File:' + definition.title),
      info = page?.imageinfo?.[0];
    if (!info) throw new Error('Missing source file');
    const license = plain(info.extmetadata.LicenseShortName?.value),
      licenseUrl = plain(info.extmetadata.LicenseUrl?.value).replace(/^http:/, 'https:');
    if (!/^(CC BY-SA [234]\.0|CC BY [234]\.0|CC0)$/.test(license))
      throw new Error('Unapproved or unresolved source licence: ' + license);
    if (!licenseUrl.startsWith('https://creativecommons.org/'))
      throw new Error('Missing explicit licence URL');
    const author = definition.authorOverride ?? plain(info.extmetadata.Artist?.value);
    if (!author) throw new Error('Attribution missing');
    const url = new URL(info.thumburl ?? info.url);
    url.search = '';
    if (
      url.protocol !== 'https:' ||
      !['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname)
    )
      throw new Error('Unexpected source host');
    await delay(1500);
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'GearRecognitionLab/0.2 (small licensed robustness evaluation; standard960px thumbnails)',
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(
        'Image HTTP ' +
          response.status +
          '; Retry-After=' +
          (response.headers.get('retry-after') ?? 'unspecified') +
          '. No early retry.',
      );
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 20_000_000) throw new Error('Image exceeds download cap');
    const decoded = await sharp(bytes, { limitInputPixels: 50_000_000 }).metadata();
    if (!decoded.width || !decoded.height) throw new Error('Undecodable image dimensions');
    const sourceFile = 'assets/fixtures/round-02/sources/' + definition.id + '.jpg';
    await fs.writeFile(path.join(root, sourceFile), bytes, { flag: 'wx' });
    const reference = await sharp(bytes, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true })
      .toColourspace('srgb')
      .jpeg({ quality: 88 })
      .toBuffer();
    const file = 'assets/fixtures/round-02/' + definition.id + '.jpg';
    await fs.writeFile(path.join(root, file), reference, { flag: 'wx' });
    const meta = await sharp(reference).metadata();
    const isOriginal = url.pathname === new URL(info.url).pathname;
    if (isOriginal && sha(bytes, 'sha1') !== info.sha1)
      throw new Error('Original source SHA1 mismatch');
    acquired.push({
      ...definition,
      author,
      license,
      licenseUrl,
      sourceUrl:
        'https://commons.wikimedia.org/wiki/File:' +
        encodeURIComponent(definition.title.replaceAll(' ', '_')),
      publisher: 'Wikimedia Commons; attributed image contributor',
      pageRevision: page.revisions?.[0]?.revid ?? null,
      pageRevisionAt: page.revisions?.[0]?.timestamp ?? null,
      retrievedAt: new Date().toISOString(),
      downloadUrl: url.toString(),
      sourceFile,
      sourceSha256: sha(bytes),
      sourceBytes: bytes.length,
      sourceDimensions: { width: decoded.width, height: decoded.height },
      sourceRepresentation: isOriginal
        ? 'Uploader original'
        : 'Commons960px thumbnail; uploader original not downloaded',
      sourceOriginalSha1: info.sha1,
      sourceOriginalHashVerified: isOriginal,
      file,
      sha256: sha(reference),
      bytes: reference.length,
      width: meta.width,
      height: meta.height,
      transformation:
        'EXIF orientation; sRGB JPEG88; longest edge<=960; no upscale; metadata omitted.',
      evidenceStrength:
        'Primary asset/licence record plus subsequent visual category review; weak labels, not expert condition evidence.',
      limitations: [
        'No protective-condition or authenticity ground truth.',
        'Public pretraining overlap unknown.',
        'No inference was used to select or label this source.',
      ],
    });
    console.log('ACQUIRED ' + definition.id + ' ' + reference.length + ' bytes ' + license);
  } catch (error) {
    excluded.push({
      id: definition.id,
      title: definition.title,
      reason: String(error),
      recordedAt: new Date().toISOString(),
    });
    console.log('EXCLUDED ' + definition.id + ' ' + String(error));
  }
}
await fs.writeFile(
  manifestPath,
  JSON.stringify(
    {
      schemaVersion: '1.0',
      createdAt: new Date().toISOString(),
      stage: 'acquisition-before-human-label-freeze',
      acquired,
      excluded,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
await fs.writeFile(
  path.join(base, 'ATTRIBUTION.md'),
  [
    '# Round 02 image attribution',
    '',
    'Downloaded source representations and transformed images retain the chosen source licences. Share adapted BY-SA images under the required same/compatible licence. Authors do not endorse this app. This corpus is for inference evaluation, not training.',
    '',
    ...acquired.flatMap((f) => [
      '## ' + f.id,
      '',
      f.title +
        ' — ' +
        f.author +
        '. [' +
        f.license +
        '](' +
        f.licenseUrl +
        '). [Source](' +
        f.sourceUrl +
        '). Page revision ' +
        f.pageRevision +
        '.',
      '',
      f.sourceRepresentation + '. ' + f.transformation,
      '',
    ]),
  ].join('\n'),
  { flag: 'wx' },
);
console.log(
  'ACQUISITION_COMPLETE ' +
    acquired.length +
    ' acquired, ' +
    excluded.length +
    ' excluded. No inference performed.',
);
