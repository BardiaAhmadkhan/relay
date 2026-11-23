import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { prepareImages } from '../server/images';
import {
  REVIEW_PROMPT,
  REVIEW_VERSION,
  ReviewSchema,
} from '../experiments/quality-cycle-02/independent-review-v2';
const labels = JSON.parse(await fs.readFile('datasets/quality-audit-01/labels.json', 'utf8'));
const selected = process.argv[3]?.split(',');
const reasoning = process.argv[4] === 'reason';
const run = process.argv[2];
assert(run && /^[a-z0-9-]+$/.test(run));
const cases = labels.cases.filter((c: any) => !selected || selected.includes(c.id));
const path = 'benchmarks/quality-cycle-02/' + run + '.jsonl';
await fs.writeFile(path, '', { flag: 'wx' });
for (const [i, c] of cases.entries()) {
  const bytes = await fs.readFile(c.file);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), c.sha256);
  const prepared = await prepareImages([
    { id: 'photo', view: c.view, base64: bytes.toString('base64') },
  ]);
  const start = performance.now();
  let row: any;
  try {
    const response = await fetch('http://127.0.0.1:11435/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        model: 'qwen3.5:4b',
        think: reasoning,
        stream: false,
        format: z.toJSONSchema(ReviewSchema),
        messages: [
          { role: 'system', content: REVIEW_PROMPT },
          {
            role: 'user',
            content: 'Record visible structural material defects in this photograph.',
            images: [Buffer.from(prepared.images[0]!.jpeg).toString('base64')],
          },
        ],
        options: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: reasoning ? 3000 : 700 },
        keep_alive: '30m',
      }),
    });
    assert(response.ok);
    const raw = await response.json();
    assert.equal(raw.done_reason, 'stop');
    assert.equal(raw.model, 'qwen3.5:4b');
    const value = ReviewSchema.parse(JSON.parse(raw.message.content));
    row = {
      id: c.id,
      condition: c.condition,
      version: REVIEW_VERSION,
      reasoning,
      ms: performance.now() - start,
      value,
      usage: { input: raw.prompt_eval_count, output: raw.eval_count },
    };
  } catch (e: any) {
    row = { id: c.id, error: e.message, ms: performance.now() - start };
  }
  await fs.appendFile(path, JSON.stringify(row) + '\n');
  console.log(
    JSON.stringify({
      i: i + 1,
      n: cases.length,
      id: c.id,
      condition: c.condition,
      findings: row.value?.findings,
      error: row.error,
      ms: Math.round(row.ms),
    }),
  );
}
