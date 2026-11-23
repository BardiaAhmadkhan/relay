import { Questions, type Disclosure, type PhotoView } from '../schema';
import {
  type Answer2,
  type Category2,
  type Decision2,
  type ExclusionQuestion,
  type Outcome,
  type PhotoRecord,
  type PhotoScores,
  type PolicyConfig,
  type Thresholds,
} from './schema';

/** Deterministic offer policy, backend v2. Pure and synchronous: the same inputs always give the same
 * decision, on the server and on the phone. No model output is ever a decision. Rule order and the
 * reasoning behind it: docs/22-backend-v2/build-guide.md, work package 7. */
export type DecideInput2 = {
  /** Event list in the order the rider answered. A 'yes' is never erased by a later answer. */
  disclosures: Disclosure[];
  photos: PhotoRecord[];
  /** Score records whose signature the service has already verified. */
  scores: PhotoScores[];
  /** How many extra close-ups this assessment has already asked the rider for. */
  closeUpsRequested: number;
  thresholds: Thresholds;
  config: PolicyConfig;
  /** Internal only. A separate validated count resolves the binding overview without changing any signed answer. */
  acceptedCountPhotoId?: string;
};

const viewLabel: Record<PhotoView, string> = {
  front: 'front',
  back: 'back',
  label: 'label',
  detail: 'close-up',
};
const reportedText = {
  crash: 'A crash was reported for this item.',
  protective_damage: 'Damage in a protective area was reported.',
  protective_repair: 'A repair in a protective area was reported.',
} as const;
const questionLabel: Record<ExclusionQuestion, string> = {
  broken: 'broken material',
  road_contact: 'road-contact damage',
  repair: 'a repair',
};
const yes = (a: Answer2 | undefined): number | null => (a?.type === 'yesno' ? a.p : null);

type Hit = { photo: PhotoRecord; scores: PhotoScores; question: ExclusionQuestion; p: number };
type Reason = Decision2['reasons'][number];

/** Category by the mean probability over the overall views; close-ups only when nothing else exists. */
export function resolveCategory(
  photos: PhotoRecord[],
  byPhoto: Map<string, PhotoScores>,
  categoryMin: number,
): Category2 {
  const overall = photos.filter((p) => p.view === 'front' || p.view === 'back');
  const pool = overall.length ? overall : photos.filter((p) => p.view === 'detail');
  const totals = new Map<string, number>();
  let n = 0;
  for (const photo of pool) {
    const answer = byPhoto.get(photo.id)?.answers.category;
    if (answer?.type !== 'choice') continue;
    n++;
    for (const [option, p] of Object.entries(answer.probabilities))
      totals.set(option, (totals.get(option) ?? 0) + p);
  }
  if (!n) return 'unknown';
  let best: [string, number] = ['unknown', 0];
  for (const [option, total] of totals) if (total / n > best[1]) best = [option, total / n];
  const known: Category2[] = ['jacket', 'trousers', 'suit', 'gloves', 'boots', 'helmet', 'armour'];
  if (best[1] < categoryMin) return 'unknown';
  return (known as string[]).includes(best[0]) ? (best[0] as Category2) : 'other';
}

/** Positive decisions require a usable answer for every question they depend on.
 * The planner may omit other questions after a decisive hold or exclusion. */
function missingOfferChecks(
  photo: PhotoRecord,
  scores: PhotoScores,
  categoryFromDetails: boolean,
): string[] {
  const missing: string[] = [];
  const requireAnswer = (key: string, type: Answer2['type'], label: string) => {
    if (scores.answers[key]?.type !== type) missing.push(label);
  };
  if (photo.view === 'label') {
    requireAnswer('label_legible', 'yesno', 'label readability');
    return missing;
  }
  requireAnswer('usable', 'yesno', 'surface visibility');
  requireAnswer('broken', 'yesno', 'broken material');
  requireAnswer('road_contact', 'yesno', 'road-contact marks');
  requireAnswer('repair', 'yesno', 'repair');
  requireAnswer('wear', 'level', 'wear grade');
  if (photo.view !== 'detail') {
    requireAnswer('single_item', 'yesno', 'one item or matching pair');
    requireAnswer('gear', 'yesno', 'motorcycle gear identification');
  }
  if (photo.view !== 'detail' || categoryFromDetails) {
    requireAnswer('category', 'choice', 'item category');
  }
  return missing;
}

