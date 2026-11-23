import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { prepareImages } from '../server/images';
import { LocalInspectionAdapter as Original } from '../experiments/quality-cycle-02/original-inspection';
const calls = (await fs.readFile('benchmarks/quality-cycle-02/canary-final-calls.jsonl', 'utf8'))
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
const p = JSON.parse(
  await fs.readFile('benchmarks/quality-cycle-02/current-http-audit-protocol.json', 'utf8'),
);
const pool = calls.filter((c) => c.at >= p.at);
const c = JSON.parse(await fs.readFile('datasets/quality-audit-01/labels.json', 'utf8')).cases.find(
  (c: any) => c.id === 'fabric-069',
);
const prepared = await prepareImages([
  { id: 'photo', view: c.view, base64: (await fs.readFile(c.file)).toString('base64') },
]);
const used: any[] = [];
const engine = new Original(
  'qwen3.5:4b',
  'd8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04',
  'http://127.0.0.1:11435',
  async (_url, init) => {
    const hash = createHash('sha256').update(String(init?.body)).digest('hex');
    const call = pool.find((c) => c.requestHash === hash);
    if (!call) throw Error('No recorded response');
    used.push(call);
    return new Response(JSON.stringify(call.raw), { status: call.status });
  },
);
let result: any;
try {
  result = await engine.analyze(prepared.images);
} catch (e: any) {
  result = { error: e.message };
} finally {
  engine.clearCache();
}
const report = {
  at: new Date().toISOString(),
  case: c.id,
  scope: 'Original adapter replay of exactly recorded model responses; no inference performed.',
  result,
  calls: used,
};
await fs.writeFile(
  'benchmarks/quality-cycle-02/fabric-069-error-diagnostic.json',
  JSON.stringify(report, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(
  JSON.stringify(
    { result, modelReplies: used.map((c) => ({ stage: c.stage, content: c.raw.message.content })) },
    null,
    2,
  ),
);
