import { verifyScores } from '../../packages/vision/v2/scorer-chain';
import { decide2 } from '../../packages/core/v2/policy';
import {
  DecisionSchema2,
  PhotoRecordSchema,
  SignedScoresSchema,
  ThresholdsSchema,
  PolicyConfigSchema,
} from '../../packages/core/v2/schema';
import rawThresholds from '../../packages/core/v2/thresholds.json';
import rawPolicy from '../../packages/core/v2/policy.config.json';
import { z } from 'zod';
import { Questions, type Disclosure } from '../../packages/core/schema';
const thresholds = ThresholdsSchema.parse(rawThresholds);
const config = PolicyConfigSchema.parse(rawPolicy);
const models = ['qwen3.5:4b@d8b0f5e9760c', 'qwen3.5:4b@d8b0f5e9760c cascade'];
thresholds.perScorer.local_logprob!.models = models;
const slot = z.object({
  source: z.string().regex(/^[a-f0-9]{64}$/),
  assigned: z.enum(['front', 'back', 'label', 'detail']),
  photo: PhotoRecordSchema,
  signed: SignedScoresSchema,
});
type Premise = {
  kind: 'garment_identity' | 'label_legible';
  verified: boolean;
  attachment: string;
  source: string;
  coverage: 'garment' | 'protector_in_garment' | 'unknown';
};
export function resolveFoundation(input: {
  decision: unknown;
  slots: unknown[];
  histories: Disclosure[];
  premises: Premise[];
  key: string;
  retainedExclusion?: boolean;
}) {
  const original = DecisionSchema2.parse(input.decision);
  const allowed = new Set(['not_recognised_as_gear', 'label_unreadable']);
  if (
    input.retainedExclusion ||
    !['review', 'retake'].includes(original.outcome) ||
    !original.reasons.length ||
    original.reasons.some((r) => !allowed.has(r.code))
  )
    return { decision: original, resolved: false };
  const used = input.premises.filter(
    (p) =>
      p.verified &&
      ['custodial', 'same_frame', 'continuity', 'staff_reconciled'].includes(p.attachment) &&
      p.coverage !== 'unknown' &&
      /^[a-f0-9]{64}$/.test(p.source),
  );
  const gear = used.some((p) => p.kind === 'garment_identity'),
    tag = used.some((p) => p.kind === 'label_legible');
  if (
    original.reasons.some(
      (r) =>
        (r.code === 'not_recognised_as_gear' && !gear) || (r.code === 'label_unreadable' && !tag),
    )
  )
    return { decision: original, resolved: false };
  const slots = input.slots.map((s) => slot.parse(s));
  if (
    !['front', 'back', 'label'].every((v) => slots.some((s) => s.assigned === v)) ||
    new Set(slots.map((s) => s.signed.scores.sha256)).size !== slots.length
  )
    return { decision: original, resolved: false };
  if (
    slots.some(
      (s) =>
        s.photo.id !== s.signed.scores.photoId ||
        s.assigned !== s.photo.view ||
        s.signed.scores.view !== s.assigned ||
        s.photo.sha256 !== s.signed.scores.sha256 ||
        !!s.signed.scores.fromOverview ||
        !models.includes(s.signed.scores.scorer.model) ||
        !verifyScores(s.signed, input.key),
    )
  )
    return { decision: original, resolved: false };
  // The actual signed scores are immutable. The policy is replayed with only the independent semantic answers
  // substituted. Any missing safety head, quality concern, uncertainty-band damage or exclusion still holds.
  const scores = slots.map((s) => {
    const copy = structuredClone(s.signed.scores);
    if (gear && ['front', 'back'].includes(s.assigned) && copy.answers.gear?.type === 'yesno')
      copy.answers.gear = { type: 'yesno', p: 1 };
    if (tag && s.assigned === 'label' && copy.answers.label_legible?.type === 'yesno')
      copy.answers.label_legible = { type: 'yesno', p: 1 };
    return copy;
  });
  const check = decide2({
    photos: slots.map((s) => s.photo),
    scores,
    disclosures: input.histories,
    thresholds,
    config,
    closeUpsRequested: 0,
  });
  if (check.outcome !== 'offer')
    return {
      decision: original,
      resolved: false,
      replayDecision: check,
      otherHold: check.reasons.map((r) => r.code),
      sources: used.map((p) => p.source),
    };
  return {
    decision: check,
    resolved: true,
    previousReason: original.reasons.map((r) => r.code),
    sources: used.map((p) => p.source),
  };
}
export function disclosuresFor(answer: 'yes' | 'no' | 'unknown', at: string): Disclosure[] {
  return Questions.map((q) => ({
    id: 'history-' + q,
    question: q,
    answer: answer === 'yes' && q !== 'crash' ? 'no' : answer,
    recordedAt: at,
  }));
}
