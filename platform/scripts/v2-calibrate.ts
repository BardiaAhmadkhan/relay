// Fit the policy thresholds from labelled score records. No model is trained; two numbers per band are chosen.
//
//   npx tsx scripts/v2-calibrate.ts --scores <scores.jsonl> --labels <labels.json> --out <thresholds.json>
//        [--keep 0.97] [--wrongBlock 0.02] [--version name] [--force] [--only-domain gear]
//        [--merge existing-thresholds.json]
//
// scores.jsonl: one PhotoScores object per line (packages/core/v2/schema.ts).
// labels.json:  [{ "photoId": "...", "damaged": "yes|no|unsure", "repair": "yes|no|unsure" (optional),
//                  "domain": "..." (optional) }]
// `damaged` answers one question: does the photograph show broken material or road-contact damage?
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  auc,
  fitBand,
  MIN_EXAMPLES_PER_CLASS,
  type LabelledScore,
} from '../packages/core/v2/calibration';
import { PhotoScoresSchema, ThresholdsSchema, type Thresholds } from '../packages/core/v2/schema';

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
const LabelSchema = z.array(
  z.object({
    photoId: z.string(),
    damaged: z.enum(['yes', 'no', 'unsure']),
    repair: z.enum(['yes', 'no', 'unsure']).optional(),
    domain: z.string().optional(),
  }),
);
const labels = LabelSchema.parse(JSON.parse(await fs.readFile(need('labels'), 'utf8')));
const onlyDomain = args.get('only-domain');
const byId = new Map(
  labels.filter((l) => !onlyDomain || l.domain === onlyDomain).map((l) => [l.photoId, l]),
);
// --scores accepts several files separated by commas (for example one per scorer).
const scores = (
  await Promise.all(
    need('scores')
      .split(',')
      .map((file) => fs.readFile(file.trim(), 'utf8')),
  )
)
  .flatMap((text) => text.split('\n'))
  .filter(Boolean)
  .map((line) => PhotoScoresSchema.parse(JSON.parse(line)));
const batteries = new Set(scores.map((s) => s.batteryVersion));
if (batteries.size !== 1)
  throw new Error('scores mix battery versions: ' + [...batteries].join(', '));
const p = (s: (typeof scores)[number], key: string) => {
  const a = s.answers[key];
  return a?.type === 'yesno' ? a.p : null;
};
const keep = Number(args.get('keep') ?? 0.97),
  wrongBlock = Number(args.get('wrongBlock') ?? 0.02);
// --merge keeps the bands of scorers that are not in this run (for example the local scorer's bands
// when only the hosted scorer is being calibrated). Only allowed for the same battery version.
const previous = args.get('merge')
  ? ThresholdsSchema.parse(JSON.parse(await fs.readFile(args.get('merge')!, 'utf8')))
  : null;
if (previous && previous.batteryVersion !== [...batteries][0])
  throw new Error('--merge thresholds were fitted for another battery version');
const perScorer: Thresholds['perScorer'] = { ...previous?.perScorer };
const report: Record<string, unknown> = {};
let lowEvidence = false;
for (const scorer of new Set(scores.map((s) => s.scorer.id))) {
  const mine = scores.filter((s) => s.scorer.id === scorer);
  const damage: LabelledScore[] = [],
    repair: LabelledScore[] = [];
  for (const s of mine) {
    const label = byId.get(s.photoId);
    if (!label) continue;
    const broken = p(s, 'broken'),
      road = p(s, 'road_contact'),
      rep = p(s, 'repair');
    if (label.damaged !== 'unsure' && (broken !== null || road !== null))
      damage.push({
        id: s.photoId,
        damaged: label.damaged === 'yes',
        score: Math.max(broken ?? 0, road ?? 0),
      });
    if (label.repair && label.repair !== 'unsure' && rep !== null)
      repair.push({ id: s.photoId, damaged: label.repair === 'yes', score: rep });
  }
  const damageFit = fitBand(damage, { keep, wrongBlock });
  const repairs = repair.filter((e) => e.damaged).length;
  // A repair band can only be fitted when labelled repairs exist. Otherwise keep a stated default and say so.
  const repairFit =
    repairs >= MIN_EXAMPLES_PER_CLASS && repair.length - repairs >= MIN_EXAMPLES_PER_CLASS
      ? fitBand(repair, { keep, wrongBlock })
      : null;
  perScorer[scorer] = {
    damage: { clear: damageFit.clear, block: damageFit.block },
    repair: repairFit
      ? { clear: repairFit.clear, block: repairFit.block }
      : {
          clear: Number(args.get('repairClear') ?? 0.3),
          block: Number(args.get('repairBlock') ?? 0.85),
        },
  };
  lowEvidence ||= damageFit.lowEvidence;
  report[scorer] = {
    model: [...new Set(mine.map((s) => s.scorer.model))],
    damage: { auc: +auc(damage).toFixed(4), ...damageFit },
    repair: repairFit
      ? { auc: +auc(repair).toFixed(4), ...repairFit }
      : { fitted: false, labelledRepairs: repairs, note: 'default band; not validated' },
  };
}
if (lowEvidence && args.get('force') !== 'true')
  throw new Error(
    'Fewer than ' +
      MIN_EXAMPLES_PER_CLASS +
      ' damaged or clean examples. Pass --force to write thresholds that cap every outcome at review.',
  );
const thresholds = ThresholdsSchema.parse({
  version:
    args.get('version') ??
    'calibrated-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'),
  batteryVersion: [...batteries][0],
  source:
    need('scores')
      .split(',')
      .map((f) => path.basename(f.trim()))
      .join(' + ') +
    ' + ' +
    path.basename(need('labels')) +
    '; keep ' +
    keep +
    ', wrongBlock ' +
    wrongBlock +
    (onlyDomain ? '; domain ' + onlyDomain : ''),
  lowEvidence,
  perScorer,
  usableMin: 0.5,
  gearMin: 0.5,
  singleItemMin: 0.5,
  categoryMin: 0.6,
  zoneMin: 0.5,
  labelLegibleMin: 0.5,
});
const out = need('out');
await fs.writeFile(out, JSON.stringify(thresholds, null, 2) + '\n');
await fs.writeFile(
  out.replace(/\.json$/, '') + '.report.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify({ thresholds, report }, null, 2));
