import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  MeteredCountReader,
  configuredCountReader,
  PROTOCOL_HASH,
  type CountReader,
} from '../server/count-reader';
import { createAppV2 } from '../server/app-v2';
import { ScorerChain, signScores } from '../packages/vision/v2/scorer-chain';
import { stubScorer, CLEAN_ITEM } from '../server/stub-scorer';
import { prepareImages } from '../server/images';
import { measureFocus, withFocus } from '../server/focus';
import {
  PolicyConfigSchema,
  ThresholdsSchema,
  PhotoScoresSchema,
  type PhotoScores,
  type Decision2,
} from '../packages/core/v2/schema';
import { bindingCountPhoto } from '../packages/core/v2/count-review';
import { Questions } from '../packages/core/schema';
import configFile from '../packages/core/v2/policy.config.json';
import bands from '../packages/core/v2/thresholds.json';
import protocol from '../server/count-protocol.json';
import { createHash } from 'node:crypto';
const signingKey = 'test-only-stock-score-'.repeat(3),
  model = 'qwen3.5:4b@d8b0f5e9760c cascade',
  time = '2026-11-20T00:00:00.000Z';
const hash = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
const apps: ReturnType<typeof createAppV2>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});
const labels = {
  item_count: 'matched_pair',
  is_motorcycle_gear: 'yes',
  category: 'boots',
  structural_damage: 'no',
  abrasion_beyond_wear: 'no',
  repair: 'no',
  ordinary_wear_only: 'yes',
};
async function fixture() {
  const bytes = await fs.readFile('assets/fixtures/leather-jacket.jpg'),
    base64 = bytes.toString('base64'),
    src = { id: 'front', view: 'front' as const, base64 };
  const full = await prepareImages([src], 1600),
    small = await prepareImages([src], 1024);
  const quality = withFocus(full.photos[0]!.quality, await measureFocus(small.images[0]!.jpeg));
  expect(quality.warnings).toEqual([]);
  const disclosures = Questions.map((question) => ({
    id: question,
    question,
    recordedAt: time,
    answer: 'no' as const,
  }));
  const scores: PhotoScores[] = (['front', 'back', 'label'] as const).map((view) =>
    PhotoScoresSchema.parse({
      photoId: view,
      view,
      sha256: view === 'front' ? full.photos[0]!.sha256 : hash(view),
      scorer: { id: 'local_logprob', model },
      batteryVersion: 'gear-2',
      scoredAt: time,
      usage: { inputTokens: 0, ms: 0 },
      answers:
        view === 'label'
          ? { label_legible: { type: 'yesno', p: 1 } }
          : {
              ...Object.fromEntries(
                ['road_contact', 'broken', 'repair', 'usable', 'gear', 'single_item'].map((k) => [
                  k,
                  {
                    type: 'yesno',
                    p:
                      k === 'single_item' && view === 'front'
                        ? 0.2
                        : ['road_contact', 'broken', 'repair'].includes(k)
                          ? 0.01
                          : 0.96,
                  },
                ]),
              ),
              category: { type: 'choice', choice: 'boots', probabilities: { boots: 1 } },
              wear: { type: 'level', score: 0.8, probabilities: [0.2, 0.8, 0, 0] },
            },
    }),
  );
  const photos = scores.map((s) => ({ id: s.photoId, view: s.view, sha256: s.sha256, quality })),
    signedScores = scores.map((s) => signScores(s, signingKey));
  const payload = {
    schemaVersion: '2.0',
    assessmentId: 'r2-control',
    photos,
    signedScores,
    disclosures,
    closeUpsRequested: 0,
  };
  return {
    scores,
    photos,
    disclosures,
    payload,
    extra: { countCheck: { notice: 'terms' as const, photoId: 'front', base64 } },
  };
}
function service(countReview?: CountReader, timeout = 8000, review = false) {
  const thresholds = ThresholdsSchema.parse(bands);
  thresholds.perScorer.local_logprob!.models = [model];
  const a = createAppV2({
    chain: new ScorerChain([stubScorer({ answers: CLEAN_ITEM })]),
    workingEdge: 1600,
    planned: true,
    signingKey,
    config: PolicyConfigSchema.parse(configFile),
    thresholds,
    countReview,
    countTimeoutMs: timeout,
    ...(review
      ? { review: { verdictsFile: path.join(os.tmpdir(), 'relay-count-no-written-verdict.jsonl') } }
      : {}),
  });
  apps.push(a);
  return a;
}
const post = (a: ReturnType<typeof service>, payload: object) =>
  a.inject({ method: 'POST', url: '/v2/assess', payload });
