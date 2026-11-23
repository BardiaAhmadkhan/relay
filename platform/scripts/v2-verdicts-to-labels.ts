// Turn the expert console's verdicts (work package 12) into calibration input.
//
//   npx tsx scripts/v2-verdicts-to-labels.ts [--verdicts data/verdicts.jsonl] [--out data/verdict]
//
// Writes <out>.scores.jsonl (one PhotoScores per garment photograph) and <out>.labels.json (the
// expert's own marks, grouped by assessment so cross-validation holds a whole item out at once). The
// latest verdict per assessment wins. Then:
//   npx tsx scripts/v2-calibrate.ts --scores data/verdict.scores.jsonl --labels data/verdict.labels.json --out <thresholds.json>
//   npx tsx scripts/v2-crossval.ts  --scores data/verdict.scores.jsonl --labels data/verdict.labels.json
import fs from 'node:fs/promises';
import { PhotoScoresSchema } from '../packages/core/v2/schema';
import { verdictsToCalibration, type VerdictLine } from '../server/review-v2';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]!;
  if (a.startsWith('--')) {
    const next = process.argv[i + 1];
    args.set(a.slice(2), next && !next.startsWith('--') ? (i++, next) : 'true');
  }
}
const input = args.get('verdicts') ?? 'data/verdicts.jsonl',
  out = args.get('out') ?? 'data/verdict';
const lines = (await fs.readFile(input, 'utf8'))
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as VerdictLine);
const { assessments, scores, labels } = verdictsToCalibration(lines);
await fs.writeFile(
  out + '.scores.jsonl',
  scores.map((s) => JSON.stringify(PhotoScoresSchema.parse(s))).join('\n') +
    (scores.length ? '\n' : ''),
);
await fs.writeFile(out + '.labels.json', JSON.stringify(labels, null, 1) + '\n');
const n = (k: 'damaged' | 'repair', v: string) => labels.filter((l) => l[k] === v).length;
console.log(
  JSON.stringify({
    assessments,
    photographs: labels.length,
    damaged: n('damaged', 'yes'),
    clean: n('damaged', 'no'),
    unsure: n('damaged', 'unsure'),
    repairs: n('repair', 'yes'),
    out,
  }),
);
