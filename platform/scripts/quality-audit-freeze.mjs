import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const dir = 'datasets/quality-audit-01';
const records = [];
for (const domain of ['commons', 'fabric', 'leather'])
  records.push(
    ...JSON.parse(
      await fs.readFile(`experiments/quality-audit-01/${domain}-acquisition.json`, 'utf8'),
    ).records,
  );
const annotations = [];
for (const name of ['commons-part1', 'commons-part2', 'fabric', 'leather'])
  annotations.push(
    ...JSON.parse(await fs.readFile(`${dir}/annotations/${name}.json`, 'utf8')).rows,
  );
assert.equal(new Set(annotations.map((x) => x.id)).size, annotations.length);
assert.equal(records.length, annotations.length);
const grouped = new Map();
for (const [group, ids] of Object.entries({
  'pellepelle-product-collection': [2, 4, 5, 7],
  'perth-denim-display': [20, 21, 22],
  'racing-gloves-museum-session': [32, 33, 34],
  'tracksuit-am-2017-66-18': [47, 48, 49],
  'nesr-blue-jacket': [62, 63],
  'connolly-gold-crochet-jacket': [77, 78],
  'purple-zipper': [94, 95],
  'metal-zipper-slider': [96, 97],
  'blue-metal-zipper': [98, 99],
}))
  for (const id of ids) grouped.set('commons-' + String(id).padStart(3, '0'), group);
const cases = [];
const hashes = new Set();
for (const record of records) {
  const label = annotations.find((a) => a.id === record.id);
  assert(label?.reviewed);
  const bytes = await fs.readFile(record.file);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), record.sha256);
  assert(!hashes.has(record.sha256), 'Duplicate audit bytes');
  hashes.add(record.sha256);
  const row = {
    ...record,
    ...label,
    group: grouped.get(record.id) ?? label.group ?? record.group,
    groupReviewPending: false,
  };
  if (record.domain === 'garment_or_gear') {
    row.domain = ['fabric_sample', 'material_sample'].includes(label.subject)
      ? 'commons_material_closeup'
      : label.subject === 'hardware'
        ? 'hardware'
        : label.subject === 'scene' || label.subject === 'thermal_image'
          ? 'unassessable_scene'
          : 'garments_and_gear';
    if (
      ['garment', 'gloves', 'boots', 'multi_gear', 'collage', 'helmet'].includes(label.subject) &&
      !new Set([
        49, 57, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85,
      ]).has(Number(record.id.split('-')[1]))
    )
      row.view = Number(record.id.split('-')[1]) === 37 ? 'detail' : 'front';
  }
  row.priorRelated = record.id === 'commons-037';
  cases.push(row);
}
cases.sort((a, b) => a.id.localeCompare(b.id));
const dataset = {
  frozenAt: new Date().toISOString(),
  scope:
    'Purposeful visual failure audit. Visible structural defects only, not crash-history labels, expert physical-condition ground truth, or field prevalence. No evaluated-system outputs were used to assign labels.',
  selection:
    '94 of 100 selected Commons images acquired; six source/licence failures retained in acquisition log. Plus 80 original fabric samples selected by seeded class strata, and 20 raw leather samples.',
  groups:
    'Related garment views grouped explicitly. Industrial material images grouped conservatively by capture date; source item identity unavailable. No quality variants are counted as new source images.',
  cases,
};
await fs.writeFile(`${dir}/labels.json`, JSON.stringify(dataset, null, 2) + '\n', { flag: 'wx' });
const columns = [
  'id',
  'domain',
  'group',
  'condition',
  'expectedKinds',
  'subject',
  'view',
  'expectedCategory',
  'anatomy',
  'history',
  'visualBasis',
  'file',
  'source',
  'author',
  'license',
  'sha256',
];
const csv = (values) =>
  values.map((v) => '"' + String(v ?? '').replaceAll('"', '""') + '"').join(',');
await fs.writeFile(
  `${dir}/labels.csv`,
  [
    csv(columns),
    ...cases.map((c) => csv(columns.map((k) => (Array.isArray(c[k]) ? c[k].join('|') : c[k])))),
  ].join('\r\n') + '\r\n',
  { flag: 'wx' },
);
const lockPaths = [
  `${dir}/labels.json`,
  `${dir}/labels.csv`,
  ...['commons-part1', 'commons-part2', 'fabric', 'leather'].map(
    (n) => `${dir}/annotations/${n}.json`,
  ),
  ...['commons', 'fabric', 'leather'].map(
    (n) => `experiments/quality-audit-01/${n}-acquisition.json`,
  ),
  'experiments/quality-audit-01/protocol.json',
];
const files = [];
for (const p of lockPaths)
  files.push({
    path: p,
    sha256: crypto
      .createHash('sha256')
      .update(await fs.readFile(p))
      .digest('hex'),
  });
await fs.writeFile(
  'experiments/quality-audit-01/labels.lock.json',
  JSON.stringify({ recordedAt: new Date().toISOString(), files }, null, 2) + '\n',
  { flag: 'wx' },
);
const counts = {};
for (const c of cases) {
  counts[c.domain] ??= {};
  counts[c.domain][c.condition] = (counts[c.domain][c.condition] ?? 0) + 1;
}
console.log(
  JSON.stringify(
    {
      images: cases.length,
      uniqueBytes: hashes.size,
      groups: new Set(cases.map((c) => c.group)).size,
      counts,
    },
    null,
    2,
  ),
);
