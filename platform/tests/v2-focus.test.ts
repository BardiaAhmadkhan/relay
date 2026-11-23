import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  MIN_LUMA_VARIANCE,
  SOFT_NORMVAR,
  focusMeasures,
  focusVerdict,
} from '../packages/core/v2/focus';
import { measureFocus, withFocus } from '../server/focus';

/** A committed public fixture prepared like the blur experiment: 1024 px working size, optional
 * degradation, JPEG 84 (experiments/backend-v2/lib.mjs prepare()). Synthetic textures do not stand
 * in for photographs here: the threshold was calibrated on photographs. */
async function fixture(name: string, degrade: { blur?: number; brightness?: number } = {}) {
  let image = sharp(
    await fs.readFile(path.join(import.meta.dirname, '..', 'assets/fixtures', name)),
  )
    .rotate()
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' });
  if (degrade.blur) image = image.blur(degrade.blur);
  if (degrade.brightness) image = image.modulate({ brightness: degrade.brightness });
  return image.jpeg({ quality: 84, mozjpeg: true }).toBuffer();
}

describe('backend v2 capture gate', () => {
  it('measures detail relative to contrast', () => {
    expect(focusMeasures(new Uint8Array(9).fill(80), 3, 3)).toEqual({
      lapVar: 0,
      variance: 0,
      normVar: 0,
    });
    const checker = new Uint8Array(64 * 64).map(
      (_, i) => (((i % 64) + Math.floor(i / 64)) % 2) * 200,
    );
    const full = focusMeasures(checker, 64, 64);
    expect(full.lapVar).toBeGreaterThan(100_000);
    // Halving the contrast quarters both variances: the normalised value does not move.
    const half = focusMeasures(
      checker.map((v) => v / 2),
      64,
      64,
    );
    expect(half.lapVar).toBeCloseTo(full.lapVar / 4, 6);
    expect(half.normVar).toBeCloseTo(full.normVar, 9);
    expect(() => focusMeasures(new Uint8Array(8), 3, 3)).toThrow('Invalid');
    expect(() => focusMeasures(new Uint8Array(4), 2, 2)).toThrow('Invalid');
  });

  it('applies the calibrated thresholds exactly at their boundaries', () => {
    expect(SOFT_NORMVAR).toBe(0.016);
    expect(MIN_LUMA_VARIANCE).toBe(10);
    expect(focusVerdict({ lapVar: 1, variance: 100, normVar: 0.01599 }).soft).toBe(true);
    expect(focusVerdict({ lapVar: 1, variance: 100, normVar: 0.016 }).soft).toBe(false);
    // A frame with no contrast cannot be judged, whatever the ratio says.
    expect(focusVerdict({ lapVar: 0.5, variance: 9.99, normVar: 0.5 }).soft).toBe(true);
    expect(focusVerdict({ lapVar: 0.5, variance: 10, normVar: 0.05 }).soft).toBe(false);
    expect(() => focusVerdict({ lapVar: Number.NaN, variance: 1, normVar: 0 })).toThrow();
    expect(() => focusVerdict({ lapVar: 1, variance: 1, normVar: -1 })).toThrow();
  });

  it('passes sharp, mildly soft and dim photographs, and stops one blurred to the harmful level', async () => {
    // Sigma 1.5 did not change ranking quality in the sweep; sigma 3 cleared nine damaged photographs.
    // Dimming to 55% is the case the absolute measure got wrong (13% of sharp photographs flagged).
    for (const name of ['leather-jacket.jpg', 'backpack-label.jpg', 'crashed-shoulder.jpg']) {
      const [sharpFocus, mild, dim, blurred] = await Promise.all(
        [{}, { blur: 1.5 }, { brightness: 0.55 }, { blur: 3 }].map(async (d) =>
          measureFocus(await fixture(name, d)),
        ),
      );
      expect(sharpFocus!.soft, name + ' sharp').toBe(false);
      expect(mild!.soft, name + ' sigma 1.5').toBe(false);
      expect(dim!.soft, name + ' dimmed').toBe(false);
      expect(blurred!.soft, name + ' sigma 3').toBe(true);
      expect(sharpFocus!.normVar).toBeGreaterThan(mild!.normVar);
      expect(mild!.normVar).toBeGreaterThan(blurred!.normVar);
    }
  });

  it('replaces the uncalibrated v1 flag and records the normalised value', () => {
    const v1 = {
      width: 1024,
      height: 768,
      brightness: 120,
      sharpness: 12,
      warnings: ['soft' as const],
    };
    const sharpVerdict = focusVerdict({ lapVar: 300, variance: 1000, normVar: 0.3 });
    expect(withFocus(v1, sharpVerdict)).toEqual({ ...v1, sharpness: 0.3, warnings: [] });
    const softVerdict = focusVerdict({ lapVar: 5, variance: 1000, normVar: 0.005 });
    expect(withFocus({ ...v1, warnings: ['dark'] }, softVerdict).warnings).toEqual([
      'dark',
      'soft',
    ]);
  });
});
