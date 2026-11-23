import fs from 'node:fs/promises';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
const base = JSON.parse(await fs.readFile('experiments/round-03/condition-protocol.json', 'utf8'));
const acquired = JSON.parse(
  await fs.readFile('assets/fixtures/round-05/acquisition.json', 'utf8'),
).acquired;
const pd = JSON.parse(
  await fs.readFile('assets/fixtures/round-05/acquisition-public-domain.json', 'utf8'),
).acquired;
const newCases = [...acquired, ...pd].map((c) => ({
  id: c.id,
  file: c.file,
  sha256: c.sha256,
  group: c.group,
  expectedDamage: ['lewis-vintage', 'biker-black'].includes(c.id) ? false : null,
  split: c.group === 'worn' ? 'same-garment-new-view' : 'new-source-control',
  labelBasis:
    c.group === 'worn'
      ? 'Worn leather and creased seams; material wear ambiguous, not scored as intact or damaged.'
      : c.id === 'schott-613'
        ? 'Older leather with possible surface wear; no condition/history ground truth, unscored.'
        : 'No localized rough scrape, hole or coating loss apparent in pre-inference visual review. Shiny folds/seams are hard negatives; not verified undamaged or safe.',
}));
const variants = [
  { id: 'reference' },
  { id: 'jpeg35', quality: 35 },
  { id: 'dim70', brightness: 0.7, quality: 88 },
  { id: 'small320', edge: 320, quality: 88 },
  { id: 'small240-jpeg60', edge: 240, quality: 60 },
  { id: 'small320-jpeg18', edge: 320, quality: 18 },
  { id: 'small320-dim55', edge: 320, brightness: 0.55, quality: 60 },
];
const cases = [];
await fs.mkdir('.cache/round-05-inputs', { recursive: true });
for (const c of [...base.cases, ...newCases]) {
  const selected = newCases.includes(c)
    ? variants.filter((v) => ['reference', 'small320', 'small240-jpeg60'].includes(v.id))
    : variants;
  const original = await fs.readFile(c.file);
  if (createHash('sha256').update(original).digest('hex') !== c.sha256)
    throw Error('Changed source');
  for (const v of selected) {
    let data = original;
    if (v.id !== 'reference') {
      let p = sharp(original).rotate().flatten({ background: '#fff' });
      if (v.brightness) p = p.modulate({ brightness: v.brightness });
      if (v.edge)
        p = p.resize({ width: v.edge, height: v.edge, fit: 'inside', withoutEnlargement: true });
      data = await p.jpeg({ quality: v.quality }).toBuffer();
    }
    const key = c.id + '--' + v.id;
    const file = '.cache/round-05-inputs/' + key + (v.id === 'reference' ? '.input' : '.jpg');
    await fs.writeFile(file, data, { flag: 'wx' });
    const m = await sharp(data).metadata();
    cases.push({
      ...c,
      id: key,
      sourceId: c.id,
      variant: v.id,
      inputFile: file,
      inputSha256: createHash('sha256').update(data).digest('hex'),
      width: m.width,
      height: m.height,
    });
  }
}
const protocol = {
  frozenAt: new Date().toISOString(),
  candidate: 'selective-abrasion-rescue-1',
  target: 'Only missed visible abrasion in low-resolution input.',
  fixedChanges:
    'No model, prompt, policy, UI or training changes. Only a bounded third verification on an enlarged rendering after the baseline rejected every finding and had proposed abrasion. Supported rescue findings become possible; mechanism stays unclear. Other metadata remains the original output.',
  inputBounds:
    'Longest edge <480, shortest >=96, aspect <=4; enlarged approx1024 visual tokens, linear interpolation, PNG; one additional model call max per eligible photograph; 4s transport deadline.',
  cases,
  sourceGroups: new Set(cases.map((c) => c.group)).size,
  sourceImages: base.cases.length + newCases.length,
  gate: {
    requiredRepairs:
      'First-user small320 miss plus at least one other previously missed damaged variant; subsequent independent-repeat check must retain the repair.',
    preservePositive:
      'Every baseline nonempty finding list, clarity, category, material and mechanism must remain unchanged.',
    falseAlarm: 'No new finding on a visually negative control, including fresh-source controls.',
    authority:
      'No rescued finding becomes clear or claims a sliding mechanism; no category/material/identity change.',
    latency:
      'At most one extra request per eligible photo; p95 additional runtime <=2500ms on this host; 4s timeout preserves baseline on failure.',
  },
  limits: [
    'These variants are correlated. Report source groups and images, never call 106 independent items.',
    'Low-quality source labels do not prove every damaged pixel remains resolvable. A retake is valid when detail is missing; no safe/offer result is allowed.',
    'Two new worn-detail views share the old worn garment; only three new source groups were acquired.',
    'Visual condition labels are not expert certification.',
  ],
};
await fs.writeFile(
  'experiments/round-05/hard-case-protocol.json',
  JSON.stringify(protocol, null, 2),
  { flag: 'wx' },
);
const contactCases = cases.filter(
  (c) =>
    ['sample-01', 'source-crash', 'biker-black', 'lewis-vintage'].includes(c.sourceId) &&
    ['small240-jpeg60', 'small320-jpeg18'].includes(c.variant),
);
const tiles = await Promise.all(
  contactCases.map(async (c, i) => ({
    input: await sharp(await fs.readFile(c.inputFile))
      .resize(280, 280, { fit: 'contain', background: '#ddd' })
      .jpeg()
      .toBuffer(),
    left: (i % 3) * 280,
    top: Math.floor(i / 3) * 280,
  })),
);
await sharp({
  create: {
    width: 840,
    height: Math.ceil(tiles.length / 3) * 280,
    channels: 3,
    background: '#ddd',
  },
})
  .composite(tiles)
  .jpeg()
  .toFile('.cache/round-05-inputs/hard-contact.jpg');
console.log(
  JSON.stringify({
    cases: cases.length,
    images: protocol.sourceImages,
    groups: protocol.sourceGroups,
    hardContactOrder: contactCases.map((c) => c.id),
  }),
);
