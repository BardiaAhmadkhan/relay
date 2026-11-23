import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../../', import.meta.url));
const baselineCommit = 'e3a6f5876d1c6c7341d4fae7d460ca632af8923c';
const output = path.join(root, 'experiments/round-02/vision');
const hash = (b) => createHash('sha256').update(b).digest('hex');
const read = (p) => fs.readFile(path.join(root, p));
const writeNew = (p, data) => fs.writeFile(path.join(root, p), data, { flag: 'wx' });
if (
  await fs.access(path.join(output, 'freeze.json')).then(
    () => true,
    () => false,
  )
)
  throw new Error('Frozen experiment exists. Preserve it.');
await fs.mkdir(path.join(output, 'conditions'), { recursive: true });
const acquisition = JSON.parse(await read('assets/fixtures/round-02/acquisition.json'));
const historical = JSON.parse(await read('assets/fixtures/manifest.json'));
const reviewed = acquisition.acquired.map((f) => {
  const result = {
    ...f,
    id: 'n-' + f.id,
    originalId: f.id,
    dataset: 'new',
    view: f.view,
    category: f.category,
    scoreCategory: f.category !== null,
    labelBasis:
      'Source description plus agent visual review before CLIP/SigLIP inference; not expert inspection.',
  };
  if (f.id === 'winter-kit') {
    result.view = 'detail';
    result.category = null;
    result.scoreCategory = false;
    result.reviewNote = 'Actual image is a jacket close-up, not a winter outfit overview.';
  }
  if (f.id === 'salopette') {
    result.category = 'trousers';
    result.scoreCategory = true;
    result.reviewNote =
      'Bib/trouser garment is the targeted source item; boots and a base layer are also visible. This weak category convention is frozen before inference.';
  }
  if (f.id === 'heated-trousers') {
    result.category = null;
    result.scoreCategory = false;
    result.reviewNote =
      'Thermal image, not an ordinary RGB smartphone overview. Retained as an unscored domain-shift control.';
  }
  if (f.id === 'mixed-riding-gear')
    result.reviewNote =
      'Motorcycle rider wears several gear categories; motorcycle/background are also visible. Expected multiple by the frozen scene taxonomy.';
  if (f.id === 'worn-jacket')
    result.reviewNote =
      'Motorcycle-specific construction not established by source/visual review; remains unscored instead of guessing.';
  return result;
});
const old = historical.fixtures.map((f) => ({
  ...f,
  id: 'h-' + f.id,
  originalId: f.id,
  group: 'historical-' + f.group,
  dataset: 'historical',
  view:
    f.id === 'backpack-label'
      ? 'label'
      : f.id === 'crashed-shoulder'
        ? 'detail'
        : f.id === 'gloves-palm'
          ? 'back'
          : 'front',
  labelBasis: 'Historical reference retained; previous model outcomes are known. Diagnostic only.',
}));
const sources = [...old, ...reviewed];
for (const f of sources) {
  if (hash(await read(f.file)) !== f.sha256) throw new Error('Source bytes changed: ' + f.id);
}
const corpus = {
  schemaVersion: '1.0',
  reviewedAt: new Date().toISOString(),
  reviewer: 'Agent visual/source review, not domain-expert or physical inspection',
  baselineCommit,
  sourceCounts: { historical: old.length, new: reviewed.length },
  exclusions: acquisition.excluded,
  sources,
};
await writeNew('experiments/round-02/vision/corpus.json', JSON.stringify(corpus, null, 2) + '\n');
const baselineSource = execFileSync('git', ['show', baselineCommit + ':packages/vision/local.ts'], {
  cwd: root,
  encoding: 'utf8',
});
const baselineSchema = execFileSync('git', ['show', baselineCommit + ':packages/core/schema.ts'], {
  cwd: root,
  encoding: 'utf8',
});
const adapter = baselineSource
  .replace("'../core/schema.js'", "'./baseline-schema.js'")
  .replace("new URL('../../', import.meta.url)", "new URL('../../../', import.meta.url)");
if (
  adapter === baselineSource ||
  !adapter.includes('./baseline-schema.js') ||
  !adapter.includes("new URL('../../../', import.meta.url)")
)
  throw new Error('Mechanical snapshot relocation failed');
await writeNew('experiments/round-02/vision/baseline-adapter.ts', adapter);
await writeNew('experiments/round-02/vision/baseline-schema.ts', baselineSchema);
await writeNew('experiments/round-02/vision/baseline-source.ts.txt', baselineSource);

