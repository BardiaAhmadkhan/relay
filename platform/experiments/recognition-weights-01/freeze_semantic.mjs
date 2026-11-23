/** Freeze a separate, consent-compatible test list before semantic model inference. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const out = path.resolve(process.argv[2]),
  prior = path.resolve(process.argv[3]);
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const specBytes = fs.readFileSync(path.join(out, 'protocol.json')),
  spec = JSON.parse(specBytes);
const sha = (v) => createHash('sha256').update(v).digest('hex');
const protocolKey = (key) => sha(spec.salt + '/' + key);
const norm = (s) =>
  (s ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const urlKey = (url) =>
  decodeURIComponent(url ?? '')
    .normalize('NFKC')
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\/$/, '');
const sort = (xs, key) =>
  [...xs].sort((a, b) => protocolKey(key(a)).localeCompare(protocolKey(key(b))));
const { prepareImages } = await import(pathToFileURL(path.resolve('server/images.ts')).href);
const first = read(prior).cases,
  real = read('datasets/realworld-v3/labels.json').cases;
const firstIds = new Set(first.map((r) => r.id)),
  firstReal = real.filter((r) => firstIds.has(r.id));
const seenHashes = new Set(first.map((r) => r.sha256)),
  seenPages = new Set(firstReal.map((r) => urlKey(r.page)).filter(Boolean));
const seenAuthors = new Set(firstReal.map((r) => norm(r.author)).filter(Boolean));
const seenAliases = new Set(firstReal.map((r) => r.seenInCalibration).filter(Boolean));
const old = [
  ...read('datasets/quality-audit-01/labels.json').cases,
  ...read('datasets/quality-cycle-02/labels.json').cases,
];
const usedOriginals = new Set(old.map((r) => r.originalFile).filter(Boolean));
const output = [],
  sourceKeys = new Set();
const attach = (c) => {
  if (sourceKeys.has(c.sha256)) throw Error('Duplicate input: ' + c.id);
  sourceKeys.add(c.sha256);
  output.push(c);
};
const garments = old.filter(
  (c) =>
    c.domain === 'garments_and_gear' &&
    !seenHashes.has(c.sha256) &&
    !seenPages.has(urlKey(c.source)) &&
    !seenAuthors.has(norm(c.author)) &&
    !seenAliases.has(c.id),
);
const negativeAuthors = new Set();
const cleaned = sort(
  garments.filter((c) => c.condition === 'no_visible_defect'),
  (c) => c.id,
)
  .filter((c) => {
    const who = norm(c.author) || c.group;
    if (negativeAuthors.has(who)) return false;
    negativeAuthors.add(who);
    return true;
  })
  .slice(0, 16);
for (const c of [...garments.filter((c) => c.condition === 'visible_defect'), ...cleaned]) {
  const visibleBreak = (c.expectedKinds ?? []).includes('tear');
  attach({
    id: c.id,
    sourcePath: c.file,
    sha256: c.sha256,
    sourceUrl: c.source,
    author: c.author,
    license: c.license,
    cohort:
      c.condition === 'no_visible_defect'
        ? 'transfer_clean'
        : visibleBreak
          ? 'transfer_damaged'
          : 'transfer_abrasion',
    condition: c.condition,
    subject: c.subject,
    view: c.view === 'label' ? 'detail' : (c.view ?? 'front'),
    framing: 'historical_garment',
    group: norm(c.author) || c.group,
    expectedKinds: c.expectedKinds,
    visualBasis: c.visualBasis,
  });
}
const raw = '.cache/phone-training/fabric/FD_Dataset';
const pool = new Map();
for (const split of ['test', 'valid']) {
  const folder = path.join(raw, 'YOLO', split, 'labels');
  for (const name of fs.readdirSync(folder)) {
    if (!name.endsWith('.txt')) continue;
    const original = name.replace(/_jpg\.rf\.[a-f0-9]+\.txt$/, '.jpg');
    const sourcePath = path.join(raw, 'FD', 'FULLDataset', original).replaceAll('\\', '/');
    const date = original.match(/^photo_(\d{4}-\d{2}-\d{2})/)?.[1];
    if (!date || usedOriginals.has(original) || !fs.existsSync(sourcePath)) continue;
    const lines = fs
      .readFileSync(path.join(folder, name), 'utf8')
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((s) => s.trim().split(/\s+/).map(Number));
    if (!lines.length || new Set(lines.map((r) => r[0])).size !== 1) continue;
    const row = {
      original,
      sourcePath,
      date,
      cls: lines[0][0],
      split,
      annotation: path.join(folder, name).replaceAll('\\', '/'),
    };
    const prev = pool.get(original);
    if (prev && prev.cls !== row.cls) throw Error('Class disagreement for ' + original);
    if (!prev) pool.set(original, row);
  }
}
for (const date of ['2023-11-19', '2024-02-11'])
  for (const [cls, n] of [
    [0, 8],
    [2, 4],
    [3, 4],
  ]) {
    const candidates = sort(
      [...pool.values()].filter((x) => x.date === date && x.cls === cls),
      (x) => x.original,
    );
    if (candidates.length < n) throw Error('Insufficient dates/classes');
    for (const c of candidates.slice(0, n)) {
      const digest = sha(fs.readFileSync(c.sourcePath));
      if (seenHashes.has(digest)) throw Error('First round source overlap');
      attach({
        id: 'fd-' + date + '-' + sha(c.original).slice(0, 12),
        sourcePath: c.sourcePath,
        sha256: digest,
        sourceUrl: 'https://doi.org/10.6084/m9.figshare.25546465.v2',
        author: 'Osamah N. Neamah',
        license: 'CC BY 4.0',
        group: 'fd-capture-' + date,
        cohort: cls === 0 ? 'fabric_negative' : 'fabric_positive',
        condition: cls === 0 ? 'surface_mark' : 'visible_defect',
        subject: 'material specimen',
        view: 'detail',
        framing: 'publisher_original',
        publisherClass: cls,
        split: c.split,
        annotation: c.annotation,
      });
    }
  }
const images = path.join(out, 'normalized');
fs.mkdirSync(images);
for (const c of output) {
  const src = fs.readFileSync(c.sourcePath);
  if (sha(src) !== c.sha256) throw Error('Hash mismatch ' + c.id);
  const jpeg = (
    await prepareImages([{ id: c.id, view: c.view, base64: src.toString('base64') }], 1600)
  ).images[0].jpeg;
  c.normalizedSha256 = sha(jpeg);
  fs.writeFileSync(path.join(images, c.id + '.jpg'), jpeg, { flag: 'wx' });
}
const cases = sort(output, (c) => c.id);
const frozen = {
  createdUtc: new Date().toISOString(),
  protocolSha256: sha(specBytes),
  firstCasesSha256: sha(fs.readFileSync(prior)),
  fit: { clear: 0.078, block: 0.255 },
  cases,
  cohorts: Object.fromEntries(
    [...new Set(cases.map((c) => c.cohort))].map((k) => [
      k,
      cases.filter((c) => c.cohort === k).length,
    ]),
  ),
};
fs.writeFileSync(path.join(out, 'cases.json'), JSON.stringify(frozen, null, 2) + '\n', {
  flag: 'wx',
});
console.log(JSON.stringify(frozen.cohorts));
