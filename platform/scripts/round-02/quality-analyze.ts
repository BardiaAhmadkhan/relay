import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { METRICS, PRIMARY_HEAVY_BLUR, type Metric, type Transform } from './quality-protocol';
import type { Measurements } from './quality-metrics';
const root = resolve(import.meta.dirname, '../..'),
  dir = resolve(root, 'benchmarks/round-02/quality');
const calibration = JSON.parse(await readFile(resolve(dir, 'thresholds.json'), 'utf8')) as {
  thresholds: Record<Metric, number>;
  frozenAt: string;
  protocolSha256: string;
  developmentRawFile: string;
};
interface Row {
  phase: string;
  fixtureId: string;
  group: string;
  transform: Transform;
  artifactSha256: string;
  pipelines: Record<string, Measurements>;
  decoderComparison: {
    meanAbsoluteByteDifference: number;
    warningsAgree: boolean;
    sharpnessDelta: number;
    brightnessDelta: number;
  };
}
const runFiles = (await readdir(dir)).filter((f) => /^run\.(development|evaluation)\./.test(f));
const runs = await Promise.all(
  runFiles.map(async (file) => JSON.parse(await readFile(resolve(dir, file), 'utf8'))),
);
const selected = runs.filter((r) =>
  r.phase === 'development'
    ? r.rawFile === calibration.developmentRawFile
    : r.protocolSha256 === calibration.protocolSha256 && r.startedAt >= calibration.frozenAt,
);
if (
  selected.filter((r) => r.phase === 'development').length !== 1 ||
  selected.filter((r) => r.phase === 'evaluation').length !== 1
)
  throw new Error('Select exactly one frozen development and one evaluation run');
const rows: Row[] = [];
for (const run of selected) {
  const text = await readFile(resolve(root, run.rawFile), 'utf8');
  if (createHash('sha256').update(text).digest('hex') !== run.rawSha256)
    throw new Error('Raw measurement hash mismatch');
  rows.push(
    ...text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)),
  );
}
if (
  rows.length !== 192 ||
  new Set(rows.map((r) => r.fixtureId + '|' + r.transform.id)).size !== 192
)
  throw new Error('Incomplete or duplicated matrix');
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i]! : (sorted[i - 1]! + sorted[i]!) / 2;
};
const rate = (numerator: number, denominator: number) => ({
  numerator,
  denominator,
  fraction: denominator ? numerator / denominator : null,
});
const pipelines = ['server_direct', 'mobile_proxy', 'server_after_mobile'];
const candidates = [
  { id: 'legacy_soft20', metric: 'laplacian192' as Metric, threshold: 20 },
  ...METRICS.map((metric) => ({
    id: 'dev_half_min_' + metric,
    metric,
    threshold: calibration.thresholds[metric],
  })),
];
const comparisons = [];
for (const split of ['development', 'evaluation', 'all'])
  for (const pipeline of pipelines)
    for (const candidate of candidates) {
      const subset = rows.filter((r) => split === 'all' || r.phase === split);
      const controls = subset.filter((r) => r.transform.family === 'identity');
      const heavy = subset.filter(
        (r) =>
          r.transform.family === 'blur' && PRIMARY_HEAVY_BLUR.includes(r.transform.sigma as 4 | 8),
      );
      const rotations = subset.filter((r) => r.transform.family === 'rotation');
      const flags = (r: Row) =>
        r.pipelines[pipeline]!.metrics[candidate.metric] < candidate.threshold;
      const controlMap = new Map(controls.map((r) => [r.fixtureId, r]));
      let rankWins = 0;
      for (const p of heavy)
        for (const n of controls) {
          const a = p.pipelines[pipeline]!.metrics[candidate.metric],
            b = n.pipelines[pipeline]!.metrics[candidate.metric];
          if (a < b) rankWins++;
          else if (a === b) rankWins += 0.5;
        }
      let ordered = 0,
        strict = 0,
        steps = 0;
      for (const control of controls) {
        const sequence = [
          control,
          ...subset
            .filter((r) => r.fixtureId === control.fixtureId && r.transform.family === 'blur')
            .sort(
              (a, b) =>
                (a.transform as { sigma: number }).sigma - (b.transform as { sigma: number }).sigma,
            ),
        ];
        for (let i = 1; i < sequence.length; i++) {
          const previous = sequence[i - 1]!.pipelines[pipeline]!.metrics[candidate.metric],
            current = sequence[i]!.pipelines[pipeline]!.metrics[candidate.metric];
          if (current <= previous + 1e-12) ordered++;
          if (current < previous - 1e-12) strict++;
          steps++;
        }
      }
      const halfGain = subset.filter(
        (r) => r.transform.family === 'gain' && r.transform.gain === 0.5,
      );
      const groupRates = [...new Set(heavy.map((r) => r.group))].map((group) => {
        const items = heavy.filter((r) => r.group === group);
        return { group, ...rate(items.filter(flags).length, items.length) };
      });
      comparisons.push({
        split,
        pipeline,
        candidate: candidate.id,
        metric: candidate.metric,
        threshold: candidate.threshold,
        images: controls.length,
        groups: new Set(controls.map((r) => r.group)).size,
        identityWarnings: rate(controls.filter(flags).length, controls.length),
        heavySyntheticBlurWarnings: rate(heavy.filter(flags).length, heavy.length),
        syntheticRankSeparationAuc:
          heavy.length * controls.length ? rankWins / (heavy.length * controls.length) : null,
        newWarningsOnBenignRotation: rate(
          rotations.filter((r) => flags(r) && !flags(controlMap.get(r.fixtureId)!)).length,
          rotations.length,
        ),
        nonincreasingBlurSteps: rate(ordered, steps),
        strictlyDecreasingBlurSteps: rate(strict, steps),
        halfGainMedianAbsoluteRelativeDrift: median(
          halfGain.map((r) =>
            Math.abs(
              r.pipelines[pipeline]!.metrics[candidate.metric] /
                controlMap.get(r.fixtureId)!.pipelines[pipeline]!.metrics[candidate.metric] -
                1,
            ),
          ),
        ),
        groupHeavyBlurWarnings: groupRates,
        groupMacroHeavyBlurRate:
          groupRates.reduce((sum, r) => sum + (r.fraction ?? 0), 0) / groupRates.length,
      });
    }