describe('optional count adjudication', () => {
  it('requires the ordinary binding reason and rejects each false gate independently', async () => {
    const f = await fixture(),
      base = (await post(service(), f.payload)).json().decision as Decision2;
    expect(bindingCountPhoto(base, f.disclosures, f.photos, f.scores, false)?.id).toBe('front');
    expect(
      bindingCountPhoto({ ...base, outcome: 'review' }, f.disclosures, f.photos, f.scores, false),
    ).toBeUndefined();
    expect(
      bindingCountPhoto(
        { ...base, reasons: [...base.reasons, ...base.reasons] },
        f.disclosures,
        f.photos,
        f.scores,
        false,
      ),
    ).toBeUndefined();
    expect(bindingCountPhoto(base, f.disclosures, f.photos, f.scores, true)).toBeUndefined();
    expect(
      bindingCountPhoto(base, f.disclosures.slice(1), f.photos, f.scores, false),
    ).toBeUndefined();
    expect(
      bindingCountPhoto(
        base,
        [{ ...f.disclosures[0]!, answer: 'yes' }, ...f.disclosures],
        f.photos,
        f.scores,
        false,
      ),
    ).toBeUndefined();
    expect(
      bindingCountPhoto(base, f.disclosures, [f.photos[0]!, f.photos[0]!], f.scores, false),
    ).toBeUndefined();
    expect(
      bindingCountPhoto(base, f.disclosures, f.photos, f.scores.slice(1), false),
    ).toBeUndefined();
    const soft = structuredClone(f.photos);
    soft[0]!.quality.warnings = ['soft'];
    expect(bindingCountPhoto(base, f.disclosures, soft, f.scores, false)).toBeUndefined();
    for (const variant of ['wrong_category', 'already_pass', 'unanswered', 'unrelated_score']) {
      const s = structuredClone(f.scores);
      if (variant === 'wrong_category')
        s[0]!.answers.category = { type: 'choice', choice: 'jacket', probabilities: { jacket: 1 } };
      if (variant === 'already_pass') s[0]!.answers.single_item = { type: 'yesno', p: 0.5 };
      if (variant === 'unanswered') delete s[0]!.answers.single_item;
      if (variant === 'unrelated_score') s[0]!.sha256 = hash('elsewhere');
      expect(bindingCountPhoto(base, f.disclosures, f.photos, s, false)).toBeUndefined();
    }
  });
  it('retains signed answers, calls only for the exact bound JPEG, and preserves the complete local outcome on failure', async () => {
    const f = await fixture(),
      plain = service();
    const ordinary = (await post(plain, f.payload)).json().decision;
    expect(ordinary.reasons[0].code).toBe('multiple_items');
    expect((await post(plain, { ...f.payload, ...f.extra })).json().decision).toEqual(ordinary);
    const read = vi.fn<CountReader['read']>().mockResolvedValue('matched_pair'),
      enabled = service({ read });
    expect(
      (await enabled.inject({ method: 'GET', url: '/v2/health' })).json().processingNotice,
    ).toBe('terms');
    expect(
      (await plain.inject({ method: 'GET', url: '/v2/health' })).json().processingNotice,
    ).toBeUndefined();
    expect((await post(enabled, f.payload)).json().decision).toEqual(ordinary);
    expect(
      (
        await post(enabled, {
          ...f.payload,
          countCheck: { ...f.extra.countCheck, notice: 'older' },
        })
      ).json().decision,
    ).toEqual(ordinary);
    expect(
      (
        await post(enabled, {
          ...f.payload,
          countCheck: {
            ...f.extra.countCheck,
            base64: (await fs.readFile('assets/fixtures/racing-boot.jpg')).toString('base64'),
          },
        })
      ).json().decision,
    ).toEqual(ordinary);
    expect(
      (
        await post(enabled, {
          ...f.payload,
          ...f.extra,
          countReceipt: { check: { kind: 'unknown' } },
        })
      ).json().decision,
    ).toEqual(ordinary);
    expect(read).not.toHaveBeenCalled();
    for (const label of ['one', 'matched_pair', 'several', 'unsure', null] as const) {
      read.mockResolvedValue(label);
      const d = (await post(enabled, { ...f.payload, ...f.extra })).json().decision;
      if (label === 'one' || label === 'matched_pair') expect(d.outcome).toBe('offer');
      else expect(d).toEqual(ordinary);
    }
    expect(read).toHaveBeenCalledTimes(5);
    expect(hash(read.mock.calls[0]![0].jpeg)).toBe(f.photos[0]!.sha256);
    expect(f.payload.signedScores[0]!.scores.answers.single_item).toEqual({
      type: 'yesno',
      p: 0.2,
    });
    read.mockRejectedValue(Error('unavailable'));
    expect((await post(enabled, { ...f.payload, ...f.extra })).json().decision).toEqual(ordinary);
    const states = structuredClone(f.scores);
    delete states[0]!.answers.wear;
    read.mockResolvedValue('one');
    const incomplete = (
      await post(enabled, {
        ...f.payload,
        ...f.extra,
        signedScores: states.map((s) => signScores(s, signingKey)),
      })
    ).json().decision;
    expect(incomplete.outcome).toBe('review');
  });
  it('returns baseline after timeout even if a reader ignores abort and finishes late', async () => {
    const f = await fixture();
    let resolve: (v: 'one') => void = () => {};
    const read = vi.fn<CountReader['read']>(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      ),
      a = service({ read }, 800);
    const baseline = (await post(a, f.payload)).json().decision;
    const adjudicated = await post(a, { ...f.payload, ...f.extra });
    expect(adjudicated.json().decision).toEqual(baseline);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]![1].aborted).toBe(true);
    resolve('one');
  });
  it('pins the evaluated protocol and reserves paid attempts atomically across readers and restarts', async () => {
    expect(hash(JSON.stringify(protocol))).toBe(PROTOCOL_HASH);
    expect(configuredCountReader({ NODE_ENV: 'test' }, signingKey)).toBeUndefined();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-count-test-'));
    const ledger = path.join(dir, 'allowance.sqlite');
    let day = '2026-11-20',
      sent = 0;
    const fetcher: typeof fetch = async (_url, init) => {
      sent++;
      const req = JSON.parse(String(init?.body));
      expect(req.model).toBe('gpt-6.2-sol');
      expect(req.reasoning.effort).toBe('medium');
      expect(req.input[0].content).toBe(protocol.system);
      expect(req.input[1].content[0].text).toBe(protocol.question);
      expect(req.text.format.schema).toEqual(protocol.schema);
      expect(req.store).toBe(false);
      expect(req.max_output_tokens).toBe(1024);
      return Response.json(
        {
          model: req.model,
          status: 'completed',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: JSON.stringify(labels) }],
            },
          ],
        },
        { headers: { 'x-request-id': 'req_test' } },
      );
    };
    const config = {
      apiKey: 'test-only',
      signingKey,
      ledger,
      maxDailyCalls: 3,
      dailyMicros: 20000,
      perCallMicros: 20000,
      now: () => new Date(day + 'T12:00:00Z'),
      fetcher,
    };
    const a = new MeteredCountReader(config),
      b = new MeteredCountReader(config);
    const source = {
      assessmentId: 'a',
      photoId: 'p',
      sha256: hash('pixels'),
      jpeg: Buffer.from('pixels'),
    };
    try {
      const results = await Promise.all([
        a.read(source, new AbortController().signal),
        b.read(source, new AbortController().signal),
      ]);
      expect(results).toContain('matched_pair');
      expect(sent).toBe(1);
      expect(await b.read(source, new AbortController().signal)).toBe('matched_pair');
      expect(await a.read({ ...source, photoId: 'new' }, new AbortController().signal)).toBeNull();
      expect(sent).toBe(1);
      day = '2026-11-21';
      expect(await b.read(source, new AbortController().signal)).toBeNull();
      expect(sent).toBe(1);
      expect(await b.read({ ...source, photoId: 'new' }, new AbortController().signal)).toBe(
        'matched_pair',
      );
      expect(sent).toBe(2);
    } finally {
      a.close();
      b.close();
      const owned = await fs.realpath(dir);
      expect(path.dirname(owned)).toBe(await fs.realpath(os.tmpdir()));
      expect(path.basename(owned)).toMatch(/^relay-count-test-/);
      await fs.rm(owned, { recursive: true, force: true });
    }
  });
  it('abstains on refusal, invalid enums, extra fields, truncated output and a different model', async () => {
    for (const mode of ['refusal', 'invalid', 'extra', 'incomplete', 'wrong_model']) {
      const reader = new MeteredCountReader({
        apiKey: 'test-only',
        signingKey,
        ledger: ':memory:',
        maxDailyCalls: 1,
        fetcher: async () =>
          Response.json({
            model: mode === 'wrong_model' ? 'other' : 'gpt-6.2-sol',
            status: mode === 'incomplete' ? 'incomplete' : 'completed',
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [
                  mode === 'refusal'
                    ? { type: 'refusal', refusal: 'no' }
                    : {
                        type: 'output_text',
                        text: JSON.stringify({
                          ...labels,
                          ...(mode === 'invalid'
                            ? { item_count: 'maybe' }
                            : mode === 'extra'
                              ? { unexpected: true }
                              : {}),
                        }),
                      },
                ],
              },
            ],
          }),
      });
      try {
        expect(
          await reader.read(
            { assessmentId: 'x', photoId: 'p', sha256: hash('p'), jpeg: Buffer.from('p') },
            new AbortController().signal,
          ),
        ).toBeNull();
      } finally {
        reader.close();
      }
    }
  });
});

