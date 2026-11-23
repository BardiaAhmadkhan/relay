import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as wait } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { serviceHealthV2, scorePhoto, assess } from '../../app/src/api-v2.ts';
import { signCount } from '../../server/count-receipt.ts';
const live = { url: 'http://127.0.0.1:8788', token: '' },
  id = 'operator-kill-switch-rehearsal',
  signal = AbortSignal.timeout(95000),
  key = process.env.RELAY_SIGNING_KEY;
const db = new DatabaseSync(process.env.RELAY_R2_LEDGER, { readOnly: true }),
  count = () => Number(db.prepare('SELECT COUNT(*) n FROM count_attempt').get().n);
const initial = count(),
  lock = net.createServer();
await new Promise((r) => lock.listen(0, '127.0.0.1', r));
const port = lock.address().port;
await new Promise((r) => lock.close(r));
const c = { url: 'http://127.0.0.1:' + port, token: '' };
const out = 'collab/baseline/v35-activation/kill-switch.json';
assert(!fs.existsSync(out));
const report = {
  source:
    'Actual server/index-v2.ts. Isolated port and two consecutive process starts. Same signing key, physical allowance and signed primary evidence; operator-generated valid previous matched-pair receipt for this fixture. Never issue a new paid request.',
  cases: [],
};
const photos = [],
  signedScores = [];
try {
  for (const [view, file] of Object.entries({
    front: 'datasets/gear-v2-openverse/images/ov-066.jpg',
    back: 'datasets/realworld-v3/images/cm-107.jpg',
    label: 'assets/fixtures/backpack-label.jpg',
  })) {
    const v = await scorePhoto(
      live,
      { assessmentId: id, photoId: view, view, base64: fs.readFileSync(file).toString('base64') },
      signal,
    );
    photos.push(v.photo);
    signedScores.push(v.signed);
  }
  const input = {
    assessmentId: id,
    photos,
    signedScores,
    closeUpsRequested: 0,
    disclosures: ['crash', 'protective_damage', 'protective_repair'].map((question) => ({
      id: question,
      question,
      answer: 'no',
      recordedAt: '2026-11-20T00:00:00.000Z',
    })),
    countReceipt: signCount(id, photos[0], 'matched_pair', key),
  };
  for (const flag of ['1', '0']) {
    const p = spawn(process.execPath, ['--import', 'tsx', 'server/index-v2.ts'], {
      env: {
        ...process.env,
        RELAY_PORT: String(port),
        RELAY_HOST: '127.0.0.1',
        RELAY_OLLAMA_URL: 'http://127.0.0.1:11439',
        RELAY_R2_ENABLED: flag,
      },
      windowsHide: true,
      stdio: 'ignore',
    });
    try {
      let h;
      for (let i = 0; i < 70; i++) {
        try {
          h = await serviceHealthV2(c, signal);
          if (h) break;
        } catch {}
        await wait(150);
      }
      assert(h);
      assert.equal(h.processingNotice, flag === '1' ? 'terms' : undefined);
      const result = await assess(c, input, signal);
      assert.equal(result.decision.outcome, flag === '1' ? 'offer' : 'retake');
      report.cases.push({
        enabled: flag === '1',
        processingNotice: h.processingNotice ?? null,
        decision: result.decision.outcome,
      });
    } finally {
      if (p.exitCode === null) {
        const end = once(p, 'exit');
        p.kill();
        await end;
      }
    }
  }
  report.paidAttempts = count() - initial;
  assert.equal(report.paidAttempts, 0);
  report.passed = true;
} finally {
  db.close();
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify(report));
