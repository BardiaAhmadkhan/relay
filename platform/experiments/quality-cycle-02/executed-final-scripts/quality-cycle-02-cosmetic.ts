import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { normalizeClaims as removeNegativeEvidence } from '../experiments/quality-cycle-02/cosmetic-claims';
const cases: any[] = [];
for (const r of JSON.parse(
  await fs.readFile('benchmarks/quality-audit-01/evaluation-full.json', 'utf8'),
).rows)
  cases.push({
    set: 'audit194',
    id: r.id,
    label: r.condition,
    photo: r.result.observation?.inspection?.photos[0],
  });
for (const r of JSON.parse(await fs.readFile('benchmarks/round-05/cue-light-results.json', 'utf8'))
  .rows)
  cases.push({
    set: 'round05-106',
    id: r.id,
    label: r.expectedDamage,
    photo: r.candidate?.inspection?.photos[0],
  });
for (const r of JSON.parse(await fs.readFile('benchmarks/round-05/repeat-results.json', 'utf8'))
  .rows)
  cases.push({
    set: 'round05-repeat36',
    id: r.id + '-' + r.repeat,
    label: r.expectedDamage,
    photo: r.candidate?.inspection?.photos[0],
  });
for (const r of JSON.parse(
  await fs.readFile('benchmarks/quality-audit-01/followup.json', 'utf8'),
).rows.filter((r: any) => r.kind === 'original-regression'))
  cases.push({
    set: 'original3',
    id: r.id,
    label: true,
    photo: r.result.observation?.inspection?.photos[0],
  });
const changed = [];
let unchanged = 0,
  skipped = 0;
const start = performance.now();
for (const c of cases) {
  if (!c.photo) {
    skipped++;
    continue;
  }
  const after = removeNegativeEvidence(c.photo);
  if (after === c.photo) unchanged++;
  else changed.push({ ...c, before: c.photo, after });
  if (c.label === true || c.label === 'visible_defect')
    assert.deepEqual(after, c.photo, 'Positive evidence changed: ' + c.id);
}
const report = {
  at: new Date().toISOString(),
  cases: cases.length,
  unchanged,
  skipped,
  changed: changed.map(({ photo, ...c }) => c),
  totalMs: performance.now() - start,
  scope:
    'Deterministic replay of frozen real model outputs, not a fresh end-to-end inference accuracy test.',
};
await fs.writeFile(
  'benchmarks/quality-cycle-02/cosmetic-claims-replay.json',
  JSON.stringify(report, null, 2) + '\n',
  { flag: 'wx' },
);
console.log({
  cases: cases.length,
  unchanged,
  skipped,
  changed: changed.map((c) => c.set + ':' + c.id),
  ms: report.totalMs,
});
