import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { canFocusTear } from '../packages/vision/focused-tear';
import { normalizeEvidenceClaims } from '../packages/vision/evidence-contract';
const data = JSON.parse(
  await fs.readFile('benchmarks/quality-cycle-02/final-evaluation.json', 'utf8'),
);
const differences: any[] = [],
  summary: any = {};
for (const r of data.rows) {
  if (!r.baseline) continue;
  const eligible = canFocusTear(r.baseline, r.set === 'hard' ? 'front' : r.reference.view),
    photo = normalizeEvidenceClaims(r.recovery && eligible ? r.candidate : r.baseline);
  summary[r.set] ??= { cases: 0, positiveRegressions: 0, newNegativeAlerts: 0, keptRecoveries: [] };
  summary[r.set].cases++;
  if (r.condition === 'visible_defect' && r.baselineFlag) assert(photo.findings.length > 0, r.id);
  if (r.condition === 'no_visible_defect' && !r.baselineFlag)
    assert.equal(photo.findings.length, 0, r.id);
  if (r.recovery && eligible) summary[r.set].keptRecoveries.push(r.id);
  if (JSON.stringify(photo) !== JSON.stringify(r.candidate)) {
    differences.push({
      id: r.id,
      set: r.set,
      condition: r.condition,
      reason: 'Narrower eligibility removes optional recovery',
    });
    assert(['ambiguous', 'unassessable'].includes(r.condition), 'Scored result changed ' + r.id);
  }
}
await fs.writeFile(
  'benchmarks/quality-cycle-02/selected-scope-regressions.json',
  JSON.stringify(
    {
      at: new Date().toISOString(),
      scope:
        'Latest eligibility and normalization replay over historical focus experiments. No new inference; 364 labelled rows, one without a visual output. All scored outputs are preserved; ambiguity changes are explicit.',
      summary,
      differences,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log(JSON.stringify({ summary, differences }));
