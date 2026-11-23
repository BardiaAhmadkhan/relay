import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  createLocalAdapter,
  MODEL_SPECS,
  PROMPT_TEMPLATES,
  LABELS,
  type LocalKind,
} from '../packages/vision/local.js';
import type { Category, VisionImage } from '../packages/core/schema.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifestBytes = await fs.readFile(path.join(root, 'assets/fixtures/manifest.json'));
const manifest = JSON.parse(manifestBytes.toString()) as {
  fixtures: Array<{
    id: string;
    file: string;
    group: string;
    category: Category;
    scoreCategory: boolean;
    sha256: string;
    notes: string;
  }>;
};
const fixtures = await Promise.all(
  manifest.fixtures.map(async (fixture) => {
    const jpeg = await fs.readFile(path.join(root, fixture.file));
    if (createHash('sha256').update(jpeg).digest('hex') !== fixture.sha256)
      throw new Error('Fixture integrity failed: ' + fixture.id);
    return { ...fixture, jpeg };
  }),
);
const output = path.join(root, 'benchmarks');
await fs.mkdir(output, { recursive: true });
const startedAt = new Date().toISOString();
const runs: unknown[] = [];
const summaries: unknown[] = [];
for (const kind of ['local_clip', 'local_siglip'] as LocalKind[]) {
  const adapter = createLocalAdapter(kind);
  const loadStart = performance.now();
  let loaded = false;
  let loadMs = 0;
  const durations: number[] = [];
  const firstPass: Array<{
    id: string;
    group: string;
    expected: Category;
    predicted: Category;
    scored: boolean;
    correct: boolean;
  }> = [];
  try {
    await adapter.warmup();
    loadMs = performance.now() - loadStart;
    loaded = true;
    console.log(kind + ' model ready in ' + Math.round(loadMs) + 'ms');
    for (let repeat = 0; repeat < 2; repeat++) {
      for (const fixture of fixtures) {
        const trialStart = performance.now();
        try {
          // Treat every corpus image as an overview for this deliberately difficult category experiment.
          // The actual app excludes label views and requires an overview before returning a category.
          const result = await adapter.evaluateForBenchmark([
            { id: fixture.id, view: 'front', jpeg: fixture.jpeg },
          ]);
          const elapsed = performance.now() - trialStart;
          durations.push(elapsed);
          runs.push({
            kind,
            repeat,
            fixtureId: fixture.id,
            itemGroup: fixture.group,
            expectedCategory: fixture.category,
            scoreCategory: fixture.scoreCategory,
            durationMs: elapsed,
            rssBytesAfter: process.memoryUsage().rss,
            observation: result.observation,
            views: result.views,
          });
          if (repeat === 0)
            firstPass.push({
              id: fixture.id,
              group: fixture.group,
              expected: fixture.category,
              predicted: result.observation.category,
              scored: fixture.scoreCategory,
              correct: result.observation.category === fixture.category,
            });
          console.log(
            kind +
              ' #' +
              repeat +
              ' ' +
              fixture.id +
              ' -> ' +
              result.observation.category +
              ' (' +
              Math.round(elapsed) +
              'ms)',
          );
        } catch (error) {
          runs.push({
            kind,
            repeat,
            fixtureId: fixture.id,
            error: error instanceof Error ? error.message : String(error),
            durationMs: performance.now() - trialStart,
          });
          console.log(kind + ' ' + fixture.id + ' FAILED');
        }
      }
    }
    const byGroup = new Map<string, boolean[]>();
    for (const row of firstPass.filter((row) => row.scored)) {
      const previous = byGroup.get(row.group) ?? [];
      previous.push(row.correct);
      byGroup.set(row.group, previous);
    }
    const sorted = [...durations].sort((a, b) => a - b);
    const median = sorted.length
      ? (sorted[Math.floor((sorted.length - 1) / 2)]! +
          sorted[Math.ceil((sorted.length - 1) / 2)]!) /
        2
      : null;
    const labelOnly = await adapter.analyze([
      { id: 'label-only', view: 'label', jpeg: fixtures[0]!.jpeg },
    ]);
    const aborted = new AbortController();
    aborted.abort();
    let cancellationRejected = false;
    try {
      await adapter.analyze(
        [{ id: 'aborted', view: 'front', jpeg: fixtures[0]!.jpeg }],
        aborted.signal,
      );
    } catch {
      cancellationRejected = true;
    }
    const jacket = fixtures.find((f) => f.id === 'leather-jacket')!;
    const boot = fixtures.find((f) => f.id === 'racing-boot')!;
    const conflicting = await adapter.analyze([
      { id: 'jacket-front', view: 'front', jpeg: jacket.jpeg },
      { id: 'boot-back', view: 'back', jpeg: boot.jpeg },
    ]);
    summaries.push({
      kind,
      model: adapter.model,
      modelLoadMs: loadMs,
      warmRequests: durations.length,
      medianMs: median,
      p95NearestRankMs: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null,
      firstPass,
      scoredImages: firstPass.filter((r) => r.scored).length,
      correctScoredImages: firstPass.filter((r) => r.scored && r.correct).length,
      scoredItemGroups: byGroup.size,
      allViewsCorrectItemGroups: [...byGroup.values()].filter((values) => values.every(Boolean))
        .length,
      sanity: {
        labelOnlyUnknown: labelOnly.category === 'unknown',
        labelOnlyHasNoFindings:
          labelOnly.attributes.length === 0 && labelOnly.concerns.length === 0,
        cancellationRejected,
        conflictingOverviewCategory: conflicting.category,
        conflictingOverviewUnknown: conflicting.category === 'unknown',
      },
    });
  } catch (error) {
    summaries.push({
      kind,
      loaded,
      modelLoadMs: performance.now() - loadStart,
      error: error instanceof Error ? error.message : String(error),
    });
    console.log(kind + ' load FAILED: ' + String(error));
  } finally {
    await adapter.dispose().catch(() => undefined);
  }
}
const cacheFiles: Array<{ file: string; bytes: number; sha256: string }> = [];
async function walk(directory: string): Promise<void> {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full);
    else {
      const bytes = await fs.readFile(full);
      cacheFiles.push({
        file: path.relative(root, full).replaceAll('\\', '/'),
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
}
await walk(path.join(root, '.cache', 'models'));
const result = {
  schemaVersion: '1.0',
  startedAt,
  finishedAt: new Date().toISOString(),
  experiment:
    'Pinned q8 category models; two fixed wording templates; two warm repetitions; no training or hosted inference.',
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    cpuModel: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    transformersVersion: JSON.parse(
      await fs.readFile(
        path.join(root, 'node_modules/@huggingface/transformers/package.json'),
        'utf8',
      ),
    ).version,
    intraOpNumThreads: 2,
    interOpNumThreads: 1,
  },
  interpretation:
    'Convenience smoke corpus only. Category references are source-based weak labels. Repeated views and repetitions are not independent accuracy samples. No condition/safety accuracy, calibration or unseen generalization claim.',
  fixtureManifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
  models: MODEL_SPECS,
  labels: LABELS,
  promptTemplates: PROMPT_TEMPLATES,
  scoreSemantics:
    'CLIP candidate-relative softmax and SigLIP independent sigmoid; never compare numeric scores as calibrated confidence.',
  aggregateRule:
    'A view requires prompt-template top-category agreement; all non-label views must agree and at least one overview must exist. Otherwise unknown. Uniform decoded frames are rejected by a narrow pixel-variance heuristic.',
  percentileMethod: 'nearest rank ceil(n*0.95); small n is descriptive only',
  summaries,
  runs,
  cacheFiles,
};
const filename = 'vision-' + startedAt.replaceAll(':', '-').replaceAll('.', '-') + '.json';
await fs.writeFile(path.join(output, filename), JSON.stringify(result, null, 2) + '\n');
await fs.writeFile(path.join(output, 'vision-latest.json'), JSON.stringify(result, null, 2) + '\n');
console.log('BENCHMARK_WRITTEN ' + filename);
console.log(JSON.stringify(summaries, null, 2));
