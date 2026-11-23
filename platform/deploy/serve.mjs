/** Relay's two-process backend. Only the authenticated Fastify service is exposed. */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { resolve } from 'node:path';
import { inspectionModel } from '../packages/vision/v2/inspection-model.ts';

const models = resolve(process.env.OLLAMA_MODELS || '.cache/ollama');
const port = Number(process.env.RELAY_PRIVATE_OLLAMA_PORT ?? 11435);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw Error('Invalid private runtime port.');
const origin = 'http://127.0.0.1:' + port;
const children = new Set();
let stopping = false;
const lifetime = new AbortController();
const driverEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|USERPROFILE|HOME|LOCALAPPDATA|APPDATA|TMP|TEMP|TMPDIR|LANG|TZ|LD_LIBRARY_PATH|CUDA_.*|NVIDIA_.*|GGML_.*|SSL_CERT_FILE|SSL_CERT_DIR)$/i.test(
      key,
    ),
  ),
);
Object.assign(driverEnv, {
  OLLAMA_HOST: '127.0.0.1:' + port,
  OLLAMA_MODELS: models,
  OLLAMA_NO_CLOUD: '1',
  OLLAMA_NUM_PARALLEL: '1',
  OLLAMA_MAX_LOADED_MODELS: '1',
  OLLAMA_CONTEXT_LENGTH: '8192',
  LLAMA_ARG_CACHE_RAM: '0',
});
const bin = process.env.RELAY_OLLAMA_BIN || 'ollama';

function launch(command, args, env, output = 'inherit') {
  const proc = spawn(command, args, { env, windowsHide: true, stdio: ['ignore', output, output] });
  children.add(proc);
  const ended = new Promise((resolve) => {
    proc.once('error', () => resolve(1));
    proc.once('exit', (code) => resolve(code ?? 1));
  }).finally(() => children.delete(proc));
  return { proc, ended };
}
async function stop() {
  if (stopping) return;
  stopping = true;
  lifetime.abort();
  const running = [...children];
  const waits = running.map((p) => once(p, 'exit').catch(() => {}));
  for (const p of running) {
    try {
      p.kill('SIGTERM');
    } catch {}
  }
  const timer = setTimeout(() => {
    for (const p of children) {
      try {
        p.kill('SIGKILL');
      } catch {}
    }
  }, 5000);
  timer.unref();
  await Promise.race([Promise.all(waits), sleep(5600, undefined, { ref: false })]);
  clearTimeout(timer);
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void stop();
  });
async function get(route) {
  const response = await fetch(origin + route, {
    signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(3000)]),
  });
  if (!response.ok) throw Error('Loopback runtime is unavailable.');
  return response.json();
}
async function serve() {
  await mkdir(models, { recursive: true });
  const existing = await get('/api/version').catch(() => null);
  if (existing) throw Error('The private runtime port is already in use.');
  const runner = launch(bin, ['serve'], driverEnv);
  let ready = false;
  for (let i = 0; i < 150 && !stopping; i++) {
    if (!children.has(runner.proc)) throw Error('The private runtime exited at startup.');
    const version = await get('/api/version').catch(() => null);
    if (version) {
      if (version.version !== '0.40.16')
        throw Error('Expected the evaluated Ollama 0.40.16 runtime.');
      ready = true;
      break;
    }
    await sleep(200);
  }
  if (!ready) throw Error('Private runtime readiness timed out.');
  const installed = async () =>
    (await get('/api/tags')).models.find((x) => x.name === inspectionModel.name);
  let checkpoint = await installed();
  if (!checkpoint && process.env.RELAY_PULL_IF_MISSING === '1') {
    const pull = launch(bin, ['pull', inspectionModel.name], driverEnv);
    if (await pull.ended) throw Error('The pinned checkpoint could not be downloaded.');
    checkpoint = await installed();
  }
  if (checkpoint?.digest !== inspectionModel.digest)
    throw Error('The release checkpoint digest is missing or differs.');
  if (stopping) return;
  if (process.env.RELAY_BACKEND_ROLE === 'bake') return;
  const worker = process.env.RELAY_BACKEND_ROLE === 'gpu';
  const apiEnv = worker
    ? {
        ...driverEnv,
        RELAY_GPU_TOKEN: process.env.RELAY_GPU_TOKEN,
        PORT: process.env.PORT,
        PORT_HEALTH: process.env.PORT_HEALTH,
        RELAY_WORKER_HOST: process.env.RELAY_WORKER_HOST,
        RELAY_OLLAMA_URL: origin,
      }
    : { ...process.env, RELAY_OLLAMA_URL: origin, RELAY_SCORERS: 'local_logprob' };
  const api = launch(
    process.execPath,
    ['--import', 'tsx', worker ? 'server/gpu-worker.ts' : 'server/index-v2.ts'],
    apiEnv,
  );
  const first = await Promise.race([api.ended, runner.ended]);
  if (!stopping) throw Error('A backend process exited (code ' + first + ').');
}
try {
  await serve();
} catch (error) {
  if (!stopping) {
    console.error(error.message);
    process.exitCode = 1;
  }
} finally {
  await stop();
}
