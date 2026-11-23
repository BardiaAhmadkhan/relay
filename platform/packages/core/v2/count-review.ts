import { z } from 'zod';
import { Questions, type Disclosure } from '../schema';
import type { Decision2, PhotoRecord, PhotoScores } from './schema';

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const CountReceiptSchema = z.strictObject({
  check: z.strictObject({
    kind: z.literal('count_check'),
    assessmentId: identifier,
    photoId: identifier,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    verdict: z.enum(['one', 'matched_pair']),
    promptVersion: z.string().min(1).max(80),
  }),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
});
export type CountReceipt = z.infer<typeof CountReceiptSchema>;
export type CountVerdict = CountReceipt['check']['verdict'];
/** Narrow, pre-registered R2 gate. A yes from another reader resolves only the count of the
 * overview that actually caused the retake. Every other ordinary policy rule still runs. */
export function bindingCountPhoto(
  decision: Decision2,
  disclosures: Disclosure[],
  photos: PhotoRecord[],
  scores: PhotoScores[],
  hasEvidenceHold: boolean,
): PhotoRecord | undefined {
  if (
    hasEvidenceHold ||
    decision.outcome !== 'retake' ||
    decision.reasons.length !== 1 ||
    decision.reasons[0]?.code !== 'multiple_items'
  )
    return;
  if (
    disclosures.some((e) => e.answer === 'yes') ||
    Questions.some((q) => disclosures.filter((e) => e.question === q).at(-1)?.answer !== 'no')
  )
    return;
  if (
    !photos.length ||
    new Set(photos.map((p) => p.sha256)).size !== photos.length ||
    photos.some(
      (p) =>
        p.quality.warnings.some((w) => ['soft', 'dark', 'bright', 'low_resolution'].includes(w)) ||
        !scores.some((s) => s.photoId === p.id && s.sha256 === p.sha256 && s.view === p.view),
    )
  )
    return;
  const target = photos.find((p) => p.id === decision.reasons[0]?.photoId);
  if (
    !target ||
    (target.view !== 'front' && target.view !== 'back') ||
    decision.requestPhoto?.view !== target.view
  )
    return;
  const score = scores.find(
    (s) => s.photoId === target.id && s.sha256 === target.sha256 && s.view === target.view,
  );
  const category = score?.answers.category,
    count = score?.answers.single_item;
  if (
    score?.fromOverview ||
    score?.scorer.id !== 'local_logprob' ||
    category?.type !== 'choice' ||
    !['boots', 'gloves'].includes(category.choice) ||
    count?.type !== 'yesno' ||
    count.p >= 0.5
  )
    return;
  return target;
}
