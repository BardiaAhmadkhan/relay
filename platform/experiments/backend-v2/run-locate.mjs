// Localisation: where is the damage? Two training-free methods on the same images.
//   G1 "box":  one generative call returns a bbox_2d on a 0..1000 grid.
//   G2 "grid": the scored 'break' question is asked of nine overlapping tiles; the heat map is the answer.
// Ground truth: the fabric publisher's annotation boxes (class, cx, cy, w, h; normalised).
// node experiments/backend-v2/run-locate.mjs [--model qwen3.5:4b] [--overlay] [--ids sample-01,sample-02]
import path from 'node:path';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { OUT, ROOT, loadCases, prepare, chat, answerMass, appendJsonl, done, args } from './lib.mjs';
import { BATTERIES } from './battery.mjs';

const a = args();
const model = a.model ?? 'qwen3.5:4b';
const breakProbe = BATTERIES.b1.probes.break;
const system = BATTERIES.b1.system;
const file = path.join(OUT, ['locate', model.replace(/[:/]/g, '-'), a.tag ?? ''].filter(Boolean).join('--') + '.jsonl');
const wanted = a.ids ? new Set(String(a.ids).split(',')) : null;
const cases = (await loadCases()).filter((c) =>
  wanted ? wanted.has(c.id) : c.condition === 'visible_defect' && c.publisherBoxes?.length,
);
const finished = await done(file);
const BOX_PROMPT =
  'Locate the most serious area of broken material in this photograph (a hole, tear, cut, open seam or scraped-through surface). ' +
  'Return JSON only: {"found": true or false, "bbox_2d": [x1, y1, x2, y2]} with integer coordinates on a 0..1000 grid ' +
  'where (0,0) is the top-left corner and (1000,1000) the bottom-right corner of the photograph. Use found=false and [0,0,0,0] when no broken material is visible.';
const boxSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['found', 'bbox_2d'],
  properties: {
    found: { type: 'boolean' },
    bbox_2d: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 1000 }, minItems: 4, maxItems: 4 },
  },
};
// 3x3 tiles, each half the frame, stride a quarter of the frame.
const tiles = [];
for (const ty of [0, 0.25, 0.5]) for (const tx of [0, 0.25, 0.5]) tiles.push({ x: tx, y: ty, w: 0.5, h: 0.5 });

for (const c of cases) {
  if (finished.has(c.id)) continue;
  try {
    const image = await prepare(c.file, 1600);
    const b64 = image.jpeg.toString('base64');
    const t0 = performance.now();
    const box = await chat({
      model,
      format: boxSchema,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: BOX_PROMPT, images: [b64] },
      ],
      options: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: 80 },
    });
    const g1 = JSON.parse(box.json.message.content);
    const g1Ms = performance.now() - t0;
    const t1 = performance.now();
    const heat = [];
    for (const t of tiles) {
      // Clamped to the frame (fixed 2026-11-17): rounding left and width separately ran one pixel past
      // the edge on odd-sized images and failed 21 of 65 photographs with "bad extract area".
      const left = Math.round(t.x * image.width),
        top = Math.round(t.y * image.height);
      const region = {
        left,
        top,
        width: Math.min(Math.round(t.w * image.width), image.width - left),
        height: Math.min(Math.round(t.h * image.height), image.height - top),
      };
      const crop = await sharp(image.jpeg).extract(region).jpeg({ quality: 88 }).toBuffer();
      const { json } = await chat({
        model,
        logprobs: true,
        top_logprobs: 12,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: breakProbe.text, images: [crop.toString('base64')] },
        ],
        options: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: 2 },
      });
      heat.push(+answerMass(json.logprobs, ['yes', 'no']).normalized.yes.toFixed(4));
    }
    const g2Ms = performance.now() - t1;
    const row = {
      id: c.id,
      domain: c.domain,
      width: image.width,
      height: image.height,
      truth: c.publisherBoxes ?? null,
      g1,
      g1Ms: Math.round(g1Ms),
      heat,
      g2Ms: Math.round(g2Ms),
    };
    await appendJsonl(file, row);
    if (a.overlay) {
      const W = image.width,
        H = image.height;
      const rects = tiles
        .map((t, i) => {
          const o = Math.min(0.75, heat[i] * 0.75);
          return `<rect x="${t.x * W + 0.125 * W}" y="${t.y * H + 0.125 * H}" width="${0.25 * W}" height="${0.25 * H}" fill="rgb(255,40,40)" fill-opacity="${o.toFixed(2)}"/><text x="${t.x * W + 0.25 * W}" y="${t.y * H + 0.25 * H}" font-size="${Math.round(W / 28)}" fill="white" stroke="black" stroke-width="1" text-anchor="middle">${heat[i].toFixed(2)}</text>`;
        })
        .join('');
      const [x1, y1, x2, y2] = g1.bbox_2d;
      const boxSvg = g1.found
        ? `<rect x="${(x1 / 1000) * W}" y="${(y1 / 1000) * H}" width="${((x2 - x1) / 1000) * W}" height="${((y2 - y1) / 1000) * H}" fill="none" stroke="rgb(0,255,120)" stroke-width="${Math.max(3, W / 200)}"/>`
        : '';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${rects}${boxSvg}</svg>`;
      const dir = path.join(ROOT, 'experiments', 'backend-v2', 'private-overlays');
      await fs.mkdir(dir, { recursive: true });
      // Composite at full size first, then shrink in a second pipeline: sharp applies resize before
      // composite inside one pipeline, which made the full-size overlay larger than the base (fixed
      // 2026-11-17).
      const drawn = await sharp(image.jpeg).composite([{ input: Buffer.from(svg) }]).toBuffer();
      await sharp(drawn)
        .resize({ width: 900, withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toFile(path.join(dir, c.id + '.jpg'));
    }
  } catch (error) {
    await appendJsonl(file, { id: c.id, error: String(error.message ?? error) });
  }
}
console.log('done', file);
