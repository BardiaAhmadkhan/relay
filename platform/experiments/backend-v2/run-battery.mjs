// One image, many scored single-token questions on a shared (system + image) prefix.
// node experiments/backend-v2/run-battery.mjs --battery b1 [--model qwen3.5:4b] [--edge 1600] [--tag x] [--only break,slide]
import path from 'node:path';
import { OUT, loadCases, prepare, chat, appendJsonl, done, args, sharpness } from './lib.mjs';
import { BATTERIES } from './battery.mjs';

const a = args();
const batteryId = a.battery ?? 'b1';
const battery = BATTERIES[batteryId];
if (!battery) throw new Error('unknown battery ' + batteryId);
const model = a.model ?? 'qwen3.5:4b';
const edge = Number(a.edge ?? 1600);
const only = a.only ? new Set(String(a.only).split(',')) : null;
const names = Object.keys(battery.probes).filter((n) => !only || only.has(n));
const degrade = { blur: a.blur, quality: a.quality, brightness: a.brightness };
const tag = [
  a.tag ?? '',
  // A separate corpus gets its own file (added 2026-11-17); the reference runs keep their names.
  a.corpus && a.corpus !== 'reference' ? 'corpus-' + a.corpus : '',
  only ? [...only].join('+') : '',
  a.blur ? 'blur' + a.blur : '',
  a.quality ? 'q' + a.quality : '',
  a.brightness ? 'bright' + a.brightness : '',
]
  .filter(Boolean)
  .join('-');
const file = path.join(
  OUT,
  ['battery', batteryId, model.replace(/[:/]/g, '-'), 'e' + edge, tag].filter(Boolean).join('--') + '.jsonl',
);
const cases = (await loadCases(a.corpus)).filter(
  (c) =>
    (!a.domain || c.domain === a.domain) &&
    (!a.scored || ['visible_defect', 'no_visible_defect'].includes(c.condition)),
);
const finished = await done(file);
// --thermal T (added 2026-11-18): before each photograph, if the GPU is at T C or hotter, wait until it
// has cooled to T - 8 C. No pause while it is cool. The guard (guarded-run.mjs) still stops at 87 C;
// a 1600 px run on this laptop reached 89 C without this.
async function gpuTemp() {
  const { execFileSync } = await import('node:child_process');
  try {
    return Number(
      execFileSync('nvidia-smi', ['--query-gpu=temperature.gpu', '--format=csv,noheader,nounits'], {
        timeout: 4000,
      })
        .toString()
        .trim(),
    );
  } catch {
    return null;
  }
}
async function coolDown(limit) {
  let t = await gpuTemp();
  if (t === null || t < limit) return;
  console.log('cooling: GPU at ' + t + ' C, waiting for ' + (limit - 8) + ' C');
  while (t !== null && t > limit - 8) {
    await new Promise((r) => setTimeout(r, 5000));
    t = await gpuTemp();
  }
}
let n = 0;
for (const c of cases) {
  if (finished.has(c.id)) continue;
  if (a.thermal) await coolDown(Number(a.thermal));
  try {
    const image = await prepare(c.file, edge, degrade);
    const b64 = image.jpeg.toString('base64');
    const focus = await sharpness(image.jpeg);
    const row = {
      id: c.id,
      corpus: c.corpus,
      domain: c.domain,
      group: c.group,
      condition: c.condition,
      subject: c.subject,
      battery: batteryId,
      model,
      edge,
      width: image.width,
      height: image.height,
      bytes: image.jpeg.length,
      focus,
      probes: {},
    };
    const started = performance.now();
    for (const name of names) {
      const probe = battery.probes[name];
      const { json, ms } = await chat({
        model,
        logprobs: true,
        top_logprobs: 20,
        messages: [
          { role: 'system', content: battery.system },
          { role: 'user', content: probe.text, images: [b64] },
        ],
        options: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: 2 },
      });
      const first = json.logprobs?.[0]?.top_logprobs ?? [];
      const mass = Object.fromEntries(probe.words.map((w) => [w, 0]));
      for (const entry of first) {
        const token = entry.token.trim().toLowerCase();
        if (token in mass) mass[token] += Math.exp(entry.logprob);
      }
      const total = Object.values(mass).reduce((x, y) => x + y, 0);
      row.probes[name] = {
        answer: json.message?.content?.trim().toLowerCase(),
        p: Object.fromEntries(probe.words.map((w) => [w, total ? +(mass[w] / total).toFixed(5) : 0])),
        mass: +total.toFixed(4),
        promptTokens: json.prompt_eval_count,
        ms: Math.round(ms),
        promptMs: Math.round((json.prompt_eval_duration ?? 0) / 1e6),
      };
    }
    row.totalMs = Math.round(performance.now() - started);
    await appendJsonl(file, row);
  } catch (error) {
    await appendJsonl(file, { id: c.id, error: String(error.message ?? error) });
  }
  if (++n % 25 === 0) console.log(n + '/' + (cases.length - finished.size));
  // --recycle N unloads the model every N photographs (added 2026-11-17). Ollama 0.40.16 holds about
  // 130 to 170 MB of system RAM per new photograph until the model is unloaded (E12a); reloading gave
  // identical scores. Off unless asked, so earlier runs stay comparable.
  if (a.recycle && n % Number(a.recycle) === 0)
    await chat({ model, messages: [], keep_alive: 0 }).catch(() => undefined);
}
console.log('done', file);
