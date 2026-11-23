import type { Quality } from './schema';

// A 1024 x 1024 preview needs at most 8 MiB for the Float64 luminance buffer.
// Current callers use previews with a longest edge of 192 pixels.
export const MAX_QUALITY_PREVIEW_PIXELS = 1_048_576;

/** Pixel statistics are acquisition heuristics, not garment-condition evidence. */
export function analyzePixels(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  originalWidth = width,
  originalHeight = height,
): Quality {
  if (
    !(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 3 ||
    height < 3 ||
    width > MAX_QUALITY_PREVIEW_PIXELS / height ||
    !Number.isSafeInteger(originalWidth) ||
    !Number.isSafeInteger(originalHeight) ||
    originalWidth <= 0 ||
    originalHeight <= 0 ||
    rgba.length !== width * height * 4
  )
    throw new Error('Invalid pixel buffer');

  const gray = new Float64Array(width * height);
  let sum = 0;
  for (let i = 0; i < gray.length; i++) {
    const j = i * 4;
    const opacity = rgba[j + 3]! / 255;
    // Match the server's explicit white background. Invisible RGB must not
    // change warnings. The opaque branch retains the original arithmetic.
    const red = opacity === 1 ? rgba[j]! : 255 + (rgba[j]! - 255) * opacity;
    const green = opacity === 1 ? rgba[j + 1]! : 255 + (rgba[j + 1]! - 255) * opacity;
    const blue = opacity === 1 ? rgba[j + 2]! : 255 + (rgba[j + 2]! - 255) * opacity;
    const y = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    gray[i] = y;
    sum += y;
  }
  let lapSum = 0,
    lapSq = 0,
    count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = gray[i - width]! + gray[i + width]! + gray[i - 1]! + gray[i + 1]! - 4 * gray[i]!;
      lapSum += v;
      lapSq += v * v;
      count++;
    }
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
