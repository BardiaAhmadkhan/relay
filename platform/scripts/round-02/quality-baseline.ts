import type { Quality } from '../../packages/core/schema';
/** Pixel statistics are acquisition heuristics, not garment-condition evidence. */
export function analyzePixels(
  rgba: Uint8Array,
  width: number,
  height: number,
  originalWidth = width,
  originalHeight = height,
): Quality {
  if (width < 3 || height < 3 || rgba.length !== width * height * 4)
    throw new Error('Invalid pixel buffer');
  const gray = new Float64Array(width * height);
  let sum = 0;
  for (let i = 0; i < gray.length; i++) {
    const j = i * 4;
    const y = 0.2126 * rgba[j]! + 0.7152 * rgba[j + 1]! + 0.0722 * rgba[j + 2]!;
    gray[i] = y;
    sum += y;
  }
  let lapSum = 0,
    lapSq = 0,
    count = 0;
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = gray[i - width]! + gray[i + width]! + gray[i - 1]! + gray[i + 1]! - 4 * gray[i]!;
      lapSum += v;
      lapSq += v * v;
      count++;
    }
  const brightness = sum / gray.length,
    sharpness = Math.max(0, lapSq / count - (lapSum / count) ** 2);
  const warnings: Quality['warnings'] = [];
  if (
    Math.min(originalWidth, originalHeight) < 240 ||
    Math.max(originalWidth, originalHeight) < 480
  )
    warnings.push('low_resolution');
  // Only severe exposure issues block progress. 'soft' is advisory until calibrated on gear.
  if (brightness < 12) warnings.push('dark');
  if (brightness > 248) warnings.push('bright');
  if (sharpness < 20) warnings.push('soft');
  return { width: originalWidth, height: originalHeight, brightness, sharpness, warnings };
}
