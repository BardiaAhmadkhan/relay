import type { PhotoView, Quality } from '../schema';
import type { PhotoScores, Thresholds } from './schema';

/** Immediate feedback on one photograph, returned with its score record while the rider is still
 * photographing (work package 11). It only ever asks for a better photograph. It never mentions damage,
 * a repair or an outcome: those belong to the decision, which sees every photograph and the history.
 * The conditions mirror the retake rules in policy.ts (rules 5 and 6), with the same thresholds. */
export type PhotoFeedback = {
  code:
    | 'out_of_focus'
    | 'exposure'
    | 'too_small'
    | 'unclear'
    | 'several_items'
    | 'not_gear'
    | 'label_unreadable';
  text: string;
};

export function photoFeedback(
  view: PhotoView,
  quality: Quality,
  scores: PhotoScores | null,
  t: Thresholds,
): PhotoFeedback[] {
  const p = (key: string) => {
    const a = scores?.answers[key];
    return a?.type === 'yesno' ? a.p : null;
  };
  const out: PhotoFeedback[] = [];
  if (quality.warnings.includes('soft'))
    out.push({
      code: 'out_of_focus',
      text: 'This photo is out of focus. Hold still, tap the item to focus, and retake it.',
    });
  if (quality.warnings.includes('dark') || quality.warnings.includes('bright'))
    out.push({
      code: 'exposure',
      text: 'This photo is too dark or too bright. Retake it in even light.',
    });
  if (quality.warnings.includes('low_resolution'))
    out.push({
      code: 'too_small',
      text: 'This photo is too small to judge. Move closer or use the camera.',
    });
  if (view === 'label') {
    const legible = p('label_legible');
    if (legible !== null && legible < t.labelLegibleMin)
      out.push({
        code: 'label_unreadable',
        text: 'The label cannot be read. Photograph it flat and close, filling the frame.',
      });
    return out;
  }
  const usable = p('usable');
  if (!out.length && usable !== null && usable < t.usableMin)
    out.push({
      code: 'unclear',
      text: 'The surface is hard to judge here. Fill the frame with the item, in even light.',
    });
  if (view === 'front' || view === 'back') {
    const single = p('single_item'),
      gear = p('gear');
    if (single !== null && single < t.singleItemMin)
      out.push({
        code: 'several_items',
        text: 'More than one item seems to be in the frame. Photograph one item on its own.',
      });
    if (gear !== null && gear < t.gearMin)
      out.push({
        code: 'not_gear',
        text: 'This does not look like motorcycle protective gear. A specialist will confirm what it is.',
      });
  }
  return out;
}
