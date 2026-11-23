import fs from 'node:fs/promises';
import sharp from 'sharp';
import { z } from 'zod';
import { proposeRegions, regionImages, REGION_VERSION } from '../packages/vision/regions';
import { PhotoInspectionSchema } from '../packages/core/schema';
import { INSPECTION_PROMPT } from '../packages/vision/inspection-prompt';
const protocol = JSON.parse(
  await fs.readFile('experiments/round-03/condition-protocol.json', 'utf8'),
);
const model = 'qwen3.5:4b';
const rows = [];
await fs.mkdir('experiments/round-03/regions', { recursive: true });
for (const c of protocol.cases) {
  const start = performance.now();
  const jpeg = await sharp(c.file)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();
  const proposals = await proposeRegions(jpeg);
  const crops = await regionImages(jpeg, proposals.regions);
  const overview = await sharp(jpeg)
    .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 84 })
    .toBuffer();
  const pictures = [overview, ...crops];
  for (let i = 0; i < crops.length; i++)
    await fs.writeFile('experiments/round-03/regions/' + c.id + '-' + i + '.jpg', crops[i]!);
  const response = await fetch('http://127.0.0.1:11435/api/chat', {
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
          content:
            'Inspect the visible material condition. Image 1 is the overview. Images 2 and 3, when present, are algorithmically selected close-ups of the SAME photograph. They are attention suggestions, not confirmed defects. Do not count the same feature twice. Use the overview to distinguish normal construction from physical damage.',
          images: pictures.map((p) => p.toString('base64')),
        },
      ],
      options: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: 700 },
      keep_alive: '30m',
    }),
    signal: AbortSignal.timeout(120000),
  });
  const raw = await response.json();
  const row = {
    id: c.id,
    proposals,
    elapsedMs: performance.now() - start,
    payloadImageBytes: pictures.reduce((n, p) => n + p.length, 0),
    raw,
  };
  rows.push(row);
  console.log(
    JSON.stringify({
      id: c.id,
      ms: row.elapsedMs,
      cvMs: proposals.durationMs,
      content: raw.message?.content,
    }),
  );
  await fs.writeFile(
    'benchmarks/round-03/algorithmic-regions-v1.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        model,
        algorithm: REGION_VERSION,
        prompt: INSPECTION_PROMPT,
        rows,
      },
      null,
      2,
    ),
  );
}
