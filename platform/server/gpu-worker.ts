import { createServer } from 'node:http';
import sharp from 'sharp';
import { createGpuWorker } from './gpu-rpc';
import { ThresholdsSchema } from '../packages/core/v2/schema';
import full from '../packages/core/v2/thresholds.json' with { type: 'json' };
import low from '../packages/core/v2/thresholds.cascade512.json' with { type: 'json' };
import { inspectionScorer } from '../packages/vision/v2/inspection-model';
import { PlannedScorer } from '../packages/vision/v2/plan';
import { InspectionLane } from '../packages/vision/v2/inspection-lane';
import { GARMENT_QUESTIONS } from '../packages/vision/v2/battery';
const host = process.env.RELAY_WORKER_HOST ?? '0.0.0.0',
  port = Number(process.env.PORT ?? 8080),
  probePort = Number(process.env.PORT_HEALTH ?? 8081);
if (port === probePort) throw Error('The worker and readiness ports must differ.');
let ready = false;
const probe = createServer((req, res) => {
  const code = req.url === '/ping' ? (ready ? 200 : 204) : 404;
  res.writeHead(code, { 'Cache-Control': 'no-store' });
  res.end(ready && code === 200 ? 'ok' : '');
});
probe.listen(probePort, host);
const model = await inspectionScorer(process.env.RELAY_OLLAMA_URL),
  a = ThresholdsSchema.parse(full),
  b = ThresholdsSchema.parse(low);
const plan = new PlannedScorer(
  model,
  (id) => a.perScorer[id],
  (id) => b.perScorer[id],
);
const lane = new InspectionLane(25, () => model.unload()).wrap(plan);
const app = createGpuWorker(lane, process.env.RELAY_GPU_TOKEN ?? '');
await app.listen({ host, port });
const jpeg = await sharp({
  create: { width: 256, height: 256, channels: 3, background: '#6b6b6b' },
})
  .jpeg({ quality: 80 })
  .toBuffer();
await lane.score(
  { view: 'detail', jpeg },
  GARMENT_QUESTIONS.filter((q) => q.key === 'road_contact'),
  AbortSignal.timeout(180000),
);
ready = true;
console.log(JSON.stringify({ event: 'gpu_worker_ready', model: lane.model }));
for (const sig of ['SIGINT', 'SIGTERM'])
  process.once(sig, () => {
    ready = false;
    probe.close();
    void app.close().then(() => process.exit(0));
  });
