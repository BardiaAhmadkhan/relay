import type { PhotoView } from '../../core/schema';
import type { Answer2, Thresholds } from '../../core/v2/schema';
import { ZONE_QUESTIONS, type Question } from './battery';
import type { Scorer, ScoreResult } from './scorer';

/** v3 question plan (added 2026-11-17): ask only what the decision can use, decisive questions first.
 *
 * Read from packages/core/v2/policy.ts (decide2), which is the only consumer of the answers:
 * - `material` is never read, and neither is `label_class`. Not asked.
 * - Road-contact damage in the block band is "no offer" wherever it is and whatever else is true
 *   (rule 2), so once it is seen nothing more about this photograph can change the outcome.
 * - `wear` only sets the grade on the offer path (rule 11). A photograph with damage or a repair at or
 *   above its clear threshold can never reach that path (rules 2 and 7 return first), so it is skipped.
 * - Zone questions change the outcome only for broken material or a repair in the block band (rule 2,
 *   protective or not). In the review band they only reword a hint, so they are skipped there.
 * - `gear` and `single_item` are read for front and back photographs only (rule 6).
 * The property test in tests/v3-plan.test.ts checks over random cases that the outcome, grade and
 * requested photograph are identical with and without the plan.
 */
export type Bands = Thresholds['perScorer'][keyof Thresholds['perScorer']];
const yes = (answers: Record<string, Answer2>, key: string) => {
  const a = answers[key];
  return a?.type === 'yesno' ? a.p : null;
};

/** The keys to ask next, given what is known; an empty list means the photograph is done. */
export function nextKeys(
  view: PhotoView,
  answers: Record<string, Answer2>,
  bands: Bands | undefined,
): string[] {
  const has = (k: string) => k in answers;
  if (view === 'label') return ['label_legible', 'label_ce'].filter((k) => !has(k));
  if (!has('road_contact')) return ['road_contact'];
  const road = yes(answers, 'road_contact') ?? 0;
  // The outcome is fixed ("no offer"), but the item's category still feeds the protective-zone lookup
  // that words the other photographs' reasons, so front and back keep their category question. Without
  // it the property test found a reason claiming a protective area the full answers ruled out.
  if (bands && road >= bands.damage.block)
    return view === 'front' || view === 'back' ? ['category'].filter((k) => !has(k)) : [];
  const stage2 = ['broken', 'repair', 'usable'].filter((k) => !has(k));
  if (stage2.length) return stage2;
  const stage3 = (view === 'detail' ? ['category'] : ['gear', 'single_item', 'category']).filter(
    (k) => !has(k),
  );
  if (stage3.length) return stage3;
  const broken = yes(answers, 'broken') ?? 0,
    repair = yes(answers, 'repair') ?? 0;
  const flagged =
    !bands || Math.max(broken, road) >= bands.damage.clear || repair >= bands.repair.clear;
  if (!flagged && !has('wear')) return ['wear'];
  if (!bands) return has('wear') ? [] : ['wear'];
  const zoneDecides = broken >= bands.damage.block || repair >= bands.repair.block;
  const category = answers.category;
  if (zoneDecides && category?.type === 'choice')
    return (ZONE_QUESTIONS[category.choice] ?? []).map((q) => q.key).filter((k) => !has(k));
  return [];
}

/** For scorers that bill per image rather than per question (a hosted closed-question service), one
 * request is cheaper than stages: keep only the questions the rules can ever read, all at once. */
export function staticKeys(view: PhotoView, questions: Question[]): Question[] {
  const unread = new Set(['material', 'label_class']);
  if (view === 'detail') unread.add('gear').add('single_item');
  return questions.filter((q) => !unread.has(q.key));
}

type Band = { clear: number; block: number };
/** On front and back photographs these need every pixel: small damage disappears at 512 px (E18). */
const FULL_SIZE_ON_WHOLE_ITEMS = new Set(['road_contact', 'broken', 'repair', 'usable']);
/** Order-preserving map from a first-stage score onto the policy's scale that keeps the band: below
 * `from.clear` lands below `to.clear`, at or above `from.block` lands at or above `to.block`, and the
 * band between maps between. So a photograph the cheap stage decides gets the same band from the
 * unchanged policy thresholds. */
export function toPolicyScale(s: number, from: Band, to: Band): number {
  if (s < from.clear) return from.clear > 0 ? (s / from.clear) * to.clear * 0.999 : 0;
  if (s >= from.block)
    return Math.min(
      1,
      to.block + ((s - from.block) / Math.max(1e-9, 1 - from.block)) * (1 - to.block),
    );
  return (
    to.clear +
    ((s - from.clear) / Math.max(1e-9, from.block - from.clear)) * (to.block - to.clear) * 0.999
  );
}

