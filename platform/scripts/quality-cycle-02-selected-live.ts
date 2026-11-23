import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { AnalysisResponseSchema, SCHEMA_VERSION } from '../packages/core/schema';
import { validateFindings } from '../packages/vision/validation';
const url = 'http://127.0.0.1:8790',
  path = 'benchmarks/quality-cycle-02/selected-live-http.jsonl';
const labels = JSON.parse(await fs.readFile('datasets/quality-audit-01/labels.json', 'utf8')).cases;
const hard = JSON.parse(
  await fs.readFile('experiments/round-05/hard-case-protocol.json', 'utf8'),
).cases;
const ids = [
  'commons-035',
  'commons-065',
  'commons-066',
  'commons-099',
  'commons-087',
  'commons-090',
  'fabric-049',
  'fabric-069',
];
const cases = ids.map((id) => ({
  ...labels.find((c: any) => c.id === id),
  expectedFlag: ['commons-087', 'commons-090', 'fabric-049', 'fabric-069'].includes(id),
}));
for (const id of [
  'sample-01--reference',
  'sample-02--reference',
  'sample-03--reference',
  'sample-01--small320',
  'source-crash--small320',
  'denim--small240-jpeg60',
  'biker-black--small240-jpeg60',
]) {
  const c = hard.find((c: any) => c.id === id);
  cases.push({
    id,
    file: c.inputFile,
    view: 'front',
    expectedFlag:
      id.startsWith('user-') || id.startsWith('source-crash') || id.startsWith('biker-black'),
  });
}
await fs.writeFile(path, '', { flag: 'wx' });
const health = await (await fetch(url + '/health')).json();
assert(health.model.endsWith('+review-index-1+focused-tear-context-2'));
assert.equal(health.externalProvider, false);
async function call(id: string, items: any[], expectedFlags?: boolean[]) {
  const before = (
    await fs.readFile('benchmarks/quality-cycle-02/canary-selected-calls.jsonl', 'utf8')
  )
    .trim()
    .split('\n')
    .filter(Boolean).length;
  const request = {
    schemaVersion: SCHEMA_VERSION,
    assessmentId: 'cycle02-' + id,
    disclosures: [],
    corrections: [],
    images: await Promise.all(
      items.map(async (c, i) => ({
        id: 'photo-' + i,
        view: c.view,
        base64: (await fs.readFile(c.file)).toString('base64'),
      })),
    ),
    consent: { processImages: true, externalProvider: false },
  };
  const started = performance.now();
  const response = await fetch(url + '/assess', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(70000),
  });
  const raw = await response.json();
  assert.equal(response.status, 200, JSON.stringify(raw));
  const result = AnalysisResponseSchema.parse(raw);
  assert.equal(result.assessmentId, request.assessmentId);
  assert.equal(result.observation?.model, health.model);
  assert.equal(result.decision.offerRecommended, false);
  assert.equal(result.decision.protectivePerformanceCertified, false);
  validateFindings(result.observation!, new Set(items.map((_, i) => 'photo-' + i)));
  const calls = (
    await fs.readFile('benchmarks/quality-cycle-02/canary-selected-calls.jsonl', 'utf8')
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(before)
    .map((line) => JSON.parse(line));
  assert(calls.filter((c) => c.stage === 'focus-grounding').length <= 1, 'Focus budget exceeded');
  const flags = result.observation!.inspection!.photos.map((p) => p.findings.length > 0);
  const row = {
    id,
    elapsedMs: performance.now() - started,
    firstAttemptSucceeded: true,
    flags,
    expectedFlags: expectedFlags ?? null,
    matchedExpectation: expectedFlags
      ? JSON.stringify(flags) === JSON.stringify(expectedFlags)
      : null,
    stages: calls.map((c) => c.stage),
    result,
  };
  await fs.appendFile(path, JSON.stringify(row) + '\n');
  console.log(
    JSON.stringify({
      id,
      flags,
      expected: expectedFlags,
      ms: Math.round(row.elapsedMs),
      stages: row.stages,
    }),
  );
  return row;
}
await fs.writeFile(
  'benchmarks/quality-cycle-02/selected-live-http-protocol.json',
  JSON.stringify(
    {
      at: new Date().toISOString(),
      health,
      cases: cases.map((c) => ({ id: c.id, expectedFlag: c.expectedFlag })),
      scope:
        'Final-code real HTTP smoke. Expected flags are regression contracts, not accuracy labels; fabric069 and biker-black are known visual failures. No retries.',
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
for (const c of cases) {
  await fetch(url + '/session', { method: 'DELETE' });
  await call(c.id, [c], [c.expectedFlag]);
}
await fetch(url + '/session', { method: 'DELETE' });
const batchItems = ['commons-087', 'commons-090', 'fabric-049'].map((id) =>
  labels.find((c: any) => c.id === id),
);
await call('three-photo-budget', batchItems, [true, false, true]);
// The weak seam in the third photograph remains its baseline alert while the optional stage is deferred.
await call('deferred-photo-alone', [batchItems[1]], [true]);
