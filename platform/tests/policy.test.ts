import { describe, expect, it } from 'vitest';
import { currentAnswers, decide, inspectionBrief } from '../packages/core/policy';
import {
  DecisionSchema,
  POLICY_VERSION,
  SCHEMA_VERSION,
  Questions,
  type Answer,
  type Correction,
  type Disclosure,
  type Observation,
  type PhotoEvidence,
} from '../packages/core/schema';

const recordedAt = '2026-10-26T12:00:00.000Z';
const answers: Answer[] = ['yes', 'no', 'unknown'];
const combinations = answers.flatMap((crash) =>
  answers.flatMap((damage) => answers.map((repair) => [crash, damage, repair] as const)),
);

function disclosures(values: readonly Answer[] = ['no', 'no', 'no']): Disclosure[] {
  return Questions.map((question, index) => ({
    id: 'disclosure-' + index,
    question,
    answer: values[index]!,
    recordedAt,
  }));
}

function photos(): PhotoEvidence[] {
  return (['front', 'back', 'label'] as const).map((view, index) => ({
    id: 'photo-' + view,
    view,
    sha256: String(index + 1).repeat(64),
    byteLength: 12_000,
    quality: { width: 1200, height: 1600, brightness: 125, sharpness: 120, warnings: [] },
  }));
}

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    schemaVersion: SCHEMA_VERSION,
    category: 'motorcycle_jacket',
    attributes: [
      {
        field: 'brand',
        value: 'Test manufacturer',
        kind: 'visible_text',
        imageIds: ['photo-label'],
      },
      {
        field: 'marking',
        value: 'EN 17092-3:2020 AA',
        kind: 'visible_text',
        imageIds: ['photo-label'],
      },
    ],
    concerns: [],
    missingViews: [],
    multipleItems: false,
    provider: 'openai',
    model: 'unit-test-fixture',
    coverage: 'visual_observations',
    durationMs: 120,
    usage: { inputTokens: 100, outputTokens: 40 },
    ...overrides,
  };
}

function expectNoOffer(result: ReturnType<typeof decide>) {
  expect(result.offerRecommended).toBe(false);
  expect(result.protectivePerformanceCertified).toBe(false);
  expect(result.policyVersion).toBe(POLICY_VERSION);
  expect(DecisionSchema.safeParse(result).success).toBe(true);
  expect(result.reasons.length).toBeGreaterThan(0);
  expect(result.nextAction.length).toBeGreaterThan(0);
}

describe('deterministic exclusion policy', () => {
  it('enumerates all 27 independent yes/no/unknown combinations', () => {
    expect(combinations).toHaveLength(27);
    expect(new Set(combinations.map((values) => values.join(','))).size).toBe(27);
  });

  it.each(combinations)(
    'history crash=%s damage=%s repair=%s cannot be overridden by vision',
    (crash, damage, repair) => {
      const values = [crash, damage, repair];
      const observations = [
        observation(),
        observation({ concerns: [{ kind: 'repair', area: 'protective', imageId: 'photo-front' }] }),
        observation({ missingViews: ['detail'] }),
        null,
      ];
      for (const visual of observations) {
        const result = decide({
          disclosures: disclosures(values),
          photos: photos(),
          observation: visual,
        });
        expectNoOffer(result);
        if (values.includes('yes')) {
          expect(result.state).toBe('not_eligible');
          const expectedExclusions = Questions.filter((_, index) => values[index] === 'yes');
          expect(result.reasons.map((reason) => reason.code)).toEqual(expectedExclusions);
        } else if (values.includes('unknown')) {
          expect(result.state).toBe('more_information');
        } else if (!visual || visual.missingViews.length) {
          expect(result.state).toBe('more_information');
        } else if (visual.concerns.length) {
          expect(result.state).toBe('human_inspection');
        } else {
          expect(result.state).toBe('ready_for_review');
        }
      }
    },
  );

  it.each(Questions)('retains a historical yes for %s after a later no', (question) => {
    const events = disclosures();
    events.push({ id: 'reported-exclusion', question, answer: 'yes', recordedAt });
    events.push({
      id: 'changed-answer',
      question,
      answer: 'no',
      recordedAt: '2026-10-26T12:01:00.000Z',
    });
    expect(currentAnswers(events)[question]).toBe('no');
    const result = decide({ disclosures: events, photos: photos(), observation: observation() });
    expect(result.state).toBe('not_eligible');
    expect(result.reasons.map((reason) => reason.code)).toContain(question);
    expect(result.nextAction).toMatch(/reconciliation/);
    expectNoOffer(result);
  });

  it.each(Questions)('retains a historical yes for %s after a later unknown', (question) => {
    const events = disclosures();
    events.push({ id: 'positive', question, answer: 'yes', recordedAt });
    events.push({ id: 'unknown-now', question, answer: 'unknown', recordedAt });
    const result = decide({ disclosures: events, photos: photos(), observation: observation() });
    expect(result.state).toBe('not_eligible');
    expectNoOffer(result);
  });

  it('uses disclosure event order instead of trusting client clock order', () => {
    const events = disclosures();
    events.push({
      id: 'clock-skew',
      question: 'crash',
      answer: 'unknown',
      recordedAt: '2025-01-01T00:00:00.000Z',
    });
    expect(currentAnswers(events).crash).toBe('unknown');
    const result = decide({ disclosures: events, photos: photos(), observation: observation() });
    expect(result.state).toBe('more_information');
    expectNoOffer(result);
  });

  it.each(Questions)('does not interpret an absent %s answer as no', (question) => {
    const result = decide({
      disclosures: disclosures().filter((event) => event.question !== question),
      photos: photos(),
      observation: observation(),
    });
    expect(result.state).toBe('more_information');
    expect(result.reasons.map((reason) => reason.code)).toContain('unknown_' + question);
    expectNoOffer(result);
  });

  it('checks a reported exclusion before missing photos, analysis or corrections', () => {
    const result = decide({
      disclosures: disclosures(['yes', 'unknown', 'unknown']),
      corrections: [{ field: 'model', value: 'Pristine and safe', recordedAt }],
      observation: observation({ provider: 'test' }),
    });
    expect(result.state).toBe('not_eligible');
    expectNoOffer(result);
  });
});

