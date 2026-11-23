import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const COUNT_MODEL = 'gpt-6.2-sol';
export const OUTPUT_TOKEN_LIMIT = 1024;
// Even the published model-wide maximum of 922,000 input tokens at the highest
// long-context cache-write rate ($10/MTok), plus 1,024 output tokens at $15/MTok,
// costs under $10. A missing billable response retains the entire reservation.
export const UNKNOWN_ATTEMPT_MICROS = 10_000_000;
export type BudgetAllocation = { scope: string; micros: number };
export type CountUsage = { input: number; output: number; ceilingMicros: number };

export function usdMicros(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,6})?$/.test(raw)) return NaN;
  const [whole, fraction = ''] = raw.split('.');
  return Number(whole) * 1_000_000 + Number(fraction.padEnd(6, '0'));
}

export function matchesCountModel(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    (value === COUNT_MODEL || /^gpt-6\.2-sol-\d{4}-\d{2}-\d{2}$/.test(value))
  );
}

export function settledUsage(body: {
  model?: unknown;
  service_tier?: unknown;
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
}): CountUsage | undefined {
  const input = body.usage?.input_tokens,
    output = body.usage?.output_tokens;
  if (
    !matchesCountModel(body.model) ||
    (body.service_tier !== undefined && body.service_tier !== 'default') ||
    typeof input !== 'number' ||
    !Number.isSafeInteger(input) ||
    input < 1 ||
    input > 922000 ||
    typeof output !== 'number' ||
    !Number.isSafeInteger(output) ||
    output < 0 ||
    output > OUTPUT_TOKEN_LIMIT
  )
    return;
  // Charge conservatively even if all input was billed as a cache write. One
  // dollar per million tokens is exactly one microdollar per token.
  const long = input > 272000;
  return { input, output, ceilingMicros: input * (long ? 10 : 5) + output * (long ? 15 : 10) };
}

export function assertAllocation(db: DatabaseSync, expected: BudgetAllocation): void {
  const row = db
    .prepare('SELECT scope, ceiling_micros FROM count_allocation WHERE singleton=1')
    .get();
  if (!row || row.scope !== expected.scope || row.ceiling_micros !== expected.micros)
    throw new Error('Count budget does not match its provisioned allocation.');
}

/** A separate operator action provisions each allocation exactly once. Normal
 * HTTP service startup is never allowed to recreate a lost spending history. */
export function provisionAllocation(ledger: string, allocation: BudgetAllocation): void {
  if (
    !/^[a-zA-Z0-9_-]{1,80}$/.test(allocation.scope) ||
    !Number.isSafeInteger(allocation.micros) ||
    allocation.micros <= 0 ||
    allocation.micros > 200_000_000 ||
    !ledger ||
    /^:|^file:/i.test(ledger)
  )
    throw new Error('Invalid count budget.');
  mkdirSync(path.dirname(path.resolve(ledger)), { recursive: true });
  if (existsSync(ledger)) {
    const existing = new DatabaseSync(ledger, { readOnly: true });
    try {
      assertAllocation(existing, allocation);
    } finally {
      existing.close();
    }
    return;
  }
  closeSync(openSync(ledger, 'wx', 0o600));
  const db = new DatabaseSync(ledger);
  try {
    db.exec(
      'BEGIN IMMEDIATE; CREATE TABLE count_allocation(singleton INTEGER PRIMARY KEY CHECK(singleton=1), scope TEXT NOT NULL, ceiling_micros INTEGER NOT NULL CHECK(ceiling_micros>0))',
    );
    db.prepare('INSERT INTO count_allocation VALUES(1,?,?)').run(
      allocation.scope,
      allocation.micros,
    );
    db.exec('COMMIT');
  } finally {
    db.close();
  }
}
