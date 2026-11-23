/** Two actual processes, the shipping phone's HTTP client, and the stock model.
 * The proxy counts worker requests and supplies no answers. No cloud billing is simulated. */
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as wait } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { serviceHealthV2, scorePhoto, assess, assessWithCount } from '../../app/src/api-v2.ts';
const final = process.argv[2] === '--final';
const file =
  'collab/baseline/v35-activation/hosting/' + (final ? 'split-4b-final.json' : 'split-4b.json');
assert(!fs.existsSync(file));
const live = { url: 'http://127.0.0.1:8788', token: '' },
  key = process.env.RELAY_SIGNING_KEY,
  signal = AbortSignal.timeout(240000);
const freePort = async () => {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
};
const [apiPort, workerPort, probePort] = await Promise.all([freePort(), freePort(), freePort()]);
assert.equal(new Set([apiPort, workerPort, probePort]).size, 3);
const token = randomBytes(28).toString('hex'),
  access = randomBytes(28).toString('hex'),
  providerKey = randomBytes(24).toString('hex');
const cpu = { url: 'http://127.0.0.1:' + apiPort, token: access },
  calls = [],
  logs = [],
  children = [];
const db = new DatabaseSync(process.env.RELAY_R2_LEDGER, { readOnly: true }),
  count = () => db.prepare('SELECT COUNT(*) n FROM count_attempt').get().n;
