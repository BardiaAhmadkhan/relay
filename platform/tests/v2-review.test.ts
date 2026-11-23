import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { Questions, type Disclosure } from '../packages/core/schema';
import { createAppV2 } from '../server/app-v2';
import { verdictsToCalibration, type VerdictLine } from '../server/review-v2';
import {
  PhotoScoresSchema,
  PolicyConfigSchema,
  ThresholdsSchema,
  type Answer2,
  type SignedScores,
} from '../packages/core/v2/schema';
import { BATTERY_VERSION, type Question } from '../packages/vision/v2/battery';
import { ScorerChain } from '../packages/vision/v2/scorer-chain';
import type { Scorer } from '../packages/vision/v2/scorer';
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
const signingKey = 'k'.repeat(48),
  token = 't'.repeat(32),
  recordedAt = '2026-11-17T12:00:00.000Z';
const history = (answer: 'yes' | 'no' = 'no'): Disclosure[] =>
  Questions.map((question, i) => ({ id: 'd' + i, question, answer, recordedAt }));
async function picture(seed: number) {
  const raw = Buffer.alloc(640 * 480 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * (seed + 7) + (i >> 3) * seed) % 251;
  return (
    await sharp(raw, { raw: { width: 640, height: 480, channels: 3 } })
      .jpeg({ quality: 80 })
      .toBuffer()
  ).toString('base64');
}
/** Every answer clean except `broken`, which the test sets per run. */
function scorer(broken: number): Scorer {
  return {
    id: 'local_logprob',
    model: 'fake-model',
    async score(_photo, questions: Question[]) {
      const answers: Record<string, Answer2> = {};
      for (const q of questions)
        answers[q.key] =
          q.type === 'yesno'
            ? {
                type: 'yesno',
                p:
                  q.key === 'broken'
                    ? broken
                    : ['usable', 'gear', 'single_item', 'label_legible', 'label_ce'].includes(q.key)
                      ? 0.95
                      : 0.02,
              }
            : q.type === 'choice'
              ? {
                  type: 'choice',
                  choice: q.key === 'category' ? 'jacket' : 'other',
                  probabilities: q.key === 'category' ? { jacket: 0.9, other: 0.1 } : { other: 1 },
                }
              : { type: 'level', score: 1, probabilities: [0.1, 0.8, 0.1, 0] };
      return { answers, inputTokens: 1000, ms: 5 };
    },
  };
}
const apps: Array<ReturnType<typeof createAppV2>> = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});
async function setup(broken = 0.4) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-review-'));
  dirs.push(dir);
  const verdictsFile = path.join(dir, 'verdicts.jsonl');
  const app = createAppV2({
    chain: new ScorerChain([scorer(broken)], { retryDelayMs: () => 0 }),
    thresholds,
    config,
    signingKey,
    token,
    review: { verdictsFile },
  });
  apps.push(app);
  const headers = { 'x-relay-token': token };
  const photos: Array<{
    id: string;
    view: 'front' | 'back' | 'label';
    base64: string;
    signed: SignedScores;
  }> = [];
  for (const [i, view] of (['front', 'back', 'label'] as const).entries()) {
    const base64 = await picture(i + 1);
    const scored = await app.inject({
      method: 'POST',
      url: '/v2/photos/score',
      headers,
      payload: { schemaVersion: '2.0', assessmentId: 'a1', photoId: 'p' + i, view, base64 },
    });
    expect(scored.statusCode, scored.body).toBe(200);
    photos.push({ id: 'p' + i, view, base64, signed: scored.json().signed });
  }
  const submit = (extra: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: '/v2/review/submit',
      headers,
      payload: {
        schemaVersion: '2.0',
        assessmentId: 'a1',
        disclosures: history(),
        photos: photos.map(({ id, view, base64 }) => ({ id, view, base64 })),
        signedScores: photos.map((p) => p.signed),
        closeUpsRequested: 1,
        ...extra,
      },
    });
  const verdict = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/v2/review/items/a1/verdict', headers, payload });
  const marks = (damaged = 'no', repair = 'no') =>
    Object.fromEntries(photos.map((p) => [p.id, { damaged, repair }]));
  return { app, headers, photos, submit, verdict, marks, verdictsFile };
}

