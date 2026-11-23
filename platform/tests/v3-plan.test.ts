import { describe, expect, it } from 'vitest';
import { Questions, type Answer, type Disclosure, type PhotoView } from '../packages/core/schema';
import { decide2 } from '../packages/core/v2/policy';
import {
  PolicyConfigSchema,
  ThresholdsSchema,
  type Answer2,
  type PhotoRecord,
  type PhotoScores,
} from '../packages/core/v2/schema';
import { GARMENT_QUESTIONS, LABEL_QUESTIONS, ZONE_QUESTIONS } from '../packages/vision/v2/battery';
import { nextKeys, PlannedScorer, staticKeys, toPolicyScale } from '../packages/vision/v2/plan';
import type { Scorer } from '../packages/vision/v2/scorer';
import configJson from '../packages/core/v2/policy.config.json';
import thresholdsJson from '../packages/core/v2/thresholds.json';

const config = PolicyConfigSchema.parse(configJson);
const thresholds = ThresholdsSchema.parse(thresholdsJson);
const bands = thresholds.perScorer.local_logprob!;
function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}
const recordedAt = '2026-11-17T12:00:00.000Z';
const CATEGORIES = ['jacket', 'jacket', 'trousers', 'gloves', 'boots', 'helmet', 'other'];

/** Everything the v2 service asks about one photograph: the whole battery, plus the zone questions of
 * the photograph's own category when damage or a repair reaches its clear threshold. */
function fullAnswers(
  view: PhotoView,
  next: () => number,
  item: { category: string; clean: boolean },
): Record<string, Answer2> {
  const yn = (p: number): Answer2 => ({ type: 'yesno', p });
  // Scores spread over the whole range, with extra mass near both thresholds of each band.
  const near = () => {
    if (item.clean) return next() * 0.14; // a clean item: every damage score below the clear band
    const r = next();
    if (r < 0.3) return next() * 0.14;
    if (r < 0.45) return bands.damage.clear + (next() - 0.5) * 0.02;
    if (r < 0.6) return bands.damage.block + (next() - 0.5) * 0.02;
    return next();
  };
  if (view === 'label')
    return Object.fromEntries(
      LABEL_QUESTIONS.map((q) => [
        q.key,
        q.type === 'yesno'
          ? yn(next())
          : { type: 'choice' as const, choice: 'other', probabilities: { other: 1 } },
      ]),
    );
  const category = item.category;
  const answers: Record<string, Answer2> = {
    usable: yn(next() < 0.85 ? 0.5 + next() / 2 : next()),
    gear: yn(next() < 0.85 ? 0.5 + next() / 2 : next()),
    single_item: yn(next() < 0.85 ? 0.5 + next() / 2 : next()),
    category: {
      type: 'choice',
      choice: category,
      probabilities: { [category]: 0.6 + next() * 0.4, other: 0.05 },
    },
    material: { type: 'choice', choice: 'leather', probabilities: { leather: 1 } },
    broken: yn(near()),
    road_contact: yn(near()),
    repair: yn(item.clean || next() < 0.7 ? next() * 0.29 : next()),
    wear: { type: 'level', score: next() * 3, probabilities: [0.25, 0.25, 0.25, 0.25] },
  };
  const damage = Math.max(
    (answers.broken as { p: number }).p,
    (answers.road_contact as { p: number }).p,
  );
  if (damage >= bands.damage.clear || (answers.repair as { p: number }).p >= bands.repair.clear)
    for (const z of ZONE_QUESTIONS[category] ?? []) answers[z.key] = yn(next());
  return answers;
}
/** What the plan asks, read from the same answers. */
function plannedAnswers(view: PhotoView, full: Record<string, Answer2>) {
  const answers: Record<string, Answer2> = {};
  let asked = 0;
  for (let i = 0; i < 8; i++) {
    const keys = nextKeys(view, answers, bands);
    if (!keys.length) break;
    for (const k of keys) {
      expect(full[k], 'the plan asked ' + k + ', which v2 had not asked').toBeDefined();
      answers[k] = full[k]!;
      asked++;
    }
  }
  return { answers, asked };
}
const record = (p: PhotoRecord, answers: Record<string, Answer2>): PhotoScores => ({
  photoId: p.id,
  sha256: p.sha256,
  view: p.view,
  batteryVersion: thresholds.batteryVersion,
  scorer: { id: 'local_logprob', model: 'm' },
  answers,
  usage: { inputTokens: 0, ms: 0 },
  scoredAt: recordedAt,
});

