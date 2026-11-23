import { describe, expect, it } from 'vitest';
import { Questions, type Disclosure } from '../packages/core/schema';
import { photoFeedback } from '../packages/core/v2/feedback';
import { ThresholdsSchema, type Decision2, type PhotoScores } from '../packages/core/v2/schema';
import { briefV2 } from '../app/src/brief-v2';

const thresholds = ThresholdsSchema.parse({
  version: 'test',
  batteryVersion: 'gear-2',
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
const quality = (warnings: Array<'soft' | 'dark' | 'bright' | 'low_resolution'> = []) => ({
  width: 1024,
  height: 768,
  brightness: 120,
  sharpness: 0.2,
  warnings,
});
const scores = (answers: Record<string, number>): PhotoScores => ({
  photoId: 'p1',
  sha256: 'a'.repeat(64),
  view: 'front',
  batteryVersion: 'gear-2',
  scorer: { id: 'local_logprob', model: 'm' },
  answers: Object.fromEntries(
    Object.entries(answers).map(([k, p]) => [k, { type: 'yesno' as const, p }]),
  ),
  usage: { inputTokens: 1, ms: 1 },
  scoredAt: '2026-11-17T12:00:00.000Z',
});
/** Assurance wording the product must never emit (the pattern from tests/v2-policy.test.ts). */
const forbidden =
  /\b(?:un)?certif(?:ied|y|ies)\b|\broadworthy\b|\bguarantee(?:d|s)?\b|\bundamaged\b|\b(?:crash|accident)[ -]?(?:free|proof)\b|\bsafe\b|\b100\s*%|\bfully protect/i;

describe('backend v2 per-photograph feedback', () => {
  it('says nothing about a clear, usable photograph of one item of gear', () => {
    expect(
      photoFeedback(
        'front',
        quality(),
        scores({ usable: 0.9, gear: 0.9, single_item: 0.9, broken: 0.99 }),
        thresholds,
      ),
    ).toEqual([]); // damage is never fed back here: that is the decision's job
  });

  it('asks for a better photograph with the same thresholds as the retake rules', () => {
    const codes = (view: 'front' | 'detail' | 'label', w: Parameters<typeof quality>[0], a = {}) =>
      photoFeedback(view, quality(w), scores(a), thresholds).map((f) => f.code);
    expect(codes('front', ['soft'])).toEqual(['out_of_focus']);
    expect(codes('front', ['dark'])).toEqual(['exposure']);
    expect(codes('front', ['low_resolution'])).toEqual(['too_small']);
    expect(codes('front', [], { usable: 0.2 })).toEqual(['unclear']);
    expect(codes('front', ['soft'], { usable: 0.2 })).toEqual(['out_of_focus']); // one cause, once
    expect(codes('front', [], { single_item: 0.1, gear: 0.2 })).toEqual([
      'several_items',
      'not_gear',
    ]);
    expect(codes('detail', [], { single_item: 0.1, gear: 0.2 })).toEqual([]); // close-ups show parts
    expect(codes('label', [], { label_legible: 0.2, usable: 0.1 })).toEqual(['label_unreadable']);
    for (const f of photoFeedback(
      'front',
      quality(['soft', 'dark']),
      scores({ gear: 0 }),
      thresholds,
    ))
      expect(f.text).not.toMatch(forbidden);
  });
});

describe('backend v2 inspection brief', () => {
  const decision: Decision2 = {
    outcome: 'review',
    policyVersion: '2026-11-16.1',
    thresholdsVersion: 'gear-2-test',
    category: 'jacket',
    grade: null,
    title: 'A specialist will take a look',
    summary: 'The photographs may show damage or a repair. A specialist decides.',
    reasons: [
      {
        code: 'possible_road_contact',
        text: 'The front photograph may show road-contact damage at the shoulder.',
        photoId: 'p1',
        question: 'road_contact',
        score: 0.4,
      },
    ],
    nextAction: 'Send the record to a specialist.',
    requestPhoto: null,
    protectivePerformanceCertified: false,
  };
  const history: Disclosure[] = [
    { id: 'a', question: 'crash', answer: 'yes', recordedAt: '2026-11-17T12:00:00.000Z' },
    ...Questions.map((question, i) => ({
      id: 'd' + i,
      question,
      answer: 'no' as const,
      recordedAt: '2026-11-17T12:01:00.000Z',
    })),
  ];

  it('carries the result, the reasons, the rider history and the photo checks', () => {
    const text = briefV2({
      id: '0123456789abcdef',
      disclosures: history,
      photos: [
        {
          id: 'p1',
          view: 'front',
          signed: {
            scores: scores({ broken: 0.12, road_contact: 0.4, repair: 0.03 }),
            signature: 'b'.repeat(64),
          },
        },
        { id: 'p2', view: 'label' },
      ],
      decision,
    });
    expect(text).toContain('RESULT: A SPECIALIST WILL TAKE A LOOK');
    expect(text).toContain('1. The front photograph may show road-contact damage at the shoulder.');
    expect(text).toContain('Crash: no (yes was given earlier)');
    expect(text).toContain('Front: broken material 0.12, road-contact damage 0.40, repair 0.03');
    expect(text).toContain('Label: not checked');
    expect(text).toContain('Versions: policy 2026-11-16.1, thresholds gear-2-test');
    expect(text).toContain('This is not a safety certification.');
    for (const line of text.split('\n'))
      if (!line.includes('not a safety certification')) expect(line).not.toMatch(forbidden);
  });
});
