import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { normalizeEvidenceClaims } from '../packages/vision/evidence-contract';
const sets = ['focus-context-audit', 'focus-context-hard', 'focus-context-fresh'];
let compared = 0;
const differences: any[] = [];
for (const name of sets) {
  const rows = (await fs.readFile('benchmarks/quality-cycle-02/' + name + '.jsonl', 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  for (const r of rows) {
    if (!r.baseline) continue;
    const revised = normalizeEvidenceClaims(r.baseline);
    if (JSON.stringify(revised) !== JSON.stringify(r.claimOnly))
      differences.push({
        set: name,
        id: r.id,
        condition: r.condition,
        before: r.claimOnly,
        after: revised,
      });
    if (r.condition === 'visible_defect')
      assert.deepEqual(revised, r.baseline, 'Positive evidence changed: ' + r.id);
    assert(
      revised.findings.every((f) =>
        r.baseline.findings.some((old: any) => JSON.stringify(f) === JSON.stringify(old)),
      ),
    );
    compared++;
  }
}
const report = {
  at: new Date().toISOString(),
  compared,
  differences,
  change:
    'Closed cosmetic vocabulary: unfamiliar descriptions and ambiguous spot-or-stain statements are preserved. This deliberately retains uncertain alerts rather than optimizing the audit count.',
  positiveEvidencePreserved: true,
  sourceSha256: createHash('sha256')
    .update(await fs.readFile('packages/vision/evidence-contract.ts'))
    .digest('hex'),
};
await fs.writeFile(
  'benchmarks/quality-cycle-02/closed-vocabulary-equivalence.json',
  JSON.stringify(report, null, 2) + '\n',
  { flag: 'wx' },
);
console.log({
  compared,
  differences: differences.map((d) => d.id),
  positiveEvidencePreserved: true,
});
