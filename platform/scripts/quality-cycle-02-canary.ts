import fs from 'node:fs/promises';
import { createApp } from '../server/app';
import { createLocalInspectionAdapter } from '../experiments/quality-cycle-02/focused-context-inspection';
const log = 'benchmarks/quality-cycle-02/canary-calls.jsonl';
await fs.writeFile(log, '', { flag: 'wx' });
const traced: typeof fetch = async (input, init) => {
  const started = performance.now();
  let body: any = null;
  try {
    body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
  } catch {}
  const response = await fetch(input, init);
  if (String(input).endsWith('/api/chat')) {
    const value = await response.clone().json();
    const stage = body?.format?.properties?.box
      ? 'focus-grounding'
      : body?.format?.properties?.supported
        ? body.messages[1]?.images?.length === 2
          ? 'focus-context-verification'
          : 'verification'
        : body?.format?.properties?.findings
          ? 'inspection'
          : 'low-detail-cue';
    await fs.appendFile(
      log,
      JSON.stringify({
        at: new Date().toISOString(),
        stage,
        images: body?.messages
          ?.filter((m: any) => m.images)
          .reduce((n: number, m: any) => n + m.images.length, 0),
        status: response.status,
        durationMs: performance.now() - started,
        inputTokens: value.prompt_eval_count ?? null,
        outputTokens: value.eval_count ?? null,
        doneReason: value.done_reason ?? null,
      }) + '\n',
    );
  }
  return response;
};
const adapter = await createLocalInspectionAdapter('qwen3.5:4b', 'http://127.0.0.1:11435', traced);
const app = createApp({ adapter });
await app.listen({ host: '127.0.0.1', port: 8790 });
console.log(
  JSON.stringify({ address: 'http://127.0.0.1:8790', model: adapter.model, imagesLogged: false }),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
