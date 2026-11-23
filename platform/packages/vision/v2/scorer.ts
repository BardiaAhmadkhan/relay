import type { PhotoView } from '../../core/schema';
import type { Answer2, PhotoScores } from '../../core/v2/schema';
import type { Question } from './battery';

export type ScoreResult = { answers: Record<string, Answer2>; inputTokens: number; ms: number };
export interface Scorer {
  readonly id: PhotoScores['scorer']['id'];
  readonly model: string;
  /** Answers every question it can. Throws ScorerFailure; never returns invented or default scores. */
  score(
    photo: { jpeg: Uint8Array; view: PhotoView },
    questions: Question[],
    signal: AbortSignal,
  ): Promise<ScoreResult>;
}
/** `retryable` separates a busy or slow service from a photograph this scorer will never accept. */
export class ScorerFailure extends Error {
  constructor(
    public readonly code:
      | 'timeout'
      | 'unavailable'
      | 'rate_limited'
      | 'refused'
      | 'invalid_response'
      | 'not_configured',
    public readonly retryable: boolean,
    detail?: string,
  ) {
    super(code + (detail ? ': ' + detail : ''));
    this.name = 'ScorerFailure';
  }
}

/** Probability mass per allowed word at one generated token, case and whitespace insensitive. */
export function wordMass(
  top: Array<{ token: string; logprob: number }>,
  words: string[],
): { probabilities: number[]; covered: number } {
  const mass = words.map(() => 0);
  for (const entry of top) {
    const index = words.indexOf(entry.token.trim().toLowerCase());
    if (index >= 0) mass[index]! += Math.exp(entry.logprob);
  }
  const covered = mass.reduce((a, b) => a + b, 0);
  return { probabilities: mass.map((m) => (covered > 0 ? m / covered : 0)), covered };
}
