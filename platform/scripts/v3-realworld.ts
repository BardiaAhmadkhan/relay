// E19: the v3 engine on real-world gear photographs, end to end.
//
//   npx tsx scripts/v3-realworld.ts [--labels datasets/realworld-v3/labels.json] [--engine v3|v2]
//
// Every labelled photograph goes through the real service (createAppV2) with the real local model over a
// real socket, as the view it shows (whole item: front; close-up: detail; label: label). Records what a
// rider and a shop would see: the damage band the record reaches under the shipped thresholds, the
// category answer, the retake hints, and time and input tokens per photograph. Before each photograph
// the GPU temperature is read; at `--cool` C or more (default 70) the run waits until it is `--resume` C
// (default 62). The laptop reached 89 C on long 1600 px runs (experiment report E18). One front photograph
// at 1600 px raises the GPU by 10 to 15 C, and with 80/72, then 76/68, this run still peaked at 86 C, one
// degree under the guard's stop line. Idle, the GPU cools by 20 C within seconds, so pausing early is cheap.
// `npm run vision:serve` must be running.
//
// `outcome` is what a rider would be told if this photograph were the whole assessment: decide2 with a
// clean reported history (three clear "no" answers) and this photograph's view as the only required
// view. It is the shipped rule order on real output, not a new rule. Every raw answer is kept too.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  PolicyConfigSchema,
  ThresholdsSchema,
  type PhotoRecord,
  type PhotoScores,
} from '../packages/core/v2/schema';
import { decide2 } from '../packages/core/v2/policy';
import { Questions } from '../packages/core/schema';
import { ScorerChain } from '../packages/vision/v2/scorer-chain';
import { createLocalLogprobScorer, RecyclingScorer } from '../packages/vision/v2/scorer-local';
import { PlannedScorer } from '../packages/vision/v2/plan';
import { GARMENT_QUESTIONS } from '../packages/vision/v2/battery';
import { createAppV2 } from '../server/app-v2';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]!;
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[++i] ?? 'true');
}
const root = path.resolve(import.meta.dirname, '..');
const read = async (p: string) => JSON.parse(await fs.readFile(path.join(root, p), 'utf8'));
const engine = args.get('engine') ?? 'v3';
const cool = Number(args.get('cool') ?? 70),
  resume = Number(args.get('resume') ?? 62);
const labelsFile = args.get('labels') ?? 'datasets/realworld-v3/labels.json';
const thresholds = ThresholdsSchema.parse(await read('packages/core/v2/thresholds.json'));
const stage1 = ThresholdsSchema.parse(await read('packages/core/v2/thresholds.cascade512.json'));
const config = PolicyConfigSchema.parse(await read('packages/core/v2/policy.config.json'));
const policy = thresholds.perScorer.local_logprob!;
type Case = {
  id: string;
  file: string;
  condition: string;
  subject: string;
  framing: string;
  view: 'front' | 'back' | 'detail' | 'label';
  group: string;
};
const cases: Case[] = (await read(labelsFile)).cases;
const local = await createLocalLogprobScorer();
const app = createAppV2({
  chain: new ScorerChain(
    [
      engine === 'v3'
        ? new RecyclingScorer(
            new PlannedScorer(
              local,
              (id) => thresholds.perScorer[id],
              (id) => stage1.perScorer[id],
            ),
            () => local.unload(),
            20,
          )
        : new RecyclingScorer(local, () => local.unload(), 20),
    ],
    { cacheTtlMs: 0 },
  ),
  thresholds,
  config,
  signingKey: 'realworld-test-signing-key-0123456789abcdef',
  workingEdge: 1600,
  planned: engine === 'v3',
  lowEdge: engine === 'v3' ? 512 : undefined,
});
const temp = () => {
  try {
    return Number(
      execFileSync('nvidia-smi', ['--query-gpu=temperature.gpu', '--format=csv,noheader,nounits'], {
        timeout: 4000,
      })
        .toString()
        .trim(),
    );
  } catch {
    return null;
  }
};
// --out writes elsewhere (E12d re-scores photographs with the runtime's prompt cache off and compares
// them with E19's rows); --only takes a comma-separated list of ids.
const out = path.join(
  root,
  'benchmarks',
  'backend-v2',
  args.get('out') ?? `realworld--${engine}.jsonl`,
);
const only = args.has('only') ? new Set(args.get('only')!.split(',')) : null;
const done = new Set(
  (await fs.readFile(out, 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l).id),
);
const address = await app.listen({ host: '127.0.0.1', port: 0 });
await local
  .score(
    { jpeg: await fs.readFile(path.join(root, cases[0]!.file)) },
    [GARMENT_QUESTIONS[5]!],
    AbortSignal.timeout(120_000),
  )
  .catch(() => undefined);
