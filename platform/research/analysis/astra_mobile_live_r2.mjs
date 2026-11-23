/** Fresh stock 4B + real OpenAI + the shipping phone networking module. */
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as wait } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { serviceHealthV2, scorePhoto, assess, assessWithCount } from '../../app/src/api-v2.ts';
const connection = { url: 'http://127.0.0.1:8788', token: '' },
  signal = AbortSignal.timeout(300000);
const privatePort = Number(process.env.RELAY_PRIVATE_OLLAMA_PORT ?? 11435);
const get = async (route) => (await fetch('http://127.0.0.1:' + privatePort + route)).json();
async function guard() {
  for (let i = 0; i < 120; i++) {
    const tasks = execFileSync(
      'nvidia-smi',
      ['--query-compute-apps=pid,process_name', '--format=csv,noheader'],
      { encoding: 'utf8', windowsHide: true },
    );
    const [temp, vram] = execFileSync(
      'nvidia-smi',
      ['--query-gpu=temperature.gpu,memory.used', '--format=csv,noheader,nounits'],
      { encoding: 'utf8', windowsHide: true },
    )
      .trim()
      .split(',')
      .map(Number);
    if (
      /\\steamapps\\common\\|\\xboxgames\\|shipping\.exe|\\(?:Civilization[^\\]*|FortniteClient[^\\]*|cs2|dota2|GTA5|eldenring|overwatch|RocketLeague)\.exe/i.test(
        tasks,
      ) ||
      temp >= 85 ||
      vram >= 7000 ||
      os.freemem() < 2 * 2 ** 30
    )
      throw Error('Hardware guard interrupted the experiment.');
    if (temp <= 72) return;
    await wait(500);
  }
  throw Error('Cooling time expired.');
}
const reportFile = 'collab/baseline/v35-activation/fresh-mobile-4b.json';
assert(!fs.existsSync(reportFile));
const labels = new Map(
  JSON.parse(fs.readFileSync('datasets/realworld-v3/labels.json', 'utf8')).cases.map((r) => [
    r.id,
    r,
  ]),
);
const cases = [
    { id: 'ov-066', expected: 'matched_pair' },
    { id: 'ox-083', expected: 'several' },
  ],
  report = {
    at: new Date().toISOString(),
    method:
      'Actual V3.5 mobile API module over HTTP to the full service. Fresh stock 4B scores on front, back and label. Standard labelled public fixture front, independently sourced boots as back and a readable test label. Constructed three-view intakes, not independently matched physical garments or a native handset.',
    cases: [],
  };
const db = new DatabaseSync(process.env.RELAY_R2_LEDGER, { readOnly: true });
const count = () => db.prepare('SELECT COUNT(*) n FROM count_attempt').get().n;
const testSource = (id) => {
  const p = labels.get(id);
  assert(/^CC BY(?:-SA)? [\d.]+$/.test(p.license));
  const b = fs.readFileSync(p.file);
  assert.equal(createHash('sha256').update(b).digest('hex'), p.sha256);
  return b.toString('base64');
};
const fixedBack = testSource('cm-107'),
  fixtureLabel = fs.readFileSync('assets/fixtures/backpack-label.jpg').toString('base64');
