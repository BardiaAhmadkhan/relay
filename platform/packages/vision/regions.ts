import sharp from 'sharp';
export const REGION_VERSION = 'texture-proposals-1';
export type Region = { x: number; y: number; width: number; height: number; score: number };
// A bounded, deterministic attention proposal, NOT a damage classifier.
// Scores measure texture contrast within this photograph; they are not probabilities.
export async function proposeRegions(
  jpeg: Uint8Array,
  budget = 2,
): Promise<{ regions: Region[]; durationMs: number }> {
  const start = performance.now();
  const { data, info } = await sharp(jpeg)
    .rotate()
    .resize({ width: 384, height: 384, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = info;
  if (w < 48 || h < 48 || budget < 1) return { regions: [], durationMs: performance.now() - start };
  const gray = new Float32Array(w * h),
    gradient = new Float32Array(w * h),
    angle = new Uint8Array(w * h);
  const borders: number[][] = [[], [], []];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x,
        offset = i * channels;
      gray[i] = 0.2126 * data[offset]! + 0.7152 * data[offset + 1]! + 0.0722 * data[offset + 2]!;
      if (x < 3 || y < 3 || x >= w - 3 || y >= h - 3)
        for (let c = 0; c < 3; c++) borders[c]!.push(data[offset + c]!);
    }
  const bg = borders.map((a) => a.sort((a, b) => a - b)[Math.floor(a.length / 2)]!);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = gray[i + 1]! - gray[i - 1]!,
        gy = gray[i + w]! - gray[i - w]!;
      gradient[i] = Math.hypot(gx, gy);
      angle[i] = Math.min(7, Math.floor(((Math.atan2(gy, gx) + Math.PI) / (2 * Math.PI)) * 8));
    }
  const candidates: Region[] = [];
  for (const fraction of [0.3, 0.48]) {
    const side = Math.max(24, Math.round(Math.min(w, h) * fraction)),
      stride = Math.max(12, Math.floor(side / 2));
    for (let y = 2; y + side < h - 1; y += stride)
      for (let x = 2; x + side < w - 1; x += stride) {
        let sum = 0,
          squares = 0,
          foreground = 0,
          edges = 0;
        const hist = new Float64Array(8),
          strengths = [];
        for (let py = y; py < y + side; py += 2)
          for (let px = x; px < x + side; px += 2) {
            const i = py * w + px,
              offset = i * channels,
              l = gray[i]!,
              g = gradient[i]!;
            sum += l;
            squares += l * l;
            strengths.push(g);
            const distance = Math.hypot(
              data[offset]! - bg[0]!,
              data[offset + 1]! - bg[1]!,
              data[offset + 2]! - bg[2]!,
            );
            if (distance > 28) foreground++;
            if (g > 12) {
              hist[angle[i]!]! += g;
              edges += g;
            }
          }
        const n = strengths.length,
          fg = foreground / n;
        if (fg < 0.35 || edges === 0) continue;
        let entropy = 0;
        for (const weight of hist)
          if (weight > 0) {
            const p = weight / edges;
            entropy -= p * Math.log(p);
          }
        strengths.sort((a, b) => a - b);
        const p90 = strengths[Math.floor(n * 0.9)]!,
          sd = Math.sqrt(Math.max(0, squares / n - (sum / n) ** 2));
        const centre = 1 - 0.25 * Math.hypot((x + side / 2) / w - 0.5, (y + side / 2) / h - 0.5);
        const score =
          p90 * Math.sqrt(sd) * (0.35 + (0.65 * entropy) / Math.log(8)) * Math.sqrt(fg) * centre;
        candidates.push({ x: x / w, y: y / h, width: side / w, height: side / h, score });
      }
  }
  candidates.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
  const regions: Region[] = [];
  for (const r of candidates) {
    if (
      regions.some((p) => {
        const overlap =
          Math.max(0, Math.min(r.x + r.width, p.x + p.width) - Math.max(r.x, p.x)) *
          Math.max(0, Math.min(r.y + r.height, p.y + p.height) - Math.max(r.y, p.y));
        return overlap / Math.min(r.width * r.height, p.width * p.height) > 0.3;
      })
    )
      continue;
    regions.push(r);
    if (regions.length >= Math.min(budget, 4)) break;
  }
  return { regions, durationMs: performance.now() - start };
}
export async function regionImages(jpeg: Uint8Array, regions: Region[]) {
  const image = sharp(jpeg).rotate();
  const full = await image.toBuffer();
  const meta = await sharp(full).metadata();
  return Promise.all(
    regions.map(async (r) => {
      const left = Math.round(r.x * meta.width!),
        top = Math.round(r.y * meta.height!),
        width = Math.min(meta.width! - left, Math.round(r.width * meta.width!)),
        height = Math.min(meta.height! - top, Math.round(r.height * meta.height!));
      return sharp(full)
        .extract({ left, top, width, height })
        .resize({ width: 384, height: 384, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toBuffer();
    }),
  );
}
