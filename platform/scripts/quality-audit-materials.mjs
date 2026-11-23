import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
const root = 'datasets/quality-audit-01';
await fs.mkdir(root + '/images/fabric', { recursive: true });
await fs.mkdir(root + '/images/leather', { recursive: true });
const source = '.cache/phone-training/fabric/FD_Dataset';
const records = [];
for (const split of ['train', 'valid', 'test']) {
  for (const name of await fs.readdir(`${source}/YOLO/${split}/labels`)) {
    const annotations = (await fs.readFile(`${source}/YOLO/${split}/labels/${name}`, 'utf8'))
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.split(/\s+/).map(Number));
    const classes = [...new Set(annotations.map((a) => a[0]))];
    if (classes.length !== 1) continue;
    const originalName = name.replace(/_jpg\.rf\.[a-f0-9]+\.txt$/, '.jpg');
    const file = `${source}/FD/FULLDataset/${originalName}`;
    try {
      await fs.access(file);
    } catch {
      continue;
    }
    records.push({
      originalName,
      file,
      publisherClass: classes[0],
      annotations,
      split,
      key: crypto
        .createHash('sha256')
        .update('audit-20261026:' + originalName)
        .digest('hex'),
    });
  }
}
const selected = [];
for (let cls = 0; cls < 4; cls++)
  selected.push(
    ...records
      .filter((r) => r.publisherClass === cls)
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(0, 20),
  );
const manifest = [];
for (const [index, r] of selected.entries()) {
  const id = 'fabric-' + String(index + 1).padStart(3, '0'),
    dest = `${root}/images/fabric/${id}.jpg`,
    bytes = await fs.readFile(r.file);
  await fs.writeFile(dest, bytes, { flag: 'wx' });
  const m = await sharp(bytes).metadata();
  manifest.push({
    id,
    domain: 'fabric_closeup',
    file: dest,
    source: 'https://doi.org/10.6084/m9.figshare.25546465.v2',
    author: 'Osamah N. Neamah',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    group: 'fd-capture-' + r.originalName.match(/photo_(\d{4}-\d{2}-\d{2})/)?.[1],
    originalFile: r.originalName,
    publisherClass: r.publisherClass,
    publisherBoxes: r.annotations,
    publisherSplit: r.split,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    width: m.width,
    height: m.height,
    transform:
      'Original publisher image bytes, no resampling or generated variants. Grouping by date is conservative; garment identity unavailable.',
  });
}
await fs.writeFile(
  'experiments/quality-audit-01/fabric-acquisition.json',
  JSON.stringify(
    {
      at: new Date().toISOString(),
      selection:
        '20 single-class original photos per publisher class, sorted by a predeclared seeded hash. No inference consulted.',
      records: manifest,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log('fabric originals', manifest.length);
const sourceMeta = JSON.parse(
  await fs.readFile('experiments/phone-offline-01/leather-dataset-metadata.json', 'utf8'),
);
const leather = [];
for (let i = 0; i < 20; i++) {
  const index = Math.floor((i * sourceMeta.files.length) / 20);
  const f = sourceMeta.files[index];
  const cache = path.join('.cache/phone-training', f.name);
  let raw;
  try {
    raw = await fs.readFile(cache);
  } catch {
    const response = await fetch(f.download_url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    raw = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(cache, raw, { flag: 'wx' });
  }
  if (
    raw.length !== f.size ||
    crypto.createHash('md5').update(raw).digest('hex') !== f.computed_md5
  )
    throw new Error('Raw checksum mismatch');
  const id = 'leather-' + String(i + 1).padStart(3, '0'),
    dest = `${root}/images/leather/${id}.jpg`;
  const bytes = await sharp(raw)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer();
  await fs.writeFile(dest, bytes, { flag: 'wx' });
  const m = await sharp(bytes).metadata();
  leather.push({
    id,
    domain: 'leather_closeup',
    file: dest,
    source: 'https://doi.org/10.6084/m9.figshare.25012643.v1',
    author: 'Jiachao Wang',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    group: 'leather-capture-2023-05-08',
    originalFile: f.name,
    sourceFileId: f.id,
    sourceMd5Matched: true,
    sourceSha256: crypto.createHash('sha256').update(raw).digest('hex'),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    width: m.width,
    height: m.height,
    transform:
      'EXIF orientation, longest edge<=1600, JPEG92, metadata omitted; raw source retained in local cache. Capture group identity beyond date unavailable.',
  });
  console.log(id);
}
await fs.writeFile(
  'experiments/quality-audit-01/leather-acquisition.json',
  JSON.stringify(
    {
      at: new Date().toISOString(),
      selection: 'Every 13th image from publisher order; no inference consulted.',
      records: leather,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
