/** Owner-authorized R2 acceptance. Real OpenAI call through the normal V3.5 endpoint.
 * Requires the pre-provisioned local SQLite ledger. Repeating this experiment never
 * allocates new tickets. No photographs, provider secrets or complete responses are saved. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createAppV2 } from '../../server/app-v2.ts';
import { configuredCountReader, PROTOCOL_HASH } from '../../server/count-reader.ts';
import { COUNT_MODEL } from '../../server/count-budget.ts';
import { signScores, ScorerChain } from '../../packages/vision/v2/scorer-chain.ts';
import { stubScorer, CLEAN_ITEM } from '../../server/stub-scorer.ts';
import { prepareImages } from '../../server/images.ts';
import { measureFocus, withFocus } from '../../server/focus.ts';
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const rows = (file) => fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
const key = process.env.RELAY_SIGNING_KEY;
assert(key && key.length >= 32 && process.env.RELAY_R2_BUDGET_SCOPE === 'relay35-local-20261119');
const ledger = path.resolve(process.env.RELAY_R2_LEDGER);
assert(fs.existsSync(ledger));
const real = configuredCountReader(
  { ...process.env, RELAY_ALLOW_PAID: '1', RELAY_R2_ENABLED: '1', RELAY_R2_TERMS_COVERED: '1' },
  key,
);
assert(real);
const db = new DatabaseSync(ledger, { readOnly: true }),
  out = 'collab/baseline/v35-activation/live-acceptance.json';
assert(!fs.existsSync(out), 'Results already exist; use the saved evidence.');
const acceptedLicenses = /^(?:CC BY(?:-SA)? [\d.]+|CC0 [\d.]+|Public domain)$/i;
const cohort = ['cm-501', 'ox-083', 'ov-051', 'ov-066'];
const source = new Map(read('datasets/realworld-v3/labels.json').cases.map((r) => [r.id, r]));
const historical = new Map(rows('benchmarks/backend-v2/realworld--v3.jsonl').map((r) => [r.id, r]));
const prior = new Map(
  rows('research/analysis/fallback-results/e19--gpt-6.2-sol.jsonl').map((r) => [r.id, r]),
);
const frozen = new Map(read('research/analysis/r2-replay-output.json').results.map((r) => [r.id, r]));
const target = read('research/analysis/fallback-e19.json').items;
const model = 'qwen3.5:4b@d8b0f5e9760c cascade',
  thresholds = read('packages/core/v2/thresholds.json');
thresholds.perScorer.local_logprob.models = [model, model.replace(' cascade', '')];
const config = { ...read('packages/core/v2/policy.config.json'), requiredViews: ['front'] };
const slim = (d) => ({
  outcome: d.outcome,
  category: d.category,
  grade: d.grade,
  reasons: d.reasons.map((z) => z.code),
  requestPhoto: d.requestPhoto,
});
const count = () => Number(db.prepare('SELECT COUNT(*) n FROM count_attempt').get().n);
const report = {
  date: new Date().toISOString(),
  method:
    'Replay the frozen, previously observed 4B heads and the exact JPEG. Require real paid production response, exact full decision and stable receipt. Actual fresh 4B and mobile client are a separate experiment.',
  cases: [],
  accept: false,
};
try {
  for (const id of cohort) {
    const s = source.get(id),
      r = historical.get(id),
      old = prior.get(id),
      c = frozen.get(id),
      truth = target.find((x) => x.id === id);
    assert(
      acceptedLicenses.test(s.license) &&
        c.routedR2 &&
        old.ok &&
        ['one', 'pair', 'several'].includes(truth.count),
    );
    const b = fs.readFileSync(s.file),
      rawHash = createHash('sha256').update(b).digest('hex');
    assert.equal(rawHash, s.sha256);
    const raw = { id, view: r.view, base64: b.toString('base64') };
    const main = await prepareImages([raw], 1600),
      small = await prepareImages([raw], 1024),
      sha256 = main.photos[0].sha256;
    assert.equal(sha256, old.imageSha256);
    const quality = withFocus(main.photos[0].quality, await measureFocus(small.images[0].jpeg));
    assert.deepEqual(quality.warnings, r.warnings);
    const answers = {};
    for (const [k, v] of Object.entries(r.answers)) {
      if (k === 'category') {
        const [choice, n] = v.split(':');
        answers[k] = { type: 'choice', choice, probabilities: { [choice]: Number(n) } };
      } else if (k === 'wear')
        answers[k] = { type: 'level', score: v, probabilities: [1, 0, 0, 0] };
      else if (typeof v === 'number')
        answers[k] = {
          type: 'yesno',
          p:
            {
              gear: r.gear,
              single_item: r.singleItem,
              usable: r.usable,
              label_legible: r.labelLegible,
            }[k] ?? v,
        };
    }
    const scoredAt = '2026-11-20T00:00:00.000Z',
      assessmentId = 'activation-20261119-' + id;
    const signed = signScores(
      {
        photoId: id,
        view: r.view,
        sha256,
        scorer: { id: 'local_logprob', model },
        batteryVersion: 'gear-2',
        usage: { inputTokens: r.tokens, ms: r.ms },
        scoredAt,
        answers,
      },
      key,
    );
    const payload = {
      schemaVersion: '2.0',
      assessmentId,
      photos: [{ id, view: r.view, sha256, quality }],
      disclosures: ['crash', 'protective_damage', 'protective_repair'].map((question) => ({
        id: id + '-' + question,
        question,
        answer: 'no',
        recordedAt: scoredAt,
      })),
      signedScores: [signed],
      closeUpsRequested: 0,
    };
    const app = createAppV2({
      chain: new ScorerChain([stubScorer({ answers: CLEAN_ITEM })]),
      config,
      thresholds,
      workingEdge: 1600,
      planned: true,
      signingKey: key,
      countReview: { read: (x, signal) => real.read(x, signal) },
    });
    try {
      const post = async (extra = {}) => {
        const v = await app.inject({
          method: 'POST',
          url: '/v2/assess',
          payload: { ...payload, ...extra },
        });
        assert.equal(v.statusCode, 200, v.body.slice(0, 280));
        return v.json();
      };
      const initial = count(),
        ordinary = await post();
      assert.deepEqual(slim(ordinary.decision), c.before);
      const attachment = { notice: 'terms', photoId: id, base64: raw.base64 };
      const blocked = await post({
        disclosures: payload.disclosures.map((d) =>
          d.question === 'crash' ? { ...d, answer: 'yes' } : d,
        ),
        countCheck: attachment,
      });
      assert.equal(blocked.decision.outcome, 'no_offer');
      const unknown = await post({
        disclosures: payload.disclosures.map((d) =>
          d.question === 'crash' ? { ...d, answer: 'unknown' } : d,
        ),
        countCheck: attachment,
      });
      assert.notEqual(unknown.decision.outcome, 'offer');
      const other = source.get(id === 'ov-066' ? 'ox-083' : 'ov-066');
      assert(acceptedLicenses.test(other.license));
      const wrong = await post({
        countCheck: { ...attachment, base64: fs.readFileSync(other.file).toString('base64') },
      });
      assert.deepEqual(wrong.decision, ordinary.decision);
      assert.equal(count(), initial, 'A gated request spent money');
      const t = performance.now(),
        after = await post({ countCheck: attachment }),
        roundTripMs = Math.round(performance.now() - t);
      const ticket = createHmac('sha256', key)
        .update(JSON.stringify([COUNT_MODEL, PROTOCOL_HASH, assessmentId, id, sha256]))
        .digest('hex');
      await new Promise((resolve) => setTimeout(resolve, 40));
      const m = db
        .prepare(
          'SELECT state,label,elapsed_ms,input_tokens,output_tokens,charged_micros,request_id FROM count_attempt WHERE ticket=?',
        )
        .get(ticket);
      const pass = ['one', 'matched_pair'].includes(m?.label),
        gold = truth.count === 'pair' ? 'matched_pair' : truth.count;
      const spent = count(),
        repeat = await post(
          after.countReceipt ? { countReceipt: after.countReceipt } : { countCheck: attachment },
        );
      const exact =
        JSON.stringify(slim(after.decision)) === JSON.stringify(pass ? c.countPass : c.before);
      const stable =
        JSON.stringify(repeat.decision) === JSON.stringify(after.decision) && count() === spent;
      const row = {
        id,
        attribution: {
          title: s.title,
          author: s.author,
          page: s.page,
          license: s.license,
          licenseUrl: s.licenseUrl,
        },
        expected: gold,
        label: m?.label ?? null,
        status: m?.state ?? 'unavailable',
        documentedRequest: !!m?.request_id,
        providerMs: m?.elapsed_ms ?? null,
        roundTripMs,
        input: m?.input_tokens ?? null,
        output: m?.output_tokens ?? null,
        budgetChargeMicros: m?.charged_micros ?? null,
        listMicros: m?.input_tokens ? m.input_tokens * 2 + m.output_tokens * 10 : null,
        before: slim(ordinary.decision),
        after: slim(after.decision),
        receipt: !!after.countReceipt,
        exact,
        stable,
        negativeControls: [
          'baseline',
          'disclosed crash',
          'unknown crash',
          'different normalized image',
        ],
        newAttempts: spent - initial,
      };
      row.passed =
        row.label === gold &&
        row.status === 'completed' &&
        row.documentedRequest &&
        row.input > 0 &&
        exact &&
        stable &&
        row.receipt === pass;
      report.cases.push(row);
      console.log(
        JSON.stringify({
          id,
          label: row.label,
          state: row.status,
          ms: row.providerMs,
          passed: row.passed,
        }),
      );
    } finally {
      await app.close();
    }
  }
  report.accept = report.cases.length === cohort.length && report.cases.every((r) => r.passed);
} finally {
  db.close();
  real.close();
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
if (!report.accept) process.exitCode = 1;
