import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, open } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import sharp from 'sharp';
import { prepareImages } from '../../server/images';
import {
  BASELINE_COMMIT,
  METRICS,
  PROTOCOL_ID,
  THRESHOLD_RULE,
  TRANSFORMS,
  type Metric,
} from './quality-protocol';
import { frozenServer, mobileProxy, transformFixture, type Measurements } from './quality-metrics';

const root = resolve(import.meta.dirname, '../..');
const experiment = resolve(root, 'experiments/round-02/quality');
const output = resolve(root, 'benchmarks/round-02/quality');
const phase = process.argv.find((a) => a.startsWith('--phase='))?.split('=')[1];
if (phase !== 'development' && phase !== 'evaluation')
  throw new Error('Use --phase=development or --phase=evaluation');
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const protocolText = await readFile(resolve(experiment, 'preregistration.json'), 'utf8');
const protocolHash = (await readFile(resolve(experiment, 'preregistration.sha256'), 'utf8')).trim();
if (sha(protocolText) !== protocolHash) throw new Error('Preregistration hash mismatch');
const protocol = JSON.parse(protocolText) as {
  id: string;
  baselineCommit: string;
  fixtures: Array<{
    id: string;
    file: string;
    group: string;
    sha256: string;
    split: string;
    title: string;
    author: string;
    license: string;
    licenseUrl: string;
    sourceUrl: string;
  }>;
};
if (protocol.id !== PROTOCOL_ID || protocol.baselineCommit !== BASELINE_COMMIT)
  throw new Error('Wrong frozen protocol');
