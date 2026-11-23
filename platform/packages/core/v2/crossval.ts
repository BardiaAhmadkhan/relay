import { fitBand, wilson, type LabelledScore } from './calibration';

/** Out-of-sample check of the threshold-fitting procedure in ./calibration.ts. Pure functions; no I/O.
 *
 * Thresholds fitted and counted on the same photographs say how well the bands describe those
 * photographs, not how they will behave on new ones. Cross-validation fits the bands on part of the
 * labelled set and counts what happens to the rest. Photographs from one source (one capture session,
 * one product shoot, one uploader) look alike, so whole source groups are held out together; holding
 * out single photographs would let near-duplicates leak from the fitting side to the counting side.
 * Design record: docs/22-backend-v2/build-guide.md section 11.
 */
export type GroupedExample = LabelledScore & { group: string; domain?: string };
export type Band = { clear: number; block: number };
export type BandCounts = {
  damaged: number;
  clean: number;
  damagedCleared: number;
  damagedReview: number;
  damagedBlocked: number;
  cleanCleared: number;
  cleanReview: number;
  cleanBlocked: number;
};

const empty = (): BandCounts => ({
  damaged: 0,
  clean: 0,
  damagedCleared: 0,
  damagedReview: 0,
  damagedBlocked: 0,
  cleanCleared: 0,
  cleanReview: 0,
  cleanBlocked: 0,
});
function add(into: BandCounts, from: BandCounts) {
  for (const key of Object.keys(into) as Array<keyof BandCounts>) into[key] += from[key];
}

/** Where each example lands under one band: below clear, between, or at or above block. */
export function bandCounts(examples: LabelledScore[], band: Band): BandCounts {
  const counts = empty();
  for (const e of examples) {
    const where = e.score < band.clear ? 'Cleared' : e.score < band.block ? 'Review' : 'Blocked';
    if (e.damaged) {
      counts.damaged++;
      counts[`damaged${where}`]++;
    } else {
      counts.clean++;
      counts[`clean${where}`]++;
    }
  }
  return counts;
}

/** Small seeded generator (mulberry32), so every report can be reproduced from its seed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Split whole groups into k folds of similar size. Groups are shuffled, then placed largest first,
 * each into the fold with the fewest examples so far. A group larger than n / k fills a fold alone. */
export function groupFolds<T extends { group: string }>(
  examples: T[],
  k: number,
  random: () => number,
): T[][] {
  if (!Number.isInteger(k) || k < 2) throw new Error('at least two folds are required');
  const byGroup = new Map<string, T[]>();
  for (const e of examples) {
    const list = byGroup.get(e.group);
    if (list) list.push(e);
    else byGroup.set(e.group, [e]);
  }
  const groups = [...byGroup.values()];
  // Fisher-Yates, then a stable sort by size: equal-sized groups keep their shuffled order.
  for (let i = groups.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [groups[i], groups[j]] = [groups[j]!, groups[i]!];
  }
  groups.sort((a, b) => b.length - a.length);
  const folds: T[][] = Array.from({ length: k }, () => []);
  for (const group of groups) {
    let smallest = 0;
    for (let f = 1; f < k; f++) if (folds[f]!.length < folds[smallest]!.length) smallest = f;
    folds[smallest]!.push(...group);
  }
  return folds;
}

export type CrossValidation = {
  folds: number;
  repeats: number;
  seed: number;
  keep: number;
  wrongBlock: number;
  /** Folds whose fitting side lacked one class and therefore could not be fitted. */
  skippedFolds: number;
  /** Every held-out photograph counted once per repeat, summed over repeats. */
  pooled: BandCounts;
  /** The same pooled counts per domain label (for example "gear"). */
  byDomain: Record<string, BandCounts>;
  /** Totals of single repeats: each covers every photograph exactly once. */
  perRepeat: Array<
    Pick<BandCounts, 'damagedCleared' | 'cleanBlocked' | 'damagedReview' | 'cleanReview'>
  >;
  /** Every band fitted on a fitting side, in fold order. */
  bands: Band[];
  /** 95% Wilson interval of the pooled shares, treating repeats as one sample (an optimistic width). */
  damagedClearedShare: { value: number; interval: [number, number] };
  cleanBlockedShare: { value: number; interval: [number, number] };
};

/** Repeated grouped k-fold cross-validation of fitBand(). */
export function crossValidate(
  examples: GroupedExample[],
  options: {
    folds?: number;
    repeats?: number;
    seed?: number;
    keep?: number;
    wrongBlock?: number;
  } = {},
): CrossValidation {
  const k = options.folds ?? 5,
    repeats = options.repeats ?? 20,
    seed = options.seed ?? 1,
    keep = options.keep ?? 0.97,
    wrongBlock = options.wrongBlock ?? 0.02;
  if (!Number.isInteger(repeats) || repeats < 1) throw new Error('at least one repeat is required');
  const pooled = empty(),
    byDomain: Record<string, BandCounts> = {},
    perRepeat: CrossValidation['perRepeat'] = [],
    bands: Band[] = [];
  let skippedFolds = 0;
  for (let r = 0; r < repeats; r++) {
    const folds = groupFolds(examples, k, seededRandom(seed + r));
    const repeat = empty();
    for (let f = 0; f < k; f++) {
      const test = folds[f]!;
      if (!test.length) continue;
      const train = folds.filter((_, i) => i !== f).flat();
      if (!train.some((e) => e.damaged) || !train.some((e) => !e.damaged)) {
        skippedFolds++;
        continue;
      }
      const fit = fitBand(train, { keep, wrongBlock });
      const band = { clear: fit.clear, block: fit.block };
      bands.push(band);
      add(repeat, bandCounts(test, band));
      for (const e of test) add((byDomain[e.domain ?? 'all'] ??= empty()), bandCounts([e], band));
    }
    add(pooled, repeat);
    perRepeat.push({
      damagedCleared: repeat.damagedCleared,
      cleanBlocked: repeat.cleanBlocked,
      damagedReview: repeat.damagedReview,
      cleanReview: repeat.cleanReview,
    });
  }
  const share = (hits: number, n: number) => ({
    value: n ? hits / n : 0,
    interval: wilson(hits / repeats, n / repeats),
  });
  return {
    folds: k,
    repeats,
    seed,
    keep,
    wrongBlock,
    skippedFolds,
    pooled,
    byDomain,
    perRepeat,
    bands,
    damagedClearedShare: share(pooled.damagedCleared, pooled.damaged),
    cleanBlockedShare: share(pooled.cleanBlocked, pooled.clean),
  };
}

/** Fit on one set and count on another: for example fit on everything but gear, count on gear. */
export function transfer(
  fitOn: LabelledScore[],
  countOn: LabelledScore[],
  options: { keep?: number; wrongBlock?: number } = {},
): { band: Band; counts: BandCounts } {
  const fit = fitBand(fitOn, options);
  const band = { clear: fit.clear, block: fit.block };
  return { band, counts: bandCounts(countOn, band) };
}
