/** Run a fresh instance of the actual Relay entry point and the published 4B runtime on loopback. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import os from 'node:os';
import net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRequire } from 'node:module';
const [live, first, output] = process.argv.slice(2).map((x) => path.resolve(x));
fs.mkdirSync(output, { recursive: true });
const sharp = createRequire(path.resolve('package.json'))('sharp');
const modelStore = path.join(live, 'model-store');
for (const prefix of ['manifests-v2/ollama.com/library', 'manifests/registry.ollama.ai/library']) {
  const dir = path.join(modelStore, prefix, 'qwen3.5');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(modelStore, prefix, 'relay-inspection/base'), path.join(dir, '4b'));
}
const temp = process.env.RELAY_SMOKE_RUNTIME_PORT || 19474,
  tel = process.env.RELAY_SMOKE_SERVICE_PORT || 18788;
for (const port of [temp, tel]) {
  const srv = net.createServer();
  await new Promise((r, j) => srv.once('error', j).listen(Number(port), '127.0.0.1', r));
  await new Promise((r) => srv.close(r));
}
const origins = { runtime: 'http://127.0.0.1:' + temp, api: 'http://127.0.0.1:' + tel };
const log = fs.createWriteStream(path.join(output, 'service.log'));
const children = [];
const start = (file, args, environment) => {
  const c = spawn(file, args, {
    env: { ...process.env, ...environment },
    cwd: process.cwd(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  c.stdout.pipe(log, { end: false });
  c.stderr.pipe(log, { end: false });
  children.push(c);
  return c;
};
const fetchJson = async (url, body) => {
  const r = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(140000),
  });
  return { code: r.status, data: await r.json() };
};
const ready = async (url, child) => {
  for (let i = 0; i < 130; i++) {
    if (child.exitCode !== null) throw Error('Process ended early ' + child.exitCode);
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return await r.json();
    } catch {}
    await sleep(400);
  }
  throw Error('Loopback startup timeout');
};
const exec = promisify(execFile),
  health = { peakTemp: 0, peakMiB: 0, minFreeMiB: Infinity };
let stopReason = null,
  polling = false,
  interval;
const monitor = async () => {
  if (polling) return;
  polling = true;
  try {
    const { stdout } = await exec(
      'nvidia-smi',
      ['--query-gpu=temperature.gpu,memory.used', '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: 4000 },
    );
    const [t, m] = stdout.trim().split(',').map(Number);
    const f = os.freemem() / 1048576;
    if (![t, m, f].every(Number.isFinite) || t >= 85 || m > 7000 || f < 2048)
      throw Error('resource guard');
    health.peakTemp = Math.max(health.peakTemp, t);
    health.peakMiB = Math.max(health.peakMiB, m);
    health.minFreeMiB = Math.min(health.minFreeMiB, Math.floor(f));
  } catch (e) {
    stopReason = e.message;
    for (const c of children) c.kill();
  } finally {
    polling = false;
  }
};
try {
  await monitor();
  if (stopReason) throw Error(stopReason);
  interval = setInterval(() => void monitor(), 900);
  const rt = start(process.env.RELAY_OLLAMA_BIN || 'ollama.exe', ['serve'], {
    OLLAMA_HOST: '127.0.0.1:' + temp,
    OLLAMA_MODELS: modelStore,
    OLLAMA_NO_CLOUD: '1',
    OLLAMA_NUM_PARALLEL: '1',
    OLLAMA_CONTEXT_LENGTH: '8192',
    OLLAMA_MAX_LOADED_MODELS: '1',
    LLAMA_ARG_CACHE_RAM: '0',
  });
  await ready(origins.runtime + '/api/tags', rt);
  const service = start(process.execPath, ['--import', 'tsx', 'server/index-v2.ts'], {
    RELAY_SIGNING_KEY: randomBytes(32).toString('hex'),
    RELAY_HOST: '127.0.0.1',
    RELAY_PORT: String(tel),
    RELAY_SCORERS: 'local_logprob',
    RELAY_OLLAMA_URL: origins.runtime,
    RELAY_LOCAL_MODEL: 'qwen3.5:4b',
    RELAY_LOCAL_DIGEST: 'd8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04',
    RELAY_PLAN: '1',
    RELAY_CASCADE: '1',
    RELAY_RECYCLE: '25',
    RELAY_REVIEW: '0',
    RELAY_ALLOW_PAID: '0',
    RELAY_ACCESS_TOKEN: '',
  });
  const h = await ready(origins.api + '/v2/health', service);
  if (
    !h.markedDetails ||
    !h.calibratedScorers.includes('local_logprob') ||
    !h.scorers[0].model.includes('qwen3.5:4b@d8b0f5e9760c')
  )
    throw Error('Wrong service profile');
  const members = JSON.parse(fs.readFileSync(path.join(first, 'sources.json'))).members;
  const m = members
    .filter((x) => x.class === 'holes')
    .sort((a, b) => a.item.localeCompare(b.item))[0];
  const original = fs.readFileSync(path.join(first, 'raw', m.id + '.jpg'));
  const raster = await sharp(original).rotate().png().toBuffer({ resolveWithObject: true });
  const { width: w, height: hg } = raster.info;
  const [x, y, bw, bh] = m.box,
    side = Math.min(w, hg, Math.max(64, Math.ceil(3 * Math.max(w * bw, hg * bh))));
  const left = Math.max(0, Math.min(w - side, Math.round(x * w - side / 2))),
    top = Math.max(0, Math.min(hg - side, Math.round(y * hg - side / 2)));
  const chip = await sharp(raster.data)
    .extract({ left, top, width: side, height: side })
    .resize(512, 512, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
  const api = (suffix, body) => fetchJson(origins.api + suffix, body);
  const send = (id, view, bytes, extra = {}) =>
    api('/v2/photos/score', {
      schemaVersion: '2.0',
      assessmentId: 'smoke-4b',
      photoId: id,
      view,
      base64: bytes.toString('base64'),
      ...extra,
    });
  const front = await send('smoke-front', 'front', original);
  if (front.code !== 200) throw Error(JSON.stringify(front));
  const fromOverview = {
    parentId: 'smoke-front',
    parentView: 'front',
    source: 'capture',
    sourceWidth: w,
    sourceHeight: hg,
    left,
    top,
    side,
  };
  const detail = await send('smoke-mark', 'detail', chip, {
    fromOverview,
    parent: front.data.signed,
  });
  if (detail.code !== 200) throw Error(JSON.stringify(detail));
  const expected = fs
    .readFileSync(path.join(live, 'scores.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse)
    .find((v) => !v.repeat && v.id === m.id + '-region');
  const got = detail.data.signed.scores;
  if (
    got.sha256 !== expected.normalizedSha256 ||
    got.answers.broken.p !== expected.answers.broken.p ||
    Object.keys(got.answers).length !== 1 ||
    got.parentSha256 !== front.data.photo.sha256
  )
    throw Error('Production mark differs from the actual 4B experiment');
  const bad = await send('smoke-invalid', 'detail', chip, {
    fromOverview,
    parent: { ...front.data.signed, signature: '0'.repeat(64) },
  });
  const body = {
    schemaVersion: '2.0',
    assessmentId: 'smoke-4b',
    photos: [front.data.photo, detail.data.photo],
    signedScores: [front.data.signed, detail.data.signed],
    closeUpsRequested: 0,
  };
  const unreported = await api('/v2/assess', { ...body, disclosures: [] });
  const crash = await api('/v2/assess', {
    ...body,
    disclosures: [
      { id: 'crash', question: 'crash', answer: 'yes', recordedAt: new Date().toISOString() },
    ],
  });
  if (
    bad.code !== 422 ||
    unreported.code !== 200 ||
    unreported.data.decision.outcome === 'offer' ||
    crash.data.decision.outcome !== 'no_offer'
  )
    throw Error('Invalid safety or provenance outcome');
  const outputResult = {
    health: h,
    source: m.id,
    totalParameters: 4539265536,
    learnedBytes: 3324162336,
    overviewScorer: front.data.signed.scores.scorer,
    overviewQuestions: Object.keys(front.data.signed.scores.answers),
    markedScorer: got.scorer,
    markQuestions: Object.keys(got.answers),
    normalizedSha256: got.sha256,
    p: got.answers.broken.p,
    studyP: expected.answers.broken.p,
    sourceRegion: fromOverview,
    parentHashMatches: true,
    wrongSignatureStatus: bad.code,
    outcomes: [unreported.data.decision.outcome, crash.data.decision.outcome],
    hardware: health,
  };
  fs.writeFileSync(
    path.join(output, 'service-smoke.json'),
    JSON.stringify(outputResult, null, 2) + '\n',
  );
  console.log(JSON.stringify(outputResult));
} finally {
  clearInterval(interval);
  for (const c of children.reverse()) c.kill();
  log.end();
}
