import fs from 'node:fs/promises';
import { createApp } from '../server/app';
import { createLocalInspectionAdapter } from '../packages/vision/inspection';
const file = process.env.RELAY_CANARY_CALLS ?? 'benchmarks/round-05/canary-calls.jsonl';
await fs.writeFile(file, '', { flag: 'wx' });
let sequence = 0;
const fetcher: typeof fetch = async (url, init) => {
  const start = performance.now();
  const response = await fetch(url, init);
  if (String(url).endsWith('/api/chat')) {
    const request = JSON.parse(String(init?.body));
    const raw = await response.clone().json();
    const stage = request.format?.properties?.abrasion
      ? 'low-detail-cue'
      : request.format?.properties?.supported
        ? 'verification'
        : 'extraction';
    let recovered = false;
    try {
      recovered = !!JSON.parse(raw.message?.content ?? '{}').abrasion;
    } catch {}
    await fs.appendFile(
      file,
      JSON.stringify({
        call: ++sequence,
        at: new Date().toISOString(),
        stage,
        elapsedMs: performance.now() - start,
        promptTokens: raw.prompt_eval_count,
        outputTokens: raw.eval_count,
        returnedCue: stage === 'low-detail-cue' ? recovered : undefined,
      }) + '\n',
    );
  }
  return response;
};
const adapter = await createLocalInspectionAdapter(undefined, undefined, fetcher);
const app = createApp({ adapter });
await app.listen({ host: '127.0.0.1', port: 8788 });
console.log(
  JSON.stringify({
    canary: 'http://127.0.0.1:8788',
    provider: adapter.id,
    model: adapter.model,
    photoBytesLogged: false,
  }),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