/** Wraps a per-question scorer (the local one: one model call per question) so that it answers the
 * plan instead of the whole battery. One record, one scorer: every stage goes to the same inner
 * scorer, so the chain's fallback still applies to the whole photograph.
 *
 * With `cascade` (v3, experiment report E13 and E14) and a small rendition of the photograph
 * (`photo.low`, 512 px):
 * - CLOSE-UPS (`detail`): every question is asked on the small image. Only when the larger of the two
 *   damage answers lands in the small image's own review band are `road_contact` and `broken` asked
 *   again on the full working image (1600 px), whose answers then stand as they are. Answers the small
 *   image decides are mapped onto the policy's scale (toPolicyScale), and the raw small-image answers are
 *   kept as `road_contact_low` and `broken_low` for the expert and for later calibration.
 * - WHOLE-ITEM VIEWS (`front`, `back`, v3.1): the damage questions (`road_contact`, `broken`, `repair`)
 *   and `usable` are asked on the full image; only `gear`, `single_item`, `category` and `wear` use the
 *   small one. E18 (needle mosaics) showed that damage covering under about 1% of the frame, a tear on a
 *   whole jacket, is invisible at 512 px: the first cascade cleared 41 damaged mosaics that 1600 px alone
 *   would not have. E16 showed category, gear and wear unchanged at 512 px.
 * - LABELS always use the full image: small print needs the pixels. */
export class PlannedScorer implements Scorer {
  readonly id: Scorer['id'];
  readonly model: string;
  constructor(
    private readonly inner: Scorer,
    private readonly bandsFor: (id: Scorer['id']) => Bands | undefined,
    private readonly cascade?: (id: Scorer['id']) => Bands | undefined,
  ) {
    this.id = inner.id;
    this.model = inner.model + (cascade ? ' cascade' : '');
  }
  async score(
    photo: { jpeg: Uint8Array; view: PhotoView; low?: Uint8Array },
    questions: Question[],
    signal: AbortSignal,
  ): Promise<ScoreResult> {
    const available = new Map(questions.map((q) => [q.key, q]));
    for (const zones of Object.values(ZONE_QUESTIONS))
      for (const z of zones) available.set(z.key, z);
    const answers: Record<string, Answer2> = {};
    let inputTokens = 0,
      ms = 0;
    const ask = async (keys: string[], image: Uint8Array) => {
      const wanted = keys.filter((k) => available.has(k));
      if (!wanted.length) return {} as Record<string, Answer2>;
      const result = await this.inner.score(
        { ...photo, jpeg: image },
        wanted.map((k) => available.get(k)!),
        signal,
      );
      inputTokens += result.inputTokens;
      ms += result.ms;
      return result.answers;
    };
    const policy = this.bandsFor(this.inner.id),
      stage1 = this.cascade?.(this.inner.id);
    // The damage cascade runs on close-ups only (v3.1, E18); whole items keep damage at full size.
    if (stage1 && policy && photo.low && photo.view === 'detail') {
      const low = photo.low;
      const first = await ask(['road_contact'], low);
      const road1 = yes(first, 'road_contact');
      if (first.road_contact) answers.road_contact_low = first.road_contact;
      if (road1 !== null && road1 >= stage1.damage.block) {
        answers.road_contact = {
          type: 'yesno',
          p: toPolicyScale(road1, stage1.damage, policy.damage),
        };
      } else {
        const second = await ask(['broken', 'repair', 'usable'], low);
        for (const k of ['repair', 'usable']) if (second[k]) answers[k] = second[k]!;
        if (second.broken) answers.broken_low = second.broken;
        const broken1 = yes(second, 'broken');
        const m1 = Math.max(road1 ?? 0, broken1 ?? 0);
        if (m1 < stage1.damage.clear || m1 >= stage1.damage.block) {
          if (road1 !== null)
            answers.road_contact = {
              type: 'yesno',
              p: toPolicyScale(road1, stage1.damage, policy.damage),
            };
          if (broken1 !== null)
            answers.broken = {
              type: 'yesno',
              p: toPolicyScale(broken1, stage1.damage, policy.damage),
            };
        } else Object.assign(answers, await ask(['road_contact', 'broken'], photo.jpeg));
      }
    }
    for (let stage = 0; stage < 8; stage++) {
      const keys = nextKeys(photo.view, answers, policy).filter((k) => available.has(k));
      if (!keys.length) break;
      // Which image: labels and zone questions always the full one; on whole items the damage questions
      // and `usable` too (E18); everything else the small one when cascading (E16).
      const full =
        !stage1 ||
        !photo.low ||
        photo.view === 'label' ||
        keys.every((k) => k.startsWith('zone_')) ||
        (photo.view !== 'detail' && keys.some((k) => FULL_SIZE_ON_WHOLE_ITEMS.has(k)));
      Object.assign(answers, await ask(keys, full ? photo.jpeg : photo.low!));
    }
    return { answers, inputTokens, ms };
  }
}
