import sharp from 'sharp';
import {
  FOCUS_GRID,
  focusMeasures,
  focusVerdict,
  type FocusVerdict,
} from '../packages/core/v2/focus';
import type { Quality } from '../packages/core/schema';

/** Focus of a prepared photograph on the fixed 512 px grid, measured exactly as the experiments
 * measured it (experiments/backend-v2/focus-measures.mjs), so the calibrated threshold applies. */
export async function measureFocus(jpeg: Uint8Array): Promise<FocusVerdict> {
  const { data, info } = await sharp(jpeg)
    .resize({
      width: FOCUS_GRID,
      height: FOCUS_GRID,
      fit: 'inside',
      withoutEnlargement: false,
      kernel: 'linear',
    })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 1) throw new Error('Unexpected channel count for the focus grid');
  return focusVerdict(focusMeasures(data, info.width, info.height));
}

/** v2 quality record: v1's exposure and size warnings, with v1's uncalibrated `soft` (a 192 px
 * preview measure) replaced by the calibrated gate. In v2 records `sharpness` holds the normalised
 * focus (Laplacian variance over luminance variance on the 512 px grid; soft below 0.016). */
export function withFocus(quality: Quality, focus: FocusVerdict): Quality {
  return {
    ...quality,
    sharpness: focus.normVar,
    warnings: [
      ...quality.warnings.filter((w) => w !== 'soft'),
      ...(focus.soft ? ['soft' as const] : []),
    ],
  };
}