it('carries a neutral signed result to the shop and always prefers current safety evidence', async () => {
  const f = await fixture();
  const base64s = await Promise.all(
    ['leather-jacket.jpg', 'armour-jacket.jpg', 'backpack-label.jpg'].map(async (a) =>
      (await fs.readFile('assets/fixtures/' + a)).toString('base64'),
    ),
  );
  const uploaded: Array<{
    id: string;
    view: 'front' | 'back' | 'label' | 'detail';
    base64: string;
  }> = [];
  for (let i = 0; i < f.photos.length; i++) {
    const photo = f.photos[i]!,
      source = { id: photo.id, view: photo.view, base64: base64s[i]! };
    uploaded.push(source);
    const full = await prepareImages([source], 1600),
      small = await prepareImages([source], 1024);
    photo.sha256 = full.photos[0]!.sha256;
    photo.quality = withFocus(full.photos[0]!.quality, await measureFocus(small.images[0]!.jpeg));
    f.scores[i]!.sha256 = photo.sha256;
  }
  const reader = { read: vi.fn<CountReader['read']>().mockResolvedValue('matched_pair') },
    enabled = service(reader, 8000, true),
    off = service(undefined, 8000, true);
  const payload = {
    ...f.payload,
    photos: f.photos,
    signedScores: f.scores.map((s) => signScores(s, signingKey)),
  };
  const ordinary = (await post(enabled, payload)).json().decision;
  const qualified = (await post(enabled, { ...payload, ...f.extra })).json();
  expect(qualified.decision.outcome).toBe('offer');
  const receipt = qualified.countReceipt;
  expect(receipt.check.verdict).toBe('matched_pair');
  expect(JSON.stringify(receipt)).not.toMatch(/openai|gpt-|provider|api_key/i);
  const review = (app: ReturnType<typeof service>, countReceipt: unknown, extra: object = {}) =>
    app.inject({
      method: 'POST',
      url: '/v2/review/submit',
      payload: { ...payload, photos: uploaded, countReceipt, ...extra },
    });
  expect((await post(enabled, { ...payload, countReceipt: receipt })).json().decision).toEqual(
    qualified.decision,
  );
  expect((await review(enabled, receipt)).json().decision).toEqual(qualified.decision);
  for (const bad of [
    { ...receipt, signature: 'f'.repeat(64) },
    { ...receipt, check: { ...receipt.check, sha256: hash('other') } },
    { ...receipt, check: { ...receipt.check, assessmentId: 'different' } },
    { ...receipt, check: { ...receipt.check, verdict: 'several' } },
    { ...receipt, check: { ...receipt.check, verdict: 'one' } },
  ]) {
    expect((await post(enabled, { ...payload, countReceipt: bad })).json().decision).toEqual(
      ordinary,
    );
    expect((await review(enabled, bad)).json().decision).toEqual(ordinary);
  }
  expect((await review(off, receipt)).json().decision).toEqual(ordinary);
  const yes = payload.disclosures.map((x, i) => (i === 0 ? { ...x, answer: 'yes' } : x));
  expect((await review(enabled, receipt, { disclosures: yes })).json().decision.outcome).toBe(
    'no_offer',
  );
  expect(reader.read).toHaveBeenCalledTimes(1);
});

