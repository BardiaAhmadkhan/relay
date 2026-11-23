import { z } from 'zod';
import type { Answer2 } from '../../core/v2/schema';
import { BATTERY_SYSTEM, renderOneWord, type Question } from './battery';
import { ScorerFailure, wordMass, type Scorer, type ScoreResult } from './scorer';

/** Local closed-question scorer: one short generation per question, the answer read from the token
 * log-probabilities of the first generated token. Measured on qwen3.5:4b (docs/22-backend-v2).
 * Nothing leaves the machine. One question costs one image evaluation, so keep the question list short. */
const Reply = z.object({
  model: z.string(),
  done: z.literal(true),
  prompt_eval_count: z.number().int().nonnegative().optional(),
  logprobs: z
    .array(
      z.object({
        token: z.string(),
        top_logprobs: z.array(z.object({ token: z.string(), logprob: z.number() })),
      }),
    )
    .min(1),
});
/** Below this share of probability on the allowed words, the model did not answer the question. */
export const MIN_COVERAGE = 0.5;

export class LocalLogprobScorer implements Scorer {
  readonly id = 'local_logprob' as const;
  readonly model: string;
  constructor(
    private readonly modelName: string,
    digest: string,
    private readonly url = 'http://127.0.0.1:11435',
    private readonly fetcher: typeof fetch = fetch,
    private readonly perQuestionTimeoutMs = 20_000,
  ) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'http:' ||
      !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    )
      throw new Error('The local scorer only talks to a loopback runtime.');
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('A pinned model digest is required.');
    this.model = modelName + '@' + digest.slice(0, 12);
  }
  async score(
    photo: { jpeg: Uint8Array },
    questions: Question[],
    signal: AbortSignal,
  ): Promise<ScoreResult> {
    const started = performance.now(),
      image = Buffer.from(photo.jpeg).toString('base64'),
      answers: Record<string, Answer2> = {};
    let inputTokens = 0;
    for (const question of questions) {
      const { text, words, keys } = renderOneWord(question);
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(this.perQuestionTimeoutMs)]);
      let response: Response;
      try {
        response = await this.fetcher(this.url + '/api/chat', {
          method: 'POST',
          signal: deadline,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.modelName,
            stream: false,
            think: false,
            logprobs: true,
            top_logprobs: 20,
            keep_alive: '30m',
            messages: [
              { role: 'system', content: BATTERY_SYSTEM },
              { role: 'user', content: text, images: [image] },
            ],
            options: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: 2 },
          }),
        });
      } catch {
        if (signal.aborted) throw signal.reason;
        throw new ScorerFailure('timeout', true, question.key);
      }
      if (!response.ok) throw new ScorerFailure('unavailable', true, 'http ' + response.status);
      const parsed = Reply.safeParse(await response.json().catch(() => null));
      if (!parsed.success || parsed.data.model !== this.modelName)
        throw new ScorerFailure('invalid_response', false, question.key);
      inputTokens += parsed.data.prompt_eval_count ?? 0;
      const { probabilities, covered } = wordMass(parsed.data.logprobs[0]!.top_logprobs, words);
      if (covered < MIN_COVERAGE) throw new ScorerFailure('invalid_response', false, question.key);
      if (question.type === 'yesno')
        answers[question.key] = { type: 'yesno', p: probabilities[0]! };
      else if (question.type === 'choice') {
        const best = probabilities.indexOf(Math.max(...probabilities));
        answers[question.key] = {
          type: 'choice',
          choice: keys[best]!,
          probabilities: Object.fromEntries(keys.map((k, i) => [k, probabilities[i]!])),
        };
      } else
        answers[question.key] = {
          type: 'level',
          score: probabilities.reduce((sum, p, i) => sum + p * i, 0),
          probabilities,
        };
    }
    return { answers, inputTokens, ms: performance.now() - started };
  }
  /** Release the model (added 2026-11-17). Ollama 0.40.16 holds 130 to 170 MB of system RAM per new
   * photograph until the model is unloaded (experiment report E12a); the next request reloads it, and
   * the scores after a reload were identical. */
  async unload(): Promise<void> {
    await this.fetcher(this.url + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.modelName, keep_alive: 0 }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }
}

/** Unloads the local model every `every` photographs, so a service that runs all day cannot run the
 * machine out of RAM (E12a: free RAM fell 6.8 GB over 40 photographs; recycling every 10 kept it flat). */
export class RecyclingScorer implements Scorer {
  readonly id: Scorer['id'];
  readonly model: string;
  private photos = 0;
  constructor(
    private readonly inner: Scorer,
    private readonly unload: () => Promise<void>,
    private readonly every = 25,
  ) {
    this.id = inner.id;
    this.model = inner.model;
  }
  async score(
    photo: Parameters<Scorer['score']>[0],
    questions: Question[],
    signal: AbortSignal,
  ): Promise<ScoreResult> {
    try {
      return await this.inner.score(photo, questions, signal);
    } finally {
      if (++this.photos % this.every === 0) await this.unload();
    }
  }
}

/** Refuse to start on weights other than the ones the thresholds were fitted on. */
export async function createLocalLogprobScorer(
  model = 'qwen3.5:4b',
  expectedDigest = 'd8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04',
  url = 'http://127.0.0.1:11435',
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(url + '/api/tags', { signal: AbortSignal.timeout(5000) });
  if (!response.ok)
    throw new Error('Local vision runtime is unavailable. Run npm run vision:serve.');
  const tags = z
    .object({ models: z.array(z.object({ name: z.string(), digest: z.string() })) })
    .parse(await response.json());
  const found = tags.models.find((m) => m.name === model);
  if (!found) throw new Error('Local model is missing: ' + model);
  if (found.digest !== expectedDigest)
    throw new Error(
      'Local model weights differ from the calibrated digest. Recalibrate before use.',
    );
  return new LocalLogprobScorer(model, found.digest, url, fetcher);
}
