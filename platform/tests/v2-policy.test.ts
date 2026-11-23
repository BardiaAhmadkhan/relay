import { describe, expect, it } from 'vitest';
import { Questions, type Answer, type Disclosure } from '../packages/core/schema';
import { decide2, resolveCategory, type DecideInput2 } from '../packages/core/v2/policy';
import {
  DecisionSchema2,
  PolicyConfigSchema,
  ThresholdsSchema,
  type Answer2,
  type PhotoRecord,
  type PhotoScores,
} from '../packages/core/v2/schema';
import configJson from '../packages/core/v2/policy.config.json';

const config = PolicyConfigSchema.parse(configJson);
const thresholds = ThresholdsSchema.parse({
  version: 'test',
  batteryVersion: 'b-test',
  source: 'unit test',
  lowEvidence: false,
  perScorer: {
    local_logprob: { damage: { clear: 0.15, block: 0.65 }, repair: { clear: 0.3, block: 0.85 } },
  },
  usableMin: 0.5,
  gearMin: 0.5,
  singleItemMin: 0.5,
  categoryMin: 0.6,
  zoneMin: 0.5,
  labelLegibleMin: 0.5,
});
const recordedAt = '2026-11-16T12:00:00.000Z';
const history = (values: readonly Answer[] = ['no', 'no', 'no']): Disclosure[] =>
  Questions.map((question, i) => ({ id: 'd' + i, question, answer: values[i]!, recordedAt }));
const photo = (view: PhotoRecord['view'], n: number): PhotoRecord => ({
  id: 'p-' + view + '-' + n,
  view,
  sha256: String(n).repeat(64).slice(0, 64),
  quality: { width: 1280, height: 960, brightness: 120, sharpness: 300, warnings: [] },
});
const yn = (p: number): Answer2 => ({ type: 'yesno', p });
const cleanAnswers = (category = 'jacket', wear = 1): Record<string, Answer2> => ({
  usable: yn(0.95),
  gear: yn(0.95),
  single_item: yn(0.95),
  category: { type: 'choice', choice: category, probabilities: { [category]: 0.9, other: 0.1 } },
  broken: yn(0.02),
  road_contact: yn(0.02),
  repair: yn(0.02),
  wear: { type: 'level', score: wear, probabilities: [0.1, 0.7, 0.15, 0.05] },
  zone_shoulder: yn(0.02),
  zone_elbow: yn(0.02),
  zone_back: yn(0.02),
  zone_chest: yn(0.02),
});
const scoresFor = (p: PhotoRecord, answers: Record<string, Answer2>): PhotoScores => ({
  photoId: p.id,
  sha256: p.sha256,
  view: p.view,
  batteryVersion: 'b-test',
  scorer: { id: 'local_logprob', model: 'test-model' },
  answers: p.view === 'label' ? { label_legible: yn(0.9) } : answers,
  usage: { inputTokens: 1000, ms: 500 },
  scoredAt: recordedAt,
});
function cleanCase(overrides: Partial<DecideInput2> = {}): DecideInput2 {
  const photos = [photo('front', 1), photo('back', 2), photo('label', 3)];
  return {
    disclosures: history(),
    photos,
    scores: photos.map((p) => scoresFor(p, cleanAnswers())),
    closeUpsRequested: 0,
    thresholds,
    config,
    ...overrides,
  };
}
const withAnswer = (input: DecideInput2, photoIndex: number, key: string, answer: Answer2) => ({
  ...input,
  scores: input.scores.map((s, i) =>
    i === photoIndex ? { ...s, answers: { ...s.answers, [key]: answer } } : s,
  ),
});
/** Deterministic generator so a failing case can be replayed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
/** Assurance wording the product must never emit, whatever the decision. */
const forbidden =
  /\b(?:un)?certif(?:ied|y|ies)\b|\broadworthy\b|\bguarantee(?:d|s)?\b|\bundamaged\b|\b(?:crash|accident)[ -]?(?:free|proof)\b|\bsafe\b|\b100\s*%|\bfully protect/i;

