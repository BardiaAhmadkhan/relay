import fs from 'node:fs/promises';
import sharp from 'sharp';
import { DeviceInspector } from '../packages/mobile/inspection';
import { createHash } from 'node:crypto';
const cases = JSON.parse(
  await fs.readFile('experiments/round-05/hard-case-protocol.json', 'utf8'),
).cases.filter((c: any) =>
  [
    'sample-01--reference',
    'sample-02--reference',
    'sample-03--reference',
    'sample-01--small320',
    'source-crash--small320',
    'denim--reference',
    'biker-black--reference',
  ].includes(c.id),
);
const output = 'benchmarks/phone-offline-02/reference-v2-contract-pilot.jsonl';
await fs.writeFile(output, '', { flag: 'wx' });
const buffers = new Map<string, Buffer>();
const calls: any[] = [];
const inspector = new DeviceInspector({
  model: 'qwen3.5-4b-q4@a9d0a3e1d8c9/phone-evidence-2',
  detailImage: async (photo) => {
    const w = photo.quality.width,
      h = photo.quality.height,
      scale = Math.sqrt((1024 * 32 * 32) / (w * h));
    const enlarged = await sharp(buffers.get(photo.uri)!)
      .resize(Math.ceil((w * scale) / 32) * 32, Math.ceil((h * scale) / 32) * 32, {
        fit: 'fill',
        kernel: 'linear',
      })
      .png()
      .toBuffer();
    buffers.set('detail', enlarged);
    return {
      uri: 'detail',
      release: async () => {
        buffers.delete('detail');
      },
    };
  },
  generate: async (images, prompt, schema, maxTokens, signal) => {
    const start = performance.now();
    const response = await fetch('http://127.0.0.1:8792/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: [
              ...images.map((uri) => ({
                type: 'image_url',
                image_url: { url: 'data:image/png;base64,' + buffers.get(uri)!.toString('base64') },
              })),
              { type: 'text', text: prompt },
            ],
          },
        ],
        temperature: 0,
        seed: 42,
        max_tokens: maxTokens,
        cache_prompt: false,
        chat_template_kwargs: { enable_thinking: false },
        response_format: { type: 'json_schema', json_schema: { strict: true, schema } },
      }),
      signal,
    });
    const raw = await response.json();
    calls.push({
      stage: (schema as any).properties.verdicts ? 'verification' : 'inspection',
      ms: performance.now() - start,
      raw,
    });
    if (!response.ok) throw Error(JSON.stringify(raw));
    return {
      text: raw.choices[0].message.content,
      complete: raw.choices[0].finish_reason === 'stop',
      inputTokens: raw.usage?.prompt_tokens ?? 0,
      outputTokens: raw.usage?.completion_tokens ?? 0,
    };
  },
});
for (const c of cases) {
  inspector.clear();
  calls.length = 0;
  const bytes = await sharp(await fs.readFile(c.inputFile))
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  buffers.clear();
  buffers.set('local-test', bytes);
  const started = performance.now();
  let row: any;
  try {
    const result = await inspector.analyze(
      [
        {
          id: 'photo',
          view: 'front',
          uri: 'local-test',
          sha256: createHash('sha256').update(bytes).digest('hex'),
          byteLength: bytes.length,
          quality: {
            width: c.width,
            height: c.height,
            brightness: 100,
            sharpness: 100,
            warnings: [],
          },
        },
      ],
      AbortSignal.timeout(120000),
    );
    row = {
      id: c.id,
      expectedDamage: c.expectedDamage,
      ms: performance.now() - started,
      result,
      calls: [...calls],
    };
  } catch (e: any) {
    row = { id: c.id, error: e.message, calls: [...calls] };
  }
  await fs.appendFile(output, JSON.stringify(row) + '\n');
  console.log(
    JSON.stringify({
      id: c.id,
      ms: row.ms,
      error: row.error,
      photo: row.result?.inspection.photos[0],
    }),
  );
}
inspector.clear();