const evidence = {
  at: new Date().toISOString(),
  scope:
    'Real CPU and GPU server roles on separate TCP ports on one Windows machine. GPU answers are fresh from the existing pinned runtime. Local transport, GPU prewarming and paid count are measured. No cloud latency or provider hosting charge is measured.',
  comparisons: [],
  passed: false,
};
const proxy = http.createServer(async (req, res) => {
  try {
    assert.equal(req.url, '/internal/v1/photo');
    assert.equal(req.headers['x-relay-worker'], token);
    assert.equal(req.headers.authorization, 'Bearer ' + providerKey);
    const chunks = [];
    for await (const x of req) chunks.push(x);
    const data = Buffer.concat(chunks),
      b = JSON.parse(data);
    calls.push({ view: b.view, keys: b.keys.length, hasLow: !!b.low, wireBytes: data.length });
    const v = await fetch('http://127.0.0.1:' + workerPort + req.url, {
      method: 'POST',
      headers: { 'x-relay-worker': token, 'content-type': 'application/json' },
      body: data,
    });
    res.writeHead(v.status, { 'content-type': 'application/json' });
    res.end(Buffer.from(await v.arrayBuffer()));
  } catch {
    res.writeHead(503);
    res.end();
  }
});
const proc = (args, env) => {
  const p = spawn(process.execPath, ['--import', 'tsx', ...args], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(p);
  p.stdout.on('data', (b) => logs.push(b.toString().slice(0, 150)));
  p.stderr.on('data', () => {});
  return p;
};
const limited = { ...process.env };
for (const k of Object.keys(limited)) {
  if (/TOKEN|KEY|PASSWORD|SECRET|BUDGET|RELAY_ALLOW_PAID|RELAY_R2_/i.test(k)) delete limited[k];
}
const ready = async (fn) => {
  for (let i = 0; i < 140; i++) {
    try {
      if (await fn()) return;
    } catch {}
    await wait(200);
  }
  throw Error('Host probe did not become ready.');
};
const inputs = {
  front: 'datasets/gear-v2-openverse/images/ov-066.jpg',
  back: 'datasets/realworld-v3/images/cm-107.jpg',
  label: 'assets/fixtures/backpack-label.jpg',
};
async function checkHardware() {
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
    if (t >= 85 || v >= 7000 || /\\steamapps\\common\\|\\xboxgames\\|shipping\.exe/i.test(p))
      throw Error('Hardware guard');
    if (t <= 72) return;
    await wait(500);
  }
  throw Error('Cooling time expired');
}
try {
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + proxy.address().port;
  proc(['server/index-v2.ts'], {
    ...process.env,
    RELAY_HOST: '127.0.0.1',
    RELAY_PORT: String(apiPort),
    RELAY_ACCESS_TOKEN: access,
    RELAY_GPU_TOKEN: token,
    RELAY_GPU_PROVIDER_KEY: providerKey,
    RELAY_GPU_ORIGIN: base,
  });
  await ready(async () => !!(await serviceHealthV2(cpu, signal)));
  const primary = await serviceHealthV2(live, signal),
    h = await serviceHealthV2(cpu, signal);
  assert.deepEqual(primary, h);
  evidence.sameHealthAndDraftContext = true;
  assert.equal((await fetch(cpu.url + '/v2/health')).status, 401);
  const disclosures = ['crash', 'protective_damage', 'protective_repair'].map((question) => ({
    id: question,
    question,
    answer: 'no',
    recordedAt: '2026-11-20T00:00:00.000Z',
  }));
  const assessmentId = final ? 'split-final-20261119' : 'split-r2-20261119',
    crash = {
      assessmentId,
      disclosures: disclosures.map((x) => ({ ...x, answer: x.id === 'crash' ? 'yes' : 'no' })),
      photos: [],
      signedScores: [],
      closeUpsRequested: 0,
    };
  assert.equal((await assess(cpu, crash, signal)).decision.outcome, 'no_offer');
  assert.equal(calls.length, 0);
  evidence.workerCallsForStartupHealthAndCrash = 0;
  await checkHardware();
  proc(['server/gpu-worker.ts'], {
    ...limited,
    RELAY_OLLAMA_URL: 'http://127.0.0.1:11439',
    RELAY_GPU_TOKEN: token,
    RELAY_WORKER_HOST: '127.0.0.1',
    PORT: String(workerPort),
    PORT_HEALTH: String(probePort),
  });
  await ready(async () => (await fetch('http://127.0.0.1:' + probePort + '/ping')).status === 200);
  assert.equal(
    (await fetch('http://127.0.0.1:' + workerPort + '/internal/v1/photo', { method: 'POST' }))
      .status,
    401,
  );
  const photos = [],
    signedScores = [],
    raw = {},
    beforeCount = count();
  for (const [view, source] of Object.entries(inputs)) {
    raw[view] = fs.readFileSync(source).toString('base64');
    const request = { assessmentId, photoId: view, view, base64: raw[view] };
    await checkHardware();
    const a = await scorePhoto(live, request, signal);
    await checkHardware();
    const t = performance.now(),
      b = await scorePhoto(cpu, request, signal);
    assert.deepEqual(a.signed.scores.answers, b.signed.scores.answers);
    assert.deepEqual(a.photo, b.photo);
    assert.deepEqual(a.feedback, b.feedback);
    assert.deepEqual(a.signed.scores.scorer, b.signed.scores.scorer);
    photos.push(b.photo);
    signedScores.push(b.signed);
    evidence.comparisons.push({
      view,
      answers: Object.keys(b.signed.scores.answers).length,
      wholeScoreAnswersEqual: true,
      qualityAndFeedbackEqual: true,
      rpcPhotoMs: Math.round(performance.now() - t),
    });
  }
  assert.equal(calls.length, 3);
  const paidInput = { assessmentId, disclosures, photos, signedScores, closeUpsRequested: 0 };
  const baseline = await assess(live, paidInput, signal),
    other = await assess(cpu, paidInput, signal);
  assert.deepEqual(baseline.decision, other.decision);
  assert.equal(other.decision.outcome, 'retake');
  const result = await assessWithCount(cpu, paidInput, signal, true, async (id) => {
    assert.equal(id, 'front');
    return raw.front;
  });
  assert.equal(result.decision.outcome, 'offer');
  assert(result.countReceipt);
  assert.equal(count() - beforeCount, 1);
  const repeat = await assessWithCount(
    live,
    { ...paidInput, countReceipt: result.countReceipt },
    signal,
    true,
    () => {
      throw Error('A signed receipt should require no upload');
    },
  );
  assert.deepEqual(result.decision, repeat.decision);
  assert.equal(count() - beforeCount, 1);
  assert.equal(calls.length, 3);
  await scorePhoto(
    cpu,
    { assessmentId, photoId: 'repeat', view: 'front', base64: raw.front },
    signal,
  );
  assert.equal(calls.length, 3);
  Object.assign(evidence, {
    workerRequests: calls,
    workerCallsForCountAssessmentAndReceipt: 0,
    repeatedPhotoWorkerCalls: 0,
    optionalProviderCalls: 1,
    before: baseline.decision.outcome,
    after: result.decision.outcome,
    passed: true,
  });
} catch (e) {
  evidence.error = e.message;
  throw e;
} finally {
  for (const p of children.reverse()) {
    if (p.exitCode === null) {
      const end = once(p, 'exit');
      p.kill();
      await Promise.race([end, wait(3000)]);
    }
  }
  proxy.closeAllConnections();
  await new Promise((r) => proxy.close(r));
  db.close();
  fs.writeFileSync(file, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify(evidence));