const blocking = (warnings: string[]) =>
  warnings
    .filter((w) => w !== 'soft')
    .sort()
    .join('|');
const warningParity = [];
for (const split of ['development', 'evaluation', 'all']) {
  const subset = rows.filter((r) => split === 'all' || r.phase === split);
  const mismatches = subset.filter(
    (r) =>
      JSON.stringify(r.pipelines.mobile_proxy!.quality.warnings) !==
      JSON.stringify(r.pipelines.server_after_mobile!.quality.warnings),
  );
  const blockingMismatches = subset.filter(
    (r) =>
      blocking(r.pipelines.mobile_proxy!.quality.warnings) !==
      blocking(r.pipelines.server_after_mobile!.quality.warnings),
  );
  warningParity.push({
    split,
    total: subset.length,
    anyWarningDisagreements: mismatches.length,
    blockingWarningDisagreements: blockingMismatches.length,
    mismatches: mismatches.map((r) => ({
      fixtureId: r.fixtureId,
      group: r.group,
      transform: r.transform.id,
      mobile: r.pipelines.mobile_proxy!.quality,
      serverAfterMobile: r.pipelines.server_after_mobile!.quality,
    })),
    medianAbsoluteBrightnessDelta: median(
      subset.map((r) =>
        Math.abs(
          r.pipelines.mobile_proxy!.quality.brightness -
            r.pipelines.server_after_mobile!.quality.brightness,
        ),
      ),
    ),
    medianAbsoluteSharpnessDelta: median(
      subset.map((r) =>
        Math.abs(
          r.pipelines.mobile_proxy!.quality.sharpness -
            r.pipelines.server_after_mobile!.quality.sharpness,
        ),
      ),
    ),
    maximumAbsoluteSharpnessDelta: Math.max(
      ...subset.map((r) =>
        Math.abs(
          r.pipelines.mobile_proxy!.quality.sharpness -
            r.pipelines.server_after_mobile!.quality.sharpness,
        ),
      ),
    ),
    jpegDecoderWarningDisagreements: subset.filter((r) => !r.decoderComparison.warningsAgree)
      .length,
    medianJpegDecoderByteDifference: median(
      subset.map((r) => r.decoderComparison.meanAbsoluteByteDifference),
    ),
  });
}
const warningBreakdown = [];
for (const split of ['development', 'evaluation', 'all'])
  for (const pipeline of pipelines)
    for (const family of ['identity', 'blur', 'gain', 'resolution', 'rotation', 'jpeg']) {
      const selected = rows.filter(
        (r) => (split === 'all' || r.phase === split) && r.transform.family === family,
      );
      warningBreakdown.push({
        split,
        pipeline,
        family,
        count: selected.length,
        warnings: Object.fromEntries(
          ['soft', 'dark', 'bright', 'low_resolution'].map((warning) => [
            warning,
            selected.filter((r) =>
              r.pipelines[pipeline]!.quality.warnings.includes(warning as 'soft'),
            ).length,
          ]),
        ),
      });
    }
