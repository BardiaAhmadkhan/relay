import { afterEach, describe, expect, it, vi } from 'vitest';
import { Questions, type Disclosure } from '../packages/core/schema';
import {
  ServiceError,
  assess,
  reportedExclusion,
  safetyFloor,
  scorePhoto,
  serviceBase,
  serviceHealthV2,
} from '../app/src/api-v2';
import type { Decision2, PhotoRecord, SignedScores } from '../packages/core/v2/schema';

const recordedAt = '2026-11-16T12:00:00.000Z';
const history = (answer: 'yes' | 'no' | 'unknown' = 'no'): Disclosure[] =>
  Questions.map((question, i) => ({ id: 'd' + i, question, answer, recordedAt }));
const photo: PhotoRecord = {
  id: 'p1',
  view: 'front',
  sha256: 'a'.repeat(64),
  quality: { width: 1280, height: 960, brightness: 120, sharpness: 200, warnings: [] },
};
const signed: SignedScores = {
  scores: {
    photoId: 'p1',
    sha256: 'a'.repeat(64),
    view: 'front',
    batteryVersion: 'gear-2',
    scorer: { id: 'local_logprob', model: 'm' },
    answers: { broken: { type: 'yesno', p: 0.02 } },
    usage: { inputTokens: 900, ms: 600 },
    scoredAt: recordedAt,
  },
  signature: 'b'.repeat(64),
};
const decision = (outcome: Decision2['outcome']): Decision2 => ({
  outcome,
  policyVersion: 'p',
  thresholdsVersion: 't',
  category: 'jacket',
  grade: outcome === 'offer' ? 'B' : null,
  title: 'x',
  summary: 'y',
  reasons: [],
  nextAction: 'z',
  requestPhoto: null,
  protectivePerformanceCertified: false,
});
const connection = { url: 'http://127.0.0.1:8788', token: 'tok' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => vi.unstubAllGlobals());

