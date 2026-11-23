import type { Answer2 } from '../packages/core/v2/schema';
import type { Question } from '../packages/vision/v2/battery';
import type { Scorer } from '../packages/vision/v2/scorer';

/** A scorer that answers every question from a table instead of a model: for browser tests, demos and
 * rehearsals without a GPU (added 2026-11-17, when sustained GPU load was suspected of shutting the
 * laptop down). Everything around it is real: image preparation, the focus gate, signing, the rules.
 * It reports itself as `local_logprob` so the real calibrated thresholds apply; its model name says
 * "stub" in every record and on /v2/health, so its output can never pass for a measurement. */
export type StubAnswers = Record<string, number | { choice: string } | { level: number }>;
export const CLEAN_ITEM: StubAnswers = {
  usable: 0.95,
  gear: 0.95,
  single_item: 0.95,
  category: { choice: 'jacket' },
  material: { choice: 'leather' },
  broken: 0.02,
  road_contact: 0.03,
  repair: 0.02,
  wear: { level: 1 },
  label_legible: 0.95,
  label_ce: 0.9,
  label_class: { choice: 'other' },
};

export function stubScorer(state: { answers: StubAnswers; delayMs?: number }): Scorer {
  return {
    id: 'local_logprob',
    model: 'stub-scorer (not a model)',
    async score(_photo, questions: Question[], signal) {
      if (state.delayMs)
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, state.delayMs);
          signal.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), {
            once: true,
          });
        });
      const answers: Record<string, Answer2> = {};
      for (const q of questions) {
        const given = state.answers[q.key];
        if (q.type === 'yesno')
          answers[q.key] = {
            type: 'yesno',
            p: typeof given === 'number' ? given : q.key.startsWith('zone_') ? 0.03 : 0.05,
          };
        else if (q.type === 'choice') {
          const choice =
            given && typeof given === 'object' && 'choice' in given && given.choice in q.options
              ? given.choice
              : 'other';
          answers[q.key] = {
            type: 'choice',
            choice,
            probabilities: Object.fromEntries(
              Object.keys(q.options).map((k) => [
                k,
                k === choice ? 0.9 : 0.1 / (Object.keys(q.options).length - 1),
              ]),
            ),
          };
        } else {
          const level = given && typeof given === 'object' && 'level' in given ? given.level : 0;
          answers[q.key] = {
            type: 'level',
            score: level,
            probabilities: q.levels.map((_, i) => (i === level ? 1 : 0)),
          };
        }
      }
      return { answers, inputTokens: 0, ms: state.delayMs ?? 0 };
    },
  };
}
