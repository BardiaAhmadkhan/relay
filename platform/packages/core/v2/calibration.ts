/** Threshold fitting for one exclusion question. Pure functions; no I/O.
 *
 * A labelled example is one photograph with an expert (or reference) answer and the scorer's
 * probability. Two thresholds split the score range into three bands:
 *   score <  clear            -> the photograph is treated as showing no such damage
 *   clear <= score < block    -> a person looks
 *   score >= block            -> the photograph is treated as showing the damage
 * `clear` is chosen so that at least `keep` of the damaged examples stay at or above it.
 * `block` is chosen so that at most `wrongBlock` of the clean examples reach it.
 */
export type LabelledScore = { id: string; damaged: boolean; score: number };
export type BandFit = {
  clear: number;
  block: number;
  damaged: number;
  clean: number;
  damagedCleared: number;
  damagedBlocked: number;
  cleanCleared: number;
  cleanBlocked: number;
  /** 95% Wilson interval for the share of damaged examples that would be cleared. */
  damagedClearedInterval: [number, number];
  /** 95% Wilson interval for the share of clean examples that would be blocked. */
  cleanBlockedInterval: [number, number];
  clearedDamagedIds: string[];
  collapsed: boolean;
  lowEvidence: boolean;
};
export const MIN_EXAMPLES_PER_CLASS = 20;

export function wilson(successes: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = successes / n,
    d = 1 + (z * z) / n,
    centre = (p + (z * z) / (2 * n)) / d,
    half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Round DOWN to three decimals so a threshold never excludes the example it was fitted on. */
const floor3 = (v: number) => Math.floor(v * 1000) / 1000;
/** Round UP to three decimals for the same reason on the block side. */
const ceil3 = (v: number) => Math.ceil(v * 1000) / 1000;

export function fitBand(
  examples: LabelledScore[],
  options: { keep?: number; wrongBlock?: number } = {},
): BandFit {
  const keep = options.keep ?? 0.97,
    wrongBlock = options.wrongBlock ?? 0.02;
  if (!(keep > 0 && keep <= 1) || !(wrongBlock >= 0 && wrongBlock < 1))
    throw new Error('invalid calibration targets');
  for (const e of examples)
    if (!Number.isFinite(e.score) || e.score < 0 || e.score > 1)
      throw new Error('score out of range for ' + e.id);
  const damaged = examples.filter((e) => e.damaged).sort((a, b) => a.score - b.score);
  const clean = examples.filter((e) => !e.damaged).sort((a, b) => a.score - b.score);
  if (!damaged.length || !clean.length) throw new Error('both classes are required');
  // Largest threshold that still keeps `keep` of the damaged examples at or above it:
  // allow at most floor((1 - keep) * n) damaged examples below the threshold.
  const allowedBelow = Math.floor((1 - keep) * damaged.length + 1e-9);
  let clear = floor3(damaged[allowedBelow]!.score);
  // Smallest threshold that at most `wrongBlock` of the clean examples reach:
  // allow at most floor(wrongBlock * n) clean examples at or above the threshold.
  const allowedAbove = Math.floor(wrongBlock * clean.length + 1e-9);
  const boundary = clean[clean.length - 1 - allowedAbove]!.score;
  // Strictly above the highest clean score that must stay out of the block band.
  let block = Math.min(1, ceil3(boundary + 1e-9));
  let collapsed = false;
  if (clear > block) {
    clear = block = floor3((clear + block) / 2);
    collapsed = true;
  }
  const damagedCleared = damaged.filter((e) => e.score < clear),
    cleanBlocked = clean.filter((e) => e.score >= block);
  return {
    clear,
    block,
    damaged: damaged.length,
    clean: clean.length,
    damagedCleared: damagedCleared.length,
    damagedBlocked: damaged.filter((e) => e.score >= block).length,
    cleanCleared: clean.filter((e) => e.score < clear).length,
    cleanBlocked: cleanBlocked.length,
    damagedClearedInterval: wilson(damagedCleared.length, damaged.length),
    cleanBlockedInterval: wilson(cleanBlocked.length, clean.length),
    clearedDamagedIds: damagedCleared.map((e) => e.id),
    collapsed,
    lowEvidence: damaged.length < MIN_EXAMPLES_PER_CLASS || clean.length < MIN_EXAMPLES_PER_CLASS,
  };
}

/** Area under the ROC curve by rank comparison; ties count one half. */
export function auc(examples: LabelledScore[]): number {
  const pos = examples.filter((e) => e.damaged),
    neg = examples.filter((e) => !e.damaged);
  if (!pos.length || !neg.length) return NaN;
  let wins = 0;
  for (const p of pos)
    for (const n of neg) wins += p.score > n.score ? 1 : p.score === n.score ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}
