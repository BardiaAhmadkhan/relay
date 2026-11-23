import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AnalysisResponseSchema, SCHEMA_VERSION } from '../packages/core/schema';
import { validateFindings } from '../packages/vision/validation';
const dataset = JSON.parse(await fs.readFile('datasets/quality-audit-01/labels.json', 'utf8'));
const protocol = JSON.parse(
  await fs.readFile('experiments/quality-audit-01/protocol.json', 'utf8'),
);
for (const source of protocol.baseline)
  assert.equal(
    createHash('sha256')
      .update(await fs.readFile(source.path))
      .digest('hex'),
    source.sha256,
    'Baseline changed: ' + source.path,
  );
const url = 'http://127.0.0.1:8790';
const health = await (await fetch(url + '/health')).json();
assert.equal(health.provider, 'local_vlm');
assert.equal(health.externalProvider, false);
assert.equal(health.model, 'qwen3.5:4b@d8b0f5e9760c/photo-evidence-2+low-detail-cue-1');
const path = 'benchmarks/quality-audit-01/first-pass.jsonl';
await fs.writeFile(path, '', { flag: 'wx' });
const startedAt = new Date().toISOString();
await fs.writeFile(
  'benchmarks/quality-audit-01/run.json',
  JSON.stringify(
    {
      startedAt,
      health,
      datasetSha256: createHash('sha256')
        .update(await fs.readFile('datasets/quality-audit-01/labels.json'))
        .digest('hex'),
      runnerSha256: createHash('sha256')
        .update(await fs.readFile('scripts/quality-audit-run.ts'))
        .digest('hex'),
      scope:
        'Actual HTTP endpoint, full unchanged preprocessing/policy/inspection. One image per assessment. No expected label, filename, source description, box or condition is sent to inference. No retry replaces a first-pass result.',
      order: 'Deterministic hashed interleave of domains/source groups; each original image once.',
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
for (const [index, c] of order.entries()) {
  const bytes = await fs.readFile(c.file);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), c.sha256);
  const start = performance.now();
  let row: any = {
    id: c.id,
    domain: c.domain,
    group: c.group,
    condition: c.condition,
    expectedKinds: c.expectedKinds,
    sourceSha256: c.sha256,
    startedAt: new Date().toISOString(),
  };
  try {
    const response = await fetch(url + '/assess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        assessmentId: 'audit01-' + c.id,
        disclosures: [],
        corrections: [],
        images: [{ id: 'photo', view: c.view, base64: bytes.toString('base64') }],
        consent: {
          processImages: true,
          externalProvider: false,
          expectedProvider: health.provider,
          expectedModel: health.model,
        },
      }),
      signal: AbortSignal.timeout(65000),
    });
    const raw = await response.json();
    if (!response.ok) {
      row = { ...row, httpStatus: response.status, error: raw.error ?? { code: 'http_error' } };
    } else {
      const result = AnalysisResponseSchema.parse(raw);
      assert.equal(result.assessmentId, 'audit01-' + c.id);
      assert.equal(result.status, 'complete');
      assert.equal(result.photos.length, 1);
      assert.equal(result.photos[0]!.id, 'photo');
      assert.equal(result.photos[0]!.view, c.view);
      assert.equal(result.decision.offerRecommended, false);
      assert.equal(result.decision.protectivePerformanceCertified, false);
      if (result.observation) {
        assert.equal(result.observation.provider, health.provider);
        assert.equal(result.observation.model, health.model);
        validateFindings(result.observation, new Set(['photo']));
      }
      const findings = result.observation?.inspection?.photos.flatMap((p) => p.findings) ?? [];
      const flag = findings.length > 0;
      const outcome =
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
      row = {
        ...row,
        httpStatus: response.status,
        outcome,
        flag,
        findingCount: findings.length,
        expectedKindMatched:
          flag && c.expectedKinds.length
            ? findings.some((f) => c.expectedKinds.includes(f.kind))
            : null,
        inventedGarmentAnatomy: c.anatomy === 'none' && findings.some((f) => f.zone !== 'unknown'),
        result,
      };
    }
  } catch (error) {
    row = {
      ...row,
      error: {
        code: error instanceof Error ? error.name : 'unknown_error',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
  row.elapsedMs = performance.now() - start;
  rows.push(row);
  await fs.appendFile(path, JSON.stringify(row) + '\n');
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const k = r.error ? 'processing_error' : r.outcome;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  await fs.writeFile(
    'benchmarks/quality-audit-01/progress.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        completed: rows.length,
        total: order.length,
        last: row.id,
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
      findings: row.findingCount,
    }),
  );
  if (row.error) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}
for (const source of protocol.baseline)
  assert.equal(
    createHash('sha256')
      .update(await fs.readFile(source.path))
      .digest('hex'),
    source.sha256,
    'Baseline changed during run',
  );
await fs.writeFile(
  'benchmarks/quality-audit-01/first-pass.json',
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
console.log('Completed unchanged-system audit.');