it('removes the old digest and verdict at eleven minutes while retaining the paid slot across restart', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-count-retention-')),
    ledger = path.join(dir, 'allowance.sqlite');
  const at = Date.parse('2026-11-20T12:00:00Z');
  let now = at;
  const recordedFetch = vi.fn().mockResolvedValue(
    Response.json(
      {
        model: 'gpt-6.2-sol',
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: JSON.stringify(labels) }],
          },
        ],
      },
      { headers: { 'x-request-id': 'req_retain' } },
    ),
  );
  const fetcher: typeof fetch = async () => recordedFetch();
  const settings = {
    apiKey: 'test-only',
    signingKey,
    ledger,
    maxDailyCalls: 1,
    dailyMicros: 20000,
    perCallMicros: 20000,
    fetcher,
    now: () => new Date(now),
  };
  const src = {
    assessmentId: 'one',
    photoId: 'front',
    sha256: hash('source'),
    jpeg: Buffer.from('source'),
  };
  let reader = new MeteredCountReader(settings);
  const check = () => {
    const db = new DatabaseSync(ledger, { readOnly: true });
    try {
      return db
        .prepare(
          'SELECT day,digest,label,model,protocol,reserved,state,request_id,elapsed_ms FROM count_attempt',
        )
        .all();
    } finally {
      db.close();
    }
  };
  try {
    expect(await reader.read(src, new AbortController().signal)).toBe('matched_pair');
    expect(check()).toMatchObject([{ digest: src.sha256, label: 'matched_pair', reserved: 20000 }]);
    now += 11 * 60 * 1000;
    expect(
      await reader.read({ ...src, photoId: 'second' }, new AbortController().signal),
    ).toBeNull();
    expect(check()).toMatchObject([
      {
        day: '2026-11-20',
        digest: null,
        label: null,
        model: 'gpt-6.2-sol',
        protocol: 'relay-fallback-01',
        reserved: 20000,
        state: 'completed',
        request_id: 'req_retain',
      },
    ]);
    reader.close();
    reader = new MeteredCountReader(settings);
    expect(await reader.read(src, new AbortController().signal)).toBeNull();
    expect(recordedFetch).toHaveBeenCalledTimes(1);
    expect(check()).toHaveLength(1);
  } finally {
    reader.close();
    const owned = await fs.realpath(dir);
    expect(path.dirname(owned)).toBe(await fs.realpath(os.tmpdir()));
    expect(path.basename(owned)).toMatch(/^relay-count-retention-/);
    await fs.rm(owned, { recursive: true, force: true });
  }
});
it('migrates pre-release nonnullable ledgers without resetting their budget or preserving an expired verdict', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-count-migration-')),
    ledger = path.join(dir, 'allowance.sqlite');
  const db = new DatabaseSync(ledger);
  db.exec(
    'CREATE TABLE count_attempt(day TEXT NOT NULL,ticket TEXT NOT NULL,digest TEXT NOT NULL,model TEXT NOT NULL,protocol TEXT NOT NULL,reserved INTEGER NOT NULL,started_ms INTEGER NOT NULL,state TEXT NOT NULL,label TEXT,request_id TEXT,elapsed_ms INTEGER,PRIMARY KEY(ticket));',
  );
  db.prepare('INSERT INTO count_attempt VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
    '2026-11-20',
    'old-ticket',
    hash('old'),
    'test',
    'old-protocol',
    20000,
    0,
    'completed',
    'one',
    'old-request',
    52,
  );
  db.close();
  const reader = new MeteredCountReader({
    apiKey: 'test-only',
    signingKey,
    ledger,
    maxDailyCalls: 1,
  });
  try {
    const after = new DatabaseSync(ledger, { readOnly: true });
    try {
      expect(
        after.prepare('SELECT ticket,digest,label,reserved,elapsed_ms FROM count_attempt').all(),
      ).toMatchObject([
        { ticket: 'old-ticket', digest: null, label: null, reserved: 20000, elapsed_ms: 52 },
      ]);
    } finally {
      after.close();
    }
  } finally {
    reader.close();
    const owned = await fs.realpath(dir);
    expect(path.dirname(owned)).toBe(await fs.realpath(os.tmpdir()));
    expect(path.basename(owned)).toMatch(/^relay-count-migration-/);
    await fs.rm(owned, { recursive: true, force: true });
  }
});
