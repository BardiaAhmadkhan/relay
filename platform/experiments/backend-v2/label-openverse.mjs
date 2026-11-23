// Labels for the Openverse gear set (2026-11-17), written in the corpus case format (datasets/*/labels.json)
// so the experiment runners can read it with `--corpus openverse`.
//
// Labels are the assistant's visual annotations from contact sheets and a closer review sheet
// (datasets/gear-v2-openverse/review/), made BEFORE any model scored these photographs. They are not
// expert labels. Photographs of injuries, accident scenes, people as the subject, riders on the road,
// vehicles, collages and non-gear items were excluded, never labelled.
// node experiments/backend-v2/label-openverse.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './lib.mjs';

const dir = path.join(ROOT, 'datasets', 'gear-v2-openverse');
const { images } = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
const byId = new Map(images.map((m) => [m.id, m]));
// id: [condition, subject, expectedKinds, group, basis]
const LABELS = {
  'ov-002': ['visible_defect', 'garment', ['tear', 'abrasion'], 'ov-ericlawrence', 'Textile jacket shoulder with ragged holes through the shell.'],
  'ov-003': ['visible_defect', 'garment', ['tear', 'abrasion'], 'ov-ericlawrence', 'Same jacket, elbow: shell torn open, lining and fibres exposed.'],
  'ov-014': ['visible_defect', 'garment', ['tear'], 'ov-ericlawrence', 'Yellow and black rain jacket shredded across the front.'],
  'ov-006': ['visible_defect', 'garment', ['abrasion', 'tear'], 'ov-timfreund', 'Mesh sleeve or leg panel with several holes worn through.'],
  'ov-007': ['visible_defect', 'garment', ['abrasion', 'tear'], 'ov-timfreund', 'Mesh riding trousers with holes through the shell at the knees and shins.'],
  'ov-008': ['visible_defect', 'garment', ['tear', 'abrasion'], 'ov-timfreund', 'Close-up of a mesh panel with a frayed, torn edge.'],
  'ov-005': ['ambiguous', 'boots', ['abrasion'], 'ov-timfreund', 'Boots from the same crash series; only possible toe-slider scuffs, no definite broken material.'],
  'ov-052': ['ambiguous', 'gloves', ['abrasion'], 'ov-badgergravling', 'Heavily worn gloves; fingertip leather may be abraded through, not decidable at this resolution.'],
  'ov-001': ['no_visible_defect', 'garment', [], 'ov-karmadude', 'Leather jacket close-up with an embossed logo; intact.'],
  'ov-038': ['no_visible_defect', 'garment', [], 'ov-4sr', 'Studio product shot of a leather jacket on a model; intact.'],
  'ov-039': ['no_visible_defect', 'garment', [], 'ov-dougkline', 'Leather jacket with printed graphics on a mannequin; intact.'],
  'ov-041': ['no_visible_defect', 'garment', [], 'ov-zombieite', 'Striped leather motorcycle jacket on a hanger; intact.'],
  'ov-043': ['no_visible_defect', 'garment', [], 'ov-antiquecycles', 'Hand-painted leather jacket on a chair; graphics, intact.'],
  'ov-045': ['no_visible_defect', 'garment', [], 'ov-yc', 'New textile motorcycle jacket on a hanger; intact.'],
  'ov-048': ['no_visible_defect', 'gloves', [], 'ov-paulgarland', 'Leather glove close-up; the finger blade is a visor wiper by design; intact.'],
  'ov-051': ['no_visible_defect', 'gloves', [], 'ov-bekathwia', 'Two pairs of motorcycle gloves on a table; intact.'],
  'ov-060': ['no_visible_defect', 'boots', [], 'ov-erichazann', 'New pink motorcycle boots in a box; intact.'],
  'ov-061': ['no_visible_defect', 'boots', [], 'ov-erichazann', 'New black buckled motorcycle boots in a box; intact.'],
  'ov-063': ['no_visible_defect', 'boots', [], 'ov-geekybiker', 'Used touring boots, scuffed and creased; intact.'],
  'ov-065': ['no_visible_defect', 'boots', [], 'ov-kathygill', 'Used motorcycle boots with snow on a rug; intact.'],
  'ov-066': ['no_visible_defect', 'boots', [], 'ov-deejayqueue', 'Tall patrol boots, polished; intact.'],
  'ov-068': ['no_visible_defect', 'boots', [], 'ov-deejayqueue', 'Close-up of a patrol boot; intact.'],
};
const cases = Object.entries(LABELS).map(([id, [condition, subject, expectedKinds, group, visualBasis]]) => {
  const m = byId.get(id);
  if (!m || m.error) throw new Error('missing image ' + id);
  return {
    id,
    domain: 'garments_and_gear',
    file: m.file,
    source: m.landingUrl,
    author: m.creator,
    license: ('CC ' + m.license.toUpperCase() + ' ' + m.licenseVersion).replace('CC PDM', 'Public Domain Mark'),
    licenseUrl: m.licenseUrl,
    title: m.title,
    sha256: m.sha256,
    width: m.width,
    height: m.height,
    group,
    condition,
    expectedKinds,
    subject,
    view: 'front',
    labelledBy: 'assistant visual annotation 2026-11-17, before scoring; not expert',
    visualBasis,
  };
});
await fs.writeFile(
  path.join(dir, 'labels.json'),
  JSON.stringify(
    {
      frozenAt: new Date().toISOString(),
      scope: 'Real motorcycle gear from Openverse (Flickr), to widen the gear slice of the backend-v2 evaluation.',
      excluded: 'injuries, accident scenes, people as subject, riders, vehicles, collages, non-gear items',
      cases,
    },
    null,
    1,
  ) + '\n',
);
const count = (c) => cases.filter((x) => x.condition === c).length;
console.log(JSON.stringify({ cases: cases.length, damaged: count('visible_defect'), clean: count('no_visible_defect'), ambiguous: count('ambiguous') }));
