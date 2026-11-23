import { setTimeout as waitForExpiry } from 'node:timers/promises';
import { createHash, createHmac } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import {
  assertAllocation,
  COUNT_MODEL,
  matchesCountModel,
  OUTPUT_TOKEN_LIMIT,
  settledUsage,
  UNKNOWN_ATTEMPT_MICROS,
  usdMicros,
  type BudgetAllocation,
  type CountUsage,
} from './count-budget';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import protocol from './count-protocol.json' with { type: 'json' };

const MODEL = COUNT_MODEL;
export const PROTOCOL_HASH = 'a8ecf2cf54b5e42a49b3225761248227b1a98f3e972391f4763b8569d3291cc4';
const yn = z.enum(['yes', 'no', 'unsure']);
const labels = z.strictObject({
  item_count: z.enum(['one', 'matched_pair', 'several', 'unsure']),
  is_motorcycle_gear: yn,
  category: z.enum([
    'jacket',
    'trousers',
    'suit',
    'gloves',
    'boots',
    'helmet',
    'armour',
    'other',
    'unsure',
  ]),
  structural_damage: yn,
  abrasion_beyond_wear: yn,
  repair: yn,
  ordinary_wear_only: yn,
});
export type CountLabel = z.infer<typeof labels>['item_count'];
export type CountRequest = {
  assessmentId: string;
  photoId: string;
  sha256: string;
  jpeg: Uint8Array;
};
export interface CountReader {
  read(input: CountRequest, signal: AbortSignal): Promise<CountLabel | null>;
  close?(): void;
}
type Settings = {
  apiKey: string;
  signingKey: string;
  ledger: string;
  maxDailyCalls: number;
  dailyMicros?: number;
  perCallMicros?: number;
  lifetime?: BudgetAllocation;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  now?: () => Date;
};

/** The ledger reserves each attempted paid request before the network operation. A unique
 * attempt per assessment, photo and protocol prevents duplicate charges. Daily allowances cover concurrent workers.
 * Photo digests and count labels expire after ten minutes. The metering record persists.
 * No photograph or response text is written. */
const REUSE_MS = 10 * 60 * 1000;
const LEDGER_SCHEMA = `CREATE TABLE IF NOT EXISTS count_attempt(
 day TEXT NOT NULL, ticket TEXT PRIMARY KEY, digest TEXT, model TEXT NOT NULL, protocol TEXT NOT NULL,
 reserved INTEGER NOT NULL, started_ms INTEGER NOT NULL, state TEXT NOT NULL, label TEXT,
 request_id TEXT, elapsed_ms INTEGER, charged_micros INTEGER NOT NULL DEFAULT 10000000, input_tokens INTEGER, output_tokens INTEGER)`;
