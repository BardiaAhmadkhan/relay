import type { ReplacementStatus } from '../../packages/core/v2/replacement';
import type { MarkedRegion } from '../../packages/core/marked-region';
import { Questions, type Disclosure, type PhotoView } from '../../packages/core/schema';
import type { Category2, Decision2, SignedScores } from '../../packages/core/v2/schema';

/** Plain-text inspection brief for a v2 decision (work package 11). Shared or saved by the rider and
 * read by the shop's specialist. Pure: no device modules, so it is unit-tested. */
export const categoryLabels2: Record<Category2, string> = {
  jacket: 'Riding jacket',
  trousers: 'Riding trousers',
  suit: 'Riding suit',
  gloves: 'Riding gloves',
  boots: 'Riding boots',
  helmet: 'Helmet',
  armour: 'Armour insert',
  other: 'Something else',
  unknown: 'Not settled',
};
const viewNames: Record<PhotoView, string> = {
  front: 'Front',
  back: 'Back',
  label: 'Label',
  detail: 'Close-up',
};
const questionNames: Record<(typeof Questions)[number], string> = {
  crash: 'Crash',
  protective_damage: 'Damage in a protective area',
  protective_repair: 'Repair in a protective area',
};

export function replacementBriefLines(items: ReplacementStatus[]): string[] {
  return items.flatMap((e) => {
    if (e.status === 'possible') {
      const cue = e.codes.some((c) => c.includes('road_contact'))
        ? 'a possible road-contact cue'
        : e.codes.some((c) => c.includes('repair'))
          ? 'a possible repair'
          : e.codes.some((c) => c.includes('broken'))
            ? 'a possible material break'
            : 'a possible concern';
      return [
        'The earlier ' +
          e.view +
          ' photo raised ' +
          cue +
          '. Ask the specialist to check that area in hand.',
      ];
    }
    if (e.status === 'unverified' || e.status === 'unverified_exclusion')
      return ['The earlier ' + e.view + ' photo check could not be verified.'];
    if (e.status === 'confirmed_exclusion')
      return [
        'The earlier ' +
          e.view +
          ' photo led to a verified exclusion. It is saved in the notebook.',
      ];
    return [];
  });
}

export function briefV2(input: {
  id: string;
  disclosures: Disclosure[];
  photos: Array<{
    id: string;
    view: PhotoView;
    signed?: SignedScores;
    fromOverview?: MarkedRegion;
  }>;
  decision: Decision2;
  replacedOverviews?: ReplacementStatus[];
  checkedAt?: string;
}): string {
  const d = input.decision;
  const latest: Record<string, string> = {};
  for (const e of input.disclosures) latest[e.question] = e.answer;
  const lines = [
    'RELAY INSPECTION BRIEF',
    'Item ' + input.id.slice(0, 8) + (input.checkedAt ? ' · checked ' + input.checkedAt : ''),
    '',
    'RESULT: ' + d.title.toUpperCase(),
    d.summary,
    ...(d.grade ? ['Condition grade: ' + d.grade] : []),
    'Item: ' + categoryLabels2[d.category],
    '',
    'WHY',
    ...d.reasons.map((r, i) => i + 1 + '. ' + r.text),
    '',
    ...replacementBriefLines(input.replacedOverviews ?? []),
    'NEXT STEP',
    d.nextAction,
    '',
    'RIDER HISTORY (as told by the rider, not verified)',
    ...Questions.map((q) => {
      const everYes = input.disclosures.some((e) => e.question === q && e.answer === 'yes');
      return (
        questionNames[q] +
        ': ' +
        (latest[q] ?? 'not answered') +
        (everYes && latest[q] !== 'yes' ? ' (yes was given earlier)' : '')
      );
    }),
    '',
    'PHOTO CHECKS (probability that the photo shows it; read with the decision, not on its own)',
    ...input.photos.map((p) => {
      const replaced = input.replacedOverviews?.find((e) => e.photoId === p.id);
      if (replaced) return 'Earlier ' + replaced.view + ' photograph retained in the notebook.';
      const a = p.signed?.scores.answers;
      if (
        p.fromOverview &&
        (!a || d.reasons.some((r) => r.photoId === p.id && r.code === 'historical_area_unverified'))
      )
        return (
          'Unverified saved crop of the ' +
          p.fromOverview.parentView +
          '. Compare the saved photographs in person.'
        );
      if (!a) return viewNames[p.view] + ': not checked';
      const yes = (key: string) => {
        const v = a[key];
        return v?.type === 'yesno' ? v.p.toFixed(2) : 'n/a';
      };
      const mark = p.signed?.scores.fromOverview;
      if (mark)
        return (
          'Rider-marked crop of ' +
          mark.parentView +
          ' (' +
          mark.side +
          ' source pixels per side). Broken material response ' +
          yes('broken') +
          '. Read alongside the overview.'
        );
      return p.view === 'label'
        ? viewNames[p.view] + ': legible ' + yes('label_legible') + ', CE mark ' + yes('label_ce')
        : viewNames[p.view] +
            ': broken material ' +
            yes('broken') +
            ', road-contact damage ' +
            yes('road_contact') +
            ', repair ' +
            yes('repair');
    }),
    '',
    'Versions: policy ' + d.policyVersion + ', thresholds ' + d.thresholdsVersion,
    'This is not a safety certification. Photographs cannot establish internal condition, crash history or protective performance.',
  ];
  return lines.join('\n');
}
