import fs from 'node:fs/promises';
import sharp from 'sharp';
import { z } from 'zod';
import { PhotoInspectionSchema } from '../packages/core/schema';
import { INSPECTION_PROMPT } from '../packages/vision/inspection-prompt';
const model = process.env.RELAY_PROBE_MODEL ?? 'qwen3-vl:4b-instruct';
const report = process.env.RELAY_PROBE_REPORT ?? 'evidence-first-qwen3vl';
const rows = [];
for (const file of ['sample-01.webp', 'sample-02.jpg', 'sample-03.jpg']) {
  const jpeg = await sharp('assets/fixtures/round-03/' + file)
    .jpeg({ quality: 90 })
    .toBuffer();
  const start = performance.now();
  const res = await fetch('http://127.0.0.1:11435/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      format: z.toJSONSchema(PhotoInspectionSchema),
      messages: [
        { role: 'system', content: INSPECTION_PROMPT },
        {
          role: 'user',
          content: 'Inspect the visible material condition in this photograph.',
          images: [jpeg.toString('base64')],
        },
      ],
      options: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: 700 },
      keep_alive: '30m',
    }),
    signal: AbortSignal.timeout(120000),
  });
  const raw = await res.json();
  const parsed = PhotoInspectionSchema.safeParse(JSON.parse(raw.message?.content || '{}'));
  const row = { file, elapsedMs: performance.now() - start, valid: parsed.success, ...raw };
  rows.push(row);
  console.log(
    JSON.stringify({
      file,
      ms: row.elapsedMs,
      valid: parsed.success,
      content: raw.message?.content,
    }),
  );
  await fs.writeFile(
    'benchmarks/round-03/' + report + '.json',
    JSON.stringify({ model, prompt: INSPECTION_PROMPT, rows }, null, 2),
  );
}
