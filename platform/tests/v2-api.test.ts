import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { Questions, type Disclosure } from '../packages/core/schema';
import { createAppV2 } from '../server/app-v2';
import { PolicyConfigSchema, ThresholdsSchema, type Answer2 } from '../packages/core/v2/schema';
import { BATTERY_VERSION, type Question } from '../packages/vision/v2/battery';
import { ScorerChain, signScores } from '../packages/vision/v2/scorer-chain';
import { ScorerFailure, type Scorer } from '../packages/vision/v2/scorer';
import { PlannedScorer } from '../packages/vision/v2/plan';
import configJson from '../packages/core/v2/policy.config.json';

const config = PolicyConfigSchema.parse(configJson);
const thresholds = ThresholdsSchema.parse({
  version: 'test',
  batteryVersion: BATTERY_VERSION,
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
const signingKey = 's'.repeat(48);
const recordedAt = '2026-11-16T12:00:00.000Z';
const history = (): Disclosure[] =>
  Questions.map((question, i) => ({ id: 'd' + i, question, answer: 'no', recordedAt }));
async function picture(seed: number) {
  // Distinct pixels per photograph: the service refuses identical photographs in one request path.
  const raw = Buffer.alloc(640 * 480 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * (seed + 7) + (i >> 3) * seed) % 251;
  return (
    await sharp(raw, { raw: { width: 640, height: 480, channels: 3 } })
      .jpeg({ quality: 80 })
      .toBuffer()
  ).toString('base64');
}
/** A scorer whose answers the test controls. `overrides` change single answers; `fail` makes it throw. */
function fakeScorer(state: {
  overrides?: Record<string, Answer2>;
  fail?: boolean;
  asked: string[][];
}): Scorer {
  return {
    id: 'local_logprob',
    model: 'fake-model',
    async score(_photo, questions: Question[]) {
      state.asked.push(questions.map((q) => q.key));
      if (state.fail) throw new ScorerFailure('unavailable', true);
      const answers: Record<string, Answer2> = {};
      for (const q of questions)
        answers[q.key] =
          state.overrides?.[q.key] ??
          (q.type === 'yesno'
            ? {
                type: 'yesno',
                p: ['usable', 'gear', 'single_item', 'label_legible', 'label_ce'].includes(q.key)
                  ? 0.95
                  : 0.02,
              }
            : q.type === 'choice'
              ? {
                  type: 'choice',
                  choice: q.key === 'category' ? 'jacket' : 'other',
                  probabilities: q.key === 'category' ? { jacket: 0.9, other: 0.1 } : { other: 1 },
                }
              : { type: 'level', score: 1, probabilities: [0.1, 0.8, 0.1, 0] });
      return { answers, inputTokens: 1500, ms: 12 };
    },
  };
}
const apps: Array<ReturnType<typeof createAppV2>> = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});
function service(
  state: Parameters<typeof fakeScorer>[0],
  extra: Partial<Parameters<typeof createAppV2>[0]> = {},
) {
  const app = createAppV2({
    chain: new ScorerChain([fakeScorer(state)], { retryDelayMs: () => 0 }),
    thresholds,
    config,
    signingKey,
    inputRates: { local_logprob: 0.1 },
    ...extra,
  });
  apps.push(app);
  return app;
}
async function scoreThree(app: ReturnType<typeof createAppV2>) {
  const out = [];
  for (const [i, view] of (['front', 'back', 'label'] as const).entries()) {
    const response = await app.inject({
      method: 'POST',
      url: '/v2/photos/score',
      payload: {
        schemaVersion: '2.0',
        assessmentId: 'a1',
        photoId: 'p' + i,
        view,
        base64: await picture(i + 1),
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    out.push(response.json());
  }
  return out;
}
const assess = (
  app: ReturnType<typeof createAppV2>,
  scored: Array<{ photo: unknown; signed: unknown }>,
  extra = {},
) =>
  app.inject({
    method: 'POST',
    url: '/v2/assess',
    payload: {
      schemaVersion: '2.0',
      assessmentId: 'a1',
      disclosures: history(),
      photos: scored.map((s) => s.photo),
      signedScores: scored.map((s) => s.signed),
      closeUpsRequested: 0,
      ...extra,
    },
  });

describe('backend v2 service', () => {
  it('scores each photograph once, then decides from the signed records without storing anything', async () => {
    const state = { asked: [] as string[][] };
    const app = service(state);
    const scored = await scoreThree(app);
    expect(state.asked).toHaveLength(3); // clean photographs never trigger zone questions
    expect(scored[0].photo).toMatchObject({
      id: 'p0',
      view: 'front',
      quality: { width: 640, height: 480 },
    });
    expect(scored[0].signed.scores).toMatchObject({
      batteryVersion: BATTERY_VERSION,
      scorer: { id: 'local_logprob' },
    });
    const response = await assess(app, scored);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(body.decision).toMatchObject({
      outcome: 'offer',
      grade: 'B',
      category: 'jacket',
      protectivePerformanceCertified: false,
    });
    expect(body.cost).toEqual({ inputTokens: 4500, estimatedUsd: 0.00045 });
    expect(response.headers['cache-control']).toBe('no-store');
    const metrics = (await app.inject({ url: '/v2/metrics' })).json();
    expect(metrics.local_logprob).toMatchObject({ scored: 3, failed: 0, inputTokens: 4500 });
    expect((await app.inject({ url: '/v2/health' })).json()).toMatchObject({
      batteryVersion: BATTERY_VERSION,
      processing: 'stateless',
    });
  });

  it('routes a partially observed surface to review after ordinary image scoring', async () => {
    const helper = fakeScorer({ asked: [] });
    const partial: Scorer = {
      id: helper.id,
      model: helper.model,
      async score(photo, questions, signal) {
        const result = await helper.score(photo, questions, signal);
        if (photo.view === 'back') delete result.answers.repair;
        return result;
      },
    };
    const app = service({ asked: [] }, { chain: new ScorerChain([partial]) });
    const scored = await scoreThree(app);
    const response = await assess(app, scored);
    expect(response.statusCode).toBe(200);
    const decision = response.json().decision;
    expect(decision.outcome).toBe('review');
    expect(decision.reasons).toContainEqual(
      expect.objectContaining({
        code: 'incomplete_photo_checks',
        photoId: 'p1',
      }),
    );
  });

  it('asks zone questions only when damage is flagged, and blocks damage in a protective area', async () => {
    const state = {
      asked: [] as string[][],
      overrides: {
        broken: { type: 'yesno', p: 0.93 },
        zone_elbow: { type: 'yesno', p: 0.8 },
      } as Record<string, Answer2>,
    };
    const app = service(state);
    const scored = await scoreThree(app);
    expect(state.asked.filter((keys) => keys.every((k) => k.startsWith('zone_')))).toHaveLength(2); // front and back
    const body = (await assess(app, scored)).json();
    expect(body.decision.outcome).toBe('no_offer');
    expect(body.decision.reasons[0]).toMatchObject({
      code: 'visible_broken_protective_area',
      question: 'broken',
    });
  });

  it('rejects edited or foreign score records', async () => {
    const app = service({ asked: [] });
    const scored = await scoreThree(app);
    const edited = structuredClone(scored);
    edited[0].signed.scores.answers.broken = { type: 'yesno', p: 0 };
    expect((await assess(app, edited)).statusCode).toBe(400);
    expect((await assess(app, edited)).json().error.code).toBe('invalid_scores');
    const other = service({ asked: [] }, { signingKey: 'o'.repeat(48) });
    expect((await assess(other, scored)).statusCode).toBe(400);
  });

  it('a record for other pixels is ignored, so the decision falls back to review', async () => {
    const app = service({ asked: [] });
    const scored = await scoreThree(app);
    const swapped = structuredClone(scored);
    swapped[0].photo.sha256 = 'f'.repeat(64);
    const body = (await assess(app, swapped)).json();
    expect(body.decision.outcome).toBe('review');
    expect(body.decision.reasons[0].code).toBe('analysis_unavailable');
  });

  it('returns 503 when no scorer answers, and the decision without scores is never an offer', async () => {
    const app = service({ asked: [], fail: true });
    const response = await app.inject({
      method: 'POST',
      url: '/v2/photos/score',
      payload: {
        schemaVersion: '2.0',
        assessmentId: 'a1',
        photoId: 'p0',
        view: 'front',
        base64: await picture(1),
      },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('scoring_unavailable');
    const photos = (['front', 'back', 'label'] as const).map((view, i) => ({
      id: 'p' + i,
      view,
      sha256: String(i + 1).repeat(64),
      quality: { width: 640, height: 480, brightness: 120, sharpness: 100, warnings: [] },
    }));
    const body = (await assess(app, [], { photos })).json();
    expect(body.decision.outcome).toBe('review');
  });

  it('flags an out-of-focus photograph with the calibrated gate and asks for a retake', async () => {
    const app = service({ asked: [] });
    const scored = await scoreThree(app);
    expect(scored.every((s) => !s.photo.quality.warnings.includes('soft'))).toBe(true);
    const blurred = await sharp(Buffer.from(await picture(2), 'base64'))
      .blur(6)
      .jpeg({ quality: 84 })
      .toBuffer();
    const response = await app.inject({
      method: 'POST',
      url: '/v2/photos/score',
      payload: {
        schemaVersion: '2.0',
        assessmentId: 'a1',
        photoId: 'p1',
        view: 'back',
        base64: blurred.toString('base64'),
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    const soft = response.json();
    expect(soft.photo.quality.warnings).toContain('soft');
    // This synthetic frame blurs to almost uniform grey, so the no-contrast floor flags it (real
    // photographs keep their large-scale contrast and are caught by the normalised ratio; see
    // tests/v2-focus.test.ts). The record carries the normalised focus value either way.
    expect(typeof soft.photo.quality.sharpness).toBe('number');
    const body = (await assess(app, [scored[0], soft, scored[2]])).json();
    expect(body.decision).toMatchObject({ outcome: 'retake', requestPhoto: { view: 'back' } });
    expect(body.decision.reasons[0].code).toBe('photo_out_of_focus');
  });

  it('says which scorers run and refuses an external provider without the rider’s choice', async () => {
    const local = service({ asked: [] });
    expect((await local.inject({ url: '/v2/health' })).json()).toMatchObject({
      scorers: [{ id: 'local_logprob', model: 'fake-model' }],
      externalProcessing: false,
    });
    const hosted: Scorer = { ...fakeScorer({ asked: [] }), id: 'decisions', model: 'hosted-test' };
    const app = service(
      { asked: [] },
      { chain: new ScorerChain([hosted], { retryDelayMs: () => 0 }) },
    );
    expect((await app.inject({ url: '/v2/health' })).json()).toMatchObject({
      externalProcessing: true,
    });
    const payload = {
      schemaVersion: '2.0',
      assessmentId: 'a1',
      photoId: 'p0',
      view: 'front',
      base64: await picture(1),
    };
    for (const consent of [undefined, { externalProvider: false }]) {
      const refused = await app.inject({
        method: 'POST',
        url: '/v2/photos/score',
        payload: { ...payload, consent },
      });
      expect(refused.statusCode).toBe(403);
      expect(refused.json().error.code).toBe('consent_required');
    }
    const allowed = await app.inject({
      method: 'POST',
      url: '/v2/photos/score',
      payload: { ...payload, consent: { externalProvider: true } },
    });
    expect(allowed.statusCode, allowed.body).toBe(200);
  });

  it('returns retake hints with the record, never a damage finding', async () => {
    const app = service({
      asked: [],
      overrides: { single_item: { type: 'yesno', p: 0.1 }, broken: { type: 'yesno', p: 0.97 } },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v2/photos/score',
      payload: {
        schemaVersion: '2.0',
        assessmentId: 'a1',
        photoId: 'p0',
        view: 'front',
        base64: await picture(1),
      },
    });
    expect(response.json().feedback.map((f: { code: string }) => f.code)).toEqual([
      'several_items',
    ]);
  });

  it('scores over a real socket, where the request emits close before the reply', async () => {
    // inject() never showed this: on a real connection the request side closes once its body is read,
    // which used to abort every scoring run (503 for every photograph).
    const app = service({ asked: [] });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const response = await fetch(address + '/v2/photos/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: '2.0',
        assessmentId: 'a1',
        photoId: 'p0',
        view: 'front',
        base64: await picture(1),
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await response.json()).signed.scores.photoId).toBe('p0');
  });

  it('v3.1: scores through the question plan, with damage on the full image for whole items', async () => {
    const state = { asked: [] as string[][] };
    const planned = new PlannedScorer(
      fakeScorer(state),
      (id) => thresholds.perScorer[id],
      () => ({ damage: { clear: 0.139, block: 0.552 }, repair: { clear: 0.3, block: 0.85 } }),
    );
    const app = service(state, {
      chain: new ScorerChain([planned], { retryDelayMs: () => 0 }),
      planned: true,
      lowEdge: 512,
    });
    const scored = await scoreThree(app);
    const front = scored[0].signed.scores;
    expect(front.scorer.model).toBe('fake-model cascade');
    expect(Object.keys(front.answers)).toEqual(
      expect.arrayContaining(['road_contact', 'broken', 'wear']),
    );
    expect(Object.keys(front.answers)).not.toContain('material');
    // v3.1 (E18): whole-item views answer the damage questions on the full image, so no raw
    // 512 px damage answers are recorded for them.
    expect(Object.keys(front.answers)).not.toContain('broken_low');
    expect(state.asked.flat()).not.toContain('label_class');
    const body = (await assess(app, scored)).json();
    expect(body.decision).toMatchObject({ outcome: 'offer', grade: 'B' });
  });

  it('reported history needs no photographs', async () => {
    const app = service({ asked: [] });
    const response = await assess(app, [], {
      disclosures: [{ id: 'c', question: 'crash', answer: 'yes', recordedAt }],
    });
    expect(response.json().decision).toMatchObject({ outcome: 'no_offer' });
  });

  it('validates input, the access token and its own configuration', async () => {
    const app = service({ asked: [] }, { token: 't'.repeat(32) });
    expect((await app.inject({ url: '/v2/health' })).statusCode).toBe(401);
    expect(
      (await app.inject({ url: '/v2/health', headers: { 'x-relay-token': 't'.repeat(32) } }))
        .statusCode,
    ).toBe(200);
    const open = service({ asked: [] });
    expect(
      (await open.inject({ method: 'POST', url: '/v2/photos/score', payload: { photoId: 'x' } }))
        .statusCode,
    ).toBe(400);
    expect((await open.inject({ method: 'POST', url: '/v2/assess', payload: {} })).statusCode).toBe(
      400,
    );
    const notImage = await open.inject({
      method: 'POST',
      url: '/v2/photos/score',
      payload: {
        schemaVersion: '2.0',
        assessmentId: 'a1',
        photoId: 'p0',
        view: 'front',
        base64: Buffer.from('x'.repeat(200)).toString('base64'),
      },
    });
    expect(notImage.statusCode).toBe(422);
    expect(() =>
      service({ asked: [] }, { thresholds: { ...thresholds, batteryVersion: 'older' } }),
    ).toThrow('Recalibrate');
    expect(() => service({ asked: [] }, { signingKey: 'short' })).toThrow('RELAY_SIGNING_KEY');
  });
});

describe('rider-marked evidence', () => {
  it('retires new crop scoring and preserves verified, unsigned and stale historical concerns', async () => {
    const state = { asked: [] as string[][] },
      app = service(state);
    const scored = await scoreThree(app),
      parent = scored[0].signed;
    const region = {
      parentId: 'p0',
      parentView: 'front',
      source: 'capture',
      sourceWidth: 2000,
      sourceHeight: 1000,
      left: 320,
      top: 64,
      side: 160,
    };
    const child = signScores(
      {
        ...parent.scores,
        photoId: 'old-crop',
        view: 'detail',
        sha256: 'a'.repeat(64),
        fromOverview: region,
        parentSha256: parent.scores.sha256,
        answers: { broken: { type: 'yesno', p: 0.02 } },
      },
      signingKey,
    );
    const n = state.asked.length;
    const retired = await app.inject({
      method: 'POST',
      url: '/v2/photos/score',
      payload: {
        schemaVersion: '2.0',
        assessmentId: 'a1',
        photoId: 'old-crop',
        view: 'detail',
        base64: await picture(7),
        fromOverview: region,
        parent,
      },
    });
    expect(retired.statusCode).toBe(410);
    expect(state.asked).toHaveLength(n);
    const area = {
      photoId: 'old-crop',
      region,
      cropSha256: child.scores.sha256,
      overviewSha256: parent.scores.sha256,
      cropReceipt: child,
      overviewReceipt: parent,
    };
    expect((await assess(app, scored)).json().decision.outcome).toBe('offer');
    for (const [entry, code] of [
      [area, 'rider_marked_area'],
      [{ photoId: 'old-crop', region }, 'historical_area_unverified'],
      [
        { ...area, cropReceipt: { ...child, signature: '0'.repeat(64) } },
        'historical_area_unverified',
      ],
      [{ ...area, region: { ...region, left: 321 } }, 'historical_area_unverified'],
      [{ ...area, overviewReceipt: undefined }, 'historical_area_unverified'],
    ] as const) {
      const extra = { historicalAreas: [entry] };
      const d = (await assess(app, scored, extra)).json().decision;
      expect(d).toMatchObject({
        outcome: 'review',
        grade: null,
        reasons: [{ code, photoId: 'old-crop' }],
      });
      expect((await assess(app, scored.slice(1), extra)).json().decision.outcome).toBe('retake');
      for (const question of Questions) {
        const disclosures = history().map((e) =>
          e.question === question ? { ...e, answer: 'yes' } : e,
        );
        expect((await assess(app, scored, { ...extra, disclosures })).json().decision.outcome).toBe(
          'no_offer',
        );
      }
    }
    // V3.1 clients may still present a real signed chip at assessment time.
    const oldWire = [
      ...scored,
      {
        photo: { ...scored[0].photo, id: 'old-crop', view: 'detail', sha256: child.scores.sha256 },
        signed: child,
      },
    ];
    expect((await assess(app, oldWire)).json().decision.reasons[0].code).toBe('rider_marked_area');
    const bad = structuredClone(oldWire);
    bad[3].signed.signature = 'f'.repeat(64);
    expect((await assess(app, bad)).statusCode).toBe(400);
  });
  it('withholds a decision when a different checkpoint shares a scorer ID', async () => {
    const scoped = structuredClone(thresholds);
    scoped.perScorer.local_logprob!.models = ['some-other-checkpoint'];
    const app = service({ asked: [] }, { thresholds: scoped });
    const evidence = await scoreThree(app);
    expect((await assess(app, evidence)).json().decision).toMatchObject({
      outcome: 'review',
      reasons: expect.arrayContaining([expect.objectContaining({ code: 'thresholds_missing' })]),
    });
  });
});

describe('superseded overview evidence (V3.5)', () => {
  it('binds a real policy exclusion to an assessment and source and keeps a possible concern advisory', async () => {
    const app = service({ asked: [] });
    const present = await scoreThree(app);
    const source = structuredClone(present[0]);
    source.photo.id = 'prior-front';
    source.signed = signScores(
      {
        ...source.signed.scores,
        photoId: 'prior-front',
        answers: { ...source.signed.scores.answers, road_contact: { type: 'yesno', p: 0.92 } },
      },
      signingKey,
    );
    const earlier = [source, ...present.slice(1)];
    const initial = (await assess(app, earlier)).json();
    expect(initial.decision.outcome).toBe('no_offer');
    const proof = initial.findings.find(
      (x: { finding: { photoId: string } }) => x.finding.photoId === 'prior-front',
    );
    const entry = {
      photoId: source.photo.id,
      view: 'front',
      replacementId: present[0].photo.id,
      record: source.photo,
      signed: source.signed,
      finding: proof,
    };
    const request = (e: unknown, more = {}) =>
      assess(app, present, { replacedOverviews: [e], ...more });
    expect((await request(entry)).json()).toMatchObject({
      decision: { outcome: 'no_offer', grade: null, requestPhoto: null },
      replacements: [{ status: 'confirmed_exclusion' }],
      transitions: [],
    });
    const fresh = (await assess(app, present)).json().decision;
    expect(fresh.outcome).toBe('offer');
    const advisory = {
      ...source,
      signed: signScores(
        {
          ...source.signed.scores,
          answers: { ...source.signed.scores.answers, road_contact: { type: 'yesno', p: 0.35 } },
        },
        signingKey,
      ),
    };
    const note = (await assess(app, [advisory, ...present.slice(1)])).json();
    expect(note.decision.requestPhoto.view).toBe('detail');
    const possible = { ...entry, signed: advisory.signed, finding: note.findings[0] };
    for (let n = 0; n < 2; n++) {
      const checked = (await request(possible)).json();
      expect(checked.decision).toEqual(fresh);
      expect(checked.replacements[0].status).toBe('possible');
      expect(checked.transitions).toEqual([
        { photoId: 'prior-front', replacementId: present[0].photo.id },
      ]);
    }
    // A high signed single-photo score is observational until an actual policy disposition is authenticated.
    expect((await request({ ...entry, finding: undefined })).json()).toMatchObject({
      decision: fresh,
      replacements: [{ status: 'possible' }],
    });
    const legacy = {
      photos: earlier.map((p) => p.photo),
      signedScores: earlier.map((p) => p.signed),
      disclosures: history(),
      closeUpsRequested: 0,
    };
    expect(
      (await request({ ...entry, finding: undefined, legacyAssessment: legacy })).json().decision
        .outcome,
    ).toBe('no_offer');
    const wrongKey = structuredClone(legacy);
    wrongKey.signedScores[0].signature = '0'.repeat(64);
    expect(
      (await request({ ...entry, finding: undefined, legacyAssessment: wrongKey })).json().decision,
    ).toEqual(fresh);
    // A displaced exclusion that this service cannot verify caps only an otherwise eligible offer.
    for (const broken of [
      { ...entry, finding: { ...proof, signature: '0'.repeat(64) } },
      { ...entry, signed: { ...source.signed, signature: 'f'.repeat(64) } },
      { ...entry, record: { ...entry.record, sha256: 'f'.repeat(64) } },
      { ...entry, signed: undefined },
    ]) {
      const invalid = (await request(broken)).json();
      expect(invalid.decision.outcome).toBe('review');
      expect(invalid.replacements[0].status).toBe('unverified_exclusion');
    }
    for (const foreign of [
      { ...entry, view: 'back' },
      { ...entry, finding: { ...proof, finding: { ...proof.finding, assessmentId: 'other' } } },
    ]) {
      const invalid = (await request(foreign)).json();
      expect(invalid.decision).toEqual(fresh);
      expect(invalid.replacements[0].status).toBe('unverified');
    }
    const rotatedKey = service(
      { asked: [] },
      { signingKey: 'new-local-test-signing-key-'.repeat(3) },
    );
    const newPhotos = await scoreThree(rotatedKey);
    expect(
      (await assess(rotatedKey, newPhotos, { replacedOverviews: [entry] })).json(),
    ).toMatchObject({
      decision: { outcome: 'review' },
      replacements: [{ status: 'unverified_exclusion' }],
    });
    expect((await assess(rotatedKey, newPhotos)).json().decision.outcome).toBe('offer');
    const empty = { photoId: 'unknown', view: 'front', replacementId: 'p0' };
    expect((await request(empty)).json()).toMatchObject({
      decision: fresh,
      replacements: [{ status: 'unverified' }],
    });
    const abandoned = (await request({ ...possible, replacementId: null })).json();
    expect(abandoned.transitions).toEqual([]);
    const reported = history();
    reported[0]!.answer = 'yes';
    expect(
      (await request(possible, { disclosures: reported })).json().decision.reasons[0].code,
    ).toBe('reported_crash');
    const outside = structuredClone(source);
    const answers = {
      ...source.signed.scores.answers,
      road_contact: { type: 'yesno', p: 0.01 },
      broken: { type: 'yesno', p: 0.92 },
    };
    for (const z of Object.keys(config.protectiveZones.jacket!))
      answers['zone_' + z] = { type: 'yesno', p: 0.01 };
    outside.signed = signScores({ ...source.signed.scores, answers }, signingKey);
    const priorOutside = (await assess(app, [outside, ...present.slice(1)])).json();
    expect(priorOutside.decision.outcome).toBe('review');
    const afterOutside = (
      await request({ ...entry, signed: outside.signed, finding: priorOutside.findings[0] })
    ).json();
    expect(afterOutside.decision).toEqual(fresh);
    expect(afterOutside.replacements[0].status).toBe('possible');
  });
});