const yes = (s: PhotoScores, k: string) => {
  const a = s.answers[k];
  return a?.type === 'yesno' ? a.p : null;
};
const s1 = stage1.perScorer.local_logprob!.damage;
/** The cascade's own rule: the larger raw 512 px damage answer in the first-stage review band. */
const escalated = (s: PhotoScores) => {
  if (!s.answers.broken_low) return false;
  const low = Math.max(yes(s, 'broken_low') ?? 0, yes(s, 'road_contact_low') ?? 0);
  return low >= s1.clear && low < s1.block;
};
let n = 0;
for (const c of cases) {
  if (done.has(c.id) || (only && !only.has(c.id))) continue;
  let t = temp();
  if (t !== null && t >= cool)
    while (t !== null && t > resume) {
      await new Promise((r) => setTimeout(r, 5000));
      t = temp();
    }
  const base64 = (await fs.readFile(path.join(root, c.file))).toString('base64');
  const started = performance.now();
  const response = await fetch(address + '/v2/photos/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: '2.0',
      assessmentId: 'realworld',
      photoId: c.id,
      view: c.view,
      base64,
    }),
  });
  const ms = Math.round(performance.now() - started);
  const body = await response.json();
  if (!response.ok) {
    await fs.appendFile(
      out,
      JSON.stringify({ id: c.id, error: body?.error?.code ?? response.status, ms }) + '\n',
    );
    continue;
  }
  const s: PhotoScores = body.signed.scores;
  const damage = Math.max(yes(s, 'broken') ?? 0, yes(s, 'road_contact') ?? 0);
  const category = s.answers.category;
  const recordedAt = new Date().toISOString();
  const decision = decide2({
    disclosures: Questions.map((question) => ({
      id: c.id + '-' + question,
      question,
      answer: 'no' as const,
      recordedAt,
    })),
    photos: [body.photo as PhotoRecord],
    scores: [s],
    closeUpsRequested: 0,
    thresholds,
    config: { ...config, requiredViews: [c.view] },
  });
  const answers = Object.fromEntries(
    Object.entries(s.answers).map(([k, a]) => [
      k,
      a.type === 'yesno'
        ? +a.p.toFixed(4)
        : a.type === 'choice'
          ? a.choice + ':' + (a.probabilities[a.choice] ?? 0).toFixed(3)
          : +a.score.toFixed(3),
    ]),
  );
  await fs.appendFile(
    out,
    JSON.stringify({
      id: c.id,
      engine,
      condition: c.condition,
      subject: c.subject,
      framing: c.framing,
      view: c.view,
      ms,
      tokens: s.usage.inputTokens,
      questions: Object.keys(s.answers).length,
      damage: +damage.toFixed(4),
      band:
        damage < policy.damage.clear ? 'clear' : damage < policy.damage.block ? 'review' : 'block',
      escalated: escalated(s),
      category: category?.type === 'choice' ? category.choice : null,
      gear: yes(s, 'gear'),
      singleItem: yes(s, 'single_item'),
      usable: yes(s, 'usable'),
      labelLegible: yes(s, 'label_legible'),
      feedback: (body.feedback ?? []).map((f: { code: string }) => f.code),
      soft: body.photo.quality.warnings.includes('soft'),
      warnings: body.photo.quality.warnings,
      outcome: decision.outcome,
      reasons: decision.reasons.map((r) => r.code),
      resolvedCategory: decision.category,
      grade: decision.grade,
      answers,
    }) + '\n',
  );
  if (++n % 20 === 0) console.log(n + ' scored');
}
await app.close();
await local.unload();
console.log('done', out);
