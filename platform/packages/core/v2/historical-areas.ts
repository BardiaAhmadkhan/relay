import type { Decision2, HistoricalArea } from './schema';

export type AreaReason = Decision2['reasons'][number];
export function historicalReason(area: HistoricalArea, verified: boolean): AreaReason {
  const mark = area.region;
  const answer = verified ? area.cropReceipt?.scores.answers.broken : undefined;
  const box =
    'Saved ' +
    mark.parentView +
    ' area at x ' +
    mark.left +
    ', y ' +
    mark.top +
    ', ' +
    mark.side +
    ' px square in the ' +
    mark.sourceWidth +
    ' × ' +
    mark.sourceHeight +
    ' px original.';
  return {
    code: verified ? 'rider_marked_area' : 'historical_area_unverified',
    text:
      box +
      (verified
        ? ' The signed crop matches its overview. Compare both in person.'
        : ' Unverified. The saved crop and overview could not be reconciled with both signed photo checks.'),
    photoId: area.photoId,
    question: verified ? 'broken' : null,
    score: answer?.type === 'yesno' ? answer.p : null,
  };
}

/** Historical evidence can require a specialist. It cannot improve an outcome or satisfy a missing photo check. */
export function withHistoricalAreas(decision: Decision2, reasons: AreaReason[]): Decision2 {
  if (!reasons.length) return decision;
  const distinct = reasons.filter(
    (r) =>
      !decision.reasons.some(
        (s) =>
          s.photoId === r.photoId &&
          ['rider_marked_area', 'historical_area_unverified', 'marked_parent_mismatch'].includes(
            s.code,
          ),
      ),
  );
  if (decision.outcome !== 'offer')
    return distinct.length
      ? { ...decision, reasons: [...decision.reasons, ...distinct] }
      : decision;
  return {
    ...decision,
    outcome: 'review',
    grade: null,
    title: 'A specialist will take a look',
    summary: 'An area saved in this earlier check needs a specialist.',
    nextAction: 'Show the saved area and its original overview to the specialist.',
    reasons: distinct,
  };
}
