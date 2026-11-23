// Claude, 2026-11-20. LIVE end-to-end check of the promoted V3.5 count fallback (D-012 R2).
// Same as astra_integrated_r2.mjs (real server code, recorded 4B scores, the 10 routed E19 cases), but the
// count reader is the shipped configuredCountReader making real OpenAI calls. No GPU. About 10 paid calls.
// The API key is read from the git-ignored .env and never printed.
// Usage (from the repo root): node --import tsx research/analysis/claude_live_r2.mjs <output-folder>
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { createAppV2 } from '../../server/app-v2.ts';
import { signScores, ScorerChain } from '../../packages/vision/v2/scorer-chain.ts';
import { stubScorer, CLEAN_ITEM } from '../../server/stub-scorer.ts';
import { prepareImages } from '../../server/images.ts';
import { measureFocus, withFocus } from '../../server/focus.ts';
import { configuredCountReader } from '../../server/count-reader.ts';

const output = path.resolve(process.argv[2] ?? '.cache/r2-live-smoke');
fs.mkdirSync(output, { recursive: true });
const envLine = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith('OPENAI_API_KEY='));
const env = {
  RELAY_R2_ENABLED: '1',
  RELAY_R2_TERMS_COVERED: '1',
  RELAY_ALLOW_PAID: '1',
  OPENAI_API_KEY: envLine.slice('OPENAI_API_KEY='.length).trim(),
  RELAY_R2_DAILY_CALLS: '15',
  RELAY_R2_RESERVE_USD: '0.02',
  RELAY_R2_DAILY_USD: '0.5',
  RELAY_R2_LEDGER: path.join(output, 'ledger.sqlite'),
};
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const lines = (f) => fs.readFileSync(f, 'utf8').trim().split(/\r?\n/).map((l) => JSON.parse(l));
const hash = (b) => createHash('sha256').update(b).digest('hex');
const cases = read('research/analysis/r2-replay-output.json').results.filter((c) => c.routedR2);
const recorded = new Map(lines('benchmarks/backend-v2/realworld--v3.jsonl').map((r) => [r.id, r]));
const labels = new Map(read('datasets/realworld-v3/labels.json').cases.map((r) => [r.id, r]));
const earlier = new Map(lines('research/analysis/fallback-results/e19--gpt-6.2-sol.jsonl').map((r) => [r.id, r]));
const thresholds = read('packages/core/v2/thresholds.json');
const config = { ...read('packages/core/v2/policy.config.json'), requiredViews: ['front'] };
const model = 'qwen3.5:4b@d8b0f5e9760c cascade';
thresholds.perScorer.local_logprob.models = [model, model.replace(' cascade', '')];
const key = randomBytes(32).toString('hex');
const real = configuredCountReader(env, key);
assert(real, 'reader not configured');
const slim = (d) => ({ outcome: d.outcome, category: d.category, grade: d.grade, reasons: d.reasons.map((z) => z.code), requestPhoto: d.requestPhoto });
const banned = /openai|gpt-|\bsol\b|terra|third.?party|external provider/i;
const out = [];
for (const c of cases) {
  const r = recorded.get(c.id), source = labels.get(c.id);
  const req = { id: c.id, view: r.view, base64: fs.readFileSync(source.file).toString('base64') };
  const main = await prepareImages([req], 1600), sub = await prepareImages([req], 1024);
  const quality = withFocus(main.photos[0].quality, await measureFocus(sub.images[0].jpeg));
  const sha256 = main.photos[0].sha256;
  const answers = {};
  for (const [k, v] of Object.entries(r.answers)) {
    if (k === 'category') { const [choice, n] = v.split(':'); answers[k] = { type: 'choice', choice, probabilities: { [choice]: Number(n) } }; }
    else if (k === 'wear') answers[k] = { type: 'level', score: v, probabilities: [1, 0, 0, 0] };
    else if (typeof v === 'number') answers[k] = { type: 'yesno', p: ({ gear: r.gear, single_item: r.singleItem, usable: r.usable, label_legible: r.labelLegible }[k] ?? v) };
  }
  const score = { photoId: c.id, view: r.view, sha256, scorer: { id: 'local_logprob', model }, batteryVersion: 'gear-2', usage: { inputTokens: r.tokens, ms: r.ms }, scoredAt: '2026-11-20T00:00:00.000Z', answers };
  const payload = {
    schemaVersion: '2.0', assessmentId: 'live-' + c.id + '-' + Date.now(),
    disclosures: ['crash', 'protective_damage', 'protective_repair'].map((question) => ({ id: c.id + '-' + question, question, answer: 'no', recordedAt: score.scoredAt })),
    photos: [{ id: c.id, view: r.view, sha256, quality }], signedScores: [signScores(score, key)], closeUpsRequested: 0,
  };
  let calls = 0, live = null, ms = null;
  const spy = { async read(x, signal) { calls++; const t0 = performance.now(); live = await real.read(x, signal); ms = Math.round(performance.now() - t0); return live; } };
  const app = createAppV2({ chain: new ScorerChain([stubScorer({ answers: CLEAN_ITEM })]), workingEdge: 1600, planned: true, config, thresholds, signingKey: key, countReview: spy });
  const post = async (extra = {}) => { const v = await app.inject({ method: 'POST', url: '/v2/assess', payload: { ...payload, ...extra } }); assert.equal(v.statusCode, 200, v.body); return { json: v.json(), body: v.body }; };
  try {
    const before = await post();
    const after = await post({ countCheck: { notice: 'terms', photoId: c.id, base64: req.base64 } });
    const pass = ['one', 'matched_pair'].includes(live);
    const expected = pass ? c.countPass : c.before;
    const outcomeOk = JSON.stringify(slim(after.json.decision)) === JSON.stringify(expected) && JSON.stringify(slim(before.json.decision)) === JSON.stringify(c.before);
    let receiptReuse = null;
    if (pass && after.json.countReceipt) {
      const repeat = await post({ countReceipt: after.json.countReceipt });
      receiptReuse = JSON.stringify(repeat.json.decision) === JSON.stringify(after.json.decision) && calls === 1;
    }
    const leak = banned.test(after.body) || banned.test(before.body);
    out.push({ id: c.id, count: c.countLabel, liveLabel: live, earlierLabel: earlier.get(c.id)?.labels?.item_count, sameAsEarlier: live === earlier.get(c.id)?.labels?.item_count, providerMs: ms, calls, before: slim(before.json.decision).outcome, after: slim(after.json.decision).outcome, afterReasons: slim(after.json.decision).reasons, outcomeAsExpected: outcomeOk, receipt: !!after.json.countReceipt, receiptReuse, providerNameInResponse: leak });
    console.log(`${c.id} count=${c.countLabel} live=${live} (earlier ${earlier.get(c.id)?.labels?.item_count}) ${ms} ms: ${slim(before.json.decision).outcome} -> ${slim(after.json.decision).outcome} [${slim(after.json.decision).reasons.join(',')}] expected=${outcomeOk} receiptReuse=${receiptReuse} leak=${leak}`);
  } finally {
    await app.close();
  }
}
fs.writeFileSync(path.join(output, 'live-r2.json'), JSON.stringify({ when: new Date().toISOString(), model: 'gpt-6.2-sol (shipped reader)', cases: out }, null, 2) + '\n');
const ok = out.filter((x) => x.outcomeAsExpected).length;
console.log(`\nlive calls ${out.reduce((n, x) => n + x.calls, 0)}; outcomes as expected ${ok}/${out.length}; labels same as earlier test ${out.filter((x) => x.sameAsEarlier).length}/${out.length}; provider names in responses ${out.filter((x) => x.providerNameInResponse).length}`);
