// Out-of-sample check of the threshold fit (packages/core/v2/crossval.ts). Reads the same files as
// scripts/v2-calibrate.ts; the labels need a `group` (source) per photograph and may carry a `domain`.
//
//   npx tsx scripts/v2-crossval.ts --scores <scores.jsonl> --labels <labels.json> [--keep 0.98]
//        [--wrongBlock 0.01] [--folds 5] [--repeats 50] [--seed 1] [--scorer local_logprob]
//        [--out report.json]
//
// Prints: the in-sample fit, repeated grouped k-fold counts, and two transfers (fit without gear,
// count on gear; fit on gear only, count on the rest).
import fs from 'node:fs/promises';
import { z } from 'zod';
import { fitBand, wilson } from '../packages/core/v2/calibration';
import { crossValidate, transfer, type GroupedExample } from '../packages/core/v2/crossval';
import { PhotoScoresSchema } from '../packages/core/v2/schema';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]!;
  if (a.startsWith('--')) {
    const next = process.argv[i + 1];
    args.set(a.slice(2), next && !next.startsWith('--') ? (i++, next) : 'true');
  }
}
const need = (k: string) => {
  const v = args.get(k);
  if (!v) throw new Error('missing --' + k);
  return v;
};
const labels = z
  .array(
    z.object({
      photoId: z.string(),
      damaged: z.enum(['yes', 'no', 'unsure']),
      group: z.string(),
      domain: z.string().optional(),
    }),
  )
  .parse(JSON.parse(await fs.readFile(need('labels'), 'utf8')));
const byId = new Map(labels.map((l) => [l.photoId, l]));
const scorerId = args.get('scorer');
const scores = (await fs.readFile(need('scores'), 'utf8'))
  .split('\n')
  .filter(Boolean)
  .map((line) => PhotoScoresSchema.parse(JSON.parse(line)))
  .filter((s) => !scorerId || s.scorer.id === scorerId);
if (new Set(scores.map((s) => s.scorer.id + '/' + s.scorer.model)).size > 1)
  throw new Error('scores mix scorers; pass --scorer');
const yes = (s: (typeof scores)[number], key: string) => {
  const a = s.answers[key];
  return a?.type === 'yesno' ? a.p : null;
};
// The same damage score the calibration and the policy use: the larger of the two damage questions.
const examples: GroupedExample[] = [];
for (const s of scores) {
  const label = byId.get(s.photoId);
  const broken = yes(s, 'broken'),
    road = yes(s, 'road_contact');
  if (!label || label.damaged === 'unsure' || (broken === null && road === null)) continue;
  examples.push({
    id: s.photoId,
    damaged: label.damaged === 'yes',
    score: Math.max(broken ?? 0, road ?? 0),
    group: label.group,
    domain: label.domain,
  });
}
const keep = Number(args.get('keep') ?? 0.98),
  wrongBlock = Number(args.get('wrongBlock') ?? 0.01);
const inSample = fitBand(examples, { keep, wrongBlock });
const cv = crossValidate(examples, {
  folds: Number(args.get('folds') ?? 5),
  repeats: Number(args.get('repeats') ?? 50),
  seed: Number(args.get('seed') ?? 1),
  keep,
  wrongBlock,
});
const gear = examples.filter((e) => e.domain === 'gear'),
  rest = examples.filter((e) => e.domain !== 'gear');
const toGear = rest.length && gear.length ? transfer(rest, gear, { keep, wrongBlock }) : null;
const toRest =
  gear.some((e) => e.damaged) && gear.some((e) => !e.damaged) && rest.length
    ? transfer(gear, rest, { keep, wrongBlock })
    : null;
const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + '%' : 'n/a');
const ci = (n: number, d: number) =>
  wilson(n, d)
    .map((v) => (100 * v).toFixed(1) + '%')
    .join(' to ');
