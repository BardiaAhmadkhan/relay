/** Capture gate, backend v2 (work package 5). Pure functions; no I/O.
 *
 * Measured on a FIXED grid: the prepared photograph resized to fit inside 512 x 512 (linear kernel),
 * greyscale. The gate value is the NORMALISED focus: the variance of the 4-neighbour Laplacian divided
 * by the variance of the luminance. Dividing by the luminance variance cancels contrast and exposure,
 * so a sharp photograph taken in dim light is not mistaken for a blurred one.
 *
 * Evidence (docs/22-backend-v2/experiment-report.md, E10 and E10b; 223 labelled photographs at the
 * 1024 px working size, degradations applied before encoding):
 *   normVar < 0.016 flagged 0 of 223 sharp photographs, 0 of 223 dimmed to 55% brightness and 2 of
 *   223 recompressed at JPEG 55; it caught 87% of photographs blurred at sigma 3 and 99.6% at sigma 6,
 *   and sent back every damaged photograph the blur had moved into the clear band (9 of 9 at sigma 3,
 *   40 of 40 at sigma 6). Blur at sigma 1.5 did not change ranking quality, so it is not gated.
 *   The absolute Laplacian variance (lapVar < 50) caught the same damaged photographs but also flagged
 *   13% of the dimmed sharp photographs, which is why it is recorded but not used as the gate.
 * Limits: Gaussian blur and uniform dimming stand in for real defocus, motion blur and venue light.
 */
export const FOCUS_GRID = 512;
/** Below this normalised focus the photograph is too soft to clear damage: retake. */
export const SOFT_NORMVAR = 0.016;
/** Below this luminance variance the frame has no contrast to judge (a lens cap, a featureless
 * defocused surface) and the ratio means nothing: also a retake. The lowest value among the 223
 * photographs was 114 sharp and 27 when dimmed to 55%, so no real photograph in the set reaches it. */
export const MIN_LUMA_VARIANCE = 10;

export type FocusMeasures = { lapVar: number; variance: number; normVar: number };

/** Laplacian variance, luminance variance and their ratio over one luminance image. */
export function focusMeasures(
  luma: Uint8Array | Uint8ClampedArray | Float64Array,
  width: number,
  height: number,
): FocusMeasures {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 3 ||
    height < 3 ||
    luma.length !== width * height
  )
    throw new Error('Invalid luminance buffer');
  let mean = 0,
    squares = 0;
  for (let i = 0; i < luma.length; i++) {
    mean += luma[i]!;
    squares += luma[i]! * luma[i]!;
  }
  mean /= luma.length;
  const variance = Math.max(0, squares / luma.length - mean * mean);
  let sum = 0,
    lapSquares = 0,
    count = 0;
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = luma[i - width]! + luma[i + width]! + luma[i - 1]! + luma[i + 1]! - 4 * luma[i]!;
      sum += v;
      lapSquares += v * v;
      count++;
    }
  const lapVar = Math.max(0, lapSquares / count - (sum / count) ** 2);
  // A flat image has no detail to judge: variance floor of 1 keeps the ratio finite and near zero.
  return { lapVar, variance, normVar: lapVar / Math.max(variance, 1) };
}

export type FocusVerdict = { normVar: number; lapVar: number; soft: boolean };
export function focusVerdict(m: FocusMeasures): FocusVerdict {
  if (![m.lapVar, m.variance, m.normVar].every((v) => Number.isFinite(v) && v >= 0))
    throw new Error('Invalid focus value');
  return {
    normVar: Math.round(m.normVar * 1e5) / 1e5,
    lapVar: Math.round(m.lapVar * 100) / 100,
    soft: m.normVar < SOFT_NORMVAR || m.variance < MIN_LUMA_VARIANCE,
  };
}
