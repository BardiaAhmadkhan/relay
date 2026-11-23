import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { prepareImages } from '../server/images';
const sourcePath = 'assets/fixtures/originals/leather-jacket.jpg',
  source = await fs.readFile(sourcePath);
const variants = [
  {
    name: 'reference-1600',
    build: () =>
      sharp(source)
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 84 })
        .toBuffer(),
  },
  {
    name: 'resize-960',
    build: () =>
      sharp(source)
        .resize({ width: 960, height: 960, fit: 'inside' })
        .jpeg({ quality: 84 })
        .toBuffer(),
  },
  {
    name: 'resize-480',
    build: () =>
      sharp(source)
        .resize({ width: 480, height: 480, fit: 'inside' })
        .jpeg({ quality: 84 })
        .toBuffer(),
  },
  { name: 'compressed-q35', build: () => sharp(source).jpeg({ quality: 35 }).toBuffer() },
  { name: 'blur-sigma8', build: () => sharp(source).blur(8).jpeg({ quality: 84 }).toBuffer() },
  { name: 'severe-dark', build: () => sharp(source).linear(0.03).jpeg({ quality: 84 }).toBuffer() },
  {
    name: 'severe-bright',
    build: () => sharp(source).linear(0.01, 250).jpeg({ quality: 84 }).toBuffer(),
  },
  {
    name: 'low-resolution',
    build: () => sharp(source).resize(120, 160, { fit: 'inside' }).jpeg({ quality: 84 }).toBuffer(),
  },
];
const results = [];
for (const variant of variants) {
  const bytes = await variant.build(),
    times: number[] = [];
  let measured;
  for (let i = 0; i < 6; i++) {
    const start = performance.now();
    const result = await prepareImages([
      { id: 'quality-fixture', view: 'front', base64: bytes.toString('base64') },
    ]);
    times.push(performance.now() - start);
    measured = result.photos[0];
  }
  const sorted = times.slice(1).sort((a, b) => a - b);
  results.push({
    variant: variant.name,
    sourceBytes: bytes.length,
    normalizedBytes: measured!.byteLength,
    quality: measured!.quality,
    latencyMs: { cold: times[0], warmSamples: times.slice(1), median: sorted[2], p95: sorted[4] },
  });
}
const result = {
  experiment: 'quality-002',
  recordedAt: new Date().toISOString(),
  source: sourcePath,
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  provenance: 'assets/fixtures/manifest.json',
  environment: {
    node: process.version,
    os: os.platform(),
    architecture: os.arch(),
    cpu: os.cpus()[0]?.model,
  },
  results,
  limitations: [
    'One source image with synthetic degradations; not image-quality rejection accuracy on representative rider photos.',
    'Five warm repetitions per variant; no phone timing, upload timing or condition ground truth.',
    'Blur is an advisory heuristic, not a hard safety or usability gate.',
    'CC BY-SA source derivatives retain original attribution/licence; generated in memory only.',
  ],
};
await fs.mkdir('benchmarks', { recursive: true });
await fs.writeFile('benchmarks/quality-latest.json', JSON.stringify(result, null, 2));
console.log(
  JSON.stringify(
    results.map((r) => ({
      variant: r.variant,
      warnings: r.quality.warnings,
      brightness: r.quality.brightness,
      sharpness: r.quality.sharpness,
      medianMs: r.latencyMs.median,
      bytes: r.normalizedBytes,
    })),
    null,
    2,
  ),
);
