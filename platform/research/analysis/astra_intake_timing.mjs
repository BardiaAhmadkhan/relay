/** A warmed stock 4B runtime, a fresh API cache per intake, and a transparent loopback counter for real model forwards. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as wait } from 'node:timers/promises';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const root = process.cwd(),
  [output, store = path.join(root, '.cache/ollama')] = process.argv.slice(2);
if (!output)
  throw Error(
    'Usage: node research/analysis/astra_intake_timing.mjs OUTPUT_DIRECTORY [STOCK_MODEL_STORE]',
  );
const out = path.resolve(output);
fs.mkdirSync(out, { recursive: true });
const file = path.join(out, 'intake-trials.jsonl'),
  read = (f) =>
    fs.existsSync(f)
      ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
      : [];
const append = (f, v) => fs.appendFileSync(f, JSON.stringify(v) + '\n'),
  hash = (b) => createHash('sha256').update(b).digest('hex');
const exec = promisify(execFile),
  sharp = createRequire(path.join(root, 'package.json'))('sharp');
const cases = [
  ['leather-jacket', 'armour-jacket'],
  ['gloves-palm', 'gloves-back'],
  ['racing-boot', 'leather-jacket'],
  ['mixed-gear', 'armour-jacket'],
  ['crashed-shoulder', 'leather-jacket'],
  ['gloves-back', 'gloves-palm'],
  ['armour-jacket', 'crashed-shoulder'],
  ['leather-jacket', 'mixed-gear'],
];
const pinned = 'd8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04';
const protocol = {
  checkpoint: pinned,
  cases,
  repeats: 2,
  labelFixture: 'backpack-label',
  fixtureDirectory: 'assets/fixtures',
  preparation:
    'EXIF-orient, fit inside 1600 without enlargement, sRGB JPEG quality 82. Timing starts after the phone-equivalent bytes exist.',
  scope:
    'Each case exercises real front, back, label and assessment HTTP requests. Histories are negative controlled inputs. These are repeatable workload fixtures, not necessarily pictures of one garment. Cold model startup, file preparation and thermal cool-down between cases are outside each measured interval. If the GPU reaches 72 C between views within an intake the runner waits for 65 C; that wait is recorded and counted in assessment wall time. Measurements include normal server image processing, inference and decision. A fresh API process per intake avoids whole-photo cache hits. The resident model is warmed and the host prompt cache remains off.',
  quantile: 'linear empirical quantile',
  minFreeMiB: 2048,
  maxGpuMiB: 7000,
  stopTemperatureC: 85,
};
const protoFile = path.join(out, 'timing-protocol.json');
if (
  fs.existsSync(protoFile) &&
  JSON.stringify(JSON.parse(fs.readFileSync(protoFile))) !== JSON.stringify(protocol)
)
  throw Error('Different frozen timing workload');
fs.writeFileSync(protoFile, JSON.stringify(protocol, null, 2) + '\n');
function quant(v, q) {
  const a = [...v].sort((a, b) => a - b),
    x = (a.length - 1) * q,
    i = Math.floor(x);
  return Math.round(100 * (a[i] + (a[Math.min(i + 1, a.length - 1)] - a[i]) * (x - i))) / 100;
}
async function freePort() {
  const server = net.createServer();
  await new Promise((r, j) => server.on('error', j).listen(0, '127.0.0.1', r));
  const p = server.address().port;
  await new Promise((r) => server.close(r));
  return p;
}
const runtimePort = await freePort(),
  apiPort = await freePort(),
  proxyPort = await freePort(),
  runtime = 'http://127.0.0.1:' + runtimePort,
  api = 'http://127.0.0.1:' + apiPort,
  controller = new AbortController();
const children = new Set();
const health = { peakTemp: 0, peakVramMiB: 0, minFreeMiB: Infinity, samples: 0 };
let lastGame = 0,
  checking = false,
  last = 0,
  heat = 0,
  lastFrame = null,
  phase = null,
  calls = [];
async function guard() {
  if (checking) return;
  checking = true;
  try {
    const smi = async (args) =>
      (await exec('nvidia-smi', args, { windowsHide: true, timeout: 4500 })).stdout.trim();
    if (Date.now() - lastGame >= 15000) {
      const list = await smi(['--query-compute-apps=pid,process_name', '--format=csv,noheader']);
      if (
        /\\steamapps\\common\\|\\xboxgames\\|shipping\.exe|\\(?:Civilization[^\\]*|FortniteClient[^\\]*|cs2|dota2|GTA5|eldenring|overwatch|RocketLeague)\.exe/i.test(
          list,
        )
      )
        throw Error('Game detected');
      lastGame = Date.now();
    }
    const [t, v] = (
        await smi(['--query-gpu=temperature.gpu,memory.used', '--format=csv,noheader,nounits'])
      )
        .split(',')
        .map(Number),
      ram = os.freemem() / 1048576;
    if (![t, v, ram].every(Number.isFinite) || t >= 85 || v > 7000 || ram < 2048)
      throw Error('Resource guard ' + JSON.stringify({ t, v, ram }));
    heat = t;
    last = Date.now();
    health.peakTemp = Math.max(health.peakTemp, t);
    health.peakVramMiB = Math.max(health.peakVramMiB, v);
    health.minFreeMiB = Math.min(health.minFreeMiB, Math.floor(ram));
    health.samples++;
  } catch (e) {
    controller.abort(e.message);
    for (const c of children) c.kill();
  } finally {
    checking = false;
  }
}
async function call(url, body) {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(150000)]),
  });
  if (!response.ok) throw Error(new URL(url).pathname + ' HTTP ' + response.status);
  return response.json();
}
async function ready(url) {
  for (let i = 0; i < 220; i++) {
    if (controller.signal.aborted) throw Error(controller.signal.reason);
    try {
      return await call(url);
    } catch {
      await wait(150);
    }
  }
  throw Error('Local service startup timed out');
}
function start(exe, args, env, onLine) {
  const c = spawn(exe, args, {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(c);
  let rest = '';
  c.stdout.on('data', (d) => {
    rest += d;
    const lines = rest.split(/\r?\n/);
    rest = lines.pop();
    for (const line of lines) onLine?.(line);
  });
  c.stderr.resume();
  c.once('exit', () => children.delete(c));
  return c;
}
async function stop(c) {
  if (c?.exitCode !== null || !c) return;
  const ended = new Promise((r) => c.once('exit', r));
  c.kill();
  await Promise.race([ended, wait(4000, undefined, { ref: false })]);
}
const proxy = http.createServer(async (req, res) => {
  try {
    const segments = [];
    for await (const b of req) segments.push(b);
    const raw = Buffer.concat(segments);
    const t = performance.now();
    const remote = await fetch(runtime + req.url, {
      method: req.method,
      headers: { 'content-type': 'application/json' },
      body: raw.length ? raw : undefined,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(135000)]),
    });
    const bytes = Buffer.from(await remote.arrayBuffer());
    if (phase && req.url === '/api/chat') {
      const input = JSON.parse(raw),
        answer = JSON.parse(bytes);
      calls.push({
        view: phase,
        questionSHA256: hash(input.messages.at(-1).content),
        jpegSHA256: hash(Buffer.from(input.messages.at(-1).images[0], 'base64')),
        ms: performance.now() - t,
        status: remote.status,
        promptTokens: answer.prompt_eval_count ?? 0,
        promptMs: (answer.prompt_eval_duration ?? 0) / 1e6,
      });
    }
    res.writeHead(remote.status, { 'content-type': 'application/json' });
    res.end(bytes);
  } catch {
    res.writeHead(503);
    res.end('{}');
  }
});
const prepared = new Map();
for (const f of new Set([...cases.flat(), 'backpack-label'])) {
  const src = fs.readFileSync(path.join(root, 'assets/fixtures', f + '.jpg'));
  const b = await sharp(src)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb')
    .jpeg({ quality: 82 })
    .toBuffer();
  prepared.set(f, { b, source: hash(src) });
}
const previous = new Set(read(file).map((r) => r.trial));
let server;
let rt;
const timer = setInterval(() => void guard(), 900);
try {
  await guard();
  if (controller.signal.aborted) throw Error(controller.signal.reason);
  await new Promise((res, rej) => proxy.on('error', rej).listen(proxyPort, '127.0.0.1', res));
  rt = start(process.env.RELAY_OLLAMA_BIN ?? 'ollama.exe', ['serve'], {
    OLLAMA_HOST: '127.0.0.1:' + runtimePort,
    OLLAMA_MODELS: path.resolve(store),
    OLLAMA_NUM_PARALLEL: '1',
    OLLAMA_MAX_LOADED_MODELS: '1',
    OLLAMA_NO_CLOUD: '1',
    OLLAMA_CONTEXT_LENGTH: '8192',
    LLAMA_ARG_CACHE_RAM: '0',
  });
  await ready(runtime + '/api/version');
  const tags = await call(runtime + '/api/tags');
  if (!tags.models.some((m) => m.name === 'qwen3.5:4b' && m.digest === pinned))
    throw Error('Wrong checkpoint');
  for (let rep = 0; rep < 2; rep++)
    for (let idx = 0; idx < cases.length; idx++) {
      const i = rep ? cases.length - 1 - idx : idx,
        trial = rep + '-' + i;
      if (previous.has(trial)) continue;
      while (heat > 62 || os.freemem() < 5 * 1024 ** 3) {
        if (controller.signal.aborted) throw Error(controller.signal.reason);
        await wait(450);
      }
      let warmed = false,
        failed = false;
      phase = null;
      server = start(
        process.execPath,
        ['--import', 'tsx', 'server/index-v2.ts'],
        {
          RELAY_HOST: '127.0.0.1',
          RELAY_PORT: String(apiPort),
          RELAY_SIGNING_KEY: randomBytes(32).toString('hex'),
          RELAY_SCORERS: 'local_logprob',
          RELAY_ALLOW_PAID: '0',
          RELAY_REVIEW: '0',
          RELAY_OLLAMA_URL: 'http://127.0.0.1:' + proxyPort,
          RELAY_PLAN: '1',
          RELAY_CASCADE: '1',
          RELAY_RECYCLE: '25',
        },
        (line) => {
          try {
            const r = JSON.parse(line);
            if (r.event === 'scorer_warm') warmed = true;
            if (r.event === 'scorer_warm_failed') failed = true;
          } catch {}
        },
      );
      const h = await ready(api + '/v2/health');
      if (!h.scorers[0].model.includes(pinned.slice(0, 12))) throw Error('Unexpected health');
      for (let n = 0; !warmed && n < 1200; n++) {
        if (failed || server.exitCode !== null || controller.signal.aborted)
          throw Error('Warmup failed');
        await wait(100);
      }
      if (!warmed) throw Error('Could not warm the original scorer');
      while (heat > 62) {
        if (controller.signal.aborted) throw Error(controller.signal.reason);
        await wait(400);
      }
      const assessmentId = 'comparison-' + trial,
        records = [],
        signed = [],
        views = [];
      calls = [];
      let startAt = performance.now();
      for (const [view, f] of [
        ['front', cases[i][0]],
        ['back', cases[i][1]],
        ['label', 'backpack-label'],
      ]) {
        const thermalStart = performance.now();
        if (heat >= 72)
          while (heat > 65) {
            if (controller.signal.aborted) throw Error(controller.signal.reason);
            await wait(300);
          }
        const preViewThermalWaitMs = performance.now() - thermalStart;
        phase = view;
        const { b, source } = prepared.get(f);
        const start = performance.now();
        const result = await call(api + '/v2/photos/score', {
          schemaVersion: '2.0',
          assessmentId,
          photoId: view,
          view,
          base64: b.toString('base64'),
        });
        const ms = performance.now() - start;
        records.push(result.photo);
        signed.push(result.signed);
        views.push({
          view,
          fixture: f,
          sourceSha256: source,
          preViewThermalWaitMs,
          submittedSha256: hash(b),
          normalizedSha256: result.photo.sha256,
          quality: result.photo.quality,
          wallMs: ms,
          answers: result.signed.scores.answers,
          usage: result.signed.scores.usage,
          scorer: result.signed.scores.scorer,
        });
      }
      phase = null;
      const startDecision = performance.now();
      const decision = await call(api + '/v2/assess', {
        schemaVersion: '2.0',
        assessmentId,
        photos: records,
        signedScores: signed,
        disclosures: ['crash', 'protective_damage', 'protective_repair'].map((question, j) => ({
          id: 'd' + j,
          question,
          answer: 'no',
          recordedAt: '2026-11-20T00:00:00.000Z',
        })),
        closeUpsRequested: 0,
      });
      const endAt = performance.now();
      lastFrame = {
        trial,
        repeat: rep,
        fixture: i,
        wallMs: endAt - startAt,
        decisionHttpMs: endAt - startDecision,
        views,
        decision: decision.decision,
        forwards: calls,
        modelForwards: calls.length,
        totalInputTokens: calls.reduce((n, q) => n + q.promptTokens, 0),
      };
      append(file, lastFrame);
      console.log(
        trial,
        Math.round(lastFrame.wallMs) + 'ms',
        lastFrame.modelForwards,
        decision.decision.outcome,
      );
      await stop(server);
      server = null;
    }
  const trials = read(file),
    times = trials.map((r) => r.wallMs),
    photos = trials.flatMap((r) => r.views.map((p) => p.wallMs));
  if (
    trials.length !== cases.length * 2 ||
    trials.some((r) => r.views.length !== 3 || !r.modelForwards)
  )
    throw Error('Incomplete timing observations');
  const profile = (xs) => ({ n: xs.length, p50: quant(xs, 0.5), p95: quant(xs, 0.95) });
  fs.writeFileSync(
    path.join(out, 'intake-timing.json'),
    JSON.stringify(
      {
        workloadSHA256: hash(JSON.stringify(protocol)),
        photosMs: profile(photos),
        assessmentMs: profile(times),
        decideHttpMs: profile(trials.map((r) => r.decisionHttpMs)),
        actualModelForwardsPerAssessment: profile(trials.map((r) => r.modelForwards)),
        health,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  clearInterval(timer);
  phase = null;
  await stop(server);
  await stop(rt);
  proxy.close();
  proxy.closeAllConnections?.();
  append(path.join(out, 'worker-health.jsonl'), {
    stopReason: controller.signal.reason ?? null,
    utc: new Date().toISOString(),
    health,
  });
}
