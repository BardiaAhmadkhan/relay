import { z } from 'zod';
import type { Answer2 } from '../../core/v2/schema';
import { renderInstruction, type Question } from './battery';
import { ScorerFailure, type Scorer, type ScoreResult } from './scorer';

/** Hosted closed-question scorer (Gemini Decisions API, v1beta).
 *
 * STATUS: written from the published reference on 2026-11-16 and NOT yet executed against the service.
 * Run scripts/v2-verify-decisions.ts with a key before relying on it, and correct the response mapping
 * to what actually comes back. Reference: https://aistudio.google.com/docs/decisions-api
 *
 * One request per photograph. All questions share the image; the service bills input tokens only.
 * Free-tier content may be used to improve the provider's products, so anything but public licensed
 * fixtures needs a paid key.
 */
const Noul = z.object({ type: z.literal('noul'), noul: z.number().min(0).max(1) });
const Choice = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
});
const Score = z.object({
  type: z.literal('score'),
  score: z.number().min(0),
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
});
const Reply = z.object({
  answers: z.record(z.string(), z.discriminatedUnion('type', [Noul, Choice, Score])),
  usage: z.object({ total_input_tokens: z.number().int().nonnegative() }).partial().optional(),
});
const SAFETY_CODES = [
  'safety',
  'prohibited_content',
  'blocklist',
  'image_safety',
  'content_blocked',
];

export class DecisionsScorer implements Scorer {
  readonly id = 'decisions' as const;
  readonly model: string;
  constructor(
    private readonly apiKey: string,
    model = 'gemini-decision-1',
    private readonly resolution: 'low' | 'medium' | 'high' | 'ultra_high' = 'high',
    private readonly fetcher: typeof fetch = fetch,
    private readonly endpoint = 'https://generativelanguage.googleapis.com/v1beta/decisions',
    private readonly timeoutMs = 6000,
  ) {
    if (!apiKey) throw new ScorerFailure('not_configured', false);
    this.model = model + '/' + resolution;
    this.modelName = model;
  }
  private readonly modelName: string;
  async score(
    photo: { jpeg: Uint8Array },
    questions: Question[],
    signal: AbortSignal,
  ): Promise<ScoreResult> {
    const started = performance.now();
    const body = {
      model: this.modelName,
      input: [
        {
          type: 'image',
          data: Buffer.from(photo.jpeg).toString('base64'),
          mime_type: 'image/jpeg',
          resolution: this.resolution,
        },
      ],
      questions: Object.fromEntries(
        questions.map((q) => [
          q.key,
          q.type === 'yesno'
            ? { type: 'noul', instructions: renderInstruction(q) }
            : q.type === 'choice'
              ? { type: 'choice', instructions: renderInstruction(q), criteria: q.options }
              : { type: 'score', instructions: renderInstruction(q), criteria: q.levels },
        ]),
      ),
    };
    let response: Response;
    try {
      response = await this.fetcher(this.endpoint, {
        method: 'POST',
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
        headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      if (signal.aborted) throw signal.reason;
      throw new ScorerFailure('timeout', true);
    }
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = (json as { error?: { code?: unknown } } | null)?.error?.code;
      if (response.status === 400 && typeof code === 'string' && SAFETY_CODES.includes(code))
        throw new ScorerFailure('refused', false, code);
      if (response.status === 429) throw new ScorerFailure('rate_limited', true);
      if (response.status >= 500)
        throw new ScorerFailure('unavailable', true, 'http ' + response.status);
      throw new ScorerFailure('invalid_response', false, 'http ' + response.status);
    }
    const parsed = Reply.safeParse(json);
    if (!parsed.success) throw new ScorerFailure('invalid_response', false);
    const answers: Record<string, Answer2> = {};
    for (const q of questions) {
      const a = parsed.data.answers[q.key];
      // A missing or mistyped answer is a failure of the whole record, never a silent default.
      if (!a) throw new ScorerFailure('invalid_response', false, 'missing ' + q.key);
      if (q.type === 'yesno' && a.type === 'noul') answers[q.key] = { type: 'yesno', p: a.noul };
      else if (q.type === 'choice' && a.type === 'choice' && a.choice in q.options)
        answers[q.key] = {
          type: 'choice',
          choice: a.choice,
          probabilities: Object.fromEntries(
            Object.keys(q.options).map((k) => [k, a.probabilities[k] ?? 0]),
          ),
        };
      else if (q.type === 'level' && a.type === 'score')
        answers[q.key] = {
          type: 'level',
          score: Math.min(a.score, q.levels.length - 1),
          probabilities: q.levels.map((_, i) => a.probabilities[String(i)] ?? 0),
        };
      else throw new ScorerFailure('invalid_response', false, 'type of ' + q.key);
    }
    return {
      answers,
      inputTokens: parsed.data.usage?.total_input_tokens ?? 0,
      ms: performance.now() - started,
    };
  }
}
