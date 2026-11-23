import sharp from 'sharp';
import jpeg from 'jpeg-js';
import { analyzePixels as baselineAnalyzePixels } from './quality-baseline';
import type { Quality } from '../../packages/core/schema';
import type { Metric, Transform } from './quality-protocol';

export interface Pixels {
  data: Uint8Array;
  width: number;
  height: number;
}
export interface ScaleMetrics {
  mean: number;
  variance: number;
  laplacian: number;
  tenengrad: number;
  normalizedLaplacian: number;
  normalizedTenengrad: number;
  blackFraction: number;
  whiteFraction: number;
}
export function validateOpaquePixels(
  p: Pixels,
  originalWidth = p.width,
  originalHeight = p.height,
): void {
  if (
    ![p.width, p.height].every((n) => Number.isSafeInteger(n) && n >= 3) ||
    ![originalWidth, originalHeight].every((n) => Number.isSafeInteger(n) && n > 0) ||
    p.data.length !== p.width * p.height * 4
  )
    throw new Error('invalid_pixel_geometry');
  for (let i = 3; i < p.data.length; i += 4)
    if (p.data[i] !== 255) throw new Error('nonopaque_pixels_require_compositing');
}
export function scaleMetrics(p: Pixels): ScaleMetrics {
  validateOpaquePixels(p);
  const count = p.width * p.height,
    gray = new Float64Array(count);
  let sum = 0,
    squareSum = 0,
    black = 0,
    white = 0;
  for (let i = 0; i < count; i++) {
    const at = i * 4,
      value = 0.2126 * p.data[at]! + 0.7152 * p.data[at + 1]! + 0.0722 * p.data[at + 2]!;
    gray[i] = value;
    sum += value;
    squareSum += value * value;
    if (value <= 2) black++;
    if (value >= 253) white++;
  }
  let lapSum = 0,
    lapSquares = 0,
    gradientSquares = 0,
    interior = 0;
  const w = p.width;
  for (let y = 1; y < p.height - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = gray[i - w]! + gray[i + w]! + gray[i - 1]! + gray[i + 1]! - 4 * gray[i]!;
      const gx =
        (-gray[i - w - 1]! +
          gray[i - w + 1]! -
          2 * gray[i - 1]! +
          2 * gray[i + 1]! -
          gray[i + w - 1]! +
          gray[i + w + 1]!) /
        8;
      const gy =
        (-gray[i - w - 1]! -
          2 * gray[i - w]! -
          gray[i - w + 1]! +
          gray[i + w - 1]! +
          2 * gray[i + w]! +
          gray[i + w + 1]!) /
        8;
      lapSum += lap;
      lapSquares += lap * lap;
      gradientSquares += gx * gx + gy * gy;
      interior++;
    }
  const mean = sum / count,
    variance = Math.max(0, squareSum / count - mean * mean);
  const laplacian = Math.max(0, lapSquares / interior - (lapSum / interior) ** 2);
  const tenengrad = gradientSquares / interior;
  return {
    mean,
    variance,
    laplacian,
    tenengrad,
    normalizedLaplacian: laplacian / (variance + 1),
    normalizedTenengrad: tenengrad / (variance + 1),
    blackFraction: black / count,
    whiteFraction: white / count,
  };
}
export interface Measurements {
  quality: Quality;
  metrics: Record<Metric, number>;
  scales: { '96': ScaleMetrics; '192': ScaleMetrics };
  metricDurationMs: number;
  preprocessDurationMs: number;
  outputBytes: number;
}
export function measureScales(
  small: Pixels,
  large: Pixels,
  originalWidth: number,
  originalHeight: number,
  outputBytes: number,
  preprocessDurationMs: number,
): Measurements {
  const started = performance.now();
  const m96 = scaleMetrics(small),
    m192 = scaleMetrics(large);
  const quality = baselineAnalyzePixels(
    large.data,
    large.width,
    large.height,
    originalWidth,
    originalHeight,
  );
  return {
    quality,
    metrics: {
      laplacian192: m192.laplacian,
      normalizedLaplacian192: m192.normalizedLaplacian,
      tenengrad192: m192.tenengrad,
      normalizedTenengrad192: m192.normalizedTenengrad,
      multiscaleNormalizedTenengrad: (m96.normalizedTenengrad + m192.normalizedTenengrad) / 2,
    },
    scales: { '96': m96, '192': m192 },
    metricDurationMs: performance.now() - started,
    preprocessDurationMs,
    outputBytes,
  };
}
async function rawPreview(bytes: Uint8Array, edge: number): Promise<Pixels> {
  const raw = await sharp(bytes)
    .resize({ width: edge, height: edge, fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: raw.data, width: raw.info.width, height: raw.info.height };
}
export async function frozenServer(
  bytes: Uint8Array,
): Promise<{ jpeg: Buffer; measurement: Measurements; raw192: Pixels }> {
  const started = performance.now();
  const output = await sharp(bytes, {
    limitInputPixels: 24_000_000,
    failOn: 'error',
    animated: false,
  })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  const [small, large] = await Promise.all([
    rawPreview(output.data, 96),
    rawPreview(output.data, 192),
  ]);
  return {
    jpeg: output.data,
    raw192: large,
    measurement: measureScales(
      small,
      large,
      output.info.width,
      output.info.height,
      output.data.length,
      performance.now() - started,
    ),
  };
}
export async function mobileProxy(bytes: Uint8Array): Promise<{
  jpeg: Buffer;
  measurement: Measurements;
  decoderComparison: {
    meanAbsoluteByteDifference: number;
    sharpnessDelta: number;
    brightnessDelta: number;
    warningsAgree: boolean;
  };
}> {
  const started = performance.now();
  const output = await sharp(bytes)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  async function preview(edge: number) {
    const encoded = await sharp(output.data)
      .resize({ width: edge, height: edge, fit: 'inside' })
      .jpeg({ quality: 90 })
      .toBuffer();
    const decoded = jpeg.decode(encoded, {
      useTArray: true,
      formatAsRGBA: true,
      maxMemoryUsageInMB: 32,
    });
    return {
      encoded,
      pixels: { data: decoded.data, width: decoded.width, height: decoded.height },
    };
  }
  const [small, large] = await Promise.all([preview(96), preview(192)]);
  const measurement = measureScales(
    small.pixels,
    large.pixels,
    output.info.width,
    output.info.height,
    output.data.length,
    performance.now() - started,
  );
  const reference = await sharp(large.encoded)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (reference.data.length !== large.pixels.data.length)
    throw new Error('decoder_geometry_disagreement');
  let absolute = 0;
  for (let i = 0; i < reference.data.length; i++)
    absolute += Math.abs(reference.data[i]! - large.pixels.data[i]!);
  const referenceQuality = baselineAnalyzePixels(
    reference.data,
    reference.info.width,
    reference.info.height,
    output.info.width,
    output.info.height,
  );
  return {
    jpeg: output.data,
    measurement,
    decoderComparison: {
      meanAbsoluteByteDifference: absolute / reference.data.length,
      sharpnessDelta: measurement.quality.sharpness - referenceQuality.sharpness,
      brightnessDelta: measurement.quality.brightness - referenceQuality.brightness,
      warningsAgree:
        JSON.stringify(measurement.quality.warnings) === JSON.stringify(referenceQuality.warnings),
    },
  };
}
export async function transformFixture(bytes: Uint8Array, transform: Transform): Promise<Buffer> {
  let pipeline = sharp(bytes).rotate();
  if (transform.family === 'blur') pipeline = pipeline.blur(transform.sigma);
  if (transform.family === 'gain') pipeline = pipeline.linear(transform.gain, 0);
  if (transform.family === 'resolution')
    pipeline = pipeline.resize({
      width: transform.longEdge,
      height: transform.longEdge,
      fit: 'inside',
      withoutEnlargement: true,
    });
  if (transform.family === 'rotation') pipeline = pipeline.rotate(transform.degrees);
  return transform.family === 'jpeg'
    ? pipeline.jpeg({ quality: transform.quality }).toBuffer()
    : pipeline.png().toBuffer();
}
