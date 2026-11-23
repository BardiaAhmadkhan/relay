import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createApp } from '../server/app';
import { createLocalInspectionAdapter } from '../packages/vision/inspection';
const log = 'benchmarks/quality-cycle-02/canary-final-calls.jsonl';
await fs.writeFile(log, '', { flag: 'wx' });
const traced: typeof fetch = async (input, init) => {
  const started = performance.now();
  let body: any = null;
  try {
    body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
  } catch {}
  if (!String(input).endsWith('/api/chat')) return fetch(input, init);
  const requestHash = createHash('sha256').update(String(init?.body)).digest('hex');
  const stage = body?.format?.properties?.box
    ? 'focus-grounding'
    : body?.format?.properties?.supported
      ? body.messages[1]?.images?.length === 2
        ? 'focus-context-verification'
        : 'verification'
      : body?.format?.properties?.findings
        ? 'inspection'
        : 'low-detail-cue';
  try {
    const response = await fetch(input, init),
      raw = await response.clone().json();
    await fs.appendFile(
      log,
      JSON.stringify({
        at: new Date().toISOString(),
        requestHash,
        stage,
        images: body?.messages
          ?.filter((m: any) => m.images)
          .reduce((n: number, m: any) => n + m.images.length, 0),
        status: response.status,
        durationMs: performance.now() - started,
        raw,
      }) + '\n',
    );
    return response;
  } catch (error: any) {
    await fs.appendFile(
      log,
      JSON.stringify({
        at: new Date().toISOString(),
        requestHash,
        stage,
        status: null,
        durationMs: performance.now() - started,
        error: error.name,
      }) + '\n',
    );
    throw error;
  }
};
const adapter = await createLocalInspectionAdapter('qwen3.5:4b', 'http://127.0.0.1:11435', traced);
const app = createApp({ adapter });
await app.listen({ host: '127.0.0.1', port: 8790 });
console.log(
  JSON.stringify({
    address: 'http://127.0.0.1:8790',
    model: adapter.model,
    imagesLogged: false,
    scope: 'Isolated evaluation service; model captions recorded locally for exact-response replay',
  }),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