describe('backend v2 expert console', () => {
  it('serves the console shell without the token, but no data without it', async () => {
    const { app, headers } = await setup();
    const page = await app.inject({ url: '/v2/review' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    expect(page.body).toContain('Mark every photograph from what you see first');
    expect((await app.inject({ url: '/v2/review/console.js' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/v2/review/items' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/v2/review/items', headers })).statusCode).toBe(200);
  });

  it('queues a verified item with a recomputed decision and the exact scored pixels', async () => {
    const { app, headers, submit } = await setup(0.4);
    const response = await submit({ decision: undefined });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().decision).toMatchObject({ outcome: 'review' }); // review band, close-up used
    const { items } = (await app.inject({ url: '/v2/review/items', headers })).json();
    expect(items).toHaveLength(1);
    expect(items[0].photos.map((p: { id: string }) => p.id)).toEqual(['p0', 'p1', 'p2']);
    expect(items[0].history[0]).toMatchObject({ question: 'crash', answer: 'no', everYes: false });
    const jpeg = await app.inject({ url: '/v2/review/items/a1/photos/p0', headers });
    expect(jpeg.headers['content-type']).toBe('image/jpeg');
    expect((await sharp(jpeg.rawPayload).metadata()).width).toBe(640);
  });

  it('refuses altered records and photographs that are not the scored pixels', async () => {
    const { submit, photos } = await setup();
    const forged = structuredClone(photos.map((p) => p.signed));
    forged[0]!.scores.answers.broken = { type: 'yesno', p: 0 };
    const altered = await submit({ signedScores: forged });
    expect(altered.statusCode).toBe(400);
    expect(altered.json().error.code).toBe('invalid_scores');
    const swapped = await submit({
      photos: photos.map(({ id, view }, i) => ({
        id,
        view,
        base64: photos[(i + 1) % photos.length]!.base64,
      })),
    });
    expect(swapped.statusCode).toBe(422);
    expect(swapped.json().error.code).toBe('photo_mismatch');
  });

  it('records the expert verdict with their own marks and the score records', async () => {
    const { submit, verdict, marks, verdictsFile } = await setup();
    await submit();
    expect(
      (await verdict({ outcome: 'no_offer', grade: null, note: '', reviewer: 'Sam', photos: {} }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await verdict({ outcome: 'offer', grade: null, note: '', reviewer: 'Sam', photos: marks() })
      ).json().error.code,
    ).toBe('grade_missing');
    expect(
      (
        await verdict({
          outcome: 'offer',
          grade: 'B',
          note: '',
          reviewer: 'Sam',
          photos: marks('yes'),
        })
      ).json().error.code,
    ).toBe('note_missing');
    const saved = await verdict({
      outcome: 'no_offer',
      grade: 'B',
      note: 'Seam open at the elbow.',
      reviewer: 'Sam Rider',
      photos: { ...marks('no'), p0: { damaged: 'yes', repair: 'no' } },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const lines = (await fs.readFile(verdictsFile, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0]!) as VerdictLine;
    expect(line).toMatchObject({
      outcome: 'no_offer',
      grade: null,
      modelOutcome: 'review',
      reviewer: 'Sam Rider',
    });
    expect(line.photos[0]).toMatchObject({ photoId: 'p0', damaged: 'yes' });
    // Calibration input: garment photographs only, valid score records, grouped by assessment.
    const { scores, labels } = verdictsToCalibration([line]);
    expect(labels.map((l) => l.damaged)).toEqual(['yes', 'no']);
    expect(labels.every((l) => l.group === 'a1')).toBe(true);
    for (const s of scores) expect(PhotoScoresSchema.safeParse(s).success).toBe(true);
    expect(new Set(scores.map((s) => s.photoId)).size).toBe(2);
  });

  it('never lets a specialist turn a reported exclusion into an offer', async () => {
    const { submit, verdict, marks } = await setup(0.02);
    await submit({
      disclosures: [{ id: 'x', question: 'crash', answer: 'yes', recordedAt }, ...history()],
    });
    const response = await verdict({
      outcome: 'offer',
      grade: 'A',
      note: '',
      reviewer: 'Sam',
      photos: marks(),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('reported_exclusion');
  });
});
