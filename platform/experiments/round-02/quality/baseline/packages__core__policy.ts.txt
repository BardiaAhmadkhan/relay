import {
  POLICY_VERSION,
  Questions,
  type Disclosure,
  type Decision,
  type Observation,
  type PhotoEvidence,
  type Correction,
} from './schema';

export const questionText = {
  crash: 'Has it been worn in a crash?',
  protective_damage: 'Any damage in a protective area?',
  protective_repair: 'Any repairs in a protective area?',
} as const;
export const categoryLabels = {
  motorcycle_jacket: 'Motorcycle jacket',
  trousers: 'Riding trousers',
  gloves: 'Gloves',
  boots: 'Motorcycle boots',
  helmet: 'Helmet',
  other: 'Another item',
  multiple: 'More than one item',
  unknown: 'Item not identified',
} as const;
export const viewLabels = {
  front: 'Front',
  back: 'Back',
  label: 'Label',
  detail: 'Detail',
} as const;
export function currentAnswers(disclosures: Disclosure[]) {
  const result: Partial<Record<Disclosure['question'], Disclosure['answer']>> = {};
  // Array order is the event order. Clock skew must not revive an earlier answer.
  for (const event of disclosures) result[event.question] = event.answer;
  return result;
}
const exclusionText = {
  crash: 'A crash has been reported for this item.',
  protective_damage: 'Damage in a protective area has been reported.',
  protective_repair: 'A repair in a protective area has been reported.',
} as const;
export function decide(input: {
  disclosures: Disclosure[];
  photos?: PhotoEvidence[];
  observation?: Observation | null;
  corrections?: Correction[];
}): Decision {
  const { disclosures, photos = [], observation, corrections = [] } = input;
  const make = (
    state: Decision['state'],
    title: string,
    summary: string,
    reasons: Decision['reasons'],
    nextAction: string,
  ): Decision => ({
    state,
    policyVersion: POLICY_VERSION,
    title,
    summary,
    reasons,
    nextAction,
    offerRecommended: false,
    protectivePerformanceCertified: false,
  });
  const excluded = Questions.filter((q) =>
    disclosures.some((e) => e.question === q && e.answer === 'yes'),
  );
  if (excluded.length)
    return make(
      'not_eligible',
      'Not eligible for an offer',
      'This item cannot enter the offer process under the challenge rules.',
      excluded.map((q) => ({ code: q, text: exclusionText[q] })),
      'Keep it out of offer consideration. A changed answer needs specialist reconciliation; photographs cannot clear the reported history.',
    );
  const answers = currentAnswers(disclosures);
  const unknown = Questions.filter((q) => answers[q] !== 'no');
  if (unknown.length)
    return make(
      'more_information',
      'A little more history',
      'The item’s history is still unresolved. Photographs cannot answer these questions.',
      unknown.map((q) => ({ code: 'unknown_' + q, text: questionText[q] })),
      'Ask the person who knows the item’s history, or take this record to a specialist. Do not guess.',
    );
  const missing = (['front', 'back', 'label'] as const).filter(
    (v) => !photos.some((p) => p.view === v),
  );
  if (missing.length)
    return make(
      'more_information',
      'A few views still needed',
      'Build a useful record before asking for a visual review.',
      missing.map((v) => ({
        code: 'missing_' + v,
        text: 'Add the ' + viewLabels[v].toLowerCase() + ' view.',
      })),
      'Add the missing views. If a label is missing or illegible, photograph its location and tell the specialist.',
    );
  if (new Set(photos.map((p) => p.sha256)).size !== photos.length)
    return make(
      'more_information',
      'Different views are needed',
      'Two views contain the same photograph.',
      [{ code: 'duplicate_photo', text: 'Replace the repeated photograph with a different view.' }],
      'Capture each required view separately.',
    );
  const unusable = photos.filter((p) =>
    p.quality.warnings.some((w) => ['low_resolution', 'dark', 'bright'].includes(w)),
  );
  if (unusable.length)
    return make(
      'more_information',
      'Let’s make those details clearer',
      'Some photographs do not show enough detail for a useful review.',
      unusable.map((p) => ({
        code: 'quality_' + p.id,
        text: 'Retake the ' + viewLabels[p.view].toLowerCase() + ' photograph in even light.',
      })),
      'Replace the affected photograph; the other evidence stays in place.',
    );
  if (!observation)
    return make(
      'more_information',
      'Visual review still needed',
      'No completed image analysis is available.',
      [{ code: 'no_analysis', text: 'The photographs have not produced a validated observation.' }],
      'Run the analysis when the service is available. Your draft is kept on this device.',
    );
  if (observation.provider === 'test')
    return make(
      'human_inspection',
      'Example · specialist review',
      'This is a disclosed test example, not an assessment of your photographs.',
      [{ code: 'example', text: 'Example observations are never live evidence.' }],
      'Start a new assessment with your own gear for a real local analysis.',
    );
  if (observation.multipleItems || observation.category === 'multiple')
    return make(
      'more_information',
      'One item at a time',
      'The images may show more than one item.',
      [
        {
          code: 'multiple',
          text: 'Keep the garment and its matching components together; remove unrelated gear.',
        },
      ],
      'Replace the overall photographs so the intended item is clear.',
    );
  if (observation.category !== 'motorcycle_jacket')
    return make(
      'human_inspection',
      'A specialist should take a look',
      'This experimental capture protocol is designed for motorcycle jackets.',
      [
        {
          code: 'category',
          text:
            'Suggested category: ' +
            categoryLabels[observation.category] +
            '. This is a model inference.',
        },
      ],
      'Bring the item and this record to a specialist. Other gear needs its own inspection protocol.',
    );
  if (corrections.length)
    return make(
      'human_inspection',
      'Your corrections are included',
      'A specialist should reconcile the item details before offer review.',
      [
        {
          code: 'correction',
          text: 'Rider corrections are kept alongside the original observations.',
        },
      ],
      'Share the inspection brief so both versions can be checked.',
    );
  if (observation.concerns.length)
    return make(
      'human_inspection',
      'A closer look is needed',
      'Visible concerns need a person’s judgment. This is not an offer recommendation.',
      observation.concerns.map((c) => ({
        code: 'concern_' + c.kind,
        text:
          concernText[c.kind] +
          ' (' +
          c.area.replace('nonprotective', 'outside a reported protective area') +
          ' area; image ' +
          c.imageId +
          ').',
      })),
      'Add a close-up if helpful, then bring the item for physical inspection.',
    );
  if (observation.missingViews.length)
    return make(
      'more_information',
      'One more detail would help',
      'The visual review could not resolve all requested views.',
      observation.missingViews.map((v) => ({
        code: 'vision_missing_' + v,
        text: 'A clearer ' + viewLabels[v].toLowerCase() + ' view is needed.',
      })),
      'Add or replace the requested photograph, then review again.',
    );
  if (observation.coverage === 'category_only' || observation.provider.startsWith('local_'))
    return make(
      'human_inspection',
      'Ready for a closer look',
      'The item has a suggested category. Its protective condition still needs a specialist.',
      [
        {
          code: 'local_scope',
          text: 'Local vision compares appearance with category descriptions. It does not inspect hidden damage or clear visible condition.',
        },
      ],
      'Share the inspection brief with a specialist for an in-person review.',
    );
  return make(
    'ready_for_review',
    'Ready for specialist review',
    'The available record supports the next review step. It does not establish safety or guarantee an offer.',
    [
      {
        code: 'reported_history',
        text: 'You reported no crash, protective-area damage or protective-area repair.',
      },
      {
        code: 'observations',
        text: 'No concern was returned for the supplied views. Unseen and internal condition remain unknown.',
      },
    ],
    'A specialist must inspect the item and apply the business’s offer policy.',
  );
}
export const concernText = {
  abrasion: 'Possible abrasion',
  tear: 'Possible tear',
  seam: 'A seam needs checking',
  repair: 'Possible repair',
  closure: 'A closure needs checking',
  insert: 'An insert or pocket needs checking',
  obscured: 'An area is obscured',
  other: 'An area needs checking',
} as const;
export function inspectionBrief(input: {
  id: string;
  disclosures: Disclosure[];
  photos: PhotoEvidence[];
  observation: Observation | null;
  corrections: Correction[];
}) {
  const decision = decide(input);
  const lines = [
    'RELAY · EXPERIMENTAL INSPECTION BRIEF',
    'Assessment: ' + input.id,
    'Policy: ' + POLICY_VERSION,
    'Result: ' + decision.title,
    '',
    'RIDER REPORTS',
    ...input.disclosures.map(
      (d) => d.recordedAt + ' | ' + questionText[d.question] + ' ' + d.answer,
    ),
    '',
    'CAPTURED EVIDENCE',
    ...input.photos.map((p) => viewLabels[p.view] + ' | ' + p.id + ' | SHA-256 ' + p.sha256),
    '',
    'MODEL OBSERVATIONS',
    input.observation
      ? 'Suggested category: ' +
        categoryLabels[input.observation.category] +
        '; ' +
        input.observation.provider +
        ' / ' +
        input.observation.model +
        '; coverage ' +
        input.observation.coverage
      : 'No validated image analysis.',
    ...(input.observation?.attributes.map(
      (a) => a.field + ': ' + a.value + ' [' + a.kind + '; images ' + a.imageIds.join(', ') + ']',
    ) ?? []),
    ...(input.observation?.concerns.map(
      (c) => concernText[c.kind] + ' [' + c.area + '; image ' + c.imageId + ']',
    ) ?? []),
    '',
    'RIDER CORRECTIONS',
    ...input.corrections.map(
      (c) => c.field + ': ' + c.value + ' [rider report; ' + c.recordedAt + ']',
    ),
    '',
    'REASONS',
    ...decision.reasons.map((r) => r.text),
    '',
    'NEXT STEP',
    decision.nextAction,
    '',
    'UNKNOWN / UNVERIFIED',
    'Protective performance, internal damage, authenticity, exact model and independently verified history remain unresolved.',
    'No protective-performance certification. No offer or price recommendation. Physical expert inspection is required.',
  ];
  return lines.join('\n');
}
