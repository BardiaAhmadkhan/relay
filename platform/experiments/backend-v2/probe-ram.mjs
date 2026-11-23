// E12a. Does the runtime's memory grow with every new photograph for a given model?
// Added 2026-11-17 after the guard stopped a qwen3-vl run when free RAM fell from 9 GB to 1.8 GB.
// One question per photograph; after each, the runtime processes' private memory and free RAM.
// node experiments/backend-v2/probe-ram.mjs --model qwen3-vl:4b-instruct [--n 40] [--unload-every 0] [--tag name]
//   [--thermal T]: before each photograph, at T C or hotter, wait until T - 8 C (as run-battery.mjs)
//
// Correction (2026-11-18, E12d): the model runs in a separate llama-server process that Ollama starts. The
// first version measured only processes named "ollama", so E12 saw a flat 203 MiB and blamed driver-side
// allocations. llama-server is now measured on its own (llamaServerPrivateMiB); it held 12.3 GB during E19.
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { OUT, loadCases, prepare, chat, answerMass, appendJsonl, args } from './lib.mjs';
import { BATTERIES } from './battery.mjs';

const a = args();
const model = a.model ?? 'qwen3-vl:4b-instruct';
const n = Number(a.n ?? 40);
const unloadEvery = Number(a['unload-every'] ?? 0);
const file = path.join(OUT, 'probe-ram--' + model.replace(/[:/]/g, '-') + (unloadEvery ? '--unload' + unloadEvery : '') + (a.edge ? '--e' + a.edge : '') + (a.tag ? '--' + a.tag : '') + '.jsonl');
const privateOf = (name) =>
  new Promise((resolve) =>
    execFile(
      'powershell',
      ['-NoProfile', '-Command', `(Get-Process ${name} -ErrorAction SilentlyContinue | Measure-Object PrivateMemorySize64 -Sum).Sum`],
      { timeout: 8000 },
      (e, out) => resolve(e ? null : Math.round(Number(out.trim()) / 1048576)),
    ),
  );
const privateMiB = () => privateOf('ollama');
function gpuTemp() {
  return new Promise((resolve) =>
    execFile(
      'nvidia-smi',
      ['--query-gpu=temperature.gpu', '--format=csv,noheader,nounits'],
      { timeout: 4000 },
      (e, out) => resolve(e ? null : Number(String(out).trim())),
    ),
  );
}
async function coolDown(limit) {
  let t = await gpuTemp();
  if (t === null || t < limit) return;
  while (t !== null && t > limit - 8) {
    await new Promise((r) => setTimeout(r, 5000));
    t = await gpuTemp();
  }
}
const cases = (await loadCases()).filter((c) => ['visible_defect', 'no_visible_defect'].includes(c.condition)).slice(0, n);
const { system, probes } = BATTERIES.b1;
for (const [i, c] of cases.entries()) {
  if (a.thermal) await coolDown(Number(a.thermal));
  const image = await prepare(c.file, Number(a.edge ?? 1600));
  const { json, ms } = await chat({
    model,
    logprobs: true,
    top_logprobs: 20,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: probes.break.text, images: [image.jpeg.toString('base64')] },
    ],
    options: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: 2 },
  });
  if (unloadEvery && (i + 1) % unloadEvery === 0)
    await chat({ model, messages: [], keep_alive: 0 }).catch(() => undefined);
  const row = {
    i,
    id: c.id,
    model,
    ms: Math.round(ms),
    promptTokens: json.prompt_eval_count,
    yes: +answerMass(json.logprobs, ['yes', 'no']).normalized.yes.toFixed(5),
    runtimePrivateMiB: await privateMiB(),
    llamaServerPrivateMiB: await privateOf('llama-server'),
    freeRamMiB: Math.round(os.freemem() / 1048576),
  };
  await appendJsonl(file, row);
  if (i % 5 === 0 || i === cases.length - 1) console.log(JSON.stringify(row));
}
console.log('done', file);
