import { randomBytes } from 'node:crypto';
// v2 against v3, live: the real local model, the real HTTP service, the same photographs.
//
//   npx tsx scripts/v3-live-compare.ts [--n 30]
//
// Starts the service twice in this process on a free port each, with the local scorer
// (`npm run vision:serve` must be running):
//   v2  the whole battery on every photograph at 1600 px (the size the shipped thresholds were fitted
//       at), the service's own zone call when damage reaches the clear band
//   v3  the question plan, the 512 px first stage with 1600 px escalation, model recycling
// Sends the same labelled photographs (half damaged, half clean, picked deterministically) as front
// views over real sockets, and records wall time per photograph, the input tokens, and the damage band
// each engine's record reaches under the shipped thresholds.
import fs from 'node:fs/promises';
import path from 'node:path';
import { PolicyConfigSchema, ThresholdsSchema, type PhotoScores } from '../packages/core/v2/schema';
import { ScorerChain } from '../packages/vision/v2/scorer-chain';
import { createLocalLogprobScorer, RecyclingScorer } from '../packages/vision/v2/scorer-local';
import { PlannedScorer } from '../packages/vision/v2/plan';
import { GARMENT_QUESTIONS } from '../packages/vision/v2/battery';
import { createAppV2 } from '../server/app-v2';

const comparisonSigningKey = randomBytes(32).toString('hex');

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]!;
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[++i] ?? 'true');
}
const n = Number(args.get('n') ?? 30);
const root = path.resolve(import.meta.dirname, '..');
const read = async (p: string) => JSON.parse(await fs.readFile(path.join(root, p), 'utf8'));
const thresholds = ThresholdsSchema.parse(await read('packages/core/v2/thresholds.json'));
const stage1 = ThresholdsSchema.parse(await read('packages/core/v2/thresholds.cascade512.json'));
const config = PolicyConfigSchema.parse(await read('packages/core/v2/policy.config.json'));
const policy = thresholds.perScorer.local_logprob!;
const labels: Array<{ photoId: string; damaged: string; domain: string; file: string }> =
  await read('benchmarks/backend-v2/labels--corpus-261.json');
const pick = (damaged: string) =>
  labels
    .filter((l) => l.damaged === damaged)
    .filter((_, i, all) => i % Math.floor(all.length / (n / 2)) === 0)
    .slice(0, n / 2);
const photos = [...pick('yes'), ...pick('no')];
const local = await createLocalLogprobScorer();
const engines = {
  v2: createAppV2({
    chain: new ScorerChain([local], { cacheTtlMs: 0 }),
    thresholds,
    config,
    signingKey: comparisonSigningKey,
    workingEdge: 1600,
  }),
  v3: createAppV2({
    chain: new ScorerChain(
      [
        new RecyclingScorer(
          new PlannedScorer(
            local,
            (id) => thresholds.perScorer[id],
            (id) => stage1.perScorer[id],
          ),
          () => local.unload(),
          25,
        ),
      ],
      { cacheTtlMs: 0 },
    ),
    thresholds,
    config,
    signingKey: comparisonSigningKey,
    workingEdge: 1600,
    planned: true,
    lowEdge: 512,
  }),
};
const yes = (s: PhotoScores, k: string) => {
  const a = s.answers[k];
  return a?.type === 'yesno' ? a.p : 0;
};
const band = (s: PhotoScores) => {
  const d = Math.max(yes(s, 'broken'), yes(s, 'road_contact'));
  return d < policy.damage.clear ? 'clear' : d < policy.damage.block ? 'review' : 'block';
};
type Row = {
  id: string;
  damaged: boolean;
  engine: string;
  ms: number;
  questions: number;
  tokens: number;
  band: string;
};
const rows: Row[] = [];
for (const [name, app] of Object.entries(engines)) {
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  // Warm the model so the first photograph does not carry the load time.
  await local
    .score(
      { jpeg: await fs.readFile(path.join(root, photos[0]!.file)) },
      [GARMENT_QUESTIONS[5]!],
      AbortSignal.timeout(120_000),
    )
    .catch(() => undefined);
  for (const p of photos) {
    const base64 = (await fs.readFile(path.join(root, p.file))).toString('base64');
    const started = performance.now();
    const response = await fetch(address + '/v2/photos/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: '2.0',
        assessmentId: 'live',
        photoId: 'p-' + p.photoId.replace(/[^a-zA-Z0-9_-]/g, ''),
        view: 'front',
        base64,
      }),
    });
    const ms = performance.now() - started;
    if (!response.ok) {
      console.error(name, p.photoId, response.status, (await response.text()).slice(0, 200));
      continue;
    }
    const scores: PhotoScores = (await response.json()).signed.scores;
    rows.push({
      id: p.photoId,
      damaged: p.damaged === 'yes',
      engine: name,
      ms: Math.round(ms),
      questions: Object.keys(scores.answers).length,
      tokens: scores.usage.inputTokens,
      band: band(scores),
    });
  }
  await app.close();
  await local.unload();
}
const out = path.join(root, 'benchmarks', 'backend-v2', 'v3-live-compare.jsonl');
await fs.writeFile(out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;
for (const engine of ['v2', 'v3']) {
  const mine = rows.filter((r) => r.engine === engine);
  const count = (damaged: boolean, b: string) =>
    mine.filter((r) => r.damaged === damaged && r.band === b).length;
  console.log(
    `${engine}: ${mine.length} photographs | median ${med(mine.map((r) => r.ms))} ms, total ${(mine.reduce((s, r) => s + r.ms, 0) / 1000).toFixed(1)} s | median input tokens ${med(mine.map((r) => r.tokens))} | damaged clear/review/block ${count(true, 'clear')}/${count(true, 'review')}/${count(true, 'block')} | clean ${count(false, 'clear')}/${count(false, 'review')}/${count(false, 'block')}`,
  );
}
const agree = rows
  .filter((r) => r.engine === 'v2')
  .filter((r) => rows.find((s) => s.engine === 'v3' && s.id === r.id)?.band === r.band).length;
console.log(
  `same damage band in both engines: ${agree} of ${rows.filter((r) => r.engine === 'v2').length}`,
);
for (const r of rows.filter((x) => x.engine === 'v2')) {
  const v3 = rows.find((s) => s.engine === 'v3' && s.id === r.id);
  if (v3 && v3.band !== r.band)
    console.log(
      `  differs: ${r.id} (${r.damaged ? 'damaged' : 'clean'}) v2 ${r.band}, v3 ${v3.band}`,
    );
}
console.log('rows:', out);