const lines: string[] = [];
const scorerLabel = scores[0] ? scores[0].scorer.id + ' ' + scores[0].scorer.model : 'none';
lines.push(
  `scorer ${scorerLabel}; ${examples.length} labelled photographs (${examples.filter((e) => e.damaged).length} damaged, ${examples.filter((e) => !e.damaged).length} clean) in ${new Set(examples.map((e) => e.group)).size} source groups; keep ${keep}, wrongBlock ${wrongBlock}`,
);
lines.push(
  `in-sample: clear ${inSample.clear}, block ${inSample.block}; damaged cleared ${inSample.damagedCleared}/${inSample.damaged} (${ci(inSample.damagedCleared, inSample.damaged)}), clean blocked ${inSample.cleanBlocked}/${inSample.clean} (${ci(inSample.cleanBlocked, inSample.clean)})`,
);
const p = cv.pooled,
  per = cv.perRepeat;
const range = (k: keyof (typeof per)[number]) =>
  Math.min(...per.map((r) => r[k])) + ' to ' + Math.max(...per.map((r) => r[k]));
const clears = cv.bands.map((b) => b.clear).sort((a, b) => a - b),
  blocks = cv.bands.map((b) => b.block).sort((a, b) => a - b);
const q = (v: number[], f: number) => v[Math.min(v.length - 1, Math.floor(f * v.length))]!;
lines.push(
  `grouped ${cv.folds}-fold x ${cv.repeats} (seed ${cv.seed}, ${cv.skippedFolds} folds skipped):`,
  `  damaged: cleared ${pct(p.damagedCleared, p.damaged)} (per repeat ${range('damagedCleared')} of ${p.damaged / cv.repeats}), review ${pct(p.damagedReview, p.damaged)}, blocked ${pct(p.damagedBlocked, p.damaged)}`,
  `  clean:   cleared ${pct(p.cleanCleared, p.clean)}, review ${pct(p.cleanReview, p.clean)}, blocked ${pct(p.cleanBlocked, p.clean)} (per repeat ${range('cleanBlocked')} of ${p.clean / cv.repeats})`,
  `  fitted clear: median ${q(clears, 0.5)}, 10th to 90th percentile ${q(clears, 0.1)} to ${q(clears, 0.9)}; block: median ${q(blocks, 0.5)}, ${q(blocks, 0.1)} to ${q(blocks, 0.9)}`,
);
for (const [domain, c] of Object.entries(cv.byDomain).sort())
  lines.push(
    `  [${domain}] damaged cleared ${pct(c.damagedCleared, c.damaged)}, review ${pct(c.damagedReview, c.damaged)}, blocked ${pct(c.damagedBlocked, c.damaged)}; clean cleared ${pct(c.cleanCleared, c.clean)}, review ${pct(c.cleanReview, c.clean)}, blocked ${pct(c.cleanBlocked, c.clean)} (n per repeat ${c.damaged / cv.repeats} + ${c.clean / cv.repeats})`,
  );
for (const [name, t] of [
  ['fit without gear, count on gear', toGear],
  ['fit on gear only, count on the rest', toRest],
] as const)
  if (t)
    lines.push(
      `${name}: clear ${t.band.clear}, block ${t.band.block}; damaged cleared ${t.counts.damagedCleared}/${t.counts.damaged}, review ${t.counts.damagedReview}, blocked ${t.counts.damagedBlocked}; clean cleared ${t.counts.cleanCleared}/${t.counts.clean}, review ${t.counts.cleanReview}, blocked ${t.counts.cleanBlocked}`,
    );
console.log(lines.join('\n'));
if (args.get('out'))
  await fs.writeFile(
    args.get('out')!,
    JSON.stringify(
      {
        scorer: scorerLabel,
        keep,
        wrongBlock,
        inSample,
        crossValidation: { ...cv, bands: undefined, perRepeat: cv.perRepeat },
        fittedBands: { clear: clears, block: blocks },
        transfer: { withoutGearToGear: toGear, gearToRest: toRest },
        text: lines,
      },
      null,
      1,
    ) + '\n',
  );
