import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const labels = JSON.parse(await fs.readFile('datasets/quality-audit-01/labels.json', 'utf8'));
const hashes = [];
for (const c of labels.cases) {
  const { data } = await sharp(await fs.readFile(c.file))
    .resize(9, 8, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = 0n;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      bits = (bits << 1n) | (data[y * 9 + x] > data[y * 9 + x + 1] ? 1n : 0n);
  hashes.push({ id: c.id, group: c.group, domain: c.domain, hash: bits });
}
const pairs = [];
for (let i = 0; i < hashes.length; i++)
  for (let j = i + 1; j < hashes.length; j++) {
    const a = hashes[i],
      b = hashes[j];
    if (a.domain !== b.domain) continue;
    let diff = a.hash ^ b.hash,
      count = 0;
    while (diff) {
      diff &= diff - 1n;
      count++;
    }
    if (count <= 7)
      pairs.push({ a: a.id, b: b.id, distance: count, sameRecordedGroup: a.group === b.group });
  }
await fs.writeFile(
  'experiments/quality-audit-01/near-duplicate-review.json',
  JSON.stringify(
    {
      at: new Date().toISOString(),
      method:
        '8x8 grayscale horizontal difference hash, Hamming <=7. Screening only, not proof of identical garment; inspect cross-group pairs.',
      pairs,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log(
  JSON.stringify({ pairs: pairs.length, crossGroup: pairs.filter((p) => !p.sameRecordedGroup) }),
);
const attribution = labels.cases.map((c) => ({
  id: c.id,
  source: c.source,
  author: c.author,
  license: c.license,
  licenseUrl: c.licenseUrl,
  transformation: c.transform,
}));
await fs.writeFile(
  'datasets/quality-audit-01/attribution.json',
  JSON.stringify({ at: new Date().toISOString(), records: attribution }, null, 2) + '\n',
  { flag: 'wx' },
);
const readme = [
  '# Relay quality audit image corpus',
  '',
  labels.cases.length +
    ' unique source photographs, labelled before the evaluated system was run. This is a deliberately difficult diagnostic collection, not a random sample of business intake.',
  '',
  '- `labels.csv`: reference labels, source, licence, image path and SHA-256.',
  '- `labels.json`: full records, related-view groups, label rationale and publisher annotation where available.',
  '- `annotations/`: original direct visual annotations retained separately.',
  '- `images/commons/`: garment, gear, decorative-detail, hardware and scene photographs.',
  '- `images/fabric/`: 80 original fabric samples, separately reported as morphology stress cases.',
  '- `images/leather/`: 20 raw leather samples, separately reported as morphology stress cases.',
  '- `review/`: contact sheets used for visual annotation.',
  '- `review.html`: labelled photographs and system results, generated after evaluation.',
  '- `attribution.json`: per-image source and reuse information.',
  '',
  'Reference labels describe visible structural material defects. Oil-like staining, printed graphics, mesh and regular seams are not labelled structural damage. Intentional fashion rips still contain visible breaks; their cause and crash history remain unknown. Ambiguous and unassessable examples stay outside binary detection totals.',
  '',
  'The assistant assigned labels by direct visual review, supported by source annotations where available. These are not independent expert physical-condition labels. Subtle source annotations were inspected as original-pixel crops; one unresolved example was kept ambiguous. No target-system prediction was used to assign labels.',
  '',
  'All photos are original distinct sources, not generated quality variants. Related views are grouped; raw-material capture groups are conservative because item identities are unavailable. The Commons boot-slider case is related to a previously exposed boot source and is marked `priorRelated`.',
  '',
  'The model, prompts and policy are frozen in `experiments/quality-audit-01/protocol.json`. The corpus/label lock is `experiments/quality-audit-01/labels.lock.json`. No training or product change is part of this audit. The raw licence-verified material archives remain under the local `.cache/phone-training` acquisition folder.',
  '',
];
await fs.writeFile('datasets/quality-audit-01/README.md', readme.join('\n'), { flag: 'wx' });
