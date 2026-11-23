import { it, expect, vi } from 'vitest';
import { createGpuWorker, remoteGpuScorer, workerModel, workerProfile } from '../server/gpu-rpc';
import { GARMENT_QUESTIONS } from '../packages/vision/v2/battery';
import { ScorerFailure, type Scorer } from '../packages/vision/v2/scorer';
import { intakeMeter } from '../server/intake-meter';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const secret = 'gpu-test-only-secret-which-is-long-enough',
  signal = new AbortController().signal;
const fixture: Scorer = {
  id: 'local_logprob',
  model: workerModel,
  async score() {
    return { answers: { gear: { type: 'yesno', p: 0.2 } }, inputTokens: 4, ms: 1 };
  },
};
it('keeps a complete photo on one worker request and rejects unauthenticated or incompatible requests', async () => {
  const worker = createGpuWorker(fixture, secret),
    url = await worker.listen({ host: '127.0.0.1', port: 0 });
  try {
    const client = remoteGpuScorer(url, secret);
    const value = await client.score(
      { jpeg: Buffer.from([255, 216, 255, 217]), view: 'front' },
      GARMENT_QUESTIONS.filter((q) => q.key === 'gear'),
      signal,
    );
    expect(value).toEqual({ answers: { gear: { type: 'yesno', p: 0.2 } }, inputTokens: 4, ms: 1 });
    const req = {
      method: 'POST' as const,
      url: '/internal/v1/photo',
      payload: { profile: workerProfile, view: 'front', jpeg: 'YWJjZA==', keys: ['gear'] },
    };
    expect((await worker.inject(req)).statusCode).toBe(401);
    for (const changes of [
      { profile: 'different' },
      { keys: ['undefined'] },
      { keys: ['gear', 'gear'] },
      { extra: true },
    ]) {
      expect(
        (
          await worker.inject({
            ...req,
            headers: { 'x-relay-worker': secret },
            payload: { ...req.payload, ...changes },
          })
        ).statusCode,
      ).toBe(400);
    }
    for (const invalid of [
      'http://not-loopback.test',
      'https://u:p@worker.test',
      'https://worker.test/?token=secret',
      'https://worker.test/path',
    ])
      expect(() => remoteGpuScorer(invalid, secret)).toThrow();
  } finally {
    await worker.close();
  }
});
it('transports the two recorded low-resolution evidence heads on a detail view', async () => {
  const answers = {
    road_contact: { type: 'yesno' as const, p: 0.22 },
    road_contact_low: { type: 'yesno' as const, p: 0.27 },
    broken_low: { type: 'yesno' as const, p: 0.18 },
  };
  const worker = createGpuWorker(
    {
      ...fixture,
      async score() {
        return { answers, inputTokens: 10, ms: 2 };
      },
    },
    secret,
  );
  const url = await worker.listen({ host: '127.0.0.1', port: 0 });
  try {
    const c = remoteGpuScorer(url, secret),
      q = GARMENT_QUESTIONS.filter((v) => v.key === 'road_contact');
    const jpeg = Buffer.from([255, 216, 255, 217]);
    expect((await c.score({ jpeg, view: 'detail' }, q, signal)).answers).toEqual(answers);
    await expect(c.score({ jpeg, view: 'front' }, q, signal)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  } finally {
    await worker.close();
  }
});
it('preserves a real scorer refusal and rejects a response bound to different pixels', async () => {
  const worker = createGpuWorker(
    {
      ...fixture,
      async score() {
        throw new ScorerFailure('refused', false);
      },
    },
    secret,
  );
  const url = await worker.listen({ host: '127.0.0.1', port: 0 });
  const p = { jpeg: Buffer.from([255, 216, 255, 217]), view: 'front' as const },
    qs = GARMENT_QUESTIONS.filter((q) => q.key === 'gear');
  try {
    const client = remoteGpuScorer(url, secret);
    await expect(client.score(p, qs, signal)).rejects.toMatchObject({
      code: 'refused',
      retryable: false,
    });
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        profile: workerProfile,
        binding: '0'.repeat(64),
        ...(await fixture.score(p, qs, signal)),
      }),
    );
    try {
      await expect(client.score(p, qs, signal)).rejects.toMatchObject({ code: 'invalid_response' });
    } finally {
      mock.mockRestore();
    }
  } finally {
    await worker.close();
  }
});
it('counts a paid follow-up or a later repeat as one intake without retaining the assessment ID', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'relay-intake-metrics-')),
    dbfile = path.join(dir, 'usage.sqlite');
  try {
    const first = intakeMeter(dbfile, secret);
    first.record('unique-rider-intake', 100);
    first.record('unique-rider-intake', 200);
    first.recordPhoto('unique-rider-intake', 'front', 105);
    first.recordPhoto('unique-rider-intake', 'front', 201);
    first.close();
    const second = intakeMeter(dbfile, secret);
    second.record('unique-rider-intake', 500);
    second.record('a-second-rider', 600);
    second.recordPhoto('unique-rider-intake', 'front', 501);
    second.recordPhoto('a-second-rider', 'front', 602);
    second.close();
    const db = new DatabaseSync(dbfile, { readOnly: true });
    try {
      const rows = db
        .prepare('SELECT ticket,first_ms FROM assessed_intake ORDER BY first_ms')
        .all();
      expect(rows.map((r) => r.first_ms)).toEqual([100, 600]);
      expect(
        db
          .prepare('SELECT first_ms FROM scored_photo ORDER BY first_ms')
          .all()
          .map((r) => r.first_ms),
      ).toEqual([105, 602]);
      expect(rows.every((r) => /^[a-f0-9]{64}$/.test(String(r.ticket)))).toBe(true);
    } finally {
      db.close();
    }
  } finally {
    expect(path.dirname(dir)).toBe(tmpdir());
    expect(path.basename(dir)).toMatch(/^relay-intake-metrics-/);
    rmSync(dir, { recursive: true, force: true });
  }
});