const timing = pipelines.map((pipeline) => ({
  pipeline,
  observations: rows.length,
  medianPreprocessMs: median(rows.map((r) => r.pipelines[pipeline]!.preprocessDurationMs)),
  medianCandidateMetricMs: median(rows.map((r) => r.pipelines[pipeline]!.metricDurationMs)),
  limitation:
    'Shared-host observations; not a controlled latency comparison or a native device benchmark.',
}));
const summary = {
  schemaVersion: '1.0',
  protocolSha256: calibration.protocolSha256,
  generatedAt: new Date().toISOString(),
  rawRuns: selected.map((r) => ({
    phase: r.phase,
    file: r.rawFile,
    sha256: r.rawSha256,
    rows: r.rows,
    groups: r.itemGroupCount,
  })),
  counts: {
    images: 8,
    independentItemGroups: 7,
    transformsPerImage: 24,
    variants: 192,
    pipelineMeasurements: 576,
    developmentImages: 3,
    developmentGroups: 3,
    evaluationImages: 5,
    evaluationGroups: 4,
  },
  productionBaselineAgreement: selected.flatMap((r) => r.productionParity),
  thresholds: calibration,
  comparisons,
  warningParity,
  warningBreakdown,
  timing,
  limits: [
    'No rider photo-utility annotations or condition/protective-performance labels.',
    'Gaussian sigma labels establish controlled transformation severity, not real poor-photo sensitivity.',
    'Identity sources are not verified good photos; their warnings cannot be called real-world false positives.',
    'Rotation new-warning rate is a stipulated benign-transformation false-warning proxy only.',
    'Five evaluation images represent four items; the two glove views are correlated.',
    'The preregistered random group split contains no evaluation jacket; do not deploy a jacket threshold based on these results.',
    'No parameter or threshold revised after evaluation; normalized candidate formulas remain exploratory.',
    'The mobile path is a Sharp/jpeg-js proxy, not iOS/Android Expo execution.',
  ],
};
await writeFile(resolve(dir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', {
  flag: 'wx',
});
process.stdout.write(
  JSON.stringify(
    {
      counts: summary.counts,
      evaluationServerCandidates: comparisons.filter(
        (c) => c.split === 'evaluation' && c.pipeline === 'server_direct',
      ),
      warningParity: warningParity.map((p) => ({
        split: p.split,
        total: p.total,
        anyWarningDisagreements: p.anyWarningDisagreements,
        blockingWarningDisagreements: p.blockingWarningDisagreements,
        jpegDecoderWarningDisagreements: p.jpegDecoderWarningDisagreements,
      })),
      productionBaselineAgreement: summary.productionBaselineAgreement.every(
        (r: { sameQuality: boolean; sameEncodedJpeg: boolean }) =>
          r.sameQuality && r.sameEncodedJpeg,
      ),
    },
    null,
    2,
  ) + '\n',
);
