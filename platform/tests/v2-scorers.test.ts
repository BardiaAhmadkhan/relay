import { describe, expect, it } from 'vitest';
import {
  BATTERY_VERSION,
  GARMENT_QUESTIONS,
  LABEL_QUESTIONS,
  ZONE_QUESTIONS,
  questionsFor,
  renderInstruction,
  renderOneWord,
  type Question,
} from '../packages/vision/v2/battery';
import { ScorerFailure, wordMass, type Scorer } from '../packages/vision/v2/scorer';
import { LocalLogprobScorer } from '../packages/vision/v2/scorer-local';
import { DecisionsScorer } from '../packages/vision/v2/scorer-decisions';
import {
  ScorerChain,
  canonicalJson,
  signScores,
  verifyScores,
} from '../packages/vision/v2/scorer-chain';
import { PolicyConfigSchema } from '../packages/core/v2/schema';
import configJson from '../packages/core/v2/policy.config.json';
// The measured experiment batteries. Production wording must stay byte-identical to what was measured.
// @ts-expect-error The experiment file is plain JavaScript without type declarations.
import { BATTERIES } from '../experiments/backend-v2/battery.mjs';

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const signal = () => new AbortController().signal;
const byKey = (key: string) =>
  [...GARMENT_QUESTIONS, ...Object.values(ZONE_QUESTIONS).flat()].find((q) => q.key === key)!;
const lp = (pairs: Record<string, number>) =>
  Object.entries(pairs).map(([token, p]) => ({ token, logprob: Math.log(p) }));
const ollamaReply = (model: string, pairs: Record<string, number>, tokens = 800) =>
  new Response(
    JSON.stringify({
      model,
      done: true,
      prompt_eval_count: tokens,
      message: { content: Object.keys(pairs)[0] },
      logprobs: [{ token: Object.keys(pairs)[0], top_logprobs: lp(pairs) }],
    }),
  );
const digest = 'a'.repeat(64);

describe('question battery', () => {
  it('is well formed', () => {
    expect(BATTERY_VERSION).toMatch(/^[a-z0-9-]{1,40}$/);
    const all = [...GARMENT_QUESTIONS, ...LABEL_QUESTIONS, ...Object.values(ZONE_QUESTIONS).flat()];
    for (const q of all) {
      expect(q.key).toMatch(/^[a-z0-9_]{1,40}$/);
      expect(q.question.length).toBeGreaterThan(10);
      if (q.type === 'choice') expect(Object.keys(q.options)).toContain('other');
      if (q.type === 'level') expect(q.levels.length).toBeGreaterThanOrEqual(2);
      // Questions describe what is visible. They never mention outcomes.
      expect(renderInstruction(q)).not.toMatch(/offer|price|safe|certif|eligible/i);
    }
    expect(new Set(GARMENT_QUESTIONS.map((q) => q.key)).size).toBe(GARMENT_QUESTIONS.length);
  });

  it('renders exactly the wording that was measured', () => {
    const measured: Record<string, string> = {
      broken: BATTERIES.b1.probes.break.text,
      road_contact: BATTERIES.b1.probes.slide.text,
      repair: BATTERIES.b1.probes.repair.text,
      gear: BATTERIES.b1.probes.gear.text,
      category: BATTERIES.b1.probes.category.text,
      material: BATTERIES.b1.probes.material.text,
      usable: BATTERIES.b2.probes.usable.text,
      single_item: BATTERIES.b2.probes.single_item.text,
      wear: BATTERIES.b2.probes.wear_level.text,
      zone_shoulder: BATTERIES.b2.probes.zone_shoulder.text,
      zone_elbow: BATTERIES.b2.probes.zone_elbow.text,
      zone_back: BATTERIES.b2.probes.zone_back.text,
      zone_chest: BATTERIES.b2.probes.zone_chest.text,
    };
    for (const [key, text] of Object.entries(measured))
      expect(renderOneWord(byKey(key)).text, key).toBe(text);
  });

  it('asks zone questions that match the policy zone map, once the category is known', () => {
    const config = PolicyConfigSchema.parse(configJson);
    for (const [category, zones] of Object.entries(config.protectiveZones))
      expect(ZONE_QUESTIONS[category]!.map((q) => q.key).sort()).toEqual(
        Object.keys(zones)
          .map((k) => 'zone_' + k)
          .sort(),
      );
    expect(questionsFor('label')).toBe(LABEL_QUESTIONS);
    expect(questionsFor('front').some((q) => q.key.startsWith('zone_'))).toBe(false);
    expect(questionsFor('front', 'jacket').filter((q) => q.key.startsWith('zone_'))).toHaveLength(
      4,
    );
  });
});

