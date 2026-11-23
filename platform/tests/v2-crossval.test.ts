import { describe, expect, it } from 'vitest';
import { fitBand } from '../packages/core/v2/calibration';
import {
  bandCounts,
  crossValidate,
  groupFolds,
  seededRandom,
  transfer,
  type GroupedExample,
} from '../packages/core/v2/crossval';

/** Synthetic set: damaged scores high, clean scores low, with a little overlap, in groups of 3. */
function synthetic(n: number, seed = 3): GroupedExample[] {
  const random = seededRandom(seed);
  return Array.from({ length: n }, (_, i) => {
    const damaged = i % 2 === 0;
    const base = damaged ? 0.55 + 0.45 * random() : 0.45 * random();
    return {
      id: 'p' + i,
      damaged,
      score: Math.min(1, Math.max(0, base + (random() < 0.1 ? (damaged ? -0.4 : 0.4) : 0))),
      group: 'g' + Math.floor(i / 3),
      domain: i % 5 === 0 ? 'gear' : 'fabric',
    };
  });
}

describe('backend v2 cross-validation of the threshold fit', () => {
  it('keeps every source group inside one fold', () => {
    const examples = synthetic(90);
    const folds = groupFolds(examples, 5, seededRandom(11));
    expect(folds.flat()).toHaveLength(90);
    const foldOf = new Map<string, number>();
    folds.forEach((fold, f) =>
      fold.forEach((e) => {
        expect(foldOf.get(e.group) ?? f).toBe(f);
        foldOf.set(e.group, f);
      }),
    );
    const sizes = folds.map((f) => f.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(3);
  });

  it('is reproducible from its seed and counts every photograph once per repeat', () => {
    const examples = synthetic(120);
    const a = crossValidate(examples, { repeats: 4, seed: 5, keep: 0.95, wrongBlock: 0.02 });
    const b = crossValidate(examples, { repeats: 4, seed: 5, keep: 0.95, wrongBlock: 0.02 });
    expect(a).toEqual(b);
    expect(a.pooled.damaged + a.pooled.clean).toBe(120 * 4);
    for (const r of a.perRepeat)
      expect(r.damagedCleared).toBeLessThanOrEqual(examples.filter((e) => e.damaged).length);
    expect(a.bands).toHaveLength(4 * 5);
    expect(a.byDomain.gear!.damaged + a.byDomain.gear!.clean).toBe(
      examples.filter((e) => e.domain === 'gear').length * 4,
    );
  });

  it('matches the in-sample counts when fitting and counting use the same photographs', () => {
    const examples = synthetic(100);
    const fit = fitBand(examples, { keep: 0.97, wrongBlock: 0.02 });
    const { counts } = transfer(examples, examples, { keep: 0.97, wrongBlock: 0.02 });
    expect(counts.damagedCleared).toBe(fit.damagedCleared);
    expect(counts.cleanBlocked).toBe(fit.cleanBlocked);
    expect(counts.damagedBlocked).toBe(fit.damagedBlocked);
    expect(counts.cleanCleared).toBe(fit.cleanCleared);
  });

  it('counts the three bands with the same boundaries as the policy', () => {
    const counts = bandCounts(
      [
        { id: 'a', damaged: true, score: 0.1 },
        { id: 'b', damaged: true, score: 0.2 },
        { id: 'c', damaged: true, score: 0.7 },
        { id: 'd', damaged: false, score: 0.69 },
      ],
      { clear: 0.2, block: 0.7 },
    );
    // Below clear clears; clear itself is review; block itself blocks.
    expect(counts).toMatchObject({
      damagedCleared: 1,
      damagedReview: 1,
      damagedBlocked: 1,
      cleanReview: 1,
    });
  });

  it('refuses nonsense settings', () => {
    expect(() => groupFolds(synthetic(10), 1, seededRandom(1))).toThrow();
    expect(() => crossValidate(synthetic(10), { repeats: 0 })).toThrow();
  });
});
