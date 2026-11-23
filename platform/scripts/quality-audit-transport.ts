import fs from 'node:fs/promises';
import sharp from 'sharp';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../server/app';
import { type VisionAdapter, SCHEMA_VERSION } from '../packages/core/schema';
let inferenceMs = 0,
  completed = false;
const adapter: VisionAdapter = {
  id: 'test',
  model: 'disclosed-transport-delay-12s',
  coverage: 'visual_observations',
  async analyze() {
    const start = performance.now();
    await delay(12000);
    inferenceMs = performance.now() - start;
    completed = true;
    return {
      schemaVersion: SCHEMA_VERSION,
      provider: 'test',
      model: 'disclosed-transport-delay-12s',
      coverage: 'visual_observations',
      durationMs: inferenceMs,
      usage: null,
      category: 'other',
      attributes: [],
      concerns: [],
      missingViews: ['back', 'label'],
      multipleItems: false,
    };
  },
};
const app = createApp({ adapter });
const address = await app.listen({ host: '127.0.0.1', port: 0 });
const image = await sharp({
  create: { width: 640, height: 480, channels: 3, background: '#777777' },
})
  .jpeg()
  .toBuffer();
const start = performance.now();
let client: any;
try {
  const response = await fetch(address + '/assess', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      assessmentId: 'transport-proof',
      disclosures: [],
      corrections: [],
      images: [{ id: 'photo', view: 'front', base64: image.toString('base64') }],
      consent: { processImages: true, externalProvider: false },
    }),
    signal: AbortSignal.timeout(20000),
  });
  client = {
    status: response.status,
    body: await response.json(),
    elapsedMs: performance.now() - start,
  };
} catch (error: any) {
  client = {
    error: error.name,
    causeCode: error.cause?.code ?? null,
    causeMessage: error.cause?.message ?? null,
    elapsedMs: performance.now() - start,
  };
}
while (!completed && performance.now() - start < 18000) await delay(200);
await app.close();
const report = {
  at: new Date().toISOString(),
  kind: 'Controlled real-HTTP transport diagnostic with a disclosed 12s test adapter; not an image-model accuracy result.',
  client,
  adapterCompleted: completed,
  adapterElapsedMs: inferenceMs,
  sourceConnectionTimeoutMs: 10000,
  systemSourceUnchanged: true,
};
await fs.writeFile(
  'benchmarks/quality-audit-01/transport-timeout-proof.json',
  JSON.stringify(report, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(JSON.stringify(report));