describe('v3 question plan', () => {
  it('property: the plan never changes the outcome, the grade or the photograph asked for', () => {
    const next = rng(20261117);
    let full = 0,
      planned = 0,
      offers = 0,
      byOutcome: Record<string, number> = {};
    for (let n = 0; n < 6000; n++) {
      const views: PhotoView[] = ['front', 'back', 'label'];
      if (next() < 0.35) views.push('detail');
      const photos: PhotoRecord[] = views.map((view, i) => ({
        id: 'p' + i,
        view,
        sha256: String(i + 1)
          .repeat(64)
          .slice(0, 64),
        quality: { width: 1024, height: 768, brightness: 120, sharpness: 0.2, warnings: [] },
      }));
      const answers: Answer[] = ['no', 'no', 'no'];
      if (next() < 0.1) answers[Math.floor(next() * 3)] = next() < 0.5 ? 'unknown' : 'yes';
      const disclosures: Disclosure[] = Questions.map((question, i) => ({
        id: 'd' + i,
        question,
        answer: answers[i]!,
        recordedAt,
      }));
      const item = {
        category: CATEGORIES[Math.floor(next() * CATEGORIES.length)]!,
        clean: next() < 0.4,
      };
      const fullRecords: PhotoScores[] = [],
        plannedRecords: PhotoScores[] = [];
      for (const p of photos) {
        const all = fullAnswers(p.view, next, item);
        const plan = plannedAnswers(p.view, all);
        fullRecords.push(record(p, all));
        plannedRecords.push(record(p, plan.answers));
        full +=
          p.view === 'label'
            ? LABEL_QUESTIONS.length
            : GARMENT_QUESTIONS.length + (Object.keys(all).length - GARMENT_QUESTIONS.length);
        planned += plan.asked;
      }
      const input = {
        disclosures,
        photos,
        closeUpsRequested: Math.floor(next() * 2),
        thresholds,
        config,
      };
      const a = decide2({ ...input, scores: fullRecords }),
        b = decide2({ ...input, scores: plannedRecords });
      expect(b.outcome, JSON.stringify({ a: a.reasons, b: b.reasons })).toBe(a.outcome);
      expect(b.grade).toBe(a.grade);
      expect(b.requestPhoto?.view ?? null).toBe(a.requestPhoto?.view ?? null);
      const codes = new Set(a.reasons.map((r) => r.code));
      for (const r of b.reasons) expect(codes.has(r.code), r.code).toBe(true);
      if (a.outcome === 'offer') offers++;
      byOutcome[a.outcome] = (byOutcome[a.outcome] ?? 0) + 1;
    }
    // Every outcome is exercised, and the plan asks fewer questions.
    expect(Object.keys(byOutcome).sort()).toEqual(['no_offer', 'offer', 'retake', 'review']);
    expect(offers).toBeGreaterThan(100);
    expect(planned).toBeLessThan(full);
  });

  it('stops at road-contact damage in the block band and skips what cannot matter', () => {
    const yn = (p: number): Answer2 => ({ type: 'yesno', p });
    expect(nextKeys('front', {}, bands)).toEqual(['road_contact']);
    expect(nextKeys('front', { road_contact: yn(0.9) }, bands)).toEqual(['category']);
    expect(nextKeys('detail', { road_contact: yn(0.9) }, bands)).toEqual([]);
    const clean = { road_contact: yn(0.02), broken: yn(0.02), repair: yn(0.02), usable: yn(0.9) };
    expect(nextKeys('front', clean, bands)).toEqual(['gear', 'single_item', 'category']);
    expect(nextKeys('detail', clean, bands)).toEqual(['category']);
    const jacket: Answer2 = { type: 'choice', choice: 'jacket', probabilities: { jacket: 1 } };
    expect(nextKeys('detail', { ...clean, category: jacket }, bands)).toEqual(['wear']);
    // Review band: wear and zones are skipped; block band of broken material: zones are asked.
    expect(nextKeys('detail', { ...clean, broken: yn(0.3), category: jacket }, bands)).toEqual([]);
    expect(nextKeys('detail', { ...clean, broken: yn(0.9), category: jacket }, bands)).toEqual(
      ZONE_QUESTIONS.jacket!.map((q) => q.key),
    );
    expect(nextKeys('label', {}, bands)).toEqual(['label_legible', 'label_ce']);
    expect(staticKeys('detail', GARMENT_QUESTIONS).map((q) => q.key)).not.toContain('gear');
    expect(staticKeys('front', GARMENT_QUESTIONS).map((q) => q.key)).not.toContain('material');
  });

  it('wraps a scorer: one record from one scorer, asked stage by stage', async () => {
    const calls: string[][] = [];
    const inner: Scorer = {
      id: 'local_logprob',
      model: 'm',
      async score(_photo, questions) {
        calls.push(questions.map((q) => q.key));
        const answers: Record<string, Answer2> = {};
        for (const q of questions)
          answers[q.key] =
            q.type === 'yesno'
              ? { type: 'yesno', p: q.key === 'road_contact' ? 0.02 : 0.9 }
              : q.type === 'choice'
                ? { type: 'choice', choice: 'jacket', probabilities: { jacket: 1 } }
                : { type: 'level', score: 1, probabilities: [0, 1, 0, 0] };
        return { answers, inputTokens: 100, ms: 1 };
      },
    };
    const planned = new PlannedScorer(inner, () => bands);
    const result = await planned.score(
      { jpeg: new Uint8Array(1), view: 'front' },
      GARMENT_QUESTIONS,
      new AbortController().signal,
    );
    // broken 0.9 is in the block band: zones decide, so they are asked; wear never is.
    expect(calls).toEqual([
      ['road_contact'],
      ['broken', 'repair', 'usable'],
      ['gear', 'single_item', 'category'],
      ZONE_QUESTIONS.jacket!.map((q) => q.key),
    ]);
    expect(result.inputTokens).toBe(400);
    expect(Object.keys(result.answers)).not.toContain('material');
  });
});