describe('evidence completeness and model limitations', () => {
  it.each(['front', 'back', 'label'] as const)('requires the %s view', (view) => {
    const result = decide({
      disclosures: disclosures(),
      photos: photos().filter((photo) => photo.view !== view),
      observation: observation(),
    });
    expect(result.state).toBe('more_information');
    expect(result.reasons.map((reason) => reason.code)).toContain('missing_' + view);
    expectNoOffer(result);
  });

  it.each(['low_resolution', 'dark', 'bright'] as const)(
    'requires recovery for %s evidence',
    (warning) => {
      const evidence = photos();
      evidence[0]!.quality.warnings = [warning];
      const result = decide({
        disclosures: disclosures(),
        photos: evidence,
        observation: observation(),
      });
      expect(result.state).toBe('more_information');
      expect(result.reasons.map((reason) => reason.code)).toContain('quality_photo-front');
      expectNoOffer(result);
    },
  );

  it.each([undefined, null])('cannot progress without validated analysis: %s', (visual) => {
    const result = decide({ disclosures: disclosures(), photos: photos(), observation: visual });
    expect(result.state).toBe('more_information');
    expect(result.reasons.map((reason) => reason.code)).toContain('no_analysis');
    expectNoOffer(result);
  });

  it.each(['local_clip', 'local_siglip'] as const)(
    'keeps %s category-only output in human inspection',
    (provider) => {
      const result = decide({
        disclosures: disclosures(),
        photos: photos(),
        observation: observation({ provider, coverage: 'category_only', usage: null }),
      });
      expect(result.state).toBe('human_inspection');
      expect(result.reasons.map((reason) => reason.code)).toContain('local_scope');
      expectNoOffer(result);
    },
  );

  it('does not present a disclosed test fixture as a live assessment', () => {
    const result = decide({
      disclosures: disclosures(),
      photos: photos(),
      observation: observation({ provider: 'test' }),
    });
    expect(result.state).toBe('human_inspection');
    expect(result.reasons.map((reason) => reason.code)).toContain('example');
    expect(result.summary).toMatch(/test example/);
    expectNoOffer(result);
  });

  it.each(['trousers', 'gloves', 'boots', 'helmet', 'other', 'unknown'] as const)(
    'routes unsupported %s to a specialist',
    (category) => {
      const result = decide({
        disclosures: disclosures(),
        photos: photos(),
        observation: observation({ category }),
      });
      expect(result.state).toBe('human_inspection');
      expectNoOffer(result);
    },
  );

  it.each([
    { category: 'multiple' as const, multipleItems: false },
    { category: 'motorcycle_jacket' as const, multipleItems: true },
    { category: 'multiple' as const, multipleItems: true },
  ])('requests one item when either model signal reports mixed objects: %j', (mixed) => {
    const result = decide({
      disclosures: disclosures(),
      photos: photos(),
      observation: observation(mixed),
    });
    expect(result.state).toBe('more_information');
    expect(result.reasons.map((reason) => reason.code)).toContain('multiple');
    expectNoOffer(result);
  });

  it.each(['front', 'back', 'label', 'detail'] as const)(
    'honours model-reported missing %s evidence despite submitted view labels',
    (view) => {
      const result = decide({
        disclosures: disclosures(),
        photos: photos(),
        observation: observation({ missingViews: [view] }),
      });
      expect(result.state).toBe('more_information');
      expect(result.reasons.map((reason) => reason.code)).toContain('vision_missing_' + view);
      expectNoOffer(result);
    },
  );

  const concernCases = (
    ['abrasion', 'tear', 'seam', 'repair', 'closure', 'insert', 'obscured', 'other'] as const
  ).flatMap((kind) =>
    (['protective', 'nonprotective', 'unknown'] as const).map((area) => ({ kind, area })),
  );
  it.each(concernCases)('routes concern $kind in $area area for inspection', (concern) => {
    const result = decide({
      disclosures: disclosures(),
      photos: photos(),
      observation: observation({ concerns: [{ ...concern, imageId: 'photo-front' }] }),
    });
    expect(result.state).toBe('human_inspection');
    expect(result.reasons.map((reason) => reason.code)).toContain('concern_' + concern.kind);
    expectNoOffer(result);
  });

  it.each(['category', 'brand', 'model', 'size', 'material'] as const)(
    'keeps rider %s corrections separate and reviewable',
    (field) => {
      const correction: Correction = { field, value: 'Rider correction', recordedAt };
      const original = observation();
      const result = decide({
        disclosures: disclosures(),
        photos: photos(),
        observation: original,
        corrections: [correction],
      });
      expect(result.state).toBe('human_inspection');
      expect(result.reasons.map((reason) => reason.code)).toContain('correction');
      expect(original.attributes[0]!.value).toBe('Test manufacturer');
      expectNoOffer(result);
    },
  );

  it('only describes the strongest positive state as a next review step', () => {
    const result = decide({
      disclosures: disclosures(),
      photos: photos(),
      observation: observation(),
    });
    expect(result.state).toBe('ready_for_review');
    expect(result.summary).toContain('does not establish safety');
    expect(result.nextAction).toContain('specialist');
    expect(result.reasons.map((reason) => reason.text).join(' ')).toContain(
      'Unseen and internal condition remain unknown',
    );
    expectNoOffer(result);
  });

  it('does not mutate evidence while deciding', () => {
    const input = {
      disclosures: disclosures(),
      photos: photos(),
      observation: observation(),
      corrections: [],
    };
    const before = structuredClone(input);
    decide(input);
    expect(input).toEqual(before);
  });
});

