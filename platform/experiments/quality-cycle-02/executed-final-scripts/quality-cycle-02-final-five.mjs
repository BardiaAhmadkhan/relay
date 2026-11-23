import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import sharp from 'sharp';
const used = new Set(
  [
    ...JSON.parse(await fs.readFile('datasets/quality-audit-01/labels.json', 'utf8')).cases,
    ...JSON.parse(await fs.readFile('datasets/quality-cycle-02/labels.json', 'utf8')).cases,
  ].map((c) => c.originalFile),
);
const root = '.cache/phone-training/fabric/FD_Dataset';
const pool = [];
for (const split of ['train', 'valid', 'test'])
  for (const name of await fs.readdir(root + '/YOLO/' + split + '/labels')) {
    const cls = [
      ...new Set(
        (await fs.readFile(root + '/YOLO/' + split + '/labels/' + name, 'utf8'))
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .map((l) => Number(l.split(/\s+/)[0])),
      ),
    ];
    if (cls.length !== 1 || ![0, 3].includes(cls[0])) continue;
    const originalFile = name.replace(/_jpg\.rf\.[a-f0-9]+\.txt$/, '.jpg');
    if (used.has(originalFile)) continue;
    const file = root + '/FD/FULLDataset/' + originalFile;
    try {
      await fs.access(file);
    } catch {
      continue;
    }
    pool.push({
      originalFile,
      file,
      publisherClass: cls[0],
      key: crypto
        .createHash('sha256')
        .update('audit-20261026:' + originalFile)
        .digest('hex'),
    });
  }
const selected = [
  ...pool
    .filter((c) => c.publisherClass === 0)
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(0, 2),
  ...pool
    .filter((c) => c.publisherClass === 3)
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(0, 3),
];
await fs.writeFile(
  'experiments/quality-cycle-02/final-five-selection.json',
  JSON.stringify(
    {
      at: new Date().toISOString(),
      scope:
        'Five remaining images within the explicit 64-image authorization; new source photographs from the existing licensed corpus. Selected before inference to check the final uncertainty guard. Same publisher/capture population, not independent field validation.',
      selected: selected.map(({ file, ...c }) => c),
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
const records = [];
for (const [i, c] of selected.entries()) {
  const id = 'final-fabric-' + String(i + 1).padStart(3, '0'),
    bytes = await fs.readFile(c.file),
    file = 'datasets/quality-cycle-02/images/' + id + '.jpg';
  await fs.writeFile(file, bytes, { flag: 'wx' });
  const m = await sharp(bytes).metadata();
  records.push({
    id,
    file,
    originalFile: c.originalFile,
    publisherClass: c.publisherClass,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    width: m.width,
    height: m.height,
    source: 'https://doi.org/10.6084/m9.figshare.25546465.v2',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    author: 'Osamah N. Neamah',
    group: 'fd-capture-' + c.originalFile.match(/photo_(\d{4}-\d{2}-\d{2})/)?.[1],
    history: 'unknown',
    view: 'detail',
    domain: 'fabric_closeup',
    priorSource: false,
  });
}
await fs.writeFile(
  'experiments/quality-cycle-02/final-five-acquisition.json',
  JSON.stringify({ at: new Date().toISOString(), records }, null, 2) + '\n',
  { flag: 'wx' },
);
console.log({
  acquired: records.length,
  totalThisRound: 59 + records.length,
  ids: records.map((r) => r.id),
});
