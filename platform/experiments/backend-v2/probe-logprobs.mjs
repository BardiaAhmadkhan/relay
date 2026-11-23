// Probe: does the local runtime return token log-probabilities for a one-word visual answer?
// Usage: node experiments/backend-v2/probe-logprobs.mjs <image> [model]
import fs from 'node:fs/promises';
const [, , file, model = 'qwen3.5:4b'] = process.argv;
const url = process.env.RELAY_OLLAMA_URL ?? 'http://127.0.0.1:11435';
const image = (await fs.readFile(file)).toString('base64');
const started = performance.now();
const response = await fetch(url + '/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model,
    stream: false,
    think: false,
    logprobs: true,
    top_logprobs: 8,
    messages: [
      {
        role: 'system',
        content:
          'You answer with exactly one word: yes or no. Structural damage means a hole, tear, cut, split seam, or material scraped through. Ordinary wear, creases, dirt, fading, logos and stitching are not structural damage.',
      },
      {
        role: 'user',
        content: 'Does this photograph show structural damage to the item? Answer yes or no.',
        images: [image],
      },
    ],
    options: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: 3 },
    keep_alive: '30m',
  }),
});
const body = await response.json();
console.log(
  JSON.stringify(
    {
      status: response.status,
      ms: Math.round(performance.now() - started),
      content: body.message?.content,
      promptTokens: body.prompt_eval_count,
      evalTokens: body.eval_count,
      loadMs: Math.round((body.load_duration ?? 0) / 1e6),
      promptMs: Math.round((body.prompt_eval_duration ?? 0) / 1e6),
      evalMs: Math.round((body.eval_duration ?? 0) / 1e6),
      logprobs: body.logprobs?.slice(0, 2),
      error: body.error,
    },
    null,
    1,
  ),
);