describe('local log-probability scorer', () => {
  it('reads yes/no, choice and level answers from first-token probabilities', async () => {
    const calls: Array<{ text: string; body: Record<string, unknown> }> = [];
    const fetcher = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      const text = body.messages[1].content as string;
      calls.push({ text, body });
      if (text.includes('visibly broken'))
        return ollamaReply('m', { yes: 0.6, no: 0.2, ' Yes': 0.1, maybe: 0.1 });
      if (text.includes('main item')) return ollamaReply('m', { a: 0.7, d: 0.2, h: 0.1 });
      return ollamaReply('m', { b: 0.5, c: 0.5 });
    }) as typeof fetch;
    const scorer = new LocalLogprobScorer('m', digest, 'http://127.0.0.1:11435', fetcher);
    const result = await scorer.score(
      { jpeg },
      [byKey('broken'), byKey('category'), byKey('wear')],
      signal(),
    );
    expect(result.answers.broken).toEqual({ type: 'yesno', p: expect.closeTo(0.7 / 0.9, 6) });
    expect(result.answers.category).toMatchObject({ type: 'choice', choice: 'jacket' });
    expect(
      (result.answers.category as { probabilities: Record<string, number> }).probabilities.gloves,
    ).toBeCloseTo(0.2, 6);
    expect(result.answers.wear).toMatchObject({ type: 'level', score: expect.closeTo(1.5, 6) });
    expect(result.inputTokens).toBe(2400);
    expect(calls).toHaveLength(3);
    expect(calls[0]!.body).toMatchObject({
      think: false,
      logprobs: true,
      options: { temperature: 0, num_predict: 2 },
    });
    expect(scorer.model).toBe('m@aaaaaaaaaaaa');
  });

  it('fails instead of guessing when the model did not answer or the runtime misbehaves', async () => {
    const make = (response: () => Response | Promise<Response>) =>
      new LocalLogprobScorer('m', digest, 'http://127.0.0.1:11435', (async () =>
        response()) as typeof fetch);
    await expect(
      make(() => ollamaReply('m', { perhaps: 0.9, yes: 0.05 })).score(
        { jpeg },
        [byKey('broken')],
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(
      make(() => ollamaReply('other', { yes: 0.9, no: 0.1 })).score(
        { jpeg },
        [byKey('broken')],
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(
      make(() => new Response('{}', { status: 500 })).score({ jpeg }, [byKey('broken')], signal()),
    ).rejects.toMatchObject({ code: 'unavailable', retryable: true });
    await expect(
      make(() => Promise.reject(new Error('socket'))).score({ jpeg }, [byKey('broken')], signal()),
    ).rejects.toMatchObject({ code: 'timeout' });
    expect(() => new LocalLogprobScorer('m', digest, 'https://example.com')).toThrow('loopback');
    expect(() => new LocalLogprobScorer('m', 'short')).toThrow('digest');
  });

  it('sums probability over spellings of the same word', () => {
    const { probabilities, covered } = wordMass(
      lp({ yes: 0.5, ' yes': 0.1, Yes: 0.1, no: 0.2, x: 0.1 }),
      ['yes', 'no'],
    );
    expect(covered).toBeCloseTo(0.9, 6);
    expect(probabilities[0]).toBeCloseTo(0.7 / 0.9, 6);
  });
});

describe('hosted closed-question scorer (request and response mapping per the published reference)', () => {
  const questions: Question[] = [byKey('broken'), byKey('category'), byKey('wear')];
  const good = {
    answers: {
      broken: { type: 'noul', noul: 0.83, confidence: 0.83 },
      category: {
        type: 'choice',
        choice: 'gloves',
        probabilities: { gloves: 0.9, jacket: 0.1 },
        confidence: 0.9,
      },
      wear: {
        type: 'score',
        score: 1.4,
        legend: {},
        probabilities: { '0': 0.1, '1': 0.5, '2': 0.3, '3': 0.1 },
        confidence: 0.5,
      },
    },
    usage: { total_input_tokens: 2100, total_output_tokens: 0 },
  };
  it('sends one image with every question and maps the three answer types', async () => {
    let sent:
      { url: string; headers: Record<string, string>; body: Record<string, any> } | undefined;
    const fetcher = (async (url: unknown, init?: RequestInit) => {
      sent = {
        url: String(url),
        headers: init!.headers as Record<string, string>,
        body: JSON.parse(String(init!.body)),
      };
      return new Response(JSON.stringify(good));
    }) as typeof fetch;
    const scorer = new DecisionsScorer('key', 'gemini-decision-1', 'high', fetcher);
    const result = await scorer.score({ jpeg }, questions, signal());
    expect(sent!.url).toBe('https://generativelanguage.googleapis.com/v1beta/decisions');
    expect(sent!.headers['x-goog-api-key']).toBe('key');
    expect(sent!.body.model).toBe('gemini-decision-1');
    expect(sent!.body.input).toEqual([
      {
        type: 'image',
        data: Buffer.from(jpeg).toString('base64'),
        mime_type: 'image/jpeg',
        resolution: 'high',
      },
    ]);
    expect(sent!.body.questions.broken).toMatchObject({ type: 'noul' });
    expect(sent!.body.questions.broken.instructions).toContain('BROKEN');
    expect(Object.keys(sent!.body.questions.category.criteria)).toContain('other');
    expect(sent!.body.questions.wear.criteria).toHaveLength(4);
    expect(result.answers.broken).toEqual({ type: 'yesno', p: 0.83 });
    expect(result.answers.category).toMatchObject({ type: 'choice', choice: 'gloves' });
    expect(
      (result.answers.category as { probabilities: Record<string, number> }).probabilities.trousers,
    ).toBe(0);
    expect(result.answers.wear).toEqual({
      type: 'level',
      score: 1.4,
      probabilities: [0.1, 0.5, 0.3, 0.1],
    });
    expect(result.inputTokens).toBe(2100);
    expect(scorer.model).toBe('gemini-decision-1/high');
  });
  it('classifies failures and never fills in a missing answer', async () => {
    const make = (status: number, body: unknown) =>
      new DecisionsScorer(
        'key',
        'gemini-decision-1',
        'high',
        (async () => new Response(JSON.stringify(body), { status })) as typeof fetch,
      );
    await expect(
      make(400, { error: { code: 'image_safety', message: 'x' } }).score(
        { jpeg },
        questions,
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'refused', retryable: false });
    await expect(make(429, {}).score({ jpeg }, questions, signal())).rejects.toMatchObject({
      code: 'rate_limited',
      retryable: true,
    });
    await expect(make(503, {}).score({ jpeg }, questions, signal())).rejects.toMatchObject({
      code: 'unavailable',
      retryable: true,
    });
    await expect(
      make(200, { answers: { broken: good.answers.broken } }).score({ jpeg }, questions, signal()),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(
      make(200, {
        answers: {
          ...good.answers,
          category: { type: 'choice', choice: 'spaceship', probabilities: {} },
        },
      }).score({ jpeg }, questions, signal()),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    expect(() => new DecisionsScorer('')).toThrow(ScorerFailure);
  });
});

describe('scorer chain', () => {
  const question = [byKey('broken')];
  const fake = (id: Scorer['id'], behaviour: () => Promise<number>): Scorer & { calls: number } => {
    const scorer = {
      id,
      model: id + '-model',
      calls: 0,
      async score() {
        scorer.calls++;
        return {
          answers: { broken: { type: 'yesno' as const, p: await behaviour() } },
          inputTokens: 10,
          ms: 1,
        };
      },
    };
    return scorer;
  };
  const photo = { photoId: 'p1', view: 'front' as const, jpeg };
  const fast = { retryDelayMs: () => 0 };

  it('falls back in order, retries a retryable failure once, and caches by pixels', async () => {
    let first = 0;
    const a = fake('decisions', async () => {
      if (first++ < 2) throw new ScorerFailure('unavailable', true);
      return 0.1;
    });
    const b = fake('local_logprob', async () => 0.4);
    const chain = new ScorerChain([a, b], fast);
    const one = await chain.score(photo, question, signal());
    expect(a.calls).toBe(2);
    expect(one.scorer.id).toBe('local_logprob');
    expect(one.batteryVersion).toBe(BATTERY_VERSION);
    expect(one.sha256).toMatch(/^[a-f0-9]{64}$/);
    // The first scorer has recovered: it answers, and its answer is cached for the same pixels.
    const two = await chain.score({ ...photo, photoId: 'p2' }, question, signal());
    expect(two.scorer.id).toBe('decisions');
    const three = await chain.score({ ...photo, photoId: 'p3' }, question, signal());
    expect(three).toMatchObject({ photoId: 'p3', scorer: { id: 'decisions' } });
    expect(a.calls).toBe(3);
    expect(chain.events.map((e) => e.outcome)).toEqual([
      'unavailable',
      'unavailable',
      'ok',
      'ok',
      'cached',
    ]);
  });

  it('opens a breaker after repeated failures and closes it after the pause; a refusal does not count', async () => {
    let clock = 1_000_000;
    const a = fake('decisions', async () => {
      throw new ScorerFailure('invalid_response', false);
    });
    const b = fake('local_logprob', async () => 0.2);
    const chain = new ScorerChain([a, b], {
      ...fast,
      now: () => clock,
      breakerFailures: 2,
      breakerOpenMs: 1000,
      cacheTtlMs: 0,
    });
    await chain.score(photo, question, signal());
    await chain.score(photo, question, signal());
    await chain.score(photo, question, signal());
    expect(a.calls).toBe(2); // third call skipped while the breaker is open
    clock += 2000;
    await chain.score(photo, question, signal());
    expect(a.calls).toBe(3);
    const refusing = fake('decisions', async () => {
      throw new ScorerFailure('refused', false);
    });
    const chain2 = new ScorerChain([refusing, b], { ...fast, breakerFailures: 1, cacheTtlMs: 0 });
    await chain2.score(photo, question, signal());
    await chain2.score(photo, question, signal());
    expect(refusing.calls).toBe(2);
  });

  it('throws when every scorer fails, so nothing downstream can invent a score', async () => {
    const dead = fake('local_logprob', async () => {
      throw new ScorerFailure('timeout', true);
    });
    await expect(
      new ScorerChain([dead], fast).score(photo, question, signal()),
    ).rejects.toBeInstanceOf(ScorerFailure);
    expect(() => new ScorerChain([])).toThrow();
  });

  it('signs score records so a client cannot edit them', async () => {
    const key = 'k'.repeat(40);
    const scores = await new ScorerChain([fake('local_logprob', async () => 0.05)], fast).score(
      photo,
      question,
      signal(),
    );
    const signed = signScores(scores, key);
    expect(verifyScores(signed, key)).toBe(true);
    expect(verifyScores(JSON.parse(JSON.stringify(signed)), key)).toBe(true);
    expect(
      verifyScores(
        { ...signed, scores: { ...scores, answers: { broken: { type: 'yesno', p: 0.0 } } } },
        key,
      ),
    ).toBe(false);
    expect(verifyScores(signed, 'x'.repeat(40))).toBe(false);
    expect(verifyScores({ ...signed, signature: 'ab' }, key)).toBe(false);
    expect(() => signScores(scores, 'short')).toThrow();
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
  });
});
