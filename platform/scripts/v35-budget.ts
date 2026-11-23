import { DatabaseSync } from 'node:sqlite';
import {
  assertAllocation,
  provisionAllocation,
  usdMicros,
  UNKNOWN_ATTEMPT_MICROS,
} from '../server/count-budget';
const {
  RELAY_R2_LEDGER: ledger,
  RELAY_R2_BUDGET_SCOPE: scope,
  RELAY_R2_LIFETIME_USD: dollars,
} = process.env;
const micros = usdMicros(dollars),
  op = process.argv[2];
if (!ledger || !scope || !micros || !['init', 'status'].includes(op ?? ''))
  throw Error('Set the ledger path, scope and lifetime USD allocation and choose init or status.');
if (op === 'init') {
  provisionAllocation(ledger, { scope, micros });
  console.log(JSON.stringify({ scope, lifetimeUsd: micros / 1e6, provisioned: true }));
} else {
  const db = new DatabaseSync(ledger, { readOnly: true });
  try {
    assertAllocation(db, { scope, micros });
    const hasTable = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='count_attempt'")
      .get();
    const values = hasTable
      ? db
          .prepare(
            'SELECT COUNT(*) AS attempts, COALESCE(SUM(charged_micros),0) AS exposure, COALESCE(SUM(input_tokens),0) AS inputTokens, COALESCE(SUM(output_tokens),0) AS outputTokens, COALESCE(SUM(CASE WHEN input_tokens IS NULL THEN 1 ELSE 0 END),0) AS unmetered, COALESCE(SUM(input_tokens * CASE WHEN input_tokens>272000 THEN 4 ELSE 2 END + output_tokens * CASE WHEN input_tokens>272000 THEN 15 ELSE 10 END),0) AS listMicros FROM count_attempt',
          )
          .get()!
      : { attempts: 0, exposure: 0, inputTokens: 0, outputTokens: 0, unmetered: 0, listMicros: 0 };
    const remaining = micros - Number(values.exposure);
    console.log(
      JSON.stringify(
        {
          scope,
          lifetimeUsd: micros / 1e6,
          attempts: values.attempts,
          inputTokens: values.inputTokens,
          outputTokens: values.outputTokens,
          attemptsWithoutVerifiedUsage: values.unmetered,
          estimatedStandardListUsdForMeasuredUsage: Number(values.listMicros) / 1e6,
          conservativeExposureUsd: Number(values.exposure) / 1e6,
          remainingAllocationUsd: remaining / 1e6,
          oneNewAttemptFitsLifetimeBudget: remaining >= UNKNOWN_ATTEMPT_MICROS,
        },
        null,
        2,
      ),
    );
  } finally {
    db.close();
  }
}