describe('offer policy v2', () => {
  describe('evidence required for an offer', () => {
    const detail = photo('detail', 4);
    const inputs = () => {
      const base = cleanCase();
      return {
        ...base,
        photos: [...base.photos, detail],
        scores: [...base.scores, scoresFor(detail, cleanAnswers())],
      };
    };
    const surface = ['usable', 'broken', 'road_contact', 'repair', 'wear'];
    const overview = [...surface, 'gear', 'single_item', 'category'];
    const required = [
      { index: 0, keys: overview },
      { index: 1, keys: overview },
      { index: 2, keys: ['label_legible'] },
      { index: 3, keys: surface },
    ];
    for (const { index, keys } of required) {
      for (const key of keys) {
        it(`withholds an offer when photo ${index + 1} lacks a usable ${key} answer`, () => {
          for (const mode of ['absent', 'wrong type']) {
            const input = inputs();
            const answers = input.scores[index]!.answers;
            if (mode === 'absent') delete answers[key];
            else
              answers[key] =
                answers[key]?.type === 'level'
                  ? yn(0)
                  : { type: 'level', score: 0, probabilities: [1, 0] };
            const decision = decide2(input);
            expect(decision.outcome).toBe('review');
            expect(decision.reasons).toContainEqual(
              expect.objectContaining({
                code: 'incomplete_photo_checks',
                photoId: input.photos[index]!.id,
              }),
            );
          }
        });
      }
    }
    it('leaves complete negative checks, irrelevant omissions and early exclusions intact', () => {
      const input = inputs();
      for (const key of ['single_item', 'gear', 'category', 'zone_shoulder'])
        delete input.scores[3]!.answers[key];
      delete input.scores[2]!.answers.label_ce;
      expect(decide2(input).outcome).toBe('offer');
      delete input.scores[0]!.answers.repair;
      const blocked = withAnswer(input, 0, 'road_contact', yn(0.99));
      expect(decide2(blocked).outcome).toBe('no_offer');
      expect(decide2({ ...input, disclosures: history(['yes', 'no', 'no']) }).outcome).toBe(
        'no_offer',
      );
    });
    it('requires the category on each contributing detail when no overview is required', () => {
      const inputsWithoutOverviews = inputs();
      const another = photo('detail', 5);
      const input = {
        ...inputsWithoutOverviews,
        photos: [detail, another],
        scores: [scoresFor(detail, cleanAnswers()), scoresFor(another, cleanAnswers())],
        config: { ...config, requiredViews: ['detail' as const] },
      };
      expect(decide2(input).outcome).toBe('offer');
      delete input.scores[1]!.answers.category;
      expect(decide2(input).outcome).toBe('review');
    });
  });

  it('recommends an offer for a complete clean record and grades it', () => {
    const d = decide2(cleanCase());
    expect(DecisionSchema2.parse(d)).toEqual(d);
    expect(d.outcome).toBe('offer');
    expect(d.grade).toBe('B');
    expect(d.category).toBe('jacket');
    expect(d.summary).toContain('This is not a safety certification');
    expect(d.protectivePerformanceCertified).toBe(false);
  });

  it('a reported exclusion wins over every photograph and survives a changed answer', () => {
    for (const q of Questions) {
      const changed: Disclosure[] = [
        { id: 'first', question: q, answer: 'yes', recordedAt },
        ...history(),
      ];
      const d = decide2(cleanCase({ disclosures: changed }));
      expect(d.outcome).toBe('no_offer');
      expect(d.reasons.map((r) => r.code)).toContain('reported_' + q);
    }
    expect(
      decide2(cleanCase({ disclosures: history(['yes', 'no', 'no']), photos: [], scores: [] }))
        .outcome,
    ).toBe('no_offer');
  });

  it('blocks visible damage in a protective area and says so with the photograph', () => {
    let input = withAnswer(cleanCase(), 0, 'broken', yn(0.9));
    input = withAnswer(input, 0, 'zone_elbow', yn(0.8));
    const d = decide2(input);
    expect(d.outcome).toBe('no_offer');
    expect(d.reasons[0]).toMatchObject({
      code: 'visible_broken_protective_area',
      photoId: 'p-front-1',
      question: 'broken',
      score: 0.9,
    });
    expect(d.reasons[0]!.text).toContain('elbow or forearm');
    expect(d.summary).toContain('A specialist can look at this');
  });

  it('treats an unanswered zone as protective, and only a fully answered clear map as outside', () => {
    const blocked = withAnswer(cleanCase(), 1, 'broken', yn(0.8));
    expect(decide2(blocked).outcome).toBe('review'); // all four jacket zones answered low
    expect(decide2(blocked).reasons[0]!.code).toBe('damage_outside_protective_areas');
    const unanswered = {
      ...blocked,
      scores: blocked.scores.map((s, i) => {
        if (i !== 1) return s;
        const { zone_back: _drop, ...rest } = s.answers;
        return { ...s, answers: rest };
      }),
    };
    expect(decide2(unanswered).outcome).toBe('no_offer');
  });

  it('road-contact damage blocks wherever it is, because crashed gear is excluded outright', () => {
    const d = decide2(withAnswer(cleanCase(), 0, 'road_contact', yn(0.9))); // every zone answered low
    expect(d.outcome).toBe('no_offer');
    expect(d.reasons[0]).toMatchObject({ code: 'visible_road_contact', question: 'road_contact' });
    expect(d.summary).toContain('the kind of marks a crash leaves');
  });

  it('shows block-band damage even when views and history are still missing', () => {
    const p = photo('detail', 7);
    const d = decide2({
      disclosures: [],
      photos: [p],
      scores: [scoresFor(p, { ...cleanAnswers(), broken: yn(0.97), zone_shoulder: yn(0.9) })],
      closeUpsRequested: 0,
      thresholds,
      config,
    });
    expect(d.outcome).toBe('no_offer');
  });

  it('asks for one close-up in the review band, then hands over to a person', () => {
    const input = withAnswer(cleanCase(), 0, 'road_contact', yn(0.4));
    const first = decide2(input);
    expect(first.outcome).toBe('retake');
    expect(first.requestPhoto?.view).toBe('detail');
    const second = decide2({ ...input, closeUpsRequested: 1 });
    expect(second.outcome).toBe('review');
    expect(second.reasons[0]!.code).toBe('possible_road_contact');
  });

  it('never lets one picture stand in for two views, and still blocks damage on it', () => {
    const base = cleanCase();
    const front = base.photos[0]!;
    const copy = { ...base.photos[1]!, sha256: front.sha256 }; // the front pixels sent as the back
    const input = {
      ...base,
      photos: [front, copy, base.photos[2]!],
      scores: [base.scores[0]!, { ...base.scores[1]!, sha256: front.sha256 }, base.scores[2]!],
    };
    const d = decide2(input);
    expect(d).toMatchObject({ outcome: 'retake', requestPhoto: { view: 'back' } });
    expect(d.reasons[0]).toMatchObject({ code: 'duplicate_photo', photoId: copy.id });
    // Damage on the duplicated picture is still shown: the block band is checked first.
    expect(decide2(withAnswer(input, 0, 'road_contact', yn(0.95))).outcome).toBe('no_offer');
  });

  it('asks for a retake of an out-of-focus garment photograph or label', () => {
    const base = cleanCase();
    const soften = (index: number) => ({
      ...base,
      photos: base.photos.map((p, i) =>
        i === index
          ? { ...p, quality: { ...p.quality, sharpness: 12, warnings: ['soft' as const] } }
          : p,
      ),
    });
    expect(decide2(soften(0))).toMatchObject({
      outcome: 'retake',
      requestPhoto: { view: 'front' },
      summary: 'The front photograph is out of focus.',
    });
    expect(decide2(soften(0)).reasons[0]!.code).toBe('photo_out_of_focus');
    expect(decide2(soften(2))).toMatchObject({
      outcome: 'retake',
      requestPhoto: { view: 'label' },
    });
  });

  it('uses the repair band independently of the damage band', () => {
    expect(
      decide2(withAnswer(cleanCase({ closeUpsRequested: 1 }), 0, 'repair', yn(0.5))).outcome,
    ).toBe('review');
    expect(decide2(withAnswer(cleanCase(), 0, 'repair', yn(0.9))).reasons[0]!.code).toBe(
      'damage_outside_protective_areas',
    );
  });

  it('never offers without a verified score for every photograph', () => {
    const base = cleanCase();
    for (let i = 0; i < base.scores.length; i++) {
      const d = decide2({ ...base, scores: base.scores.filter((_, j) => j !== i) });
      expect(d.outcome).toBe('review');
      expect(d.reasons[0]!.code).toBe('analysis_unavailable');
    }
    // A record for different pixels, another battery or another view is not evidence.
    expect(
      decide2({
        ...base,
        scores: base.scores.map((s, i) => (i ? s : { ...s, sha256: 'f'.repeat(64) })),
      }).outcome,
    ).toBe('review');
    expect(
      decide2({
        ...base,
        scores: base.scores.map((s, i) => (i ? s : { ...s, batteryVersion: 'old' })),
      }).outcome,
    ).toBe('review');
    expect(
      decide2({
        ...base,
        scores: base.scores.map((s, i) => (i ? s : { ...s, view: 'back' as const })),
      }).outcome,
    ).toBe('review');
  });

  it('never offers on an uncalibrated scorer or low-evidence thresholds', () => {
    const base = cleanCase();
    const verbal = {
      ...base,
      scores: base.scores.map((s) => ({ ...s, scorer: { id: 'verbal' as const, model: 'x' } })),
    };
    expect(decide2(verbal).reasons[0]!.code).toBe('thresholds_missing');
    expect(
      decide2({ ...base, thresholds: { ...thresholds, lowEvidence: true } }).reasons[0]!.code,
    ).toBe('thresholds_low_evidence');
  });

  it('routes missing views, unusable photographs, unreadable labels and several items to a retake', () => {
    const base = cleanCase();
    const noBack = {
      ...base,
      photos: base.photos.filter((p) => p.view !== 'back'),
      scores: base.scores.filter((s) => s.view !== 'back'),
    };
    expect(decide2(noBack)).toMatchObject({ outcome: 'retake', requestPhoto: { view: 'back' } });
    expect(decide2(withAnswer(base, 0, 'usable', yn(0.2)))).toMatchObject({
      outcome: 'retake',
      requestPhoto: { view: 'front' },
    });
    expect(decide2(withAnswer(base, 0, 'single_item', yn(0.1))).reasons[0]!.code).toBe(
      'multiple_items',
    );
    const dark = {
      ...base,
      photos: base.photos.map((p, i) =>
        i === 1 ? { ...p, quality: { ...p.quality, warnings: ['dark' as const] } } : p,
      ),
    };
    expect(decide2(dark)).toMatchObject({ outcome: 'retake', requestPhoto: { view: 'back' } });
    const label = withAnswer(base, 2, 'label_legible', yn(0.1));
    expect(decide2(label)).toMatchObject({ outcome: 'retake', requestPhoto: { view: 'label' } });
    expect(decide2({ ...label, closeUpsRequested: 1 }).reasons[0]!.code).toBe('label_unreadable');
  });

  it('sends unknown history, unsupported kinds, non-gear and heavy wear to a person', () => {
    expect(
      decide2(cleanCase({ disclosures: history(['no', 'unknown', 'no']) })).reasons[0]!.code,
    ).toBe('history_unknown_protective_damage');
    expect(decide2(cleanCase({ disclosures: [] })).outcome).toBe('review');
    const helmet = cleanCase();
    helmet.scores = helmet.scores.map((s) =>
      s.view === 'label' ? s : { ...s, answers: cleanAnswers('helmet') },
    );
    expect(decide2(helmet)).toMatchObject({ outcome: 'review', category: 'helmet' });
    expect(decide2(withAnswer(cleanCase(), 0, 'gear', yn(0.1))).reasons[0]!.code).toBe(
      'not_recognised_as_gear',
    );
    const worn = cleanCase();
    worn.scores = worn.scores.map((s) =>
      s.view === 'label' ? s : { ...s, answers: cleanAnswers('jacket', 2.8) },
    );
    expect(decide2(worn)).toMatchObject({ outcome: 'review', grade: 'D' });
    const unsure = cleanCase();
    unsure.scores = unsure.scores.map((s) =>
      s.view === 'label'
        ? s
        : {
            ...s,
            answers: {
              ...s.answers,
              category: {
                type: 'choice',
                choice: 'jacket',
                probabilities: { jacket: 0.4, trousers: 0.35, other: 0.25 },
              },
            },
          },
    );
    expect(decide2(unsure)).toMatchObject({ outcome: 'review', category: 'unknown' });
  });

  it('resolves the category from the overall views by mean probability', () => {
    const photos = [photo('front', 1), photo('back', 2)];
    const map = new Map(
      photos.map((p, i) => [p.id, scoresFor(p, cleanAnswers(i ? 'gloves' : 'jacket'))]),
    );
    expect(resolveCategory(photos, map, 0.6)).toBe('unknown'); // 0.45 each
    expect(resolveCategory(photos, new Map(), 0.6)).toBe('unknown');
  });

  it('property: an offer implies every gate, over 4,000 random records', () => {
    const next = rng(20261116);
    const answers: Answer[] = ['yes', 'no', 'unknown'];
    let offers = 0;
    for (let n = 0; n < 4000; n++) {
      const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!;
      // Skew toward the clean end so offers actually occur and the gates are exercised.
      const low = () => (next() < 0.8 ? next() * 0.14 : next());
      const high = () => (next() < 0.85 ? 0.5 + next() * 0.5 : next());
      const views: PhotoRecord['view'][] =
        next() < 0.85 ? ['front', 'back', 'label'] : ['front', 'label'];
      if (next() < 0.3) views.push('detail');
      const photos = views.map((v, i) => photo(v, i + 1));
      const scores = photos
        .filter(() => next() < 0.97)
        .map((p) =>
          scoresFor(p, {
            ...cleanAnswers(
              pick(['jacket', 'jacket', 'jacket', 'gloves', 'helmet', 'other']),
              next() * 3,
            ),
            usable: yn(high()),
            gear: yn(high()),
            single_item: yn(high()),
            broken: yn(low()),
            road_contact: yn(low()),
            repair: yn(low()),
            zone_shoulder: yn(next()),
          }),
        );
      const input: DecideInput2 = {
        disclosures:
          next() < 0.8 ? history() : history([pick(answers), pick(answers), pick(answers)]),
        photos,
        scores,
        closeUpsRequested: Math.floor(next() * 2),
        thresholds: next() < 0.95 ? thresholds : { ...thresholds, lowEvidence: true },
        config,
      };
      const d = decide2(input);
      expect(DecisionSchema2.safeParse(d).success).toBe(true);
      for (const text of [d.title, d.summary, d.nextAction, ...d.reasons.map((r) => r.text)])
        if (!text.includes('This is not a safety certification'))
          expect(text).not.toMatch(forbidden);
      if (input.disclosures.some((e) => e.answer === 'yes')) expect(d.outcome).toBe('no_offer');
      if (d.outcome !== 'offer') continue;
      offers++;
      expect(input.disclosures.every((e) => e.answer === 'no')).toBe(true);
      expect(input.thresholds.lowEvidence).toBe(false);
      for (const v of config.requiredViews) expect(photos.some((p) => p.view === v)).toBe(true);
      for (const p of photos) {
        const s = scores.find((x) => x.photoId === p.id);
        expect(s).toBeDefined();
        if (p.view === 'label') continue;
        const y = (k: string) => (s!.answers[k] as { p: number }).p;
        expect(Math.max(y('broken'), y('road_contact'))).toBeLessThan(0.15);
        expect(y('repair')).toBeLessThan(0.3);
        expect(y('usable')).toBeGreaterThanOrEqual(0.5);
      }
      expect(config.supportedCategories).toContain(d.category);
      expect(config.offerGrades).toContain(d.grade);
    }
    expect(offers).toBeGreaterThan(20); // the generator does reach the offer path
  });

  it('property: raising a damage or repair score never moves a decision toward an offer', () => {
    const next = rng(77);
    const rank = { offer: 0, retake: 1, review: 1, no_offer: 2 } as const;
    for (let n = 0; n < 3000; n++) {
      let input = cleanCase({ closeUpsRequested: Math.floor(next() * 2) });
      const index = Math.floor(next() * 2);
      for (const key of ['broken', 'road_contact', 'repair', 'zone_shoulder', 'zone_back'])
        input = withAnswer(input, index, key, yn(next() < 0.6 ? next() * 0.2 : next()));
      const before = decide2(input);
      const key = (['broken', 'road_contact', 'repair'] as const)[Math.floor(next() * 3)]!;
      const current = (input.scores[index]!.answers[key] as { p: number }).p;
      const raised = withAnswer(input, index, key, yn(current + (1 - current) * next()));
      const after = decide2(raised);
      // offer < (retake | review) < no_offer: a higher score can only hold the rank or raise it.
      expect(rank[after.outcome]).toBeGreaterThanOrEqual(rank[before.outcome]);
    }
  });
});
