import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const output = path.resolve(process.argv[2]);
const root = process.cwd();
const projectModule = (p) => import(pathToFileURL(path.resolve(root, p)).href);
const { fitBand } = await projectModule('packages/core/v2/calibration.ts');
const { prepareImages } = await projectModule('server/images.ts');
const protocolBytes = fs.readFileSync(new URL('protocol.json', import.meta.url));
const protocol = JSON.parse(protocolBytes);
const sha = (v) => createHash('sha256').update(v).digest('hex');
const read = (p) => JSON.parse(fs.readFileSync(path.resolve(root, p), 'utf8'));
const rand = (c) => sha(protocol.salt + '/' + c.id);
const sorted = (rows) => [...rows].sort((a, b) => rand(a).localeCompare(rand(b)));
function limited(rows, perGroup, max = Infinity) {
  const groups = new Map(),
    selected = [];
  for (const r of sorted(rows)) {
    if ((groups.get(r.group) ?? 0) >= perGroup) continue;
    groups.set(r.group, (groups.get(r.group) ?? 0) + 1);
    selected.push(r);
    if (selected.length === max) break;
  }
  return selected;
}
const corpus = read('datasets/realworld-v3/labels.json').cases;
const held = corpus.filter((c) => !c.seenInCalibration);
const e14Groups = new Set(corpus.filter((c) => c.id.startsWith('ov-')).map((c) => c.group));
const natural = held.filter((c) => ['item', 'detail'].includes(c.framing));
const worn = /scuff|scratch|worn|wear|dust|crease|mud|snow|print|graphic|paint|faded|grime|dirt/i;
const marked = natural.filter((c) => c.condition === 'clean' && worn.test(c.visualBasis));
const wear = limited(marked, 2);
const others = limited(
  natural.filter((c) => c.condition === 'clean' && !worn.test(c.visualBasis)),
  1,
  14,
);
const ambiguous = limited(
  natural.filter((c) => c.condition === 'ambiguous'),
  1,
  6,
);
const scene = held.find((c) => c.id === 'cm-091');
const scenes = [
  scene,
  ...limited(
    held.filter((c) => c.framing === 'scene' && c.group !== scene.group),
    1,
    3,
  ),
];
const needles = read('datasets/needle-v3/labels.json').cases.filter((c) => c.grid === 4);
const groups = {
  damaged: held.filter((c) => c.condition === 'damaged'),
  wear,
  other_clean: others,
  ambiguous,
  scene: scenes,
  label: held.filter((c) => c.framing === 'label').slice(0, 1),
  needle_damaged: limited(
    needles.filter((c) => c.sourceId),
    1,
    8,
  ),
  needle_clean: limited(
    needles.filter((c) => !c.sourceId),
    1,
    8,
  ),
};
const ids = new Set();
const cases = [];
const images = path.join(output, 'normalized');
fs.mkdirSync(images);
for (const [cohort, rows] of Object.entries(groups))
  for (const c of rows) {
    if (ids.has(c.id)) throw new Error('Duplicate selected ID: ' + c.id);
    ids.add(c.id);
    const source = fs.readFileSync(path.resolve(root, c.file)),
      sourceSha = sha(source);
    if (c.sha256 && sourceSha !== c.sha256) throw new Error('Input drift: ' + c.id);
    const view = c.view;
    const prepared = await prepareImages(
      [{ id: c.id, view, base64: source.toString('base64') }],
      1600,
    );
    const jpeg = prepared.images[0].jpeg;
    fs.writeFileSync(path.join(images, c.id + '.jpg'), jpeg, { flag: 'wx' });
    cases.push({
      id: c.id,
      cohort,
      sourcePath: c.file,
      sha256: sourceSha,
      normalizedSha256: sha(jpeg),
      condition: c.condition,
      subject: c.subject,
      framing: c.framing ?? 'synthetic',
      group: c.group,
      e14Photographer: e14Groups.has(c.group),
      view,
    });
  }
const rows = fs
  .readFileSync('benchmarks/backend-v2/battery--b1--qwen3.5-2b--e1600--break+slide.jsonl', 'utf8')
  .trim()
  .split('\n')
  .map((r) => JSON.parse(r))
  .filter((r) => !r.error && ['visible_defect', 'no_visible_defect'].includes(r.condition));
const fit = fitBand(
  rows.map((r) => ({
    id: r.id,
    score: Math.max(r.probes.break.p.yes, r.probes.slide.p.yes),
    damaged: r.condition === 'visible_defect',
  })),
  { keep: 0.98, wrongBlock: 0.01 },
);
if (fit.clear !== 0.078 || fit.block !== 0.255)
  throw new Error('2B calibration differs from reference report');
const manifest = {
  protocolSha256: sha(protocolBytes),
  createdUtc: new Date().toISOString(),
  fit,
  cases: sorted(cases),
  cohorts: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])),
};
fs.writeFileSync(path.join(output, 'cases.json'), JSON.stringify(manifest, null, 2) + '\n', {
  flag: 'wx',
});
console.log(
  JSON.stringify({
    n: cases.length,
    cohorts: manifest.cohorts,
    clear: fit.clear,
    block: fit.block,
  }),
);
