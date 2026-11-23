import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  provisionAllocation,
  settledUsage,
  UNKNOWN_ATTEMPT_MICROS,
  usdMicros,
} from '../server/count-budget';
import { MeteredCountReader, configuredCountReader } from '../server/count-reader';

const body = {
  status: 'completed',
  model: 'gpt-6.2-sol',
  service_tier: 'default',
  usage: { input_tokens: 2000, output_tokens: 100 },
  output: [
    {
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text: JSON.stringify({
            item_count: 'matched_pair',
            is_motorcycle_gear: 'yes',
            category: 'boots',
            structural_damage: 'no',
            abrasion_beyond_wear: 'no',
            repair: 'no',
            ordinary_wear_only: 'yes',
          }),
        },
      ],
    },
  ],
};
const item = (photoId: string) => ({
  assessmentId: 'test',
  photoId,
  sha256: '4'.repeat(64),
  jpeg: new Uint8Array([1]),
});
const key = 'test-only-stable-signing-key-of-32-bytes';
const signal = new AbortController().signal;

describe('owner-authorized cumulative OpenAI limit', () => {
  it('preauthorizes the whole model-wide maximum at standard service and settles only verifiable usage', () => {
    expect(usdMicros('0.000019')).toBe(19);
    expect(usdMicros('35.10')).toBe(35100000);
    expect(usdMicros('Infinity')).toBeNaN();
    expect(settledUsage(body)?.ceilingMicros).toBe(11000);
    expect(
      settledUsage({ ...body, usage: { input_tokens: 922000, output_tokens: 1024 } })
        ?.ceilingMicros,
    ).toBe(9235360);
    expect(UNKNOWN_ATTEMPT_MICROS).toBeGreaterThan(9235360);
    for (const change of [
      { model: 'another' },
      { service_tier: 'priority' },
      { usage: { input_tokens: -1, output_tokens: 1 } },
      { usage: { input_tokens: 922001, output_tokens: 1 } },
      { usage: { input_tokens: 123, output_tokens: 1025 } },
      { usage: {} },
    ]) {
      expect(settledUsage({ ...body, ...change })).toBeUndefined();
    }
  });
  it('enforces one durable allowance across workers, retries, UTC dates, missing responses, expiry and restarts', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'relay-lifetime-')),
      ledger = path.join(dir, 'budget.sqlite');
    const lifetime = { scope: 'test-allocation', micros: 12_000_000 };
    let ms = Date.parse('2026-11-19T12:00:00Z');
    let done!: (r: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      done = resolve;
    });
    const network = vi
      .fn()
      .mockImplementationOnce(() => pending)
      .mockRejectedValue(Error('simulated lost response'));
    const cfg = {
      apiKey: 'test',
      signingKey: key,
      ledger,
      lifetime,
      maxDailyCalls: 10,
      now: () => new Date(ms),
      fetcher: ((_, opts) => {
        expect(JSON.parse(String(opts?.body)).service_tier).toBe('default');
        return network();
      }) as typeof fetch,
    };
    expect(() => new MeteredCountReader(cfg)).toThrow('Provision');
    provisionAllocation(ledger, lifetime);
    provisionAllocation(ledger, lifetime);
    expect(() => provisionAllocation(ledger, { ...lifetime, micros: 100000000 })).toThrow('match');
    const a = new MeteredCountReader(cfg),
      b = new MeteredCountReader(cfg);
    try {
      const first = a.read(item('first'), signal);
      expect(await b.read(item('other'), signal)).toBeNull();
      expect(network).toHaveBeenCalledTimes(1);
      done(Response.json(body));
      expect(await first).toBe('matched_pair');
      expect(await b.read(item('first'), signal)).toBe('matched_pair');
      expect(await a.read(item('lost'), signal)).toBeNull();
      expect(network).toHaveBeenCalledTimes(2);
      ms += 86400000;
      expect(await b.read(item('next-day'), signal)).toBeNull();
      expect(await b.read(item('lost'), signal)).toBeNull();
    } finally {
      a.close();
      b.close();
    }
    const restarted = new MeteredCountReader(cfg);
    try {
      expect(await restarted.read(item('restart'), signal)).toBeNull();
      expect(network).toHaveBeenCalledTimes(2);
    } finally {
      restarted.close();
    }
    const db = new DatabaseSync(ledger, { readOnly: true });
    try {
      expect(
        db.prepare('SELECT SUM(charged_micros) AS n, COUNT(*) AS calls FROM count_attempt').get(),
      ).toMatchObject({ n: 10011000, calls: 2 });
      expect(
        db
          .prepare(
            'SELECT COUNT(*) AS n FROM count_attempt WHERE digest IS NOT NULL OR label IS NOT NULL',
          )
          .get()?.n,
      ).toBe(0);
    } finally {
      db.close();
      expect(path.dirname(dir)).toBe(tmpdir());
      expect(path.basename(dir)).toMatch(/^relay-lifetime-/);
      await rm(dir, { recursive: true, force: true });
    }
  });
  it.each([401, 403, 429, 500, 503, 'invalid-json', 'wrong-tier', 'no-response'] as const)(
    'keeps one reservation and abstains for provider failure %s',
    async (failure) => {
      const network = vi.fn(async () => {
        if (typeof failure === 'number') return new Response(null, { status: failure });
        if (failure === 'invalid-json') return new Response('broken');
        if (failure === 'wrong-tier') return Response.json({ ...body, service_tier: 'priority' });
        throw Error('connection lost');
      });
      const dir = await mkdtemp(path.join(tmpdir(), 'relay-failure-'));
      const ledger = path.join(dir, 'budget.sqlite');
      const lifetime = { scope: 'failure-check', micros: UNKNOWN_ATTEMPT_MICROS };
      provisionAllocation(ledger, lifetime);
      const reader = new MeteredCountReader({
        apiKey: 'test',
        signingKey: key,
        ledger,
        maxDailyCalls: 10,
        lifetime,
        fetcher: network,
      });
      try {
        expect(await reader.read(item('cancelled'), AbortSignal.abort())).toBeNull();
        expect(network).not.toHaveBeenCalled();
        expect(await reader.read(item('first'), signal)).toBeNull();
        expect(await reader.read(item('first'), signal)).toBeNull();
        expect(await reader.read(item('second'), signal)).toBeNull();
        expect(network).toHaveBeenCalledTimes(1);
        const db = new DatabaseSync(ledger, { readOnly: true });
        try {
          expect(
            db.prepare('SELECT COUNT(*) n, SUM(charged_micros) total FROM count_attempt').get(),
          ).toMatchObject({ n: 1, total: UNKNOWN_ATTEMPT_MICROS });
        } finally {
          db.close();
        }
      } finally {
        reader.close();
        expect(path.dirname(dir)).toBe(tmpdir());
        expect(path.basename(dir)).toMatch(/^relay-failure-/);
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
  it('warns once at 50 and 80 percent across restarts, including irreversible timeout exposure', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'relay-budget-alert-')),
      ledger = path.join(dir, 'budget.sqlite');
    const lifetime = { scope: 'alert-test', micros: 32_000_000 };
    provisionAllocation(ledger, lifetime);
    const cfg = {
      ledger,
      lifetime,
      signingKey: key,
      apiKey: 'test',
      maxDailyCalls: 9,
      fetcher: async () => {
        throw Error('lost');
      },
    };
    const note = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const first = new MeteredCountReader(cfg);
      try {
        await first.read(item('a'), signal);
        expect(note).not.toHaveBeenCalled();
        await first.read(item('b'), signal);
      } finally {
        first.close();
      }
      const reopened = new MeteredCountReader(cfg);
      try {
        await reopened.read(item('c'), signal);
        await reopened.read(item('d'), signal);
      } finally {
        reopened.close();
      }
      expect(note.mock.calls.map((c) => String(c[0]).match(/(50|80)%/)?.[0])).toEqual([
        '50%',
        '80%',
      ]);
    } finally {
      note.mockRestore();
      expect(path.dirname(dir)).toBe(tmpdir());
      expect(path.basename(dir)).toMatch(/^relay-budget-alert-/);
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('does not enable metered access on an unprovisioned or differently allocated ledger', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'relay-lifetime-')),
      ledger = path.join(dir, 'budget.sqlite');
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      RELAY_R2_ENABLED: '1',
      RELAY_R2_TERMS_COVERED: '1',
      RELAY_ALLOW_PAID: '1',
      OPENAI_API_KEY: 'test',
      RELAY_R2_DAILY_CALLS: '15',
      RELAY_R2_LEDGER: ledger,
    };
    try {
      expect(configuredCountReader(env, key)).toBeUndefined();
      expect(() =>
        configuredCountReader(
          { ...env, RELAY_R2_BUDGET_SCOPE: 'a', RELAY_R2_LIFETIME_USD: '35' },
          key,
        ),
      ).toThrow('Provision');
      provisionAllocation(ledger, { scope: 'a', micros: 35000000 });
      expect(() =>
        configuredCountReader(
          { ...env, RELAY_R2_BUDGET_SCOPE: 'b', RELAY_R2_LIFETIME_USD: '35' },
          key,
        ),
      ).toThrow('match');
      const reader = configuredCountReader(
        { ...env, RELAY_R2_BUDGET_SCOPE: 'a', RELAY_R2_LIFETIME_USD: '35' },
        key,
      );
      expect(reader).toBeDefined();
      reader?.close?.();
    } finally {
      expect(path.dirname(dir)).toBe(tmpdir());
      expect(path.basename(dir)).toMatch(/^relay-lifetime-/);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
