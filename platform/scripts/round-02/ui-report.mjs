import fs from 'node:fs/promises';
import path from 'node:path';
const directory = path.resolve('benchmarks/round-02/experience');
const afterLabel = process.argv[2];
const names = ['baseline', 'baseline-recovery', ...(afterLabel ? [afterLabel] : [])];
function cases(report) {
  const out = [];
  function walk(suite) {
    for (const spec of suite.specs ?? [])
      for (const entry of spec.tests ?? []) {
        const final = entry.results?.at(-1);
        out.push({
          title: spec.title,
          status: final?.status ?? 'missing',
          expectedStatus: entry.expectedStatus,
          durationMs: final?.duration ?? 0,
          attempts: entry.results?.length ?? 0,
          error: final?.error?.message?.slice(0, 1000) ?? null,
        });
      }
    for (const child of suite.suites ?? []) walk(child);
  }
  for (const suite of report.suites ?? []) walk(suite);
  return out;
}
const runs = {};
for (const name of names) {
  const report = JSON.parse(
    await fs.readFile(path.join(directory, name + '-results.json'), 'utf8'),
  );
  const entries = cases(report);
  runs[name] = {
    total: entries.length,
    passed: entries.filter((x) => x.status === 'passed').length,
    failed: entries.filter((x) => x.status === 'failed' || x.status === 'timedOut').length,
    durationMs: report.stats?.duration,
    cases: entries,
  };
}
const baseline = [...runs.baseline.cases, ...runs['baseline-recovery'].cases];
if (new Set(baseline.map((x) => x.title)).size !== baseline.length)
  throw new Error('Baseline parts contain overlapping cases.');
const after = afterLabel ? runs[afterLabel].cases : [];
const missingAfter = afterLabel
  ? baseline.filter((x) => !after.some((y) => y.title === x.title)).map((x) => x.title)
  : [];
const comparison = {
  schemaVersion: '1.0',
  researchDate: '2026-10-26',
  baselineCommit: 'e3a6f58',
  baseline: {
    total: baseline.length,
    passed: baseline.filter((x) => x.status === 'passed').length,
    failed: baseline.filter((x) => x.status === 'failed' || x.status === 'timedOut').length,
  },
  runs,
  comparison: afterLabel
    ? baseline.map((b) => ({
        title: b.title,
        before: b.status,
        after: after.find((a) => a.title === b.title)?.status ?? 'not run',
      }))
    : null,
  missingAfter,
  interpretation:
    'Pass counts are scenario contract results, not product accuracy, safety certification, user research or native-device readiness.',
};
const name = afterLabel ? 'comparison-' + afterLabel + '.json' : 'baseline-summary.json';
await fs.writeFile(path.join(directory, name), JSON.stringify(comparison, null, 2));
console.log(
  JSON.stringify(
    {
      output: name,
      baseline: comparison.baseline,
      after: afterLabel
        ? {
            run: afterLabel,
            total: runs[afterLabel].total,
            passed: runs[afterLabel].passed,
            failed: runs[afterLabel].failed,
          }
        : null,
      missingAfter,
    },
    null,
    2,
  ),
);
