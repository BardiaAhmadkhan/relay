// E5. Does the local runtime reuse the evaluated image between questions when the image comes first?
// Measured on 2026-11-16 (E2): every question re-evaluated the whole prompt, about 0.9 s at 1600 px.
// Hypothesis: the image is placed after the question text inside the one user message, so the
// question text breaks the shared prefix. Moving the image into its own earlier turn should let the
// runtime reuse system + image and evaluate only the question tokens.
//
// node experiments/backend-v2/probe-prefix-cache.mjs [--id commons-031] [--edge 1280] [--model qwen3.5:4b]
// Must run alone: the runtime has one slot, and any other request between two calls evicts the cache.
import path from 'node:path';
import { OUT, loadCases, prepare, chat, answerMass, appendJsonl, args } from './lib.mjs';
import { BATTERIES } from './battery.mjs';

const a = args();
const model = a.model ?? 'qwen3.5:4b';
const edge = Number(a.edge ?? 1280);
const cases = await loadCases();
const id = a.id ?? 'commons-031';
const c = cases.find((x) => x.id === id);
if (!c) throw new Error('unknown case ' + id);
const image = await prepare(c.file, edge);
const b64 = image.jpeg.toString('base64');
const { system, probes } = BATTERIES.b1;
const order = ['break', 'slide', 'repair', 'break'];
const file = path.join(OUT, 'prefix-cache--' + model.replace(/[:/]/g, '-') + '.jsonl');

// Layout "inline": the production layout (question text and image in one user message).
// Layout "image_turn": the image in its own user turn, a fixed assistant acknowledgement, then the question.
// Layout "image_first_text": one user message whose text starts with a fixed sentence and the question
// follows; images are still attached to the same message, so this only tests text order.
const layouts = {
  inline: (q) => [
    { role: 'system', content: system },
    { role: 'user', content: q, images: [b64] },
  ],
  image_turn: (q) => [
    { role: 'system', content: system },
    { role: 'user', content: 'Photograph to inspect.', images: [b64] },
    { role: 'assistant', content: 'Ready.' },
    { role: 'user', content: q },
  ],
};
for (const [layout, build] of Object.entries(layouts)) {
  // A different image first, so the slot holds nothing useful for this one.
  const other = await prepare(cases.find((x) => x.id !== id && x.file).file, 512);
  await chat({
    model,
    messages: [{ role: 'user', content: 'Describe in one word.', images: [other.jpeg.toString('base64')] }],
    options: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: 1 },
  });
  for (const [i, name] of order.entries()) {
    const { json, ms } = await chat({
      model,
      logprobs: true,
      top_logprobs: 20,
      messages: build(probes[name].text),
      options: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: 2 },
    });
    const row = {
      id,
      model,
      edge,
      width: image.width,
      height: image.height,
      layout,
      step: i,
      question: name,
      promptTokens: json.prompt_eval_count,
      promptMs: Math.round((json.prompt_eval_duration ?? 0) / 1e6),
      loadMs: Math.round((json.load_duration ?? 0) / 1e6),
      totalMs: Math.round(ms),
      yes: +answerMass(json.logprobs, ['yes', 'no']).normalized.yes.toFixed(5),
      answer: json.message?.content?.trim(),
    };
    await appendJsonl(file, row);
    console.log(JSON.stringify(row));
  }
}
console.log('done', file);
