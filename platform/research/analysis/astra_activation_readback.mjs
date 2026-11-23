/** Local verification. Publishes aggregate evidence only. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
const dir = 'collab/baseline/v35-activation',
  read = (p) => JSON.parse(fs.readFileSync(p)),
  hash = (b) => createHash('sha256').update(b).digest('hex');
const db = new DatabaseSync(process.env.RELAY_R2_LEDGER, { readOnly: true });
const rows = db
  .prepare(
    'SELECT state,input_tokens,output_tokens,elapsed_ms,charged_micros FROM count_attempt ORDER BY started_ms',
  )
  .all();
const allocation = db.prepare('SELECT scope,ceiling_micros FROM count_allocation').get();
db.close();
const bills = rows.map(
    (x) =>
      x.input_tokens * (x.input_tokens > 272000 ? 4 : 2) +
      x.output_tokens * (x.input_tokens > 272000 ? 15 : 10),
  ),
  ms = rows.map((x) => x.elapsed_ms).sort((a, b) => a - b),
  sum = (a) => a.reduce((x, y) => x + y, 0);
const u = read(dir + '/unit-results.json'),
  b = read(dir + '/mobile-journeys.json'),
  policy = read(dir + '/final-ordinary-policy/policy-summary.json'),
  native = read(dir + '/android/verification.json'),
  many = read(dir + '/android-several/verification.json'),
  split = read(dir + '/hosting/split-4b-final.json'),
  held = read(dir + '/count-holdout-results.json');
const receipt = read('artifacts/relay-v3.5-host/manifest.json');
assert.equal(
  hash(fs.readFileSync('artifacts/relay-v3.5-host/relay-v3.5-backend.tar.gz')),
  receipt.archiveSha256,
);
const health = await fetch('http://127.0.0.1:8788/v2/health').then((r) => r.json());
assert.equal(health.processingNotice, 'terms');
assert.equal(health.engineRelease, '3.5');
const bundles = {};
for (const platform of ['android', 'ios']) {
  const folder = '.cache/v35-cloud-url-check/_expo/static/js/' + platform;
  const file = fs.readdirSync(folder).find((x) => x.endsWith('.hbc'));
  const bytes = fs.readFileSync(path.join(folder, file));
  const url = bytes.includes(Buffer.from('https://relay-build-check.invalid'));
  const secretFree = ['OPENAI_API_KEY', 'RELAY_SIGNING_KEY'].every(
    (k) => Boolean(process.env[k]) && !bytes.includes(Buffer.from(process.env[k])),
  );
  assert(url && secretFree);
  bundles[platform] = {
    bytes: bytes.length,
    sha256: hash(bytes),
    validatedBuildOriginInHermes: true,
    actualServerSecretsAbsent: true,
  };
}
const evidence = {
  at: new Date().toISOString(),
  hostedCloudSpendUsd: 0,
  hostedDeployment: false,
  localHealth: {
    version: health.engineRelease,
    notice: health.processingNotice,
    primary: health.scorers,
  },
  budget: {
    scope: allocation.scope,
    ceilingUsd: allocation.ceiling_micros / 1e6,
    attempts: rows.length,
    completed: rows.filter((x) => x.state === 'completed').length,
    missingUsage: rows.filter((x) => x.input_tokens === null || x.output_tokens === null).length,
    inputTokens: sum(rows.map((x) => x.input_tokens ?? 0)),
    outputTokens: sum(rows.map((x) => x.output_tokens ?? 0)),
    standardListUsd: sum(bills) / 1e6,
    observedMeanUsd: sum(bills) / rows.length / 1e6,
    observedMinUsd: Math.min(...bills) / 1e6,
    observedMaxUsd: Math.max(...bills) / 1e6,
    ledgerExposureUsd: sum(rows.map((x) => x.charged_micros)) / 1e6,
    headroomUsd: (allocation.ceiling_micros - sum(rows.map((x) => x.charged_micros))) / 1e6,
    providerMs: {
      median:
        ms.length % 2
          ? ms[Math.floor(ms.length / 2)]
          : (ms[ms.length / 2 - 1] + ms[ms.length / 2]) / 2,
      p95: ms[Math.ceil(ms.length * 0.95) - 1],
    },
  },
  unit: { passed: u.numPassedTests, total: u.numTotalTests, failed: u.numFailedTests },
  browser: b.stats,
  policy: { comparisons: policy.comparisons, changed: policy.changedCases.length },
  openCases: {
    knownCohort: read(dir + '/live-acceptance.json').cases.length,
    holdout: held.cases.length,
    holdoutCorrect: held.cases.filter((x) => x.correct).length,
    holdoutNaturallyRouted: held.cases.filter((x) => x.routed).length,
  },
  android: {
    apk: native.apkSha256,
    pair: native.visibleResult,
    realManyAttempts: many.newPaidAttempts,
    realMany: many.passed,
  },
  split: {
    equalEach: split.comparisons.map((x) => [x.view, x.answers]),
    passed: split.passed,
    controlGpuCalls: split.workerCallsForStartupHealthAndCrash,
  },
  mobileBuilds: bundles,
  package: { files: receipt.fileCount, bytes: receipt.archiveBytes, sha256: receipt.archiveSha256 },
};
assert.equal(evidence.localHealth.primary[0].model, 'qwen3.5:4b@d8b0f5e9760c cascade');
assert.equal(evidence.unit.failed, 0);
assert.equal(evidence.browser.unexpected, 0);
assert.equal(evidence.policy.changed, 0);
fs.writeFileSync(dir + '/activation-readback.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(
  JSON.stringify({
    budget: evidence.budget,
    unit: evidence.unit,
    package: evidence.package,
    live: true,
  }),
);