let thresholds: Record<Metric, number> | undefined;
if (phase === 'evaluation') {
  const calibration = JSON.parse(await readFile(resolve(output, 'thresholds.json'), 'utf8'));
  if (calibration.protocolSha256 !== protocolHash) throw new Error('Threshold provenance mismatch');
  thresholds = calibration.thresholds;
}
await mkdir(output, { recursive: true });
await mkdir(resolve(experiment, 'variants'), { recursive: true });
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const rawName = 'measurements.' + phase + '.' + runId + '.jsonl';
const rawFile = await open(resolve(output, rawName), 'wx');
const startedAt = new Date().toISOString();
const fixtures = protocol.fixtures.filter((f) => f.split === phase);
const sourceLicenseNotice = [
  '# Round-02 controlled image derivatives',
  '',
  'These files are experimental image-quality transformations, not new photographs or protective-condition labels.',
  'Changes: image decoding and metadata stripping; selected Gaussian blur, encoded-RGB gain/clipping, resolution reduction, quarter-turn rotation, or JPEG re-encoding. The source licence is retained for each derivative. No author endorsement is implied.',
  '',
  ...protocol.fixtures.map(
    (f) =>
      '- **' +
      f.id +
      '**: ' +
      f.title +
      '; ' +
      f.author +
      '; [' +
      f.license +
      '](' +
      f.licenseUrl +
      '); [source](' +
      f.sourceUrl +
      '). File prefix: ' +
      f.id +
      '__',
  ),
  '',
].join('\n');
try {
  await writeFile(resolve(experiment, 'ATTRIBUTION.md'), sourceLicenseNotice, { flag: 'wx' });
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
}
const identities: Record<string, Record<Metric, number>> = {};
const productionParity: unknown[] = [];
let rows = 0;
try {
  for (const fixture of fixtures) {
    const source = await readFile(resolve(root, fixture.file));
    if (sha(source) !== fixture.sha256) throw new Error('Fixture changed: ' + fixture.id);
    for (const transform of TRANSFORMS) {
      const transformed = await transformFixture(source, transform);
      const extension = transform.family === 'jpeg' ? '.jpg' : '.png';
      const artifactName = fixture.id + '__' + transform.id + extension;
      const artifactPath = resolve(experiment, 'variants', artifactName);
      try {
        await writeFile(artifactPath, transformed, { flag: 'wx' });
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== 'EEXIST' ||
          sha(await readFile(artifactPath)) !== sha(transformed)
        )
          throw error;
      }
      const direct = await frozenServer(transformed);
      const mobile = await mobileProxy(transformed);
      const afterMobile = await frozenServer(mobile.jpeg);
      const metadata = await sharp(transformed).metadata();
      const pipelines: Record<string, Measurements> = {
        server_direct: direct.measurement,
        mobile_proxy: mobile.measurement,
        server_after_mobile: afterMobile.measurement,
      };
      const row = {
        schemaVersion: '1.0',
        protocolId: PROTOCOL_ID,
        protocolSha256: protocolHash,
        phase,
        fixtureId: fixture.id,
        group: fixture.group,
        sourceSha256: fixture.sha256,
        sourceLicense: fixture.license,
        sourceUrl: fixture.sourceUrl,
        transform,
        artifact: relative(root, artifactPath).replaceAll('\\', '/'),
        artifactSha256: sha(transformed),
        input: { width: metadata.width, height: metadata.height, bytes: transformed.length },
        pipelines,
        decoderComparison: mobile.decoderComparison,
        thresholdFlags: thresholds
          ? Object.fromEntries(
              Object.entries(pipelines).map(([name, values]) => [
                name,
                Object.fromEntries(
                  METRICS.map((metric) => [metric, values.metrics[metric] < thresholds![metric]]),
                ),
              ]),
            )
          : null,
      };
      await rawFile.write(JSON.stringify(row) + '\n');
      rows++;
      if (transform.family === 'identity') {
        identities[fixture.id] = direct.measurement.metrics;
        const actual = await prepareImages([
          { id: 'probe-' + fixture.id, view: 'front', base64: transformed.toString('base64') },
        ]);
        productionParity.push({
          fixtureId: fixture.id,
          sameEncodedJpeg: sha(actual.images[0]!.jpeg) === sha(direct.jpeg),
          sameQuality:
            JSON.stringify(actual.photos[0]!.quality) ===
            JSON.stringify(direct.measurement.quality),
          actual: actual.photos[0]!.quality,
          frozen: direct.measurement.quality,
        });
      }
    }
    process.stdout.write(
      JSON.stringify({ phase, completedFixture: fixture.id, variants: TRANSFORMS.length }) + '\n',
    );
  }
} finally {
  await rawFile.close();
}
const rawSha = sha(await readFile(resolve(output, rawName)));
const summary = {
  schemaVersion: '1.0',
  protocolId: PROTOCOL_ID,
  protocolSha256: protocolHash,
  phase,
  startedAt,
  finishedAt: new Date().toISOString(),
  rawFile: 'benchmarks/round-02/quality/' + rawName,
  rawSha256: rawSha,
  rows,
  expectedRows: fixtures.length * TRANSFORMS.length,
  imageCount: fixtures.length,
  itemGroupCount: new Set(fixtures.map((f) => f.group)).size,
  productionParity,
  node: process.version,
  sharpVersions: sharp.versions,
  timingCaveat:
    'Single serial quality run on a shared host. Other project experiments may execute concurrently; values do not estimate native phone latency.',
  actualProductionFiles: Object.fromEntries(
    await Promise.all(
      ['server/images.ts', 'packages/core/quality.ts'].map(async (file) => [
        file,
        sha(await readFile(resolve(root, file))),
      ]),
    ),
  ),
};
if (rows !== summary.expectedRows) throw new Error('Incomplete phase');
await writeFile(
  resolve(output, 'run.' + phase + '.' + runId + '.json'),
  JSON.stringify(summary, null, 2) + '\n',
  { flag: 'wx' },
);
if (phase === 'development') {
  thresholds = Object.fromEntries(
    METRICS.map((metric) => [
      metric,
      0.5 * Math.min(...Object.values(identities).map((value) => value[metric])),
    ]),
  ) as Record<Metric, number>;
  const calibration = {
    protocolId: PROTOCOL_ID,
    protocolSha256: protocolHash,
    frozenAt: new Date().toISOString(),
    rule: THRESHOLD_RULE,
    developmentRawFile: summary.rawFile,
    developmentRawSha256: rawSha,
    developmentFixtureIds: Object.keys(identities),
    thresholds,
    identityScores: identities,
    legacySoftThreshold: 20,
    interpretation:
      'Exploratory controlled-transformation thresholds only; not operational bad-photo cutoffs.',
  };
  await writeFile(resolve(output, 'thresholds.json'), JSON.stringify(calibration, null, 2) + '\n', {
    flag: 'wx',
  });
}
process.stdout.write(
  JSON.stringify(
    {
      phase,
      rows,
      rawFile: summary.rawFile,
      rawSha256: rawSha,
      thresholdsFrozen: phase === 'development',
    },
    null,
    2,
  ) + '\n',
);
