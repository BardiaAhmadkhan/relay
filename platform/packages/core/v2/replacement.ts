import { z } from 'zod';
import type { Decision2 } from './schema';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const view = z.enum(['front', 'back']);
export const CUE_CODES = [
  'visible_road_contact',
  'visible_broken_protective_area',
  'visible_repair_protective_area',
  'possible_road_contact',
  'possible_broken',
  'possible_repair',
  'damage_outside_protective_areas',
] as const;
export type CueCode = (typeof CUE_CODES)[number];
export function isCue(value: string): value is CueCode {
  return CUE_CODES.some((code) => code === value);
}
export const PriorFindingSchema = z.strictObject({
  assessmentId: id,
  photoId: id,
  sha256: digest,
  view,
  policyVersion: z.string().min(1).max(40),
  thresholdsVersion: z.string().min(1).max(80),
  kind: z.enum(['exclusion', 'observation']),
  codes: z.array(z.enum(CUE_CODES)).min(1).max(CUE_CODES.length),
});
export const SignedFindingSchema = z.strictObject({
  finding: PriorFindingSchema,
  signature: digest,
});
export type SignedFinding = z.infer<typeof SignedFindingSchema>;
export const ReplacementStatusSchema = z.strictObject({
  photoId: id,
  view,
  replacementId: id.nullable(),
  sha256: digest.optional(),
  status: z.enum([
    'confirmed_exclusion',
    'possible',
    'unverified_exclusion',
    'unverified',
    'clear',
  ]),
  codes: z.array(z.enum(CUE_CODES)).max(CUE_CODES.length),
});
export type ReplacementStatus = z.infer<typeof ReplacementStatusSchema>;
export const ReplacementTransitionSchema = z.strictObject({ photoId: id, replacementId: id });
export type ReplacementTransition = z.infer<typeof ReplacementTransitionSchema>;

/** An earlier exclusion can keep its original disposition. Observations from another photograph
 * stay in the evidence record without changing any field of the current photograph decision. */
export function preserveExclusions(decision: Decision2, statuses: ReplacementStatus[]): Decision2 {
  const blocked = statuses.filter((s) => s.status === 'confirmed_exclusion');
  if (decision.outcome === 'no_offer') return decision;
  if (!blocked.length) {
    const unknown = statuses.filter((s) => s.status === 'unverified_exclusion');
    if (!unknown.length || decision.outcome !== 'offer') return decision;
    return {
      ...decision,
      outcome: 'review',
      grade: null,
      requestPhoto: null,
      title: 'A specialist will take a look',
      summary: 'An earlier exclusion needs to be reconciled.',
      nextAction: 'Show the earlier photograph and its saved receipt to the shop specialist.',
      reasons: unknown.map((s) => ({
        code: 'previous_exclusion_unreconciled',
        photoId: s.photoId,
        question: null,
        score: null,
        text:
          'The saved ' +
          s.view +
          ' photograph previously led to an exclusion. Its earlier receipt is unverified on this service.',
      })),
    };
  }
  return {
    ...decision,
    outcome: 'no_offer',
    grade: null,
    requestPhoto: null,
    title: 'Not eligible for an offer',
    summary: 'An earlier overview in this check already excluded the item.',
    nextAction: 'Show the earlier photograph and the current views to the shop specialist.',
    reasons: blocked.map((s) => ({
      code: 'previous_visible_exclusion',
      photoId: s.photoId,
      question: null,
      score: null,
      text:
        'The earlier ' +
        s.view +
        ' photograph led to an exclusion. The replacement is saved alongside it for the specialist.',
    })),
  };
}
export function offerTransitions(
  statuses: ReplacementStatus[],
  outcome: Decision2['outcome'],
): ReplacementTransition[] {
  if (outcome !== 'offer') return [];
  return statuses.flatMap((s) =>
    s.status === 'possible' && s.replacementId
      ? [{ photoId: s.photoId, replacementId: s.replacementId }]
      : [],
  );
}
export function mergeTransitions(prior: ReplacementTransition[], current: ReplacementTransition[]) {
  return [
    ...new Map(
      [...prior, ...current].map((t) => [JSON.stringify([t.photoId, t.replacementId]), t]),
    ).values(),
  ];
}
