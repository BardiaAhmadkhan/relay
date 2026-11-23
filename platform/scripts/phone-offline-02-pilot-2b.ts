import fs from 'node:fs/promises';
import sharp from 'sharp';
import { z } from 'zod';
import { PhotoInspectionSchema } from '../packages/core/schema';
import { INSPECTION_PROMPT } from '../packages/vision/inspection-prompt';
const files = [
  'assets/fixtures/round-03/sample-01.webp',
  'assets/fixtures/round-03/sample-02.jpg',
  'assets/fixtures/round-03/sample-03.jpg',
];
const actual = JSON.parse(
  await fs.readFile('experiments/round-05/hard-case-protocol.json', 'utf8'),
).cases.filter((c: any) =>
  [
    'sample-01--reference',
    'sample-02--reference',
    'sample-03--reference',
    'denim--reference',
    'biker-black--reference',
  ].includes(c.id),
);
await fs.writeFile('benchmarks/phone-offline-02/second-model-pilot.jsonl', '', { flag: 'wx' });
for (const c of actual) {
  const bytes = await sharp(await fs.readFile(c.inputFile))
    .resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 86 })
    .toBuffer();
  const body = {
    model: 'qwen-2b-q4',
    messages: [
      { role: 'system', content: INSPECTION_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Inspect this photograph. Return only the requested JSON.' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/jpeg;base64,' + bytes.toString('base64') },
          },
        ],
      },
    ],
    temperature: 0,
    seed: 42,
    max_tokens: 280,
    chat_template_kwargs: { enable_thinking: false },
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'inspection',
        strict: true,
        schema: z.toJSONSchema(PhotoInspectionSchema),
      },
    },
  };
  const started = performance.now();
  try {
    const response = await fetch('http://127.0.0.1:8792/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
    const raw = await response.json();
    const row = { id: c.id, elapsedMs: performance.now() - started, status: response.status, raw };
    await fs.appendFile(
      'benchmarks/phone-offline-02/second-model-pilot.jsonl',
      JSON.stringify(row) + '\n',
    );
    console.log(
      JSON.stringify({
        id: c.id,
        ms: row.elapsedMs,
        result: raw.choices?.[0]?.message,
        error: raw.error,
      }),
    );
  } catch (e: any) {
    console.log(c.id, e.message);
    throw e;
  }
}