export function decide2(input: DecideInput2): Decision2 {
  const marks = input.scores.filter((s) => s.fromOverview);
  if (!marks.length) return decidePhotographs(input);

  const ids = new Set(
    marks
      .filter(
        (s) =>
          s.view === 'detail' &&
          input.photos.some(
            (p) => p.id === s.photoId && p.view === 'detail' && p.sha256 === s.sha256,
          ) &&
          !input.scores.some(
            (other) =>
              !other.fromOverview && other.photoId === s.photoId && other.sha256 === s.sha256,
          ),
      )
      .map((s) => s.photoId),
  );
  const originals = input.photos.filter((p) => !ids.has(p.id));
  const decision = decidePhotographs({
    ...input,
    photos: originals,
    scores: input.scores.filter((s) => !ids.has(s.photoId)),
  });
  const reasons = marks.map((s) => {
    const mark = s.fromOverview!;
    const parent = originals.find(
      (p) => p.id === mark.parentId && p.view === mark.parentView && p.sha256 === s.parentSha256,
    );
    const child = input.photos.find(
      (p) => p.id === s.photoId && p.view === 'detail' && p.sha256 === s.sha256,
    );
    const matched = !!parent && !!child && s.batteryVersion === input.thresholds.batteryVersion;
    return {
      code: matched ? 'rider_marked_area' : 'marked_parent_mismatch',
      text: matched
        ? 'The rider marked an area on the ' +
          mark.parentView +
          '. Compare this crop with the overview in person.'
        : 'The marked area could not be matched to its overview. A specialist needs both images.',
      photoId: s.photoId,
      question: matched ? 'broken' : null,
      score: matched ? yes(s.answers.broken) : null,
    };
  });
  if (decision.outcome !== 'offer')
    return { ...decision, reasons: [...decision.reasons, ...reasons] };
  return {
    ...decision,
    outcome: 'review',
    grade: null,
    title: 'A specialist will take a look',
    summary: 'You marked an area for inspection.',
    reasons,
    nextAction: 'Show the specialist the marked area alongside the whole garment.',
  };
}

