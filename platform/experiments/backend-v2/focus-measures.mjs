// E10b. Which focus measure separates blur from dim light? CPU only, no model.
// For the 223 labelled photographs, under each degradation used in queue A (blur 1.5/3/6, JPEG 55,
// brightness 0.55), compute candidate measures on the same prepared image the battery saw:
//   lapVar      variance of the 4-neighbour Laplacian on the 512 px grid (the E10 measure)
//   normMean    lapVar / mean luminance^2 x 1e4            (invariant to a uniform brightness scale)
//   normVar     lapVar / luminance variance                  (invariant to contrast scaling)
//   scaleRatio  lapVar on the 512 grid / lapVar on a 256 grid (fine detail relative to coarse detail)
// node experiments/backend-v2/focus-measures.mjs   -> benchmarks/backend-v2/focus-measures.jsonl
import path from 'node:path';
import sharp from 'sharp';
import { OUT, loadCases, prepare, appendJsonl, done } from './lib.mjs';

const file = path.join(OUT, 'focus-measures.jsonl');
const LEVELS = {
  sharp: {},
  'blur1.5': { blur: 1.5 },
  blur3: { blur: 3 },
  blur6: { blur: 6 },
  'dim0.55': { brightness: 0.55 },
  q55: { quality: 55 },
};
async function grid(jpeg, size) {
  const { data, info } = await sharp(jpeg)
    .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: false, kernel: 'linear' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width,
    h = info.height;
  let lapSum = 0,
    lapSq = 0,
    n = 0,
    mean = 0,
    sq = 0;
  for (let i = 0; i < data.length; i++) {
    mean += data[i];
    sq += data[i] * data[i];
  }
  mean /= data.length;
  const variance = sq / data.length - mean * mean;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = data[i - w] + data[i + w] + data[i - 1] + data[i + 1] - 4 * data[i];
      lapSum += lap;
      lapSq += lap * lap;
      n++;
    }
  return { lapVar: lapSq / n - (lapSum / n) ** 2, mean, variance };
}
const cases = (await loadCases()).filter((c) =>
  ['visible_defect', 'no_visible_defect'].includes(c.condition),
);
const finished = await done(file);
for (const c of cases) {
  if (finished.has(c.id)) continue;
  const row = { id: c.id, domain: c.domain, condition: c.condition, levels: {} };
  for (const [name, degrade] of Object.entries(LEVELS)) {
    const image = await prepare(c.file, 1024, degrade);
    const g512 = await grid(image.jpeg, 512),
      g256 = await grid(image.jpeg, 256);
    row.levels[name] = {
      lapVar: +g512.lapVar.toFixed(3),
      normMean: +((g512.lapVar / Math.max(g512.mean, 20) ** 2) * 1e4).toFixed(3),
      normVar: +(g512.lapVar / Math.max(g512.variance, 1)).toFixed(5),
      scaleRatio: +(g512.lapVar / Math.max(g256.lapVar, 1e-6)).toFixed(5),
      mean: +g512.mean.toFixed(1),
    };
  }
  await appendJsonl(file, row);
}
console.log('done', file);
