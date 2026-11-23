/** Source-disjoint count check. Ground truth is frozen in count-holdout-protocol.json. */
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { createHash, createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { serviceHealthV2, scorePhoto, assess, assessWithCount } from '../../app/src/api-v2.ts';
import { configuredCountReader, PROTOCOL_HASH } from '../../server/count-reader.ts';
import { COUNT_MODEL } from '../../server/count-budget.ts';
import { prepareImages } from '../../server/images.ts';
const json = (p) => JSON.parse(fs.readFileSync(p, 'utf8')),
  b64 = (p) => fs.readFileSync(p).toString('base64'),
  dir = 'collab/baseline/v35-activation/';
const out = dir + 'count-holdout-results.json';
assert(!fs.existsSync(out));
const target = json(dir + 'count-holdout-protocol.json').cohort;
const e19 = json('datasets/realworld-v3/labels.json').cases,
  attribution = json('datasets/quality-cycle-02/attribution.json').images;
const design = new Set(json('research/analysis/fallback-design.json').items.map((x) => x.id));
const pages = new Set([
  ...e19.map((p) => p.page),
  ...attribution.filter((p) => design.has(p.id)).map((p) => p.source),
]);
const digests = new Set([
  ...e19.map((p) => p.sha256),
  ...json('research/analysis/fallback-design.json').items.map((p) =>
    createHash('sha256').update(fs.readFileSync(p.file)).digest('hex'),
  ),
]);
const open = json('datasets/gear-v2-openverse/manifest.json')
  .images.filter((p) => target.some((x) => x.id === p.id))
  .map((p) => ({
    ...p,
    source: p.landingUrl,
    author: p.creator,
    license: 'CC ' + p.license.toUpperCase() + ' ' + p.licenseVersion,
  }));
const pool = new Map([...attribution, ...open].map((p) => [p.id, p]));
const c = { url: 'http://127.0.0.1:8788', token: '' },
  signal = AbortSignal.timeout(240000),
  key = process.env.RELAY_SIGNING_KEY;
assert.equal(process.env.RELAY_R2_BUDGET_SCOPE, 'relay35-local-20261119');
const reader = configuredCountReader(process.env, key);
assert(reader);
const db = new DatabaseSync(process.env.RELAY_R2_LEDGER, { readOnly: true }),
  calls = () => db.prepare('SELECT COUNT(*) n FROM count_attempt').get().n;
const stmt = db.prepare(
  'SELECT label,state,elapsed_ms,input_tokens,output_tokens,charged_micros FROM count_attempt WHERE ticket=?',
);
const back = b64(e19.find((x) => x.id === 'cm-107').file),
  label = b64('assets/fixtures/backpack-label.jpg');
const report = {
  at: new Date().toISOString(),
  definition:
    'Fresh full primary scores and mobile routing. On nonrouted fronts only, a separate diagnostic isolated adapter call revisits count. Reference is assessor-annotated, with pages/bytes distinct from both previous fallback cohorts. Physical garments and photographers across the internet may recur.',
  cases: [],
};
async function hardware() {
  for (let i = 0; i < 120; i++) {
    const [t, v] = execFileSync(
      'nvidia-smi',
      ['--query-gpu=temperature.gpu,memory.used', '--format=csv,noheader,nounits'],
      { encoding: 'utf8', windowsHide: true },
    )
      .split(',')
      .map(Number);
    const p = execFileSync(
      'nvidia-smi',
      ['--query-compute-apps=pid,process_name', '--format=csv,noheader'],
      { encoding: 'utf8', windowsHide: true },
    );
    if (
      t >= 85 ||
      v >= 7000 ||
      os.freemem() < 2 * 2 ** 30 ||
      /\\steamapps\\common\\|\\xboxgames\\|shipping\.exe/i.test(p)
    )
      throw Error('Hardware guard');
    if (t <= 72) return;
    await wait(500);
  }
  throw Error('Cooling time expired');
}
try {
  const health = await serviceHealthV2(c, signal);
  assert.equal(health?.processingNotice, 'terms');
  for (const { id, label: expected } of target) {
    const p = pool.get(id),
      raw = b64(p.file);
    const sha = createHash('sha256').update(Buffer.from(raw, 'base64')).digest('hex');
    assert.equal(sha, p.sha256);
    assert(
      !digests.has(sha) && !pages.has(p.source) && !design.has(id) && !e19.some((x) => x.id === id),
    );
    assert(/^CC BY(?:-SA)? [\d.]+$/.test(p.license));
    const assessmentId = 'holdout-20261119-' + id,
      images = { front: raw, back, label },
      photos = [],
      signedScores = [];
    for (const view of ['front', 'back', 'label']) {
      await hardware();
      const q = await scorePhoto(
        c,
        { assessmentId, photoId: view, view, base64: images[view] },
        signal,
      );
      photos.push(q.photo);
      signedScores.push(q.signed);
    }
    const input = {
        assessmentId,
        photos,
        signedScores,
        disclosures: ['crash', 'protective_damage', 'protective_repair'].map((question) => ({
          id: question,
          question,
          answer: 'no',
          recordedAt: '2026-11-20T00:00:00.000Z',
        })),
        closeUpsRequested: 0,
      },
      ordinary = await assess(c, input, signal);
    let sent = 0;
    const initial = calls(),
      after = await assessWithCount(c, input, signal, true, async (photoId) => {
        assert.equal(photoId, 'front');
        sent++;
        return raw;
      });
    const routedCalls = calls() - initial;
    assert.equal(routedCalls, sent);
    assert(sent === 0 || sent === 1);
    if (!sent) assert.deepEqual(after.decision, ordinary.decision);
    const source = await prepareImages([{ id: 'front', view: 'front', base64: raw }], 1600),
      digest = source.photos[0].sha256;
    assert.equal(digest, photos[0].sha256);
    const ticketId = sent ? assessmentId : 'diagnostic-' + assessmentId;
    if (!sent)
      await reader.read(
        { assessmentId: ticketId, photoId: 'front', sha256: digest, jpeg: source.images[0].jpeg },
        signal,
      );
    const ticket = createHmac('sha256', key)
      .update(JSON.stringify([COUNT_MODEL, PROTOCOL_HASH, ticketId, 'front', digest]))
      .digest('hex');
    const m = stmt.get(ticket);
    assert.equal(calls() - initial, 1);
    const row = {
      id,
      author: p.author,
      page: p.source,
      license: p.license,
      sourceSha: sha,
      expected,
      actual: m?.label ?? null,
      routed: sent === 1,
      purpose: sent ? 'live' : 'diagnostic only',
      ordinary: ordinary.decision.outcome,
      effective: after.decision.outcome,
      reasons: ordinary.decision.reasons.map((x) => x.code),
      receipt: !!after.countReceipt,
      correct: m?.label === expected,
      usage: m,
    };
    report.cases.push(row);
    console.log(
      JSON.stringify([id, expected, row.actual, row.purpose, row.ordinary, row.effective]),
    );
  }
} finally {
  reader.close();
  db.close();
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