describe('backend v2 client', () => {
  it('scores a photograph and checks the record belongs to it', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return reply({ schemaVersion: '2.0', assessmentId: 'a1', photo, signed });
    });
    const signal = new AbortController().signal;
    const result = await scorePhoto(
      connection,
      { assessmentId: 'a1', photoId: 'p1', view: 'front', base64: 'AAAA' },
      signal,
    );
    expect(result.signed).toEqual(signed);
    expect(calls[0]!.url).toBe('http://127.0.0.1:8788/v2/photos/score');
    expect((calls[0]!.init.headers as Record<string, string>)['X-Relay-Token']).toBe('tok');
    await expect(
      scorePhoto(
        connection,
        { assessmentId: 'a1', photoId: 'other', view: 'front', base64: 'AAAA' },
        signal,
      ),
    ).rejects.toMatchObject({ code: 'mismatched_response' });
    await expect(
      scorePhoto(
        connection,
        { assessmentId: 'a2', photoId: 'p1', view: 'front', base64: 'AAAA' },
        signal,
      ),
    ).rejects.toMatchObject({ code: 'mismatched_response' });
  });

  it('maps service and network failures to retryable errors and keeps the service message', async () => {
    const signal = new AbortController().signal;
    vi.stubGlobal('fetch', async () =>
      reply(
        { error: { code: 'scoring_unavailable', message: 'The photo check did not complete.' } },
        503,
      ),
    );
    await expect(
      scorePhoto(
        connection,
        { assessmentId: 'a1', photoId: 'p1', view: 'front', base64: 'AAAA' },
        signal,
      ),
    ).rejects.toMatchObject({
      code: 'scoring_unavailable',
      retryable: true,
      message: 'The photo check did not complete.',
    });
    vi.stubGlobal('fetch', async () =>
      reply(
        { error: { code: 'invalid_image', message: 'A photograph could not be opened.' } },
        422,
      ),
    );
    await expect(
      scorePhoto(
        connection,
        { assessmentId: 'a1', photoId: 'p1', view: 'front', base64: 'AAAA' },
        signal,
      ),
    ).rejects.toMatchObject({ retryable: false });
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Network request failed');
    });
    await expect(
      scorePhoto(
        connection,
        { assessmentId: 'a1', photoId: 'p1', view: 'front', base64: 'AAAA' },
        signal,
      ),
    ).rejects.toMatchObject({ code: 'offline', retryable: true });
    vi.stubGlobal('fetch', async () => reply({ nonsense: true }));
    await expect(
      scorePhoto(
        connection,
        { assessmentId: 'a1', photoId: 'p1', view: 'front', base64: 'AAAA' },
        signal,
      ),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('accepts a consistent decision and refuses one the device can prove wrong', async () => {
    const signal = new AbortController().signal;
    const input = {
      assessmentId: 'a1',
      disclosures: history(),
      photos: [photo],
      signedScores: [signed],
      closeUpsRequested: 0,
    };
    const body = (d: Decision2) => ({
      schemaVersion: '2.0',
      assessmentId: 'a1',
      decision: d,
      cost: { inputTokens: 900, estimatedUsd: 0.00009 },
      timing: { decideMs: 1, scoringMs: 600 },
    });
    vi.stubGlobal('fetch', async () => reply(body(decision('offer'))));
    expect((await assess(connection, input, signal)).decision.outcome).toBe('offer');
    // A reported crash can only ever come back as "no offer".
    await expect(
      assess(connection, { ...input, disclosures: history('yes') }, signal),
    ).rejects.toMatchObject({ code: 'unsafe_decision' });
    // An offer needs three clear answers and a score record for every photograph.
    await expect(
      assess(connection, { ...input, disclosures: history('unknown') }, signal),
    ).rejects.toMatchObject({ code: 'unsafe_decision' });
    await expect(assess(connection, { ...input, signedScores: [] }, signal)).rejects.toMatchObject({
      code: 'unsafe_decision',
    });
    await expect(
      assess(connection, { ...input, photos: [{ ...photo, sha256: 'c'.repeat(64) }] }, signal),
    ).rejects.toMatchObject({ code: 'unsafe_decision' });
    vi.stubGlobal('fetch', async () => reply(body(decision('no_offer'))));
    expect(
      (await assess(connection, { ...input, disclosures: history('yes') }, signal)).decision
        .outcome,
    ).toBe('no_offer');
    vi.stubGlobal('fetch', async () => reply({ ...body(decision('review')), assessmentId: 'zzz' }));
    await expect(assess(connection, input, signal)).rejects.toMatchObject({
      code: 'mismatched_response',
    });
  });

  it('knows a reported exclusion without any network', () => {
    expect(reportedExclusion(history())).toEqual([]);
    expect(
      reportedExclusion([
        { id: 'x', question: 'protective_repair', answer: 'yes', recordedAt },
        ...history(),
      ]),
    ).toEqual(['protective_repair']);
    expect(() => safetyFloor(decision('review'), history('yes'), [], [])).toThrow(ServiceError);
    expect(safetyFloor(decision('review'), history('unknown'), [], []).outcome).toBe('review');
  });

  it('refuses an offer that rests on one picture sent as two views', () => {
    const back: PhotoRecord = { ...photo, id: 'p2', view: 'back' }; // same sha256 as the front
    const backSigned: SignedScores = {
      ...signed,
      scores: { ...signed.scores, photoId: 'p2', view: 'back' },
    };
    expect(safetyFloor(decision('offer'), history(), [photo], [signed]).outcome).toBe('offer');
    expect(() =>
      safetyFloor(decision('offer'), history(), [photo, back], [signed, backSigned]),
    ).toThrow(ServiceError);
  });

  it('recognises a v2 service and leaves everything else to the v1 path', async () => {
    const signal = new AbortController().signal;
    const v2 = {
      status: 'ok',
      schemaVersion: '2.0',
      batteryVersion: 'gear-2',
      policyVersion: 'p',
      thresholdsVersion: 't',
      calibratedScorers: ['local_logprob'],
      scorers: [{ id: 'local_logprob', model: 'qwen3.5:4b@d8b0f5e9760c' }],
      externalProcessing: false,
      processing: 'stateless',
    };
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seen.push(url + ' ' + JSON.stringify(init.headers));
      return reply(v2);
    });
    expect(await serviceHealthV2(connection, signal)).toMatchObject({
      batteryVersion: 'gear-2',
      externalProcessing: false,
    });
    expect(seen[0]).toBe('http://127.0.0.1:8788/v2/health {"X-Relay-Token":"tok"}');
    // A v1 service: 404, or a v1 health body where a v2 one was expected (the v1 browser tests stub
    // every URL ending in /health with a v1 body).
    vi.stubGlobal('fetch', async () => reply({ error: 'not found' }, 404));
    expect(await serviceHealthV2(connection, signal)).toBeNull();
    vi.stubGlobal('fetch', async () =>
      reply({ status: 'ok', schemaVersion: '1.0', provider: 'local_vlm', model: 'm' }),
    );
    expect(await serviceHealthV2(connection, signal)).toBeNull();
    vi.stubGlobal('fetch', async () => reply({ error: { code: 'unauthorized' } }, 401));
    await expect(serviceHealthV2(connection, signal)).rejects.toMatchObject({
      code: 'unauthorized',
      retryable: false,
    });
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('network down');
    });
    await expect(serviceHealthV2(connection, signal)).rejects.toMatchObject({
      code: 'offline',
      retryable: true,
    });
  });

  it('sends the external-provider choice and returns the retake hints', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return reply({
        schemaVersion: '2.0',
        assessmentId: 'a1',
        photo,
        signed,
        feedback: [{ code: 'out_of_focus', text: 'This photo is out of focus.' }],
      });
    });
    const result = await scorePhoto(
      connection,
      {
        assessmentId: 'a1',
        photoId: 'p1',
        view: 'front',
        base64: 'AAAA',
        consent: { externalProvider: false },
      },
      new AbortController().signal,
    );
    expect(body.consent).toEqual({ externalProvider: false });
    expect(result.feedback).toEqual([
      { code: 'out_of_focus', text: 'This photo is out of focus.' },
    ]);
  });

  it('only talks to HTTPS or private-network services', () => {
    expect(serviceBase('https://relay.example.com/')).toBe('https://relay.example.com');
    expect(serviceBase('http://192.168.1.20:8788')).toBe('http://192.168.1.20:8788');
    expect(() => serviceBase('http://relay.example.com')).toThrow('HTTPS');
    expect(() => serviceBase('https://user:pw@relay.example.com')).toThrow('credentials');
    expect(() => serviceBase('ftp://127.0.0.1')).toThrow('HTTPS');
  });
});
