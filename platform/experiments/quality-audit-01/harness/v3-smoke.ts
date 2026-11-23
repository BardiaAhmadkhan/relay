import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { AnalysisResponseSchema, SCHEMA_VERSION } from '../packages/core/schema';
import { validateFindings } from '../packages/vision/validation';
const dataset = JSON.parse(await fs.readFile('datasets/quality-audit-01/labels.json', 'utf8'));
const protocol = JSON.parse(
  await fs.readFile('experiments/quality-audit-01/protocol.json', 'utf8'),
);
const url = 'http://127.0.0.1:8790';
async function checkSources() {
  for (const s of protocol.baseline)
    assert.equal(
      createHash('sha256')
        .update(await fs.readFile(s.path))
        .digest('hex'),
      s.sha256,
      'Baseline changed: ' + s.path,
    );
}
await checkSources();
const health = await (await fetch(url + '/health')).json();
assert.equal(health.provider, 'local_vlm');
assert.equal(health.externalProvider, false);
assert.equal(health.model, 'qwen3.5:4b@d8b0f5e9760c/photo-evidence-2+low-detail-cue-1');
const warmed = await fetch('http://127.0.0.1:11435/api/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'qwen3.5:4b', stream: false, keep_alive: '30m' }),
  signal: AbortSignal.timeout(120000),
});
assert(warmed.ok, 'Warmup failed');
await warmed.json();
let cleared: any;
for (let i = 0; i < 40; i++) {
  cleared = await (await fetch(url + '/session', { method: 'DELETE' })).json();
  if (cleared.inFlight === 0) break;
  await delay(2000);
}
assert.equal(cleared.inFlight, 0, 'Prior requests did not drain');
const runName = process.argv[2] ?? 'full';
assert(/^[a-z0-9-]+$/.test(runName), 'Invalid run name');
const limit = Number(process.argv[3] ?? dataset.cases.length);
assert(Number.isInteger(limit) && limit > 0 && limit <= dataset.cases.length);
const runBase = 'benchmarks/quality-audit-01/evaluation-' + runName;
const output = runBase + '.jsonl';
await fs.writeFile(output, '', { flag: 'wx' });
const startedAt = new Date().toISOString();
await fs.writeFile(
  runBase + '-run.json',
  JSON.stringify(
    {
      startedAt,
      health,
      datasetSha256: createHash('sha256')
        .update(await fs.readFile('datasets/quality-audit-01/labels.json'))
        .digest('hex'),
      runnerSha256: createHash('sha256')
        .update(await fs.readFile('scripts/quality-audit-run-v3.ts'))
        .digest('hex'),
      warmup: true,
      scope:
        'Unchanged HTTP preprocessing/model/policy. One source image per assessment, no labels/source titles passed to inference. All request attempts retained. Retry only the same image after a transport disconnect or busy response, respecting Retry-After, until a result or 75s deadline. Report first-request failures separately from eventual visual outputs. Never substitute retries for first-attempt reliability.',
      earlierDiagnostic: 'cold-start-interruption.json',
      order: 'Same deterministic hashed interleave as original attempted run',
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
const order = [...dataset.cases].sort((a, b) =>
  createHash('sha256')
    .update('audit-order:' + a.id)
    .digest('hex')
    .localeCompare(
      createHash('sha256')
        .update('audit-order:' + b.id)
        .digest('hex'),
    ),
);
const rows: any[] = [];
for (const [index, c] of order.slice(0, limit).entries()) {
  const bytes = await fs.readFile(c.file);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), c.sha256);
  const body = JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    assessmentId: 'audit02-' + c.id,
    disclosures: [],
    corrections: [],
    images: [{ id: 'photo', view: c.view, base64: bytes.toString('base64') }],
    consent: {
      processImages: true,
      externalProvider: false,
      expectedProvider: health.provider,
      expectedModel: health.model,
    },
  });
  const start = performance.now();
  const attempts: any[] = [];
  let result: any = null;
  let finalError: any = null;
  while (performance.now() - start < 75000 && attempts.length < 12) {
    const attemptedAt = new Date().toISOString(),
      requestStart = performance.now();
    let waitMs = 2200;
    try {
      const response = await fetch(url + '/assess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(Math.ceil(Math.max(1000, 75000 - (performance.now() - start)))),
      });
      const raw = await response.json();
      if (!response.ok) {
        finalError = raw.error ?? { code: 'http_error' };
        attempts.push({
          attemptedAt,
          ms: performance.now() - requestStart,
          httpStatus: response.status,
          error: finalError,
        });
        if (response.status !== 429) break;
        waitMs = Math.max(2200, Number(response.headers.get('retry-after') ?? 2) * 1000);
      } else {
        result = AnalysisResponseSchema.parse(raw);
        assert.equal(result.assessmentId, 'audit02-' + c.id);
        assert.equal(result.status, 'complete');
        assert.equal(result.photos.length, 1);
        assert.equal(result.photos[0].id, 'photo');
        assert.equal(result.photos[0].view, c.view);
        assert.equal(result.decision.offerRecommended, false);
        assert.equal(result.decision.protectivePerformanceCertified, false);
        if (result.observation) {
          assert.equal(result.observation.provider, health.provider);
          assert.equal(result.observation.model, health.model);
          validateFindings(result.observation, new Set(['photo']));
        }
        attempts.push({
          attemptedAt,
          ms: performance.now() - requestStart,
          httpStatus: response.status,
        });
        finalError = null;
        break;
      }
    } catch (error: any) {
      if (error?.name === 'RangeError' || error?.name === 'ReferenceError') throw error;
      finalError = {
        code: error?.name ?? 'unknown_error',
        message: String(error?.message ?? error),
        causeCode: error?.cause?.code ?? null,
      };
      attempts.push({ attemptedAt, ms: performance.now() - requestStart, error: finalError });
      if (error?.name !== 'TypeError') break;
    }
    if (performance.now() - start + waitMs >= 75000) break;
    await delay(waitMs);
  }
  const row: any = {
    id: c.id,
    domain: c.domain,
    group: c.group,
    condition: c.condition,
    expectedKinds: c.expectedKinds,
    sourceSha256: c.sha256,
    startedAt: attempts[0]?.attemptedAt,
    elapsedMs: performance.now() - start,
    attempts,
    firstAttemptFailed: !!attempts[0]?.error,
    recoveredAfterRetry: !!result && attempts.length > 1,
  };
  if (result) {
    const findings = result.observation?.inspection?.photos.flatMap((p: any) => p.findings) ?? [];
    const flag = findings.length > 0;
    row.outcome =
      c.condition === 'visible_defect'
        ? flag
          ? 'detected'
          : 'miss'
        : c.condition === 'no_visible_defect'
          ? flag
            ? 'false_flag'
            : 'correct_negative'
          : c.condition === 'ambiguous'
            ? flag
              ? 'ambiguous_flagged'
              : 'ambiguous_unflagged'
            : flag
              ? 'unassessable_flagged'
              : 'unassessable_unflagged';
    row.flag = flag;
    row.findingCount = findings.length;
    row.expectedKindMatched =
      flag && c.expectedKinds.length
        ? findings.some((f: any) => c.expectedKinds.includes(f.kind))
        : null;
    row.inventedGarmentAnatomy =
      c.anatomy === 'none' && findings.some((f: any) => f.zone !== 'unknown');
    row.result = result;
  } else row.error = finalError ?? { code: 'no_completed_result' };
  rows.push(row);
  await fs.appendFile(output, JSON.stringify(row) + '\n');
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const k = r.error ? 'processing_error' : r.outcome;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  await fs.writeFile(
    runBase + '-progress.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        completed: rows.length,
        total: order.length,
        last: row.id,
        firstAttemptFailures: rows.filter((r) => r.firstAttemptFailed).length,
        counts,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify({
      n: index + 1,
      total: order.length,
      id: c.id,
      outcome: row.error ? 'processing_error' : row.outcome,
      ms: Math.round(row.elapsedMs),
      attempts: attempts.length,
    }),
  );
}
await checkSources();
await fs.writeFile(
  runBase + '.json',
  JSON.stringify(
    {
      startedAt,
      completedAt: new Date().toISOString(),
      health,
      datasetSha256: createHash('sha256')
        .update(await fs.readFile('datasets/quality-audit-01/labels.json'))
        .digest('hex'),
      rows,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log('Completed full corpus; all attempts retained.');
