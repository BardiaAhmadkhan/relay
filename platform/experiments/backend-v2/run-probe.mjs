// Scored single-token probes over the frozen labelled corpora.
// node experiments/backend-v2/run-probe.mjs --probe structural-1 [--model qwen3.5:4b] [--edge 1600] [--tag x]
import path from 'node:path';
import {
  OUT,
  loadCases,
  prepare,
  chat,
  answerMass,
  appendJsonl,
  done,
  args,
  sharpness,
} from './lib.mjs';
import { PROBES } from './probes.mjs';

const a = args();
const probeId = a.probe ?? 'structural-1';
const probe = PROBES[probeId];
if (!probe) throw new Error('unknown probe ' + probeId);
const model = a.model ?? 'qwen3.5:4b';
const edge = Number(a.edge ?? 1600);
const degrade = { blur: a.blur, quality: a.quality, brightness: a.brightness };
const tag = [
  a.tag ?? '',
  a.blur ? 'blur' + a.blur : '',
  a.quality ? 'q' + a.quality : '',
  a.brightness ? 'bright' + a.brightness : '',
]
  .filter(Boolean)
  .join('-');
const file = path.join(
  OUT,
  ['probe', probeId, model.replace(/[:/]/g, '-'), 'e' + edge, tag].filter(Boolean).join('--') + '.jsonl',
);
const cases = (await loadCases()).filter(
  (c) =>
    (!a.domain || c.domain === a.domain) &&
    (!a.scored || ['visible_defect', 'no_visible_defect'].includes(c.condition)),
);
const finished = await done(file);
let n = 0;
for (const c of cases) {
  if (finished.has(c.id)) continue;
  try {
    const image = await prepare(c.file, edge, degrade);
    const { json, ms } = await chat({
      model,
      logprobs: true,
      top_logprobs: 12,
      messages: [
        { role: 'system', content: probe.system },
        { role: 'user', content: probe.user, images: [image.jpeg.toString('base64')] },
      ],
      options: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: 2 },
    });
    const scored = answerMass(json.logprobs, probe.words);
    await appendJsonl(file, {
      id: c.id,
      corpus: c.corpus,
      domain: c.domain,
      group: c.group,
      condition: c.condition,
      probe: probeId,
      model,
      edge,
      width: image.width,
      height: image.height,
      bytes: image.jpeg.length,
      sharpness: await sharpness(image.jpeg),
      answer: json.message?.content?.trim().toLowerCase(),
      p: scored.normalized,
      mass: scored.total,
      promptTokens: json.prompt_eval_count,
      ms: Math.round(ms),
      promptMs: Math.round((json.prompt_eval_duration ?? 0) / 1e6),
      evalMs: Math.round((json.eval_duration ?? 0) / 1e6),
    });
  } catch (error) {
    await appendJsonl(file, { id: c.id, error: String(error.message ?? error) });
  }
  if (++n % 25 === 0) console.log(n + '/' + (cases.length - finished.size));
}
console.log('done', file);
