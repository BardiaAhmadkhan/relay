import { describe, expect, it } from 'vitest';
import { auc, fitBand, wilson, type LabelledScore } from '../packages/core/v2/calibration';

const make = (damaged: number[], clean: number[]): LabelledScore[] => [
  ...damaged.map((score, i) => ({ id: 'd' + i, damaged: true, score })),
  ...clean.map((score, i) => ({ id: 'c' + i, damaged: false, score })),
];
const spread = (n: number, from: number, to: number) =>
  Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));

describe('threshold calibration', () => {
  it('keeps every damaged example and blocks no clean example on separable scores', () => {
    const fit = fitBand(make(spread(40, 0.6, 0.99), spread(40, 0.01, 0.3)), {
      keep: 1,
      wrongBlock: 0,
    });
    expect(fit.damagedCleared).toBe(0);
    expect(fit.cleanBlocked).toBe(0);
    expect(fit.clear).toBeLessThanOrEqual(0.6);
    expect(fit.block).toBeGreaterThan(0.3);
    expect(fit.clear).toBeLessThanOrEqual(fit.block);
    expect(fit.lowEvidence).toBe(false);
  });

  it('honours the keep and wrongBlock allowances exactly', () => {
    const damaged = spread(100, 0.05, 0.95),
      clean = spread(100, 0.01, 0.8);
    const fit = fitBand(make(damaged, clean), { keep: 0.97, wrongBlock: 0.02 });
    expect(fit.damagedCleared).toBeLessThanOrEqual(3);
    expect(fit.cleanBlocked).toBeLessThanOrEqual(2);
    expect(fit.clearedDamagedIds).toHaveLength(fit.damagedCleared);
    const tighter = fitBand(make(damaged, clean), { keep: 1, wrongBlock: 0 });
    expect(tighter.clear).toBeLessThanOrEqual(fit.clear);
    expect(tighter.block).toBeGreaterThanOrEqual(fit.block);
    expect(tighter.damagedCleared).toBe(0);
    expect(tighter.cleanBlocked).toBe(0);
  });

  it('collapses to one threshold when the bands would cross, and says so', () => {
    const fit = fitBand(make(spread(30, 0.7, 0.9), spread(30, 0.0, 0.1)), {
      keep: 0.5,
      wrongBlock: 0.5,
    });
    expect(fit.collapsed).toBe(true);
    expect(fit.clear).toBe(fit.block);
  });

  it('flags small sets and rejects impossible input', () => {
    expect(fitBand(make([0.9, 0.8], [0.1, 0.2])).lowEvidence).toBe(true);
    expect(() => fitBand(make([], [0.1]))).toThrow('both classes');
    expect(() => fitBand(make([1.2], [0.1]))).toThrow('out of range');
    expect(() => fitBand(make([0.9], [0.1]), { keep: 0 })).toThrow('invalid');
  });

  it('computes ranking quality and intervals', () => {
    expect(auc(make([0.9, 0.8], [0.1, 0.2]))).toBe(1);
    expect(auc(make([0.5], [0.5]))).toBe(0.5);
    expect(auc(make([0.1], [0.9]))).toBe(0);
    const [lo, hi] = wilson(0, 15);
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThan(0.19);
    expect(hi).toBeLessThan(0.21);
    expect(wilson(0, 0)).toEqual([0, 1]);
  });
});