describe('v3 resolution cascade', () => {
  const stage1 = { clear: 0.139, block: 0.552 },
    policy = bands.damage;
  const band = (s: number, b: { clear: number; block: number }) =>
    s < b.clear ? 0 : s < b.block ? 1 : 2;

  it('property: mapping a first-stage score keeps its band and its order', () => {
    const next = rng(512);
    let previous = -1,
      last = -1;
    const sorted = Array.from({ length: 5000 }, () => next()).sort((a, b) => a - b);
    for (const s of [
      0,
      stage1.clear - 1e-9,
      stage1.clear,
      stage1.block - 1e-9,
      stage1.block,
      1,
      ...sorted,
    ]) {
      const m = toPolicyScale(s, stage1, policy);
      expect(band(m, policy), String(s)).toBe(band(s, stage1));
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(1);
    }
    for (const s of sorted) {
      const m = toPolicyScale(s, stage1, policy);
      if (s > previous) expect(m).toBeGreaterThanOrEqual(last);
      previous = s;
      last = m;
    }
  });

  /** A scorer that answers from two tables, one per image, and records which image each call used. */
  function twoImageScorer(low: Record<string, number>, high: Record<string, number>) {
    const LOW = new Uint8Array([1]),
      HIGH = new Uint8Array([2]);
    const calls: Array<{ image: 'low' | 'high'; keys: string[] }> = [];
    const inner: Scorer = {
      id: 'local_logprob',
      model: 'm',
      async score(photo, questions) {
        const image = photo.jpeg === LOW ? 'low' : 'high';
        calls.push({ image, keys: questions.map((q) => q.key) });
        const table = image === 'low' ? low : high;
        const answers: Record<string, Answer2> = {};
        for (const q of questions)
          answers[q.key] =
            q.type === 'yesno'
              ? { type: 'yesno', p: table[q.key] ?? 0.9 }
              : q.type === 'choice'
                ? { type: 'choice', choice: 'jacket', probabilities: { jacket: 1 } }
                : { type: 'level', score: 1, probabilities: [0, 1, 0, 0] };
        return { answers, inputTokens: image === 'low' ? 300 : 1300, ms: 1 };
      },
    };
    const planned = new PlannedScorer(
      inner,
      () => bands,
      () => ({ damage: stage1, repair: bands.repair }),
    );
    const run = (view: PhotoView) =>
      planned.score(
        { jpeg: HIGH, low: LOW, view },
        [...GARMENT_QUESTIONS, ...LABEL_QUESTIONS],
        new AbortController().signal,
      );
    return { calls, run, planned };
  }

  it('decides a clean close-up on the small image alone', async () => {
    const s = twoImageScorer({ road_contact: 0.03, broken: 0.05, repair: 0.02 }, {});
    const r = await s.run('detail');
    expect(s.calls.every((c) => c.image === 'low')).toBe(true);
    expect((r.answers.broken as { p: number }).p).toBeLessThan(policy.clear);
    expect((r.answers.broken_low as { p: number }).p).toBe(0.05);
    expect(Object.keys(r.answers)).toContain('wear');
    expect(s.planned.model).toBe('m cascade');
  });

  it('asks the two damage questions again on the full image when the small one is unsure', async () => {
    const s = twoImageScorer(
      { road_contact: 0.03, broken: 0.3, repair: 0.02 },
      { road_contact: 0.02, broken: 0.04 },
    );
    const r = await s.run('detail');
    expect(s.calls.filter((c) => c.image === 'high')).toEqual([
      { image: 'high', keys: ['road_contact', 'broken'] },
    ]);
    expect((r.answers.broken as { p: number }).p).toBe(0.04); // the full image's answer stands
    expect((r.answers.broken_low as { p: number }).p).toBe(0.3);
    expect(Object.keys(r.answers)).toContain('wear'); // cleared at full size, so the grade is needed
  });

  it('stops at road-contact damage on the small image, and keeps labels and zones on the full image', async () => {
    const road = twoImageScorer({ road_contact: 0.6 }, {});
    const r = await road.run('detail');
    expect((r.answers.road_contact as { p: number }).p).toBeGreaterThanOrEqual(policy.block);
    expect(road.calls.map((c) => c.keys)).toEqual([['road_contact']]);
    const label = twoImageScorer({}, {});
    await label.run('label');
    expect(label.calls.every((c) => c.image === 'high')).toBe(true);
    const broken = twoImageScorer({ road_contact: 0.03, broken: 0.9, repair: 0.02 }, {});
    await broken.run('detail');
    const zoneCall = broken.calls.find((c) => c.keys.every((k) => k.startsWith('zone_')))!;
    expect(zoneCall.image).toBe('high');
  });
  it('v3.1: on whole items the damage questions use the full image, the rest the small one', async () => {
    // E18: damage covering under about 1% of the frame is invisible at 512 px.
    const s = twoImageScorer(
      { road_contact: 0.03, broken: 0.05, repair: 0.02 },
      { road_contact: 0.02, broken: 0.04, repair: 0.01 },
    );
    const r = await s.run('front');
    const byKey = new Map(s.calls.flatMap((c) => c.keys.map((k) => [k, c.image] as const)));
    for (const k of ['road_contact', 'broken', 'repair', 'usable'])
      expect(byKey.get(k), k).toBe('high');
    for (const k of ['gear', 'single_item', 'category', 'wear'])
      expect(byKey.get(k), k).toBe('low');
    expect((r.answers.broken as { p: number }).p).toBe(0.04); // the full image's own answer, unmapped
    expect(r.answers.broken_low).toBeUndefined();
  });
});
