import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { PhotoView } from '../../core/schema';
import { PhotoScoresSchema, type PhotoScores, type SignedScores } from '../../core/v2/schema';
import { BATTERY_VERSION, type Question } from './battery';
import { ScorerFailure, type Scorer } from './scorer';

/** Ordered fallback over scorers, with one retry, a breaker per scorer and a pixel-keyed cache.
 * A total failure throws: callers must show "not checked", never a default score. */
export type ChainOptions = {
  retryDelayMs?: () => number;
  breakerFailures?: number;
  breakerOpenMs?: number;
  cacheEntries?: number;
  cacheTtlMs?: number;
  now?: () => number;
};
export type ChainEvent = {
  scorer: string;
  outcome: 'ok' | 'cached' | 'skipped_open' | ScorerFailure['code'] | 'error';
  ms: number;
  inputTokens: number;
};

export class ScorerChain {
  private readonly failures = new Map<string, { count: number; openUntil: number }>();
  private readonly cache = new Map<string, { value: PhotoScores; expires: number }>();
  readonly events: ChainEvent[] = [];
  constructor(
    private readonly scorers: Scorer[],
    private readonly options: ChainOptions = {},
  ) {
    if (!scorers.length) throw new Error('At least one scorer is required.');
  }
  /** Scorer ids and models in fallback order, for health reporting. Never includes credentials. */
  get members(): Array<{ id: Scorer['id']; model: string }> {
    return this.scorers.map((s) => ({ id: s.id, model: s.model }));
  }
  private now() {
    return (this.options.now ?? Date.now)();
  }
  private record(event: ChainEvent) {
    this.events.push(event);
    if (this.events.length > 2000) this.events.splice(0, this.events.length - 2000);
  }
  async score(
    /** `low` is an optional small rendition for a cascading scorer (v3); the record, its hash and the
     * cache key always belong to `jpeg`, the full working image. */
    photo: { photoId: string; view: PhotoView; jpeg: Uint8Array; low?: Uint8Array },
    questions: Question[],
    signal: AbortSignal,
  ): Promise<PhotoScores> {
    const sha256 = createHash('sha256').update(photo.jpeg).digest('hex');
    const questionKey = createHash('sha256')
      .update(JSON.stringify(questions.map((q) => q.key)))
      .digest('hex');
    let last: unknown = new ScorerFailure('unavailable', true);
    for (const scorer of this.scorers) {
      const state = this.failures.get(scorer.id);
      if (state && state.openUntil > this.now()) {
        this.record({ scorer: scorer.id, outcome: 'skipped_open', ms: 0, inputTokens: 0 });
        continue;
      }
      const cacheKey = [
        sha256,
        photo.view,
        BATTERY_VERSION,
        scorer.id,
        scorer.model,
        questionKey,
      ].join(':');
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expires > this.now()) {
        this.record({ scorer: scorer.id, outcome: 'cached', ms: 0, inputTokens: 0 });
        // Same pixels, new photo id: rebind the record, never the pixels.
        return { ...cached.value, photoId: photo.photoId };
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        if (signal.aborted) throw signal.reason;
        const started = performance.now();
        try {
          const result = await scorer.score(photo, questions, signal);
          const value = PhotoScoresSchema.parse({
            photoId: photo.photoId,
            sha256,
            view: photo.view,
            batteryVersion: BATTERY_VERSION,
            scorer: { id: scorer.id, model: scorer.model },
            answers: result.answers,
            usage: { inputTokens: result.inputTokens, ms: result.ms },
            scoredAt: new Date(this.now()).toISOString(),
          });
          this.failures.delete(scorer.id);
          if (this.cache.size >= (this.options.cacheEntries ?? 256))
            this.cache.delete(this.cache.keys().next().value!);
          this.cache.set(cacheKey, {
            value,
            expires: this.now() + (this.options.cacheTtlMs ?? 30 * 60 * 1000),
          });
          this.record({
            scorer: scorer.id,
            outcome: 'ok',
            ms: result.ms,
            inputTokens: result.inputTokens,
          });
          return value;
        } catch (error) {
          if (signal.aborted) throw signal.reason;
          last = error;
          const failure = error instanceof ScorerFailure ? error : null;
          this.record({
            scorer: scorer.id,
            outcome: failure?.code ?? 'error',
            ms: performance.now() - started,
            inputTokens: 0,
          });
          if (failure?.retryable && attempt === 0) {
            await new Promise((r) =>
              setTimeout(r, (this.options.retryDelayMs ?? (() => 250 + Math.random() * 500))()),
            );
            continue;
          }
          // A refusal is about this photograph, not the health of the service: do not trip the breaker.
          if (failure?.code !== 'refused') {
            const count = (this.failures.get(scorer.id)?.count ?? 0) + 1;
            this.failures.set(scorer.id, {
              count,
              openUntil:
                count >= (this.options.breakerFailures ?? 3)
                  ? this.now() + (this.options.breakerOpenMs ?? 60_000)
                  : 0,
            });
          }
          break;
        }
      }
    }
    throw last;
  }
}

/** Stable serialisation: object keys sorted at every depth, so a signature survives a JSON round trip. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value as object)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonicalJson((value as Record<string, unknown>)[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function signScores(scores: PhotoScores, key: string): SignedScores {
  if (key.length < 32) throw new Error('The signing key must be at least 32 characters.');
  return {
    scores,
    signature: createHmac('sha256', key).update(canonicalJson(scores)).digest('hex'),
  };
}
export function verifyScores(signed: SignedScores, key: string): boolean {
  const expected = createHmac('sha256', key).update(canonicalJson(signed.scores)).digest();
  const given = Buffer.from(signed.signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
