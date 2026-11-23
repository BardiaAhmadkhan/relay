/** Read-only. Joins actual RunPod billing for two explicit resources + a UTC
 * window with private local intake counts and verified OpenAI token usage. */
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
const finite = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
function sameTime(a, b) {
  return typeof a === 'string' && Date.parse(a) === Date.parse(b);
}
export function bucketWindow(start, end) {
  const a = Date.parse(start),
    b = Date.parse(end);
  if (
    !Number.isSafeInteger(a) ||
    !Number.isSafeInteger(b) ||
    a % 3600000 ||
    b % 3600000 ||
    b <= a ||
    b - a > 31 * 86400000
  )
    throw Error('Use increasing UTC-hour boundaries (maximum 31 days).');
  return { start: new Date(a).toISOString(), end: new Date(b).toISOString(), a, b };
}
export function readBill(body, id, kind, w) {
  const field = kind === 'pods' ? 'podId' : 'serverlessId',
    q = body.metadata?.query,
    rows = body.records;
  if (
    !q ||
    q[field] !== id ||
    q.bucketSize !== 'hour' ||
    !sameTime(q.startTime, w.start) ||
    !sameTime(q.endTime, w.end) ||
    !Array.isArray(rows) ||
    body.metadata.recordCount !== rows.length
  )
    throw Error('Provider returned a different resource or window.');
  const seen = new Set();
  let total = 0;
  for (const r of rows) {
    const a = Date.parse(r.startTime),
      b = Date.parse(r.endTime);
    if (
      r[field] !== id ||
      !finite(r.totalAmount) ||
      !Number.isSafeInteger(a) ||
      b - a !== 3600000 ||
      a < w.a ||
      b > w.b ||
      seen.has(a)
    )
      throw Error('Unexpected or duplicate billing bucket.');
    seen.add(a);
    total += r.totalAmount;
  }
  const official = body.metadata.totals;
  if (
    !finite(official?.totalAmount) ||
    Math.abs(total - official.totalAmount) > Math.max(0.00001, rows.length * 0.000001)
  )
    throw Error('Billing totals do not reconcile.');
  return {
    resource: id,
    observedBuckets: rows.length,
    reportedTotalUsd: official.totalAmount,
    components: Object.fromEntries(
      ['gpuAmount', 'cpuAmount', 'diskAmount', 'feeAmount']
        .filter((k) => finite(official[k]))
        .map((k) => [k, official[k]]),
    ),
  };
}
export function measureLocal(w, intakes, allowance) {
  const db = new DatabaseSync(intakes, { readOnly: true }),
    wallet = new DatabaseSync(allowance, { readOnly: true });
  try {
    const n = db
      .prepare('SELECT COUNT(*) n FROM assessed_intake WHERE first_ms>=? AND first_ms<?')
      .get(w.a, w.b).n;
    const photos = db
      .prepare('SELECT COUNT(*) n FROM scored_photo WHERE first_ms>=? AND first_ms<?')
      .get(w.a, w.b).n;
    const row = wallet
      .prepare(
        'SELECT COUNT(*) calls,COALESCE(SUM(CASE WHEN input_tokens IS NULL THEN 1 ELSE 0 END),0) missing,COALESCE(SUM(input_tokens*(CASE WHEN input_tokens>272000 THEN 4 ELSE 2 END)+output_tokens*(CASE WHEN input_tokens>272000 THEN 15 ELSE 10 END)),0) list,COALESCE(SUM(charged_micros),0) exposure FROM count_attempt WHERE started_ms>=? AND started_ms<?',
      )
      .get(w.a, w.b);
    return {
      intakesFirstAssessed: Number(n),
      distinctPhotosFirstScored: Number(photos),
      openAIAttempts: Number(row.calls),
      attemptsWithoutVerifiedUsage: Number(row.missing),
      openAIStandardListEstimateUsd: Number(row.list) / 1e6,
      openAILedgerExposureUsd: Number(row.exposure) / 1e6,
    };
  } finally {
    db.close();
    wallet.close();
  }
}
async function main() {
  const [start, end] = process.argv.slice(2),
    w = bucketWindow(start, end),
    env = process.env;
  if (w.b > Date.now()) throw Error('Choose a completed reporting window.');
  if (
    !env.RELAY_USAGE_DB ||
    !env.RELAY_R2_LEDGER ||
    !env.RUNPOD_BILLING_KEY ||
    !env.RELAY_BILLING_POD_ID ||
    !env.RELAY_BILLING_ENDPOINT_ID
  )
    throw Error(
      'Configure the two durable ledgers, a billing:read credential and the two specific resource IDs.',
    );
  const local = measureLocal(w, env.RELAY_USAGE_DB, env.RELAY_R2_LEDGER);
  const reports = await Promise.all(
    [
      ['pods', env.RELAY_BILLING_POD_ID],
      ['serverless', env.RELAY_BILLING_ENDPOINT_ID],
    ].map(async ([kind, id]) => {
      const u = new URL('https://api.runpod.io/v2/billing/' + kind);
      u.search = new URLSearchParams({
        [kind === 'pods' ? 'podId' : 'serverlessId']: id,
        startTime: w.start,
        endTime: w.end,
        bucketSize: 'hour',
      });
      const r = await fetch(u, {
        headers: { Authorization: 'Bearer ' + env.RUNPOD_BILLING_KEY },
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) throw Error('RunPod billing HTTP ' + r.status + ' for ' + kind);
      return readBill(await r.json(), id, kind, w);
    }),
  );
  const compute = reports.reduce((v, r) => v + r.reportedTotalUsd, 0);
  const populated = reports.every((r) => r.observedBuckets > 0);
  console.log(
    JSON.stringify(
      {
        start: w.start,
        end: w.end,
        retrievedAt: new Date().toISOString(),
        provider: 'RunPod billing API v2',
        reports,
        ...local,
        providerRecordsPresentForBoth: populated,
        reportedHostingUsd: compute,
        hostingUsdPerPhoto:
          populated && local.distinctPhotosFirstScored
            ? compute / local.distinctPhotosFirstScored
            : null,
        hostingPlusEstimatedOpenAIUsdPerPhoto:
          populated && !local.attemptsWithoutVerifiedUsage && local.distinctPhotosFirstScored
            ? (compute + local.openAIStandardListEstimateUsd) / local.distinctPhotosFirstScored
            : null,
        hostingUsdPerIntake:
          populated && local.intakesFirstAssessed ? compute / local.intakesFirstAssessed : null,
        hostingPlusEstimatedOpenAIUsdPerIntake:
          populated && !local.attemptsWithoutVerifiedUsage && local.intakesFirstAssessed
            ? (compute + local.openAIStandardListEstimateUsd) / local.intakesFirstAssessed
            : null,
        scope:
          'Resource-attributed usage. Re-query after billing posts. OpenAI figures are list estimates or conservative exposure. Include other separately billed services and invoices when relevant.',
      },
      null,
      2,
    ),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
