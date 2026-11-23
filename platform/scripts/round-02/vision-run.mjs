import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { env } from '@huggingface/transformers';
import { analyze } from './vision-analyze.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const experiment = path.join(root, 'experiments/round-02/vision');
const freezeBytes = await fs.readFile(path.join(experiment, 'freeze.json'));
const freeze = JSON.parse(freezeBytes);
for (const binding of freeze.bindings) {
  if (sha(await fs.readFile(path.join(root, binding.file))) !== binding.sha256)
    throw new Error('Frozen file changed before inference: ' + binding.file);
}
const { createLocalAdapter } =
  await import('../../experiments/round-02/vision/baseline-adapter.ts');
const cases = JSON.parse(await fs.readFile(path.join(experiment, 'cases.json'), 'utf8'));
const schedule = JSON.parse(await fs.readFile(path.join(experiment, 'schedule.json'), 'utf8'));
const caseMap = new Map(cases.map((c) => [c.id, c]));
const imageBytes = new Map();
for (const c of cases) {
  const bytes = await fs.readFile(path.join(root, c.file));
  if (sha(bytes) !== c.sha256) throw new Error('Condition bytes changed: ' + c.id);
  imageBytes.set(c.id, bytes);
}
const startedAt = new Date().toISOString();
const runDirectory =
  'benchmarks/round-02/vision/run-' + startedAt.replaceAll(':', '-').replaceAll('.', '-');
const runDir = path.join(root, runDirectory);
await fs.mkdir(runDir, { recursive: false });
const journal = await fs.open(path.join(runDir, 'trials.jsonl'), 'wx');
const adapters = {
  local_clip: createLocalAdapter('local_clip'),
  local_siglip: createLocalAdapter('local_siglip'),
};
const initialized = [];
const networkAttempts = [];
env.allowRemoteModels = false;
globalThis.fetch = async (input) => {
  networkAttempts.push(String(input));
  throw new Error(
    'Round02 inference is restricted to existing cached model files; network blocked.',
  );
};
let completed = 0,
  failures = 0;
const run = {
  schemaVersion: '1.0',
  startedAt,
  baselineCommit: freeze.baselineCommit,
  freezeSha256: sha(freezeBytes),
  runDirectory,
  sourceCode:
    'Immutable baseline snapshot with path-only relocation; target models/prompts unchanged.',
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    transformersVersion: JSON.parse(
      await fs.readFile(
        path.join(root, 'node_modules/@huggingface/transformers/package.json'),
        'utf8',
      ),
    ).version,
    sharpVersion: JSON.parse(
      await fs.readFile(path.join(root, 'node_modules/sharp/package.json'), 'utf8'),
    ).version,
    threadSettings: { intraOp: 2, interOp: 1 },
    uncontrolled:
      'Other host workloads, CPU frequency and thermal state were not controlled; timing is local only.',
  },
  initialized,
  trialsScheduled: freeze.trialCount,
  trialsCompleted: 0,
  failures: 0,
};
try {
  for (const kind of ['local_clip', 'local_siglip']) {
    const before = performance.now();
    await adapters[kind].warmup();
    const loadMs = performance.now() - before;
    const warmBefore = performance.now();
    await adapters[kind].analyze([
      {
        id: 'excluded-historical-warmup',
        view: 'front',
        jpeg: imageBytes.get('h-gloves-back--reference'),
      },
    ]);
    initialized.push({
      kind,
      loadMs,
      excludedWarmupMs: performance.now() - warmBefore,
      rssBytesAfter: process.memoryUsage().rss,
    });
    console.log('INITIALIZED ' + kind + ' cached load ' + Math.round(loadMs) + 'ms');
  }
  for (const pair of schedule.schedule) {
    const c = caseMap.get(pair.caseId);
    for (const model of pair.modelOrder) {
      const beginning = performance.now();
      const metadata = {
        sequence: completed,
        pairIndex: pair.pairIndex,
        repeat: pair.repeat,
        caseId: c.id,
        sourceId: c.sourceId,
        dataset: c.dataset,
        group: c.group,
        condition: c.condition,
        model,
        declaredView: c.declaredView,
        expectedCategory: c.expectedCategory,
        scoreCategory: c.scoreCategory,
        expectedWorkflowAbstention: c.expectedWorkflowAbstention,
        bytes: c.bytes,
        width: c.width,
        height: c.height,
        sha256: c.sha256,
      };
      let trial;
      try {
        const result = await adapters[model].evaluateForBenchmark([
          { id: c.sourceId, view: c.declaredView, jpeg: imageBytes.get(c.id) },
        ]);
        trial = {
          ...metadata,
          status: 'success',
          requestMs: performance.now() - beginning,
          observation: result.observation,
          views: result.views,
          inferenceExecuted: result.views.some((v) => v.prompts.length > 0),
          rssBytesAfter: process.memoryUsage().rss,
        };
      } catch (error) {
        failures++;
        trial = {
          ...metadata,
          status: 'failed',
          requestMs: performance.now() - beginning,
          error: { name: error?.name ?? 'Error', message: error?.message ?? String(error) },
          inferenceExecuted: false,
        };
      }
      await journal.write(JSON.stringify(trial) + '\n');
      completed++;
    }
    if (completed % 80 === 0)
      console.log(
        'PROGRESS ' + completed + '/' + freeze.trialCount + ' trials; ' + failures + ' failures',
      );
  }
  const misassignment = [];
  for (const probe of schedule.labelMisassignment)
    for (const model of ['local_clip', 'local_siglip']) {
      const start = performance.now();
      try {
        const result = await adapters[model].evaluateForBenchmark([
          { id: probe.id, view: probe.declaredView, jpeg: imageBytes.get(probe.caseId) },
        ]);
        misassignment.push({
          ...probe,
          model,
          durationMs: performance.now() - start,
          status: 'success',
          ...result,
        });
      } catch (error) {
        misassignment.push({ ...probe, model, status: 'failed', error: String(error) });
      }
    }
  await fs.writeFile(
    path.join(runDir, 'probes.json'),
    JSON.stringify(
      {
        description:
          'Actual real-label photos deliberately misdeclared as overview. Expected workflow abstention is a robustness target, not a category ground-truth label.',
        misassignment,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  run.status = 'complete';
} catch (error) {
  run.status = 'failed';
  run.error = String(error);
  throw error;
} finally {
  await journal.close();
  for (const adapter of Object.values(adapters)) await adapter.dispose().catch(() => undefined);
  run.finishedAt = new Date().toISOString();
  run.trialsCompleted = completed;
  run.failures = failures;
  run.networkAttempts = networkAttempts;
  run.boundFileChangesDuringRun = [];
  for (const binding of freeze.bindings) {
    const current = sha(await fs.readFile(path.join(root, binding.file)));
    if (current !== binding.sha256)
      run.boundFileChangesDuringRun.push({
        file: binding.file,
        expected: binding.sha256,
        actual: current,
      });
  }
  await fs.writeFile(path.join(runDir, 'run.json'), JSON.stringify(run, null, 2) + '\n', {
    flag: 'wx',
  });
}
await analyze(runDirectory);
console.log('ROUND02_COMPLETE ' + runDirectory);