export class MeteredCountReader implements CountReader {
  private db: DatabaseSync;
  private expiry?: AbortController;
  private readonly reserved: number;
  constructor(private readonly config: Settings) {
    if (createHash('sha256').update(JSON.stringify(protocol)).digest('hex') !== PROTOCOL_HASH)
      throw Error('Changed count protocol');
    if (
      !config.apiKey ||
      config.signingKey.length < 32 ||
      !Number.isSafeInteger(config.maxDailyCalls) ||
      config.maxDailyCalls < 0
    )
      throw Error('Invalid count allowance');
    const { dailyMicros, perCallMicros } = config;
    if (
      (dailyMicros === undefined) !== (perCallMicros === undefined) ||
      (dailyMicros !== undefined &&
        (!Number.isSafeInteger(dailyMicros) ||
          dailyMicros < 0 ||
          !Number.isSafeInteger(perCallMicros) ||
          perCallMicros! <= 0))
    )
      throw Error('Invalid currency allowance');
    if (
      config.timeoutMs !== undefined &&
      (!Number.isFinite(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 8000)
    )
      throw Error('Invalid count timeout');
    this.reserved = perCallMicros ?? 0;
    if (config.ledger !== ':memory:')
      mkdirSync(path.dirname(path.resolve(config.ledger)), { recursive: true });
    if (config.lifetime && !existsSync(config.ledger))
      throw Error('Provision the count budget before serving.');
    this.db = new DatabaseSync(config.ledger);
    try {
      this.db.exec(
        'PRAGMA busy_timeout=150; PRAGMA secure_delete=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; BEGIN IMMEDIATE',
      );
      this.db.exec(LEDGER_SCHEMA);
      // The pre-release ledger required a digest for every row. Preserve the spent allowances
      // while permitting expiry of the two result fields in any ledger produced by that build.
      const col = this.db
        .prepare('PRAGMA table_info(count_attempt)')
        .all()
        .find((c) => c.name === 'digest');
      if (Number(col?.notnull) === 1) {
        this.db.exec('ALTER TABLE count_attempt RENAME TO count_attempt_v0');
        this.db.exec(LEDGER_SCHEMA);
        const columns =
          'day,ticket,digest,model,protocol,reserved,started_ms,state,label,request_id,elapsed_ms';
        this.db.exec(
          'INSERT INTO count_attempt (' +
            columns +
            ') SELECT ' +
            columns +
            ' FROM count_attempt_v0; DROP TABLE count_attempt_v0',
        );
      }
      const existingColumns = this.db
        .prepare('PRAGMA table_info(count_attempt)')
        .all()
        .map((x) => x.name);
      if (!existingColumns.includes('charged_micros'))
        this.db.exec(
          'ALTER TABLE count_attempt ADD COLUMN charged_micros INTEGER NOT NULL DEFAULT 10000000',
        );
      if (!existingColumns.includes('input_tokens'))
        this.db.exec('ALTER TABLE count_attempt ADD COLUMN input_tokens INTEGER');
      if (!existingColumns.includes('output_tokens'))
        this.db.exec('ALTER TABLE count_attempt ADD COLUMN output_tokens INTEGER');
      if (config.lifetime) {
        assertAllocation(this.db, config.lifetime);
        this.db.exec(
          'CREATE TABLE IF NOT EXISTS count_budget_alert(level INTEGER PRIMARY KEY CHECK(level IN (50,80)))',
        );
      }
      this.db.exec('COMMIT');
      this.sweep(this.nowMs());
    } catch (e) {
      try {
        this.db.exec('ROLLBACK');
      } catch {}
      this.db.close();
      throw e;
    }
  }
  private nowMs() {
    return this.config.now?.().getTime() ?? Date.now();
  }
  private armExpiry(delay: number) {
    this.expiry?.abort();
    const controller = new AbortController();
    this.expiry = controller;
    void waitForExpiry(delay, undefined, { ref: false, signal: controller.signal })
      .then(() => {
        if (controller.signal.aborted) return;
        try {
          this.sweep(this.nowMs());
        } catch {
          this.armExpiry(250);
        }
      })
      .catch(() => undefined);
  }
  private scheduleExpiry(now: number) {
    const row = this.db
      .prepare(
        'SELECT MIN(started_ms) AS earliest FROM count_attempt WHERE digest IS NOT NULL OR label IS NOT NULL',
      )
      .get();
    if (typeof row?.earliest === 'number')
      this.armExpiry(Math.max(1, row.earliest + REUSE_MS - now));
    else {
      this.expiry?.abort();
      this.expiry = undefined;
    }
  }
  private warnBudget(now: number) {
    const allowance = this.config.lifetime;
    if (!allowance) return;
    try {
      const note = this.db.prepare(
        "INSERT OR IGNORE INTO count_budget_alert(level) SELECT ? WHERE NOT EXISTS(SELECT 1 FROM count_budget_alert WHERE level=?) AND (SELECT COALESCE(SUM(charged_micros),0) FROM count_attempt WHERE state!='reserved' OR started_ms<=?)>=?",
      );
      for (const level of [50, 80]) {
        if (note.run(level, level, now - 8000, Math.ceil((allowance.micros * level) / 100)).changes)
          console.warn(
            'Relay OpenAI allowance ' +
              allowance.scope +
              ' reached ' +
              level +
              '% of its lifetime USD ' +
              allowance.micros / 1e6 +
              ' limit, including unresolved requests.',
          );
      }
    } catch {
      /* Operator warnings never change an assessment or its existing reservation. */
    }
  }
  private sweep(now: number) {
    this.db
      .prepare(
        'UPDATE count_attempt SET digest=NULL,label=NULL WHERE started_ms<=? AND (digest IS NOT NULL OR label IS NOT NULL)',
      )
      .run(now - REUSE_MS);
    this.scheduleExpiry(now);
    this.warnBudget(now);
  }
  close() {
    this.expiry?.abort();
    this.db.close();
  }
  async read(input: CountRequest, signal: AbortSignal): Promise<CountLabel | null> {
    const now = this.config.now?.() ?? new Date(),
      day = now.toISOString().slice(0, 10);
    const ticket = createHmac('sha256', this.config.signingKey)
      .update(
        JSON.stringify([MODEL, PROTOCOL_HASH, input.assessmentId, input.photoId, input.sha256]),
      )
      .digest('hex');
    const c = this.config;
    let usage: CountUsage | undefined;
    let requestId: string | null = null,
      choice: CountLabel | null = null,
      state = 'unavailable';
    const timed = AbortSignal.any([signal, AbortSignal.timeout(c.timeoutMs ?? 8000)]);
    const start = performance.now();
    try {
      this.sweep(now.getTime());
      if (signal.aborted || !this.config.maxDailyCalls) return null;
      const reserved = this.db
        .prepare(
          "INSERT OR IGNORE INTO count_attempt(day,ticket,digest,model,protocol,reserved,started_ms,state,charged_micros) SELECT ?,?,?,?,?,?,?,'reserved',? WHERE (SELECT COUNT(*) FROM count_attempt WHERE day=?) < ? AND (SELECT COALESCE(SUM(reserved),0) FROM count_attempt WHERE day=?) + ? <= ? AND (SELECT COALESCE(SUM(charged_micros),0) FROM count_attempt) + ? <= ?",
        )
        .run(
          day,
          ticket,
          input.sha256,
          MODEL,
          protocol.version,
          this.reserved,
          now.getTime(),
          UNKNOWN_ATTEMPT_MICROS,
          day,
          c.maxDailyCalls,
          day,
          this.reserved,
          c.dailyMicros ?? Number.MAX_SAFE_INTEGER,
          UNKNOWN_ATTEMPT_MICROS,
          c.lifetime?.micros ?? Number.MAX_SAFE_INTEGER,
        );
      if (reserved.changes) this.scheduleExpiry(now.getTime());
      if (!reserved.changes) {
        const prior = this.db
          .prepare('SELECT label FROM count_attempt WHERE ticket=? AND state=? AND started_ms>=?')
          .get(ticket, 'completed', now.getTime() - REUSE_MS);
        const known = labels.shape.item_count.safeParse(prior?.label);
        return !timed.aborted && known.success ? known.data : null;
      }
    } catch {
      return null;
    }
    try {
      const response = await (c.fetcher ?? fetch)('https://api.openai.com/v1/responses', {
        method: 'POST',
        signal: timed,
        redirect: 'error',
        headers: { Authorization: 'Bearer ' + c.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          reasoning: { effort: 'medium' },
          store: false,
          max_output_tokens: OUTPUT_TOKEN_LIMIT,
          service_tier: 'default',
          input: [
            { role: 'system', content: protocol.system },
            {
              role: 'user',
              content: [
                { type: 'input_text', text: protocol.question },
                {
                  type: 'input_image',
                  image_url: 'data:image/jpeg;base64,' + Buffer.from(input.jpeg).toString('base64'),
                  detail: 'high',
                },
              ],
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'relay_fallback',
              schema: protocol.schema,
              strict: true,
            },
          },
        }),
      });
      const rid = response.headers.get('x-request-id');
      requestId = rid && /^[a-zA-Z0-9_.-]{1,140}$/.test(rid) ? rid : null;
      if (!response.ok) {
        state = 'http_' + response.status;
        return null;
      }
      const body = await response.json();
      usage = settledUsage(body);
      if (
        timed.aborted ||
        body.status !== 'completed' ||
        !matchesCountModel(body.model) ||
        (body.service_tier !== undefined && body.service_tier !== 'default')
      ) {
        state = 'incomplete';
        return null;
      }
      const message = (Array.isArray(body.output) ? body.output : []).filter(
        (o: { type?: string; role?: string }) => o.type === 'message' && o.role === 'assistant',
      );
      if (
        message.length !== 1 ||
        message[0].content?.length !== 1 ||
        message[0].content[0]?.type !== 'output_text'
      ) {
        state = 'abstained';
        return null;
      }
      const text = message[0].content[0].text;
      if (typeof text !== 'string' || text.length > 4096) {
        state = 'invalid';
        return null;
      }
      const checked = labels.safeParse(JSON.parse(text));
      if (!checked.success) {
        state = 'invalid';
        return null;
      }
      choice = checked.data.item_count;
      state = 'completed';
    } catch {
      state = timed.aborted ? 'cancelled_or_timeout' : 'unavailable';
      return null;
    } finally {
      if (timed.aborted) {
        state = 'cancelled_or_timeout';
        choice = null;
      }
      try {
        this.db
          .prepare(
            'UPDATE count_attempt SET state=?, label=CASE WHEN digest IS NOT NULL AND started_ms>? THEN ? ELSE NULL END, request_id=?,elapsed_ms=?,charged_micros=?,input_tokens=?,output_tokens=? WHERE day=? AND ticket=?',
          )
          .run(
            state,
            this.nowMs() - REUSE_MS,
            choice,
            requestId,
            Math.round(performance.now() - start),
            usage?.ceilingMicros ?? UNKNOWN_ATTEMPT_MICROS,
            usage?.input ?? null,
            usage?.output ?? null,
            day,
            ticket,
          );
        this.warnBudget(this.nowMs());
      } catch {
        choice = null;
      }
    }
    return choice;
  }
}
export function configuredCountReader(
  env: NodeJS.ProcessEnv,
  key: string,
): CountReader | undefined {
  if (
    env.RELAY_R2_ENABLED !== '1' ||
    env.RELAY_ALLOW_PAID !== '1' ||
    env.RELAY_R2_TERMS_COVERED !== '1' ||
    !env.OPENAI_API_KEY
  )
    return;
  if (env.RELAY_R2_LEDGER && /^:|^file:/i.test(env.RELAY_R2_LEDGER)) return;
  const max = Number(env.RELAY_R2_DAILY_CALLS ?? 0);
  if (!Number.isSafeInteger(max) || max < 1) return;
  const lifetime = usdMicros(env.RELAY_R2_LIFETIME_USD);
  const scope = env.RELAY_R2_BUDGET_SCOPE;
  if (
    !scope ||
    !Number.isSafeInteger(lifetime) ||
    !lifetime ||
    lifetime < 1 ||
    lifetime > 200000000 ||
    !env.RELAY_R2_LEDGER
  )
    return;
  return new MeteredCountReader({
    apiKey: env.OPENAI_API_KEY,
    signingKey: key,
    ledger: env.RELAY_R2_LEDGER ?? 'data/count-allowance.sqlite',
    maxDailyCalls: max,
    lifetime: { scope, micros: lifetime },
    dailyMicros: usdMicros(env.RELAY_R2_DAILY_USD),
    perCallMicros: usdMicros(env.RELAY_R2_RESERVE_USD),
  });
}
