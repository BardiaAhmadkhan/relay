export type Tri = 'yes' | 'no' | 'unknown';
export type Foundation = 'offer' | 'review' | 'retake' | 'no_offer' | 'pending';
export type Action = 'keep' | 'retire' | 'request' | 'specialist';
export type FactorKey =
  | 'history'
  | 'area_damage'
  | 'area_repair'
  | 'identity'
  | 'component'
  | 'layer'
  | 'view'
  | 'foundation';
export interface FusionInput {
  foundation: Foundation;
  awaitingRiderHistory?: boolean;
  resolvableFoundation?: boolean;
  crash: Tri;
  areaDamage: Tri;
  areaRepair: Tri;
  combinedHistory?: Tri;
  verifiedProtectiveFailure: boolean;
  identityConflict: boolean;
  unresolvedComponent: boolean;
  possibleStructural: boolean;
  acquisitionComplete: boolean;
  needsSourceView: boolean;
}
const questions: Record<FactorKey, { effort: number; prompt: string }> = {
  history: {
    effort: 1,
    prompt:
      'Has it been in a crash, or damaged or repaired in an impact area? Choose Yes, No, or Not sure.',
  },
  area_damage: {
    effort: 1,
    prompt: 'Tell us whether this item has known damage in an impact area.',
  },
  area_repair: { effort: 1, prompt: 'Tell us whether an impact area has been repaired.' },
  identity: {
    effort: 2,
    prompt:
      'Photograph the identification tag still attached, with the waistband or jacket opening visible.',
  },
  component: {
    effort: 4,
    prompt: 'Have a specialist identify the affected component and its role.',
  },
  layer: {
    effort: 3,
    prompt: 'Show the marked area and how its layer joins the garment in one connected photo.',
  },
  view: {
    effort: 2,
    prompt: 'Add the missing view with the full component and its surrounding garment in frame.',
  },
  foundation: {
    effort: 3,
    prompt: 'Finish the visible-condition check for front, back and label.',
  },
};
export function modelFusion(x: FusionInput) {
  const reasons: string[] = [];
  const hard =
    x.foundation === 'no_offer' ||
    x.combinedHistory === 'yes' ||
    x.crash === 'yes' ||
    x.areaDamage === 'yes' ||
    x.areaRepair === 'yes' ||
    x.verifiedProtectiveFailure;
  if (
    x.foundation === 'no_offer' &&
    x.combinedHistory !== 'yes' &&
    x.crash !== 'yes' &&
    x.areaDamage !== 'yes' &&
    x.areaRepair !== 'yes'
  )
    reasons.push('The visible-condition check recorded an exclusion under the shop rules.');
  if (x.combinedHistory === 'yes')
    reasons.push('The rider reported a crash, damage, or a repair in an impact area.');
  if (x.crash === 'yes') reasons.push('A crash was reported for this gear.');
  if (x.areaDamage === 'yes' || x.verifiedProtectiveFailure)
    reasons.push('Damage in a protective area has been reported or verified.');
  if (x.areaRepair === 'yes') reasons.push('A protective-area repair was reported.');
  const open: FactorKey[] = [];
  if (!hard) {
    if (x.identityConflict) open.push('identity');
    if (x.possibleStructural) open.push('layer');
    if (x.unresolvedComponent) open.push('component');
    if (x.combinedHistory !== 'no' && [x.crash, x.areaDamage, x.areaRepair].includes('unknown'))
      open.push('history');
    if (!x.acquisitionComplete || x.needsSourceView) open.push('view');
    if (x.foundation === 'pending' || x.foundation === 'retake' || x.resolvableFoundation)
      open.push('foundation');
  }
  // Each unknown boolean means "the resolving evidence supports continued use".
  // One state per assignment; no frequency or probability is inferred from the count of states.
  function given(assignment: number): 'keep' | 'retire' | 'review' {
    if (hard) return 'retire';
    for (let i = 0; i < open.length; i++) {
      if (assignment & (1 << i)) continue;
      if (['history', 'area_damage', 'area_repair', 'layer'].includes(open[i]!)) return 'retire';
    }
    if (
      open.some(
        (k, i) =>
          !(assignment & (1 << i)) && ['identity', 'component', 'view', 'foundation'].includes(k),
      )
    )
      return 'review';
    if (
      (x.foundation === 'review' && !x.awaitingRiderHistory && !x.resolvableFoundation) ||
      x.foundation === 'no_offer'
    )
      return 'review';
    return 'keep';
  }
  const count = 1 << open.length;
  const states = Array.from({ length: count }, (_, i) => given(i));
  const possible = [...new Set(states)].sort();
  // Minimal sufficient sets resolve the action irrespective of unobserved factors. This captures joint blockers.
  const masks: number[] = [];
  const subsets = Array.from({ length: count - 1 }, (_, i) => i + 1).sort(
    (a, b) => bits(a) - bits(b) || a - b,
  );
  if (possible.length > 1)
    for (const mask of subsets) {
      if (masks.some((m) => (m & mask) === m)) continue;
      const buckets = new Map<number, string>();
      let consistent = true;
      for (let i = 0; i < count; i++) {
        const k = i & mask,
          old = buckets.get(k);
        if (old !== undefined && old !== states[i]) {
          consistent = false;
          break;
        }
        buckets.set(k, states[i]!);
      }
      if (consistent) masks.push(mask);
    }
  const resolvingSets = masks.map((mask) => open.filter((_, i) => mask & (1 << i)));
  const unresolved = [...new Set(resolvingSets.flat())];
  const ranked = unresolved.sort(
    (a, b) => questions[a].effort - questions[b].effort || a.localeCompare(b),
  );
  const preferred = x.identityConflict
    ? 'identity'
    : x.possibleStructural
      ? 'layer'
      : x.unresolvedComponent
        ? 'component'
        : ranked[0];
  const possibleHard = possible.includes('retire');
  let action: Action;
  if (hard) action = 'retire';
  else if (preferred === 'identity') action = 'request';
  else if (
    x.combinedHistory === 'unknown' ||
    x.possibleStructural ||
    x.unresolvedComponent ||
    (x.foundation === 'review' && !x.awaitingRiderHistory && !x.resolvableFoundation) ||
    x.foundation === 'no_offer'
  )
    action = 'specialist';
  else if (open.length) action = 'request';
  else action = 'keep';
  if (x.identityConflict)
    reasons.push('The submitted identification photos point to different garments.');
  if (x.possibleStructural)
    reasons.push(
      'A possible material or hardware failure needs a connected view of the layer and body area.',
    );
  if (x.unresolvedComponent)
    reasons.push('The function or service record of a component needs a specialist check.');
  if (x.foundation === 'review' && !x.awaitingRiderHistory && !x.resolvableFoundation)
    reasons.push('The visible-condition check needs a specialist review.');
  if (!hard && open.includes('history'))
    reasons.push(
      x.combinedHistory === 'unknown'
        ? 'The rider is unsure about the history.'
        : 'The rider has not yet answered the history question.',
    );
  if (!hard && !x.acquisitionComplete)
    reasons.push('Some requested photographic evidence is missing.');
  if (action === 'keep')
    reasons.push(
      'The submitted history and visible-condition checks meet the shop’s offer criteria.',
    );
  const next = hard
    ? null
    : preferred
      ? questions[preferred].prompt
      : action === 'specialist'
        ? 'A specialist needs to inspect the recorded finding.'
        : null;
  return {
    action,
    robust: hard || (action === 'keep' && possible.length === 1),
    possible,
    possibleHard,
    reasons,
    next,
    resolvingSets,
    counterfactual: open.map((factor, i) => ({
      factor,
      ifSupported: [...new Set(states.filter((_, j) => j & (1 << i)))].sort(),
      ifAdverse: [...new Set(states.filter((_, j) => !(j & (1 << i))))].sort(),
    })),
    offerEligible: action === 'keep' && x.foundation === 'offer',
    stateCount: count,
    limitation:
      'Photographs cannot establish an undisclosed crash, reveal every hidden layer or measure impact and abrasion performance.',
  };
}
function bits(x: number) {
  let n = 0;
  for (; x; x &= x - 1) n++;
  return n;
}
export function scopedService(input: {
  maker: string;
  componentIdentified: boolean;
  purchaseDate?: string;
  asOf: string;
}) {
  if (!input.componentIdentified || input.maker.toUpperCase() !== 'KNOX')
    return { status: 'unverified', rule: null } as const;
  if (!input.purchaseDate)
    return { status: 'purchase_date_needed', rule: 'knox-purchase' } as const;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.purchaseDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.asOf))
    throw Error('Expected a calendar date');
  const from = new Date(input.purchaseDate + 'T00:00:00Z');
  if (
    !Number.isFinite(+from) ||
    from.toISOString().slice(0, 10) !== input.purchaseDate ||
    input.purchaseDate > input.asOf
  )
    throw Error('Invalid component purchase date');
  const y = from.getUTCFullYear() + 5,
    m = from.getUTCMonth(),
    d = Math.min(from.getUTCDate(), new Date(Date.UTC(y, m + 1, 0)).getUTCDate());
  const dueDate = new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
  return {
    status: input.asOf >= dueDate ? 'replacement_due' : 'within_guidance_interval',
    rule: 'knox-purchase',
    dueDate,
  } as const;
}
