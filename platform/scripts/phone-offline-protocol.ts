import fs from 'node:fs/promises';
import { proposeRegions } from '../packages/vision/regions';
const root = 'experiments/phone-offline-01';
const previous = JSON.parse(
  await fs.readFile('experiments/round-05/hard-case-protocol.json', 'utf8'),
);
const condition = JSON.parse(
  await fs.readFile('experiments/round-03/condition-protocol.json', 'utf8'),
);
const sources = [...previous.cases];
for (const item of condition.cases)
  if (!sources.some((c) => c.file === item.file))
    sources.push({ ...item, inputFile: item.file, variant: 'reference' });
const cases = [];
for (const item of sources) {
  const bytes = await fs.readFile(item.inputFile);
  const proposal = await proposeRegions(bytes, 3);
  cases.push({ ...item, regions: proposal.regions });
}
const heads = {
  item: {
    motorcycle_jacket: ['a motorcycle riding jacket', 'a padded leather motorbike jacket'],
    trousers: ['a pair of trousers', 'motorcycle pants'],
    gloves: ['a pair of gloves', 'motorcycle gloves'],
    boots: ['a pair of boots', 'motorcycle boots'],
    helmet: ['a motorcycle helmet', 'a protective helmet'],
    ordinary_jacket: ['an ordinary denim jacket', 'a casual winter coat'],
    label: ['a clothing label with printed text', 'a size and care tag inside clothing'],
    other: ['an unrelated household object', 'an empty scene'],
  },
  material: {
    leather: ['leather clothing', 'a leather surface'],
    textile: ['woven textile clothing', 'woven synthetic fabric'],
    mesh: ['mesh clothing', 'perforated mesh fabric'],
    denim: ['denim clothing', 'blue denim fabric'],
  },
  surface: {
    tear: [
      'torn fabric with a ragged hole',
      'ripped clothing with frayed threads',
      'a hole through clothing material',
    ],
    abrasion: [
      'scraped leather with missing surface coating',
      'abraded fabric with broken fibers',
      'a rough scuffed patch on clothing',
    ],
    seam: [
      'a split seam with broken stitching',
      'unstitched fabric edges pulling apart',
      'a seam that has torn open',
    ],
    smooth: [
      'intact smooth leather with normal creases',
      'unbroken fabric in good condition',
      'wrinkled fabric with normal folds',
    ],
    stitching: [
      'normal stitching along a seam',
      'intact ribbed padding',
      'reinforced stitched panels',
    ],
    graphic: [
      'a printed logo on clothing',
      'a white decorative stripe on fabric',
      'an embroidered brand patch',
    ],
    mesh: [
      'regular mesh holes in fabric',
      'perforated protective padding',
      'woven textile texture',
    ],
    hardware: ['a closed zipper on clothing', 'metal buttons and snaps', 'plastic body armor'],
    background: [
      'a textured wall behind clothing',
      'the floor behind a jacket',
      'a hanger or furniture',
    ],
  },
};
await fs.writeFile(
  root + '/probe-protocol.json',
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      task: 'Small shared encoder plus fixed item, material and morphology similarity heads. No free-form VLM, server, or image upload. Scores are uncalibrated candidates, not verified damage.',
      models: ['TinyCLIP-ViT-8M-16-Text-3M-YFCC15M', 'TinyCLIP-ViT-40M-32-Text-19M-LAION400M'],
      templates: ['A close-up photograph of {}.', 'A photograph showing {}.'],
      preprocessing:
        'RGB, entire crop bilinear resized to 224 square; CLIP mean/std. Whole image and max three algorithmic region proposals.',
      heads,
      cases,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log(JSON.stringify({ cases: cases.length, heads: Object.keys(heads) }));
