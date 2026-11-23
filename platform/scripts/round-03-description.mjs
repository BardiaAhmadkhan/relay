import fs from 'node:fs/promises';
import sharp from 'sharp';
const variants = [
  {
    id: 'description',
    prompt:
      'Describe the physical condition of the jacket in this photo. Pay attention to the shoulder and sleeves. What damage, if any, is visible? Be specific and concise.',
  },
  {
    id: 'evidence-first',
    prompt:
      'Inspect this photograph. First list visible material defects (scuffs, abrasion, holes, tears, fraying, broken seams) with their locations and visual evidence. Then say whether those marks are consistent with road-contact damage. Do not assume normal design features are damage. Do not claim to verify crash history. If no damage is visible, say that. Answer in at most 120 words.',
  },
];
const rows = [];
for (const variant of variants)
  for (const file of ['sample-01.webp', 'sample-02.jpg', 'sample-03.jpg']) {
    const jpeg = await sharp('assets/fixtures/round-03/' + file)
      .jpeg()
      .toBuffer();
    const start = performance.now();
    const res = await fetch('http://127.0.0.1:11435/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3-vl:4b-instruct',
        stream: false,
        think: false,
        messages: [{ role: 'user', content: variant.prompt, images: [jpeg.toString('base64')] }],
        options: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: 350 },
        keep_alive: '30m',
      }),
      signal: AbortSignal.timeout(90000),
    });
    const raw = await res.json();
    const row = { variant: variant.id, file, elapsedMs: performance.now() - start, ...raw };
    rows.push(row);
    console.log(
      JSON.stringify({
        variant: variant.id,
        file,
        ms: row.elapsedMs,
        content: raw.message?.content,
      }),
    );
    await fs.writeFile(
      'benchmarks/round-03/description-probe.json',
      JSON.stringify({ variants, rows }, null, 2),
    );
  }
