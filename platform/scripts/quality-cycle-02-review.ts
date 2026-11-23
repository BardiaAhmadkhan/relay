import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { prepareImages } from '../server/images';
import {
  REVIEW_PROMPT,
  REVIEW_VERSION,
  ReviewSchema,
  keptIndices,
} from '../experiments/quality-cycle-02/physical-review-v1';
const labels = JSON.parse(await fs.readFile('datasets/quality-audit-01/labels.json', 'utf8'));
const baseline = JSON.parse(
  await fs.readFile('benchmarks/quality-audit-01/evaluation-full.json', 'utf8'),
);
const run = process.argv[2] ?? 'probe';
assert(/^[a-z0-9-]+$/.test(run));
const selected = process.argv[3]?.split(',');
const rows = baseline.rows.filter(
  (r: any) => (!selected || selected.includes(r.id)) && r.findingCount > 0,
);
const path = 'benchmarks/quality-cycle-02/' + run + '.jsonl';
await fs.writeFile(path, '', { flag: 'wx' });
const tags = await (await fetch('http://127.0.0.1:11435/api/tags')).json();
assert.equal(
  tags.models.find((m: any) => m.name === 'qwen3.5:4b').digest,
  'd8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04',
);
for (const [i, row] of rows.entries()) {
  const c = labels.cases.find((c: any) => c.id === row.id);
  const bytes = await fs.readFile(c.file);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), c.sha256);
  const prepared = await prepareImages([
    { id: 'photo', view: c.view, base64: bytes.toString('base64') },
  ]);
  const original = row.result.observation.inspection.photos[0];
  const start = performance.now();
  let record: any;
  try {
    const response = await fetch('http://127.0.0.1:11435/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({
        model: 'qwen3.5:4b',
        think: false,
        stream: false,
        format: z.toJSONSchema(ReviewSchema),
        messages: [
          { role: 'system', content: REVIEW_PROMPT },
          {
            role: 'user',
            content:
              'Check these untrusted candidates: ' +
              JSON.stringify(
                original.findings.map((f: any, index: number) => ({ index, evidence: f.evidence })),
              ),
            images: [Buffer.from(prepared.images[0]!.jpeg).toString('base64')],
          },
        ],
        options: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: 900 },
        keep_alive: '30m',
      }),
    });
    assert(response.ok);
    const raw = await response.json();
    assert.equal(raw.done_reason, 'stop');
    assert.equal(raw.model, 'qwen3.5:4b');
    const review = ReviewSchema.parse(JSON.parse(raw.message.content));
    assert.equal(review.checks.length, original.findings.length);
    assert.equal(new Set(review.checks.map((c) => c.index)).size, original.findings.length);
    assert(review.checks.every((c) => c.index < original.findings.length));
    const keep = keptIndices(review);
    record = {
      id: c.id,
      condition: c.condition,
      domain: c.domain,
      version: REVIEW_VERSION,
      ms: performance.now() - start,
      review,
      kept: keep,
      findings: original.findings.filter((_: any, index: number) => keep.includes(index)),
      baseline: original.findings,
      usage: { input: raw.prompt_eval_count, output: raw.eval_count },
    };
  } catch (e: any) {
    record = { id: c.id, error: e.message, ms: performance.now() - start };
  }
  await fs.appendFile(path, JSON.stringify(record) + '\n');
  console.log(
    JSON.stringify({
      i: i + 1,
      n: rows.length,
      id: c.id,
      condition: c.condition,
      kept: record.kept,
      error: record.error,
      ms: Math.round(record.ms),
    }),
  );
}