describe('review packet provenance', () => {
  it('exports history, original observations, rider corrections and unresolved facts together', () => {
    const events = disclosures();
    events.push({ id: 'past-report', question: 'crash', answer: 'yes', recordedAt });
    events.push({ id: 'revision', question: 'crash', answer: 'no', recordedAt });
    const brief = inspectionBrief({
      id: 'case-test-01',
      disclosures: events,
      photos: photos(),
      observation: observation(),
      corrections: [{ field: 'brand', value: 'Different brand', recordedAt }],
    });
    expect(brief).toContain('Assessment: case-test-01');
    expect(brief).toContain('Policy: ' + POLICY_VERSION);
    expect(brief).toContain('Not eligible for an offer');
    expect(brief).toContain('Has it been worn in a crash? yes');
    expect(brief).toContain('Has it been worn in a crash? no');
    expect(brief).toContain('brand: Test manufacturer [visible_text; images photo-label]');
    expect(brief).toContain('brand: Different brand [rider report;');
    expect(brief).toContain(photos()[0]!.sha256);
    expect(brief).toContain('UNKNOWN / UNVERIFIED');
    expect(brief).toContain(
      'No protective-performance certification. No offer or price recommendation.',
    );
  });
});

describe('defense in depth for adapter scope', () => {
  it.each(['local_clip', 'local_siglip'] as const)(
    'does not promote forged %s visual coverage into condition review',
    (provider) => {
      const result = decide({
        disclosures: disclosures(),
        photos: photos(),
        observation: observation({
          provider,
          coverage: 'visual_observations',
          attributes: [],
          usage: null,
        }),
      });
      expect(result.state).toBe('human_inspection');
      expectNoOffer(result);
    },
  );

  it('does not count one normalized photograph as three independent views', () => {
    const evidence = photos().map((photo) => ({ ...photo, sha256: 'a'.repeat(64) }));
    const result = decide({
      disclosures: disclosures(),
      photos: evidence,
      observation: observation(),
    });
    expect(result.state).toBe('more_information');
    expectNoOffer(result);
  });
});
