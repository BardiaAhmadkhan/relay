import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  normalizeEvidenceClaims,
  isWhollyNegativeEvidence,
} from '../packages/vision/evidence-contract';
import { canFocusTear } from '../experiments/quality-cycle-02/focused-tear-context';
const sets = [
  ['audit', 'focus-context-audit', 'datasets/quality-audit-01/labels.json'],
  ['hard', 'focus-context-hard', 'experiments/round-05/hard-case-protocol.json'],
  ['fresh', 'focus-context-fresh', 'datasets/quality-cycle-02/labels.json'],
  ['final', 'focus-context-final-five', 'datasets/quality-cycle-02/final-holdout-labels.json'],
];
const oldReview = JSON.parse(
  await fs.readFile('benchmarks/quality-audit-01/summary.json', 'utf8'),
).correspondenceReview;
const repaired = new Set(['commons-087', 'commons-090', 'fabric-049']);
const freshPartial = new Set([
  'fresh-commons-007',
  'fresh-fabric-023',
  'fresh-fabric-031',
  'fresh-fabric-040',
]);
const freshMissed = new Set(['fresh-commons-016']);
const rows: any[] = [];
const routeChanges: any[] = [];
const structure =
  /\b(?:tear|torn|hole|rip|fray|abrasion|abraded|scrap|scuff|expos|broken|split|sever|rough|missing|separat|crack)\w*/i;
const wearable = new Set([
  'motorcycle_jacket',
  'trousers',
  'gloves',
  'boots',
  'helmet',
  'multiple',
]);
for (const [set, name, labelFile] of sets) {
  const labels = JSON.parse(await fs.readFile(labelFile!, 'utf8')).cases;
  const recorded = (await fs.readFile('benchmarks/quality-cycle-02/' + name + '.jsonl', 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  for (const r of recorded) {
    assert(!r.error, 'Inference failed: ' + r.id);
    const c = labels.find((c: any) => c.id === r.id);
    assert(c);
    if (!r.baseline) {
      rows.push({ ...r, set, reference: c });
      continue;
    }
    const base = r.baseline,
      candidate = normalizeEvidenceClaims(r.recovery ? r.candidate : base),
      view = set === 'hard' ? 'front' : c.view;
    // Reconstruct the original eligibility from its recorded normalization decisions.
    const oldEligible =
      view !== 'label' &&
      (!base.findings.length
        ? wearable.has(base.category)
        : base.findings.every(
            (f: any) =>
              ['other', 'seam'].includes(f.kind) &&
              !structure.test(f.evidence) &&
              !isWhollyNegativeEvidence(f.evidence) &&
              r.claimOnly.findings.some((kept: any) => JSON.stringify(kept) === JSON.stringify(f)),
          ) && base.findings.some((f: any) => /\b(?:line|linear|seam)\b/i.test(f.evidence)));
    const newEligible = canFocusTear(base, view);
    if (oldEligible !== newEligible) routeChanges.push({ set, id: r.id, oldEligible, newEligible });
    const baselineFlag = base.findings.length > 0,
      candidateFlag = candidate.findings.length > 0;
    assert(
      !(r.condition === 'visible_defect' && baselineFlag && !candidateFlag),
      'Lost positive alert ' + r.id,
    );
    assert(!(r.condition === 'no_visible_defect' && r.recovery), 'False recovery ' + r.id);
    assert(
      !(r.condition === 'no_visible_defect' && !baselineFlag && candidateFlag),
      'New false flag ' + r.id,
    );
    let correspondenceBefore: string | null = null,
      correspondenceAfter: string | null = null;
    if (set === 'audit') {
      correspondenceBefore = oldReview.find((x: any) => x.id === r.id)?.correspondence ?? null;
      correspondenceAfter = repaired.has(r.id) && r.recovery ? 'matched' : correspondenceBefore;
      if (correspondenceBefore === 'matched')
        assert.deepEqual(candidate, base, 'Matched evidence altered ' + r.id);
    }
    if ((set === 'fresh' || set === 'final') && r.condition === 'visible_defect') {
      correspondenceBefore =
        set === 'final'
          ? 'partial'
          : freshMissed.has(r.id)
            ? 'missed'
            : freshPartial.has(r.id)
              ? 'partial'
              : 'matched';
      correspondenceAfter = correspondenceBefore;
      assert.deepEqual(candidate, base, 'Fresh positive evidence altered ' + r.id);
    }
    rows.push({
      ...r,
      set,
      reference: c,
      baseline: base,
      candidate,
      baselineFlag,
      candidateFlag,
      correspondenceBefore,
      correspondenceAfter,
    });
  }
}
assert.equal(
  routeChanges.length,
  0,
  'Candidate routing changed; new inference is required: ' + JSON.stringify(routeChanges),
);
const metrics: any = {};
for (const set of sets.map((s) => s[0])) {
  const group = rows.filter((r) => r.set === set),
    positive = group.filter((r) => r.condition === 'visible_defect'),
    negative = group.filter((r) => r.condition === 'no_visible_defect');
  metrics[set!] = {
    cases: group.length,
    positives: positive.length,
    negatives: negative.length,
    ambiguous: group.filter((r) => r.condition === 'ambiguous').length,
    unassessable: group.filter((r) => r.condition === 'unassessable').length,
    baselineFalseFlags: negative.filter((r) => r.baselineFlag).length,
    candidateFalseFlags: negative.filter((r) => r.candidateFlag).length,
    baselinePositiveAlerts: positive.filter((r) => r.baselineFlag).length,
    candidatePositiveAlerts: positive.filter((r) => r.candidateFlag).length,
    baselineCorrespondence: positive.reduce(
      (a: any, r) => (
        (a[r.correspondenceBefore ?? 'unreviewed'] =
          (a[r.correspondenceBefore ?? 'unreviewed'] ?? 0) + 1),
        a
      ),
      {},
    ),
    candidateCorrespondence: positive.reduce(
      (a: any, r) => (
        (a[r.correspondenceAfter ?? 'unreviewed'] =
          (a[r.correspondenceAfter ?? 'unreviewed'] ?? 0) + 1),
        a
      ),
      {},
    ),
    attempted: group.filter((r) => r.attempted).length,
    recoveries: group.filter((r) => r.recovery).map((r) => r.id),
    fallbacks: group
      .filter((r) => r.trace?.fallback)
      .map((r) => ({ id: r.id, reason: r.trace.fallback })),
  };
}
const output = {
  at: new Date().toISOString(),
  scope:
    'Final conservative normalization replay over frozen actual outputs plus previously executed live context-aware recovery. Routing equality checked. Fresh-59 informed a conservative uncertainty fix and is no longer untouched for the final normalization; final five were sealed before inference.',
  metrics,
  routeChanges,
  rows,
  sourceHashes: await Promise.all(
    [
      'packages/vision/evidence-contract.ts',
      'experiments/quality-cycle-02/focused-tear-context.ts',
      'experiments/quality-cycle-02/focused-context-inspection.ts',
    ].map(async (path) => ({
      path,
      sha256: createHash('sha256')
        .update(await fs.readFile(path))
        .digest('hex'),
    })),
  ),
};
await fs.writeFile(
  'benchmarks/quality-cycle-02/final-evaluation.json',
  JSON.stringify(output, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(JSON.stringify(metrics, null, 2));
