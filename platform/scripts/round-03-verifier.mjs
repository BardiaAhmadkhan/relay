import fs from 'node:fs/promises';
import sharp from 'sharp';
const source = JSON.parse(
  await fs.readFile('benchmarks/round-03/condition-first-run.json', 'utf8'),
);
const schema = {
  type: 'object',
  properties: {
    supported: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 5 } },
    uncertain: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 5 } },
    crashPattern: { type: 'string', enum: ['consistent_with_sliding', 'not_observed', 'unclear'] },
  },
  required: ['supported', 'uncertain', 'crashPattern'],
  additionalProperties: false,
};
const prompt =
  'You review untrusted candidate observations against a photograph. Report which candidate indices describe actual visible PHYSICAL DAMAGE. Support only material loss, rough scrape marks, ragged tears, severed fibers or disrupted stitching you can see. Smooth natural leather grain, gentle creasing, worn denim dye, intact piping, logos, normal seams, functional zippers, mesh construction, dirt, shadows and photo blur are NOT physical damage. Reject invented locations or facts that merely describe a garment feature. Use uncertain for an ambiguous actual defect needing a close-up, not for every normal feature. Empty arrays are valid. Then assess whether the supported evidence forms a road-sliding pattern. No verified crash history, safety, or protective-performance judgment. Return JSON only: supported is an array of candidate indices directly supported by the image; uncertain is an array of indices needing confirmation; crashPattern is consistent_with_sliding, not_observed, or unclear.';
const rows = [];
for (const c of source.rows.filter(
  (r) => r.body.observation?.inspection?.photos[0].findings.length,
)) {
  const findings = c.body.observation.inspection.photos[0].findings;
  const jpeg = await sharp(c.file)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();
  const start = performance.now();
  const response = await fetch('http://127.0.0.1:11435/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen3.5:4b',
      stream: false,
      think: false,
      format: schema,
      messages: [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content:
            'Check these candidates (zero-based indices): ' +
            JSON.stringify(findings.map((f, i) => ({ index: i, ...f }))),
          images: [jpeg.toString('base64')],
        },
      ],
      options: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: 180 },
      keep_alive: '30m',
    }),
    signal: AbortSignal.timeout(120000),
  });
  const raw = await response.json();
  const row = { id: c.id, ms: performance.now() - start, candidates: findings, raw };
  rows.push(row);
  console.log(JSON.stringify({ id: c.id, ms: row.ms, content: raw.message?.content }));
  await fs.writeFile(
    'benchmarks/round-03/verification-probe.json',
    JSON.stringify({ prompt, schema, rows }, null, 2),
  );
}
