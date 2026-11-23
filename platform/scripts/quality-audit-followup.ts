import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { AnalysisResponseSchema, SCHEMA_VERSION } from '../packages/core/schema';
const labels = JSON.parse(await fs.readFile('datasets/quality-audit-01/labels.json', 'utf8'));
const cases = [
  { id: 'sample-01', file: 'assets/fixtures/round-03/sample-01.webp', kind: 'original-regression' },
  { id: 'sample-02', file: 'assets/fixtures/round-03/sample-02.jpg', kind: 'original-regression' },
  { id: 'sample-03', file: 'assets/fixtures/round-03/sample-03.jpg', kind: 'original-regression' },
  ...['fabric-068', 'leather-008', 'fabric-018'].map((id) => ({
    id,
    file: labels.cases.find((c: any) => c.id === id).file,
    kind: 'latency-repeat',
  })),
];
const url = 'http://127.0.0.1:8790',
  health = await (await fetch(url + '/health')).json();
assert.equal(health.externalProvider, false);
assert.equal(health.provider, 'local_vlm');
const rows: any[] = [];
for (const c of cases) {
  let cleared: any;
  for (let i = 0; i < 40; i++) {
    cleared = await (await fetch(url + '/session', { method: 'DELETE' })).json();
    if (cleared.inFlight === 0) break;
    await delay(2000);
  }
  assert.equal(cleared.inFlight, 0);
  const bytes = await fs.readFile(c.file);
  const start = performance.now();
  let row: any = {
    id: c.id,
    kind: c.kind,
    sourceSha256: createHash('sha256').update(bytes).digest('hex'),
  };
  try {
    const response = await fetch(url + '/assess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        assessmentId: 'audit-followup-' + c.id,
        disclosures: [],
        corrections: [],
        images: [{ id: 'photo', view: 'front', base64: bytes.toString('base64') }],
        consent: {
          processImages: true,
          externalProvider: false,
          expectedProvider: health.provider,
          expectedModel: health.model,
        },
      }),
      signal: AbortSignal.timeout(65000),
    });
    if (!response.ok) throw Error('HTTP ' + response.status);
    const result = AnalysisResponseSchema.parse(await response.json());
    const findings = result.observation?.inspection?.photos.flatMap((p) => p.findings) ?? [];
    row = {
      ...row,
      result,
      findings: findings.length,
      expectedDefectDetected:
        c.kind === 'original-regression'
          ? findings.some((f) => ['abrasion', 'tear', 'seam'].includes(f.kind))
          : null,
    };
  } catch (e: any) {
    row = { ...row, error: { name: e.name, message: e.message, causeCode: e.cause?.code } };
  }
  row.elapsedMs = performance.now() - start;
  rows.push(row);
  console.log(
    JSON.stringify({
      id: row.id,
      kind: row.kind,
      ms: Math.round(row.elapsedMs),
      detected: row.expectedDefectDetected,
      error: row.error,
    }),
  );
}
await fs.writeFile(
  'benchmarks/quality-audit-01/followup.json',
  JSON.stringify(
    {
      at: new Date().toISOString(),
      health,
      scope:
        'Three original diagnostic photos plus three latency repeats after the corpus. App and image-result caches cleared before each case. These are follow-ups, never substitutes for the frozen first-corpus run; no phone-performance claim.',
      rows,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
