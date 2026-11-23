import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import {
  BASELINE_COMMIT,
  METRICS,
  PROTOCOL_ID,
  SOURCES,
  SPLIT_SEED,
  THRESHOLD_RULE,
  TRANSFORMS,
} from './quality-protocol';
const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'experiments/round-02/quality');
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
await mkdir(resolve(out, 'baseline'), { recursive: true });
const manifestText = await readFile(resolve(root, 'assets/fixtures/manifest.json'), 'utf8');
const manifest = JSON.parse(manifestText.replace(/^\uFEFF/, '')) as {
  fixtures: Array<{
    id: string;
    group: string;
    file: string;
    sha256: string;
    license: string;
    licenseUrl: string;
    author: string;
    sourceUrl: string;
  }>;
};
const groups = [...new Set(manifest.fixtures.map((f) => f.group))]
  .map((group) => ({ group, orderingHash: hash(SPLIT_SEED + '|' + group) }))
  .sort((a, b) => a.orderingHash.localeCompare(b.orderingHash));
const development = new Set(groups.slice(0, 3).map((g) => g.group));
const fixtureRecords = [];
for (const fixture of manifest.fixtures) {
  const bytes = await readFile(resolve(root, fixture.file));
  if (hash(bytes) !== fixture.sha256) throw new Error('Fixture hash mismatch: ' + fixture.id);
  fixtureRecords.push({
    ...fixture,
    split: development.has(fixture.group) ? 'development' : 'evaluation',
  });
}
const baselineFiles = [
  'packages/core/quality.ts',
  'server/images.ts',
  'app/src/session.ts',
  'packages/core/policy.ts',
];
const snapshots = [];
for (const file of baselineFiles) {
  const content = execFileSync('git', ['show', BASELINE_COMMIT + ':' + file], {
    cwd: root,
    encoding: 'utf8',
  });
  const name = file.replaceAll('/', '__') + '.txt';
  await writeFile(resolve(out, 'baseline', name), content, { flag: 'wx' });
  snapshots.push({
    file,
    sha256: hash(content),
    snapshot: 'experiments/round-02/quality/baseline/' + name,
  });
  if (file === 'packages/core/quality.ts') {
    const runnable = content.replace("from './schema'", "from '../../packages/core/schema'");
    await writeFile(resolve(root, 'scripts/round-02/quality-baseline.ts'), runnable, {
      flag: 'wx',
    });
  }
}
const protocol = {
  schemaVersion: '1.0',
  id: PROTOCOL_ID,
  frozenAt: new Date().toISOString(),
  baselineCommit: BASELINE_COMMIT,
  sourceManifest: 'assets/fixtures/manifest.json',
  sourceManifestSha256: hash(manifestText),
  freezesBefore:
    'Any round-02 quality metric measurement, candidate threshold calculation or evaluation-group inspection.',
  existingCorpusCaveat:
    'These are previously available convenience fixtures, not a prospectively collected independent external test set.',
  groups,
  developmentGroups: [...development],
  evaluationGroups: groups.filter((g) => !development.has(g.group)).map((g) => g.group),
  fixtures: fixtureRecords,
  snapshots,
  transforms: TRANSFORMS,
  expectedVariants: manifest.fixtures.length * TRANSFORMS.length,
  metrics: METRICS,
  metricDetails: {
    luminance:
      '0.2126 R + 0.7152 G + 0.0722 B on encoded 0..255 values; not linear-light radiometry.',
    laplacian192:
      'Population variance of four-neighbour discrete Laplacian over interior pixels at longest edge 192; identical baseline operator.',
    tenengrad192:
      'Mean squared Sobel x/y gradient magnitude over interior pixels; each Sobel derivative divided by 8.',
    normalizedLaplacian192: 'laplacian192 / (population luminance variance + 1).',
    normalizedTenengrad192: 'tenengrad192 / (population luminance variance + 1).',
    multiscaleNormalizedTenengrad:
      'Arithmetic mean of normalized Tenengrad at longest edges 96 and 192.',
  },
  calibration: {
    rule: THRESHOLD_RULE,
    frozenBeforeEvaluation: true,
    absoluteValuesNotClinicalOrOperationalThresholds: true,
  },
  outcomes: [
    'Existing warning counts by transformation, pipeline, split and item group.',
    'Heavy controlled Gaussian blur (sigma 4 or 8) warning rate with denominator; never described as real bad-photo sensitivity.',
    'Paired ordering across adjacent Gaussian sigma steps and compared with identity.',
    'New soft warnings on 90/180/270 degree controls relative to the same image identity; stipulated benign-transform false-warning proxy only.',
    'Control warnings retained separately because unmodified sources are not independently labelled as good photographs.',
    'Median relative metric drift on sRGB gain 0.5; contrast sensitivity analysis, not camera exposure validation.',
    'Mobile preprocessing proxy vs server-after-mobile warning disagreement and JPEG decoder differences.',
  ],
  pipelines: {
    server_direct:
      'Frozen server: rotate by EXIF, fit within 1600 without enlargement, white alpha flatten, JPEG84 mozjpeg; raw RGBA previews at 192 and 96.',
    mobile_proxy:
      'Sharp proxy: same geometry, white flatten, JPEG82; JPEG90 previews decoded by jpeg-js. This is not native Expo execution.',
    server_after_mobile:
      'Frozen server pipeline applied to the JPEG82 proxy capture; corresponds to actual upload order but not native codec equivalence.',
  },
  probes: [
    'Actual production server EXIF orientations 1..8 and lossless PNG representation equivalence.',
    'Exact normalized duplicates vs near duplicates after recompression: distinguish documented exact hashing from perceptual deduplication.',
    'Alpha hidden RGB invariance in server flattening and raw shared quality metric.',
    'Malformed dimensions and non-opaque raw pixels, including finite/integer constraints.',
    'Truncated images, metadata stripping and resolution boundaries.',
  ],
  restrictions: [
    'No condition/protective-performance ground truth.',
    'No model training or inference.',
    'No threshold fitted to evaluation groups.',
    'No production code edits.',
    'No prior reports overwritten.',
    'No physical iOS/Android parity claim.',
  ],
  runtime: { node: process.version, sharp: sharp.versions },
  sources: SOURCES,
};
const text = JSON.stringify(protocol, null, 2) + '\n';
await writeFile(resolve(out, 'preregistration.json'), text, { flag: 'wx' });
await writeFile(resolve(out, 'preregistration.sha256'), hash(text) + '\n', { flag: 'wx' });
process.stdout.write(
  JSON.stringify(
    {
      protocol: PROTOCOL_ID,
      sha256: hash(text),
      imageCount: fixtureRecords.length,
      groupCount: groups.length,
      developmentGroups: [...development],
      evaluationGroups: protocol.evaluationGroups,
      variants: protocol.expectedVariants,
    },
    null,
    2,
  ) + '\n',
);