export function decisionBands(thresholds: Thresholds, scores: PhotoScores) {
  const bands = thresholds.perScorer[scores.scorer.id];
  return bands && (!bands.models || bands.models.includes(scores.scorer.model)) ? bands : undefined;
}
function decidePhotographs(input: DecideInput2): Decision2 {
  const { disclosures, photos, thresholds: t, config } = input;
  const byPhoto = new Map<string, PhotoScores>();
  for (const s of input.scores) {
    const photo = photos.find((p) => p.id === s.photoId);
    // A record for other pixels, another view or another battery is not evidence for this photograph.
    if (
      photo &&
      photo.sha256 === s.sha256 &&
      photo.view === s.view &&
      s.batteryVersion === t.batteryVersion
    )
      byPhoto.set(photo.id, s);
  }
  const category = resolveCategory(photos, byPhoto, t.categoryMin);
  const make = (
    outcome: Outcome,
    title: string,
    summary: string,
    reasons: Reason[],
    nextAction: string,
    extra: Partial<Pick<Decision2, 'grade' | 'requestPhoto'>> = {},
  ): Decision2 => ({
    outcome,
    policyVersion: config.version,
    thresholdsVersion: t.version,
    category,
    grade: extra.grade ?? null,
    title,
    summary,
    reasons,
    nextAction,
    requestPhoto: extra.requestPhoto ?? null,
    protectivePerformanceCertified: false,
  });
  const reason = (code: string, text: string, hit?: Partial<Hit>): Reason => ({
    code,
    text,
    photoId: hit?.photo?.id ?? null,
    question: hit?.question ?? null,
    score: hit?.p ?? null,
  });

  // 1. Reported history. Needs no photographs and no network, and nothing below can undo it.
  const reported = Questions.filter((q) =>
    disclosures.some((e) => e.question === q && e.answer === 'yes'),
  );
  if (reported.length)
    return make(
      'no_offer',
      'Not eligible for an offer',
      'This item cannot enter the offer process under the shop rules.',
      reported.map((q) => reason('reported_' + q, reportedText[q])),
      'Keep the item out of offer consideration. If an answer was given by mistake, a specialist has to reconcile it; photographs cannot clear a reported history.',
    );

  // 2. Visible damage or repair in the block band. Shown even when views or history are still missing.
  const garment = photos.filter((p) => p.view !== 'label');
  const blockHits: Hit[] = [],
    reviewHits: Hit[] = [];
  for (const photo of garment) {
    const scores = byPhoto.get(photo.id),
      bands = scores && decisionBands(t, scores);
    if (!scores || !bands) continue;
    // The damage band was fitted on max(broken, road_contact). Testing each question against it is
    // the same condition, and keeps every question's evidence: a higher score on one question must
    // never hide the other (the monotonicity property test fails if it does).
    const candidates: Array<[ExclusionQuestion, number | null, { clear: number; block: number }]> =
      [
        ['broken', yes(scores.answers.broken), bands.damage],
        ['road_contact', yes(scores.answers.road_contact), bands.damage],
        ['repair', yes(scores.answers.repair), bands.repair],
      ];
    for (const [question, p, band] of candidates) {
      if (p === null) continue;
      if (p >= band.block) blockHits.push({ photo, scores, question, p });
      else if (p >= band.clear) reviewHits.push({ photo, scores, question, p });
    }
  }
  const zones = config.protectiveZones[category];
  /** Unknown is treated as protective: an unanswered zone question never downgrades a block.
   * Road-contact damage is the visual sign of a crash, and crashed gear is excluded wherever the
   * marks are, so it never depends on the zone. */
  const inProtectiveArea = (hit: Hit) =>
    hit.question === 'road_contact' ||
    !zones ||
    Object.keys(zones).some((key) => {
      const p = yes(hit.scores.answers['zone_' + key]);
      return p === null || p >= t.zoneMin;
    });
  const likelyZone = (hit: Hit): string | null => {
    if (!zones) return null;
    let best: [string, number] | null = null;
    for (const [key, label] of Object.entries(zones)) {
      const p = yes(hit.scores.answers['zone_' + key]);
      if (p !== null && p >= 0.3 && (!best || p > best[1])) best = [label, p];
    }
    return best ? best[0] : null;
  };
  if (blockHits.length) {
    const protectiveHits = blockHits.filter(inProtectiveArea);
    if (protectiveHits.length)
      return make(
        'no_offer',
        'Not eligible for an offer',
        'The photographs show ' +
          [...new Set(protectiveHits.map((h) => questionLabel[h.question]))].join(' and ') +
          (protectiveHits.every((h) => h.question === 'road_contact')
            ? ', the kind of marks a crash leaves.'
            : ' in or near a protective area.') +
          ' A specialist can look at this if you think it is wrong.',
        protectiveHits.map((h) =>
          reason(
            h.question === 'road_contact'
              ? 'visible_road_contact'
              : 'visible_' + h.question + '_protective_area',
            'The ' +
              viewLabel[h.photo.view] +
              ' photograph shows ' +
              questionLabel[h.question] +
              (likelyZone(h) ? ' at the ' + likelyZone(h) : '') +
              '.',
            h,
          ),
        ),
        'Keep the item out of offer consideration, or ask a specialist to review the marked photographs.',
      );
    return make(
      'review',
      'A specialist will take a look',
      'The photographs show ' +
        [...new Set(blockHits.map((h) => questionLabel[h.question]))].join(' and ') +
        ' outside the protective areas listed for this kind of item. A specialist decides whether it matters.',
      blockHits.map((h) =>
        reason(
          'damage_outside_protective_areas',
          'The ' + viewLabel[h.photo.view] + ' photograph shows ' + questionLabel[h.question] + '.',
          h,
        ),
      ),
      'Send the record to a specialist. No offer is recommended until they have decided.',
    );
  }

  // 3. Coverage. Every photograph must be its own picture. v1 rejected two views with the same pixels
  // inside one request; v2 scores one photograph per request, so the check lives here (added
  // 2026-11-17, build guide section 11.3). Without it, the clean front sent twice could stand in for
  // a back that was never shown.
  const firstByHash = new Map<string, PhotoRecord>();
  for (const photo of photos) {
    const first = firstByHash.get(photo.sha256);
    if (first)
      return make(
        'retake',
        'One more photo',
        'Two photographs are the same picture (' +
          viewLabel[first.view] +
          ' and ' +
          viewLabel[photo.view] +
          ').',
        [
          reason(
            'duplicate_photo',
            'Take a separate photograph of the ' + viewLabel[photo.view] + '.',
            { photo },
          ),
        ],
        'Replace that photograph with a new one. Everything else is kept.',
        {
          requestPhoto: { view: photo.view, hint: 'The ' + viewLabel[photo.view] + ' of the item' },
        },
      );
    firstByHash.set(photo.sha256, photo);
  }
  const missing = config.requiredViews.find((v) => !photos.some((p) => p.view === v));
  if (missing)
    return make(
      'retake',
      'One more photo',
      'The ' + viewLabel[missing] + ' photograph is still needed.',
      [reason('missing_' + missing, 'Add the ' + viewLabel[missing] + ' photograph.')],
      'Add the missing photograph. Everything already captured is kept.',
      { requestPhoto: { view: missing, hint: 'The ' + viewLabel[missing] + ' of the item' } },
    );

  // 4. Every photograph needs a verified score record and thresholds for the scorer that produced it.
  const unscored = photos.filter((p) => !byPhoto.has(p.id));
  if (unscored.length)
    return make(
      'review',
      'A specialist will take a look',
      'The photo check did not complete. No assessment was made from the photographs.',
      unscored.map((p) =>
        reason(
          'analysis_unavailable',
          'The ' + viewLabel[p.view] + ' photograph was not checked.',
          { photo: p },
        ),
      ),
      'Try the check again when the connection is back, or hand the item to a specialist.',
    );
  const uncalibrated = garment.filter((p) => !decisionBands(t, byPhoto.get(p.id)!));
  if (uncalibrated.length)
    return make(
      'review',
      'A specialist will take a look',
      'The photo check ran on a service that has not been calibrated, so its result is not used on its own.',
      uncalibrated.map((p) =>
        reason(
          'thresholds_missing',
          'No thresholds exist for ' + byPhoto.get(p.id)!.scorer.id + '.',
          { photo: p },
        ),
      ),
      'Hand the record to a specialist.',
    );

  // 5. Photographs that cannot carry a judgement.
  for (const photo of photos) {
    const scores = byPhoto.get(photo.id)!;
    // 'soft' blocks since the focus gate was calibrated (work package 5, experiment E10, 2026-11-17).
    // The service sets it from the 512 px grid measure; before calibration it was advisory.
    const soft = photo.quality.warnings.includes('soft');
    const blocked =
      soft || photo.quality.warnings.some((w) => ['dark', 'bright', 'low_resolution'].includes(w));
    if (photo.view === 'label') {
      const legible = yes(scores.answers.label_legible);
      if (blocked || (legible !== null && legible < t.labelLegibleMin)) {
        if (input.closeUpsRequested < config.maxCloseUpRequests)
          return make(
            'retake',
            'One more photo',
            'The label could not be read.',
            [reason('label_unreadable', 'Retake the label photograph, flat and close.', { photo })],
            'Retake the label. If the label is missing or worn away, say so and a specialist will check.',
            { requestPhoto: { view: 'label', hint: 'The label, flat, filling the frame' } },
          );
        return make(
          'review',
          'A specialist will take a look',
          'The label could not be read from the photographs.',
          [reason('label_unreadable', 'The label is missing or not legible.', { photo })],
          'Hand the item to a specialist, who will check the label in person.',
        );
      }
      continue;
    }
    const usable = yes(scores.answers.usable);
    if (blocked || (usable !== null && usable < t.usableMin))
      return make(
        'retake',
        'One more photo',
        'The ' +
          viewLabel[photo.view] +
          (soft
            ? ' photograph is out of focus.'
            : ' photograph does not show the surface clearly enough.'),
        [
          reason(
            soft ? 'photo_out_of_focus' : 'photo_unusable',
            'Retake the ' + viewLabel[photo.view] + ' photograph in even light, in focus.',
            { photo, p: usable ?? undefined },
          ),
        ],
        'Retake that photograph. The others are kept.',
        {
          requestPhoto: {
            view: photo.view,
            hint: 'Even light, in focus, the item filling the frame',
          },
        },
      );
  }

  // 6. The subject has to be one piece of protective gear.
  for (const photo of photos.filter((p) => p.view === 'front' || p.view === 'back')) {
    const scores = byPhoto.get(photo.id)!;
    const single = yes(scores.answers.single_item);
    if (single !== null && single < t.singleItemMin && input.acceptedCountPhotoId !== photo.id)
      return make(
        'retake',
        'One item at a time',
        'The ' + viewLabel[photo.view] + ' photograph seems to show more than one item.',
        [reason('multiple_items', 'Photograph one item on its own.', { photo, p: single })],
        'Retake the photograph with only the item being offered in the frame.',
        { requestPhoto: { view: photo.view, hint: 'Only the one item, on a plain surface' } },
      );
    const gear = yes(scores.answers.gear);
    if (gear !== null && gear < t.gearMin)
      return make(
        'review',
        'A specialist will take a look',
        'The item was not recognised as motorcycle protective gear.',
        [
          reason('not_recognised_as_gear', 'A specialist confirms what the item is.', {
            photo,
            p: gear,
          }),
        ],
        'Hand the record to a specialist.',
      );
  }

  // 7. Review band: one targeted close-up first, then a person.
  if (reviewHits.length) {
    const strongest = reviewHits.reduce((a, b) => (b.p > a.p ? b : a));
    const reasons = reviewHits.map((h) =>
      reason(
        'possible_' + h.question,
        'The ' +
          viewLabel[h.photo.view] +
          ' photograph may show ' +
          questionLabel[h.question] +
          (likelyZone(h) ? ' at the ' + likelyZone(h) : '') +
          '.',
        h,
      ),
    );
    if (
      input.closeUpsRequested < config.maxCloseUpRequests &&
      reviewHits.some((h) => h.photo.view !== 'detail')
    )
      return make(
        'retake',
        'One close-up',
        'One area needs a closer photograph before a result can be given.',
        reasons,
        'Take one close-up of the area described. Everything already captured is kept.',
        {
          requestPhoto: {
            view: 'detail',
            hint:
              'A close-up of the ' + (likelyZone(strongest) ?? 'area that looks worn or marked'),
          },
        },
      );
    return make(
      'review',
      'A specialist will take a look',
      'The photographs may show damage or a repair. A specialist decides.',
      reasons,
      'Send the record to a specialist. No offer is recommended until they have decided.',
    );
  }

  // 8. History has to be a clear "no" three times. Array order is event order.
  const latest: Partial<Record<(typeof Questions)[number], string>> = {};
  for (const e of disclosures) latest[e.question] = e.answer;
  const open = Questions.filter((q) => latest[q] !== 'no');
  if (open.length)
    return make(
      'review',
      'A specialist will take a look',
      'Part of the item history is not known. Photographs cannot answer it.',
      open.map((q) =>
        reason(
          'history_unknown_' + q,
          'Not answered with a clear no: ' + q.replace('_', ' ') + '.',
        ),
      ),
      'Ask the person who knows the item, or hand the record to a specialist. Do not guess.',
    );

  // 9. Category rules.
  if (category === 'unknown' || category === 'other')
    return make(
      'review',
      'A specialist will take a look',
      'The kind of item could not be settled from the photographs.',
      [reason('category_unclear', 'A specialist confirms what the item is.')],
      'Hand the record to a specialist.',
    );
  if (
    config.reviewOnlyCategories.includes(category) ||
    !config.supportedCategories.includes(category)
  )
    return make(
      'review',
      'A specialist will take a look',
      'This kind of item is always checked by a specialist before any offer.',
      [
        reason(
          'category_review_only',
          'Items of this kind are not assessed from photographs alone.',
        ),
      ],
      'Hand the item to a specialist.',
    );

  // 10. Thresholds fitted on too little evidence never produce an offer.
  if (t.lowEvidence)
    return make(
      'review',
      'A specialist will take a look',
      'The photo check has not been calibrated on enough examples to stand on its own.',
      [reason('thresholds_low_evidence', 'More labelled examples are needed.')],
      'Hand the record to a specialist.',
    );

  // 11. Grade and offer.
  let wear: number | null = null;
  for (const photo of garment) {
    const a = byPhoto.get(photo.id)!.answers.wear;
    if (a?.type === 'level') wear = Math.max(wear ?? 0, a.score);
  }
  if (wear === null)
    return make(
      'review',
      'A specialist will take a look',
      'A condition grade could not be worked out from the photographs.',
      [reason('grade_unavailable', 'No wear rating was returned.')],
      'Hand the record to a specialist.',
    );
  const grade = (config.gradeFromWear.find(([upper]) => wear! < upper) ??
    config.gradeFromWear[config.gradeFromWear.length - 1]!)[1];
  if (!config.offerGrades.includes(grade))
    return make(
      'review',
      'A specialist will take a look',
      'The item shows heavy wear. A specialist decides whether an offer makes sense.',
      [reason('heavy_wear', 'Condition grade ' + grade + '.')],
      'Hand the record to a specialist.',
      { grade },
    );
  const categoryFromDetails = !photos.some((p) => p.view === 'front' || p.view === 'back');
  const incomplete: Reason[] = [];
  for (const photo of photos) {
    const missing = missingOfferChecks(photo, byPhoto.get(photo.id)!, categoryFromDetails);
    if (missing.length) {
      incomplete.push(
        reason(
          'incomplete_photo_checks',
          'The ' +
            viewLabel[photo.view] +
            ' photograph has no usable result for ' +
            missing.join(', ') +
            '.',
          { photo },
        ),
      );
    }
  }
  if (incomplete.length) {
    return make(
      'review',
      'A specialist will take a look',
      'Some of the photo checks needed for an offer are incomplete.',
      incomplete,
      'Keep the photographs and complete the missing checks or ask a specialist to inspect the item.',
    );
  }
  return make(
    'offer',
    'Offer recommended',
    'No crash, protective-area damage or protective-area repair was reported, and none was flagged in the photographs. Condition grade ' +
      grade +
      '. This is not a safety certification.',
    [
      reason(
        'history_clear',
        'The rider answered no to crash, protective-area damage and protective-area repair.',
      ),
      reason(
        'photos_clear',
        'No broken material, road-contact damage or repair was flagged in ' +
          garment.length +
          ' photographs.',
      ),
      reason('grade', 'Condition grade ' + grade + ' from visible wear.'),
    ],
    'Make an offer under the shop price policy. Check the item in hand before paying.',
    { grade },
  );
}
