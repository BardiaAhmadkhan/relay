import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createLocalAdapter } from '../packages/vision/local.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const checks = [];
const jpeg = await fs.readFile(path.join(root, 'assets/fixtures/gloves-back.jpg'));
const blank = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#202020' } }).jpeg().toBuffer();

for (const kind of ['local_clip', 'local_siglip']) {
  const adapter = createLocalAdapter(kind);
  await adapter.warmup();
  async function check(name, fn) {
    const began = performance.now();
    try {
      await fn();
      checks.push({ kind, name, passed: true, durationMs: performance.now() - began });
    } catch (error) {
      checks.push({ kind, name, passed: false, error: String(error), durationMs: performance.now() - began });
    }
  }
  await check('uniform-frame-abstains', async () => {
    const result = await adapter.analyze([{ id: 'blank', view: 'front', jpeg: blank }]);
    assert.equal(result.category, 'unknown');
    assert.equal(result.coverage, 'category_only');
    assert.deepEqual(result.attributes, []);
    assert.deepEqual(result.concerns, []);
  });
  await check('corrupt-image-rejects', async () => {
    await assert.rejects(adapter.analyze([{ id: 'corrupt', view: 'front', jpeg: new Uint8Array([1, 2, 3, 4]) }]));
  });
  await check('more-than-six-images-rejects', async () => {
    await assert.rejects(adapter.analyze(Array.from({ length: 7 }, (_, i) => ({ id: 'photo' + i, view: 'front', jpeg }))));
  });
  await check('detail-only-abstains', async () => {
    const result = await adapter.analyze([{ id: 'detail', view: 'detail', jpeg }]);
    assert.equal(result.category, 'unknown');
  });
  await check('all-nonlabel-views-processed', async () => {
    const result = await adapter.evaluateForBenchmark([
      { id: 'front', view: 'front', jpeg }, { id: 'back', view: 'back', jpeg }, { id: 'label', view: 'label', jpeg },
    ]);
    assert.equal(result.views.length, 2);
    assert.deepEqual(result.views.map(view => view.imageId), ['front', 'back']);
    assert.equal(result.observation.category, 'gloves');
    assert.deepEqual(result.observation.attributes, []);
    assert.deepEqual(result.observation.concerns, []);
    assert.equal(result.observation.coverage, 'category_only');
    assert.equal('score' in result.observation, false);
  });
  await check('invalid-second-view-is-not-ignored', async () => {
    await assert.rejects(adapter.analyze([
      { id: 'good', view: 'front', jpeg }, { id: 'bad', view: 'back', jpeg: new Uint8Array([1, 2]) },
    ]));
  });
  await check('cancellation-during-work-never-success', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10);
    try {
      await assert.rejects(adapter.analyze([{ id: 'cancel', view: 'front', jpeg }], controller.signal));
    } finally { clearTimeout(timer); }
  });
  await adapter.dispose();
}
const result = {
  executedAt: new Date().toISOString(),
  adapterSha256: createHash('sha256').update(await fs.readFile(path.join(root, 'packages/vision/local.ts'))).digest('hex'),
  checks, passed: checks.filter(check => check.passed).length, total: checks.length,
};
await fs.writeFile(path.join(root, 'benchmarks/vision-adapter-checks.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ passed: result.passed, total: result.total }));
assert.equal(result.passed, result.total);
