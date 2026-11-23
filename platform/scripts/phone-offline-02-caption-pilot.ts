import fs from 'node:fs/promises';
import sharp from 'sharp';
const cases = JSON.parse(
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
const out = 'benchmarks/phone-offline-02/compact-caption-pilot.jsonl';
await fs.writeFile(out, '', { flag: 'wx' });
for (const c of cases) {
  const bytes = await sharp(await fs.readFile(c.inputFile))
    .resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 86 })
    .toBuffer();
  const body = {
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: 'data:image/jpeg;base64,' + bytes.toString('base64') },
          },
          {
            type: 'text',
            text: 'Describe visible damage to the clothing material in one short sentence. Look for ragged holes, torn fibers or scraped coating. Normal seams and printed designs are not damage. If no actual damage is visible, say No clear damage.',
          },
        ],
      },
    ],
    temperature: 0.2,
    seed: 42,
    max_tokens: 90,
    presence_penalty: 1.5,
    chat_template_kwargs: { enable_thinking: false },
  };
  const start = performance.now();
  const response = await fetch('http://127.0.0.1:8792/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  const raw = await response.json(),
    row = { id: c.id, ms: performance.now() - start, status: response.status, raw };
  await fs.appendFile(out, JSON.stringify(row) + '\n');
  console.log(
    JSON.stringify({ id: c.id, ms: row.ms, content: raw.choices?.[0]?.message?.content }),
  );
}