const conditions = [
  'reference',
  'medium',
  'small',
  'tiny',
  'compressed',
  'dark_blur',
  'framed_clutter',
  'center_detail',
];
const cases = [];
const checker = Buffer.alloc(960 * 960 * 3);
for (let y = 0; y < 960; y++)
  for (let x = 0; x < 960; x++) {
    const value = (Math.floor(x / 48) + Math.floor(y / 48)) % 2 ? 72 : 184;
    const i = (y * 960 + x) * 3;
    checker[i] = checker[i + 1] = checker[i + 2] = value;
  }
for (const fixture of sources) {
  const sourceBytes = await read(fixture.file);
  const metadata = await sharp(sourceBytes).metadata();
  for (const condition of conditions) {
    let bytes;
    let role = fixture.view;
    if (condition === 'reference') bytes = sourceBytes;
    if (['medium', 'small', 'tiny'].includes(condition)) {
      const size = { medium: 480, small: 224, tiny: 112 }[condition],
        quality = condition === 'tiny' ? 40 : 70;
      bytes = await sharp(sourceBytes)
        .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();
    }
    if (condition === 'compressed')
      bytes = await sharp(sourceBytes).jpeg({ quality: 30 }).toBuffer();
    if (condition === 'dark_blur')
      bytes = await sharp(sourceBytes).linear(0.45, 0).blur(1.4).jpeg({ quality: 88 }).toBuffer();
    if (condition === 'framed_clutter') {
      const tile = await sharp(sourceBytes)
        .resize({ width: 432, height: 432, fit: 'inside', withoutEnlargement: true })
        .toBuffer();
      const m = await sharp(tile).metadata();
      bytes = await sharp(checker, { raw: { width: 960, height: 960, channels: 3 } })
        .composite([
          {
            input: tile,
            left: Math.floor((960 - m.width) / 2),
            top: Math.floor((960 - m.height) / 2),
          },
        ])
        .jpeg({ quality: 88 })
        .toBuffer();
    }
    if (condition === 'center_detail') {
      const width = Math.max(1, Math.floor(metadata.width * 0.3)),
        height = Math.max(1, Math.floor(metadata.height * 0.3));
      bytes = await sharp(sourceBytes)
        .extract({
          left: Math.floor((metadata.width - width) / 2),
          top: Math.floor((metadata.height - height) / 2),
          width,
          height,
        })
        .resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toBuffer();
      if (role !== 'label') role = 'detail';
    }
    const file = 'experiments/round-02/vision/conditions/' + fixture.id + '--' + condition + '.jpg';
    await writeNew(file, bytes);
    const m = await sharp(bytes).metadata();
    cases.push({
      id: fixture.id + '--' + condition,
      sourceId: fixture.id,
      dataset: fixture.dataset,
      group: fixture.group,
      condition,
      file,
      sha256: hash(bytes),
      bytes: bytes.length,
      width: m.width,
      height: m.height,
      declaredView: role,
      expectedCategory: fixture.category,
      scoreCategory: fixture.scoreCategory && ['front', 'back'].includes(role),
      expectedWorkflowAbstention: ['detail', 'label'].includes(role),
      license: fixture.license,
      licenseUrl: fixture.licenseUrl,
    });
  }
}
await writeNew('experiments/round-02/vision/cases.json', JSON.stringify(cases, null, 2) + '\n');
function rng(seed) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(input, random) {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
const seed = 2026102602,
  schedule = [];
for (let repeat = 0; repeat < 3; repeat++) {
  const sequence = shuffle(cases, rng(seed + repeat));
  sequence.forEach((entry, index) =>
    schedule.push({
      pairIndex: schedule.length,
      repeat,
      caseId: entry.id,
      modelOrder:
        (index + repeat) % 2 ? ['local_siglip', 'local_clip'] : ['local_clip', 'local_siglip'],
    }),
  );
}
const probes = sources
  .filter((f) => ['front', 'back'].includes(f.view))
  .flatMap((f) => [
    {
      id: f.id + '--same_detail',
      dataset: f.dataset,
      group: f.group,
      type: 'same_item_detail',
      overviewCase: f.id + '--reference',
      additionalCase: f.id + '--center_detail',
      additionalView: 'detail',
      expected: f.category,
      score: f.scoreCategory,
    },
    {
      id: f.id + '--mismatch_detail',
      dataset: f.dataset,
      group: f.group,
      type: 'mismatched_item_detail',
      overviewCase: f.id + '--reference',
      additionalCase:
        (f.category === 'boots' ? 'n-helmet-fullface' : 'n-boots-axo') + '--reference',
      additionalView: 'detail',
      expected: 'unknown',
      score: true,
    },
    {
      id: f.id + '--mismatch_overview',
      dataset: f.dataset,
      group: f.group,
      type: 'mismatched_item_overview',
      overviewCase: f.id + '--reference',
      additionalCase:
        (f.category === 'boots' ? 'n-helmet-fullface' : 'n-boots-axo') + '--reference',
      additionalView: 'back',
      expected: 'unknown',
      score: true,
    },
    {
      id: f.id + '--label',
      dataset: f.dataset,
      group: f.group,
      type: 'overview_plus_label',
      overviewCase: f.id + '--reference',
      additionalCase: 'n-helmet-label--reference',
      additionalView: 'label',
      expected: f.category,
      score: f.scoreCategory,
    },
  ]);
const labelMisassignment = sources
  .filter((f) => f.view === 'label')
  .map((f) => ({
    id: f.id + '--label_as_front',
    dataset: f.dataset,
    type: 'label_misassignment',
    caseId: f.id + '--reference',
    declaredView: 'front',
    expected: 'unknown',
    metric: 'workflow robustness, not category accuracy',
  }));
await writeNew(
  'experiments/round-02/vision/schedule.json',
  JSON.stringify(
    {
      seed,
      repeats: 3,
      method:
        'Fisher-Yates source-condition shuffle per repeat; alternating balanced paired model order',
      schedule,
      probes,
      labelMisassignment,
    },
    null,
    2,
  ) + '\n',
);
const { MODEL_SPECS, LABELS, PROMPT_TEMPLATES } =
  await import('../../experiments/round-02/vision/baseline-adapter.ts');
const sourceLedger = reviewed.map((f) => ({
  id: 'R02-' + f.originalId,
  title: f.title,
  url: f.sourceUrl,
  publisher: f.publisher,
  author: f.author,
  publicationDate: null,
  revisionDate: f.pageRevisionAt?.slice(0, 10) ?? null,
  sourceRevision: String(f.pageRevision),
  retrievedOn: f.retrievedAt.slice(0, 10),
  relevantClaims: [
    f.notes,
    'Source record states ' + f.license + '; attribution and transformations retained.',
  ],
  evidenceStrength:
    'Primary asset/licence record; agent visual label review is weak task evidence, not expert inspection.',
  limitations: f.limitations,
  howUsed: ['New-to-project robustness evaluation fixture; group ' + f.group],
  licenceUrl: f.licenseUrl,
}));
await writeNew(
  'experiments/round-02/vision/sources.json',
  JSON.stringify(sourceLedger, null, 2) + '\n',
);
const boundFiles = [
  'experiments/round-02/vision/protocol.md',
  'experiments/round-02/vision/corpus.json',
  'experiments/round-02/vision/cases.json',
  'experiments/round-02/vision/schedule.json',
  'experiments/round-02/vision/baseline-adapter.ts',
  'experiments/round-02/vision/baseline-schema.ts',
  'scripts/round-02/vision-run.mjs',
  'scripts/round-02/vision-analyze.mjs',
  'scripts/round-02/vision-prepare.mjs',
  'assets/fixtures/manifest.json',
  'assets/fixtures/round-02/acquisition.json',
  'package-lock.json',
];
const bindings = await Promise.all(
  boundFiles.map(async (file) => ({ file, sha256: hash(await read(file)) })),
);
const freeze = {
  schemaVersion: '1.0',
  frozenAt: new Date().toISOString(),
  baselineCommit,
  protocolSha256: bindings[0].sha256,
  bindings,
  models: MODEL_SPECS,
  labels: LABELS,
  templates: PROMPT_TEMPLATES,
  precision: 'q8',
  device: 'cpu',
  intraOpNumThreads: 2,
  interOpNumThreads: 1,
  warmup:
    'One excluded historical glove request per model after initialization; no new evaluation image used for warmup.',
  orderSeed: seed,
  caseCount: cases.length,
  trialCount: schedule.length * 2,
  probePlan:
    'Multiview candidate outputs derived from frozen repeat-zero per-view results; no extra inference or independent accuracy samples. Two actual label-as-front probes per model test misassignment.',
  sourceCodeRelocation:
    'Baseline adapter and schema loaded from immutable git commit; only schema relative import and cache-root relative path changed. Original source retained.',
  originalAdapterSha256: hash(baselineSource),
  noInferenceBeforeFreeze: true,
  analysisSeed: 2026102699,
  bootstrapReplicates: 3000,
};
await writeNew('experiments/round-02/vision/freeze.json', JSON.stringify(freeze, null, 2) + '\n');
console.log(
  JSON.stringify({
    frozenAt: freeze.frozenAt,
    sha256: hash(JSON.stringify(freeze, null, 2) + '\n'),
    sources: sources.length,
    newSources: reviewed.length,
    scoredNew: sources.filter((f) => f.dataset === 'new' && f.scoreCategory).length,
    conditions: cases.length,
    scheduledTrials: freeze.trialCount,
  }),
);
