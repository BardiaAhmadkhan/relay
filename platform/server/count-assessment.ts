import type { Decision2 } from '../packages/core/v2/schema';
import { decisionBands, type DecideInput2 } from '../packages/core/v2/policy';
import { matchesCount, signCount } from './count-receipt';
import { bindingCountPhoto, type CountReceipt } from '../packages/core/v2/count-review';
import type { CountReader } from './count-reader';
import { prepareImages } from './images';
import { measureFocus, withFocus } from './focus';

export type CountAttachment = { notice: 'terms'; photoId: string; base64: string };
type Context = {
  assessmentId: string;
  input: DecideInput2;
  decision: Decision2;
  hold: boolean;
  reader?: CountReader;
  attachment?: CountAttachment;
  receipt?: CountReceipt;
  signingKey: string;
  signal: AbortSignal;
  workingEdge: number;
  timeoutMs?: number;
};
export async function resolveCount(ctx: Context): Promise<CountReceipt | undefined> {
  const { reader, attachment, input, signal } = ctx;
  if (!reader || signal.aborted || ctx.workingEdge !== 1600) return;
  const target = bindingCountPhoto(
    ctx.decision,
    input.disclosures,
    input.photos,
    input.scores,
    ctx.hold,
  );
  if (!target) return;
  const score = input.scores.find(
    (s) => s.photoId === target.id && s.sha256 === target.sha256 && s.view === target.view,
  );
  if (
    !score ||
    score.batteryVersion !== input.thresholds.batteryVersion ||
    !decisionBands(input.thresholds, score)
  )
    return;
  if (ctx.receipt)
    return matchesCount(ctx.receipt, ctx.assessmentId, target, ctx.signingKey)
      ? ctx.receipt
      : undefined;
  if (!attachment || attachment.notice !== 'terms' || target.id !== attachment.photoId) return;
  // Image, verification, diagnostic call and response parsing share one time budget. A slow native
  // decoder or provider cannot revise a result that has already timed out or been cancelled.
  const deadline = AbortSignal.any([
    signal,
    AbortSignal.timeout(Math.min(ctx.timeoutMs ?? 8000, 8000)),
  ]);
  const work = async () => {
    const source = { id: target.id, view: target.view, base64: attachment.base64 };
    const working = await prepareImages([source], 1600);
    if (working.photos[0]!.sha256 !== target.sha256 || deadline.aborted) return;
    const focusImage = await prepareImages([source], 1024);
    const quality = withFocus(
      working.photos[0]!.quality,
      await measureFocus(focusImage.images[0]!.jpeg),
    );
    if (
      quality.warnings.some((w) => ['soft', 'dark', 'bright', 'low_resolution'].includes(w)) ||
      deadline.aborted
    )
      return;
    const answer = await reader.read(
      {
        assessmentId: ctx.assessmentId,
        photoId: target.id,
        sha256: target.sha256,
        jpeg: working.images[0]!.jpeg,
      },
      deadline,
    );
    if (!deadline.aborted && (answer === 'one' || answer === 'matched_pair'))
      return signCount(ctx.assessmentId, target, answer, ctx.signingKey);
  };
  let cancel: () => void = () => {};
  const stopped = new Promise<undefined>((resolve) => {
    cancel = () => resolve(undefined);
    deadline.addEventListener('abort', cancel, { once: true });
    if (deadline.aborted) cancel();
  });
  try {
    return await Promise.race([work().catch(() => undefined), stopped]);
  } finally {
    deadline.removeEventListener('abort', cancel);
  }
}
