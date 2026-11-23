import fs from 'node:fs/promises';
import sharp from 'sharp';
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:8788';
const health = await (await fetch(base + '/health')).json();
const bytes = await fs.readFile('assets/fixtures/round-03/sample-01.webp');
const consent = {
  processImages: true,
  externalProvider: false,
  expectedProvider: health.provider,
  expectedModel: health.model,
};
const payload = {
  schemaVersion: '1.0',
  assessmentId: 'perf-original',
  disclosures: [],
  corrections: [],
  images: [{ id: 'original-id', view: 'front', base64: bytes.toString('base64') }],
  consent,
};
await fetch(base + '/session', { method: 'DELETE' });
const rows = [];
async function run(label, body) {
  const start = performance.now();
  const response = await fetch(base + '/assess', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.decision.offerRecommended, false);
  rows.push({ label, elapsedMs: performance.now() - start, result });
  return result;
}
const first = await run('fresh-original', payload);
assert(first.observation.inspection.photos[0].findings.length > 0);
const changed = await run('new-id-and-history', {
  ...payload,
  assessmentId: 'perf-edited',
  images: [{ ...payload.images[0], id: 'new-id' }],
  disclosures: [
    { id: 'history1', question: 'crash', answer: 'no', recordedAt: new Date().toISOString() },
  ],
});
assert.equal(changed.observation.inspection.photos[0].imageId, 'new-id');
assert.equal(changed.observation.usage.outputTokens, 0);
const black = await sharp({ create: { width: 800, height: 800, channels: 3, background: 'black' } })
  .jpeg()
  .toBuffer();
const partial = await run('usable-plus-black', {
  ...payload,
  assessmentId: 'perf-partial',
  images: [...payload.images, { id: 'black', view: 'detail', base64: black.toString('base64') }],
});
assert.equal(partial.photos.length, 2);
assert.equal(partial.observation.inspection.photos.length, 1);
assert.equal(partial.decision.title, 'Crash-like damage detected');
for (const [id, file] of [
  ['sample-01', 'assets/fixtures/round-03/sample-01.webp'],
  ['source-crash', 'assets/fixtures/crashed-shoulder.jpg'],
]) {
  const small = await sharp(file)
    .rotate()
    .flatten({ background: '#fff' })
    .resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  const result = await run('small320-' + id, {
    ...payload,
    assessmentId: 'retake-' + id,
    images: [{ id: 'small', view: 'front', base64: small.toString('base64') }],
  });
  if (!result.observation.inspection.photos[0].findings.length)
    assert.equal(result.decision.title, 'A clearer photo is needed');
}
await fs.writeFile(
  'benchmarks/round-04/service-recovery.json',
  JSON.stringify(
    {
      at: new Date().toISOString(),
      boundary:
        'Loopback host end-to-end; no physical-phone/network timing. One run per request, not p95.',
      rows,
    },
    null,
    2,
  ),
  { flag: 'wx' },
);
console.log(
  JSON.stringify(
    rows.map((r) => ({
      label: r.label,
      ms: r.elapsedMs,
      title: r.result.decision.title,
      tokens: r.result.observation?.usage,
    })),
  ),
);