try {
  const health = await serviceHealthV2(connection, signal);
  assert.equal(health?.engineRelease, '3.5');
  assert.equal(health?.processingNotice, 'terms');
  report.health = {
    release: health.engineRelease,
    primary: health.scorers,
    processingNotice: health.processingNotice,
  };
  report.runtime = (await get('/api/version')).version;
  for (const { id, expected } of cases) {
    const images = { front: testSource(id), back: fixedBack, label: fixtureLabel },
      assessmentId = 'mobile-real-20261119-' + id;
    const row = { id, expected, assessmentId, views: [], attemptsBefore: count() };
    report.cases.push(row);
    const photos = [],
      signedScores = [],
      start = performance.now();
    for (const view of ['front', 'back', 'label']) {
      await guard();
      const t = performance.now();
      const data = await scorePhoto(
        connection,
        { assessmentId, photoId: view, view, base64: images[view] },
        signal,
      );
      photos.push(data.photo);
      signedScores.push(data.signed);
      const a = data.signed.scores.answers;
      row.views.push({
        view,
        ms: Math.round(performance.now() - t),
        sha256: data.photo.sha256,
        warnings: data.photo.quality.warnings,
        model: data.signed.scores.scorer.model,
        inputTokens: data.signed.scores.usage.inputTokens,
        category: a.category?.choice,
        singleProbability: a.single_item?.p,
      });
    }
    const input = {
      assessmentId,
      disclosures: ['crash', 'protective_damage', 'protective_repair'].map((question) => ({
        id: question,
        question,
        answer: 'no',
        recordedAt: '2026-11-20T00:00:00.000Z',
      })),
      photos,
      signedScores,
      closeUpsRequested: 0,
    };
    const ordinary = await assess(connection, input, signal);
    const old = await assessWithCount(connection, input, signal, false, () => {
      throw Error('Earlier client read pixels');
    });
    assert.deepEqual(old.decision, ordinary.decision);
    const crash = await assessWithCount(
      connection,
      {
        ...input,
        disclosures: input.disclosures.map((d) =>
          d.question === 'crash' ? { ...d, answer: 'yes' } : d,
        ),
      },
      signal,
      true,
      () => {
        throw Error('Crash read pixels');
      },
    );
    assert.equal(crash.decision.outcome, 'no_offer');
    assert.equal(count(), row.attemptsBefore);
    const transferred = [],
      t = performance.now();
    const checked = await assessWithCount(connection, input, signal, true, async (photoId) => {
      assert.equal(photoId, 'front', 'Only the licensed routed front may be sent');
      transferred.push(photoId);
      return images.front;
    });
    row.optionalMs = Math.round(performance.now() - t);
    row.totalMs = Math.round(performance.now() - start);
    const priorCount = count();
    const repeat = await assessWithCount(
      connection,
      { ...input, ...(checked.countReceipt ? { countReceipt: checked.countReceipt } : {}) },
      signal,
      true,
      async (photoId) => {
        assert.equal(photoId, 'front');
        return images.front;
      },
    );
    assert.deepEqual(repeat.decision, checked.decision);
    assert.equal(count(), priorCount);
    const simple = (d) => ({
      outcome: d.outcome,
      grade: d.grade,
      category: d.category,
      reasons: d.reasons.map((r) => r.code),
      requestPhoto: d.requestPhoto,
    });
    row.ordinary = simple(ordinary.decision);
    row.effective = simple(checked.decision);
    row.mobileRead = transferred;
    row.attempts = priorCount - row.attemptsBefore;
    row.oldClientUnchanged = true;
    row.disclosedCrash = 'no_offer';
    row.duplicateCharges = 0;
    row.receipt = !!checked.countReceipt;
    const m = db
      .prepare(
        'SELECT state,label,elapsed_ms,input_tokens,output_tokens,charged_micros FROM count_attempt WHERE digest=? ORDER BY started_ms DESC LIMIT 1',
      )
      .get(photos[0].sha256);
    row.provider = row.attempts > 0 ? m : null;
    row.passed =
      row.attempts === 1 &&
      transferred.length === 1 &&
      m?.state === 'completed' &&
      m.label === expected &&
      (expected === 'several'
        ? JSON.stringify(checked.decision) === JSON.stringify(ordinary.decision)
        : row.receipt);
    console.log(
      JSON.stringify({
        id,
        ordinary: row.ordinary,
        effective: row.effective,
        attempts: row.attempts,
        provider: row.provider,
        passed: row.passed,
      }),
    );
  }
  report.resident = (await get('/api/ps')).models.map((m) => ({
    name: m.name,
    digest: m.digest,
    size_vram: m.size_vram,
  }));
  report.passed = report.cases.length === 2 && report.cases.every((x) => x.passed);
} catch (e) {
  report.error = e.message;
  throw e;
} finally {
  db.close();
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
if (!report.passed) process.exitCode = 1;
