import { CountReceiptSchema } from '../../packages/core/v2/count-review';
import {
  ReplacementStatusSchema,
  ReplacementTransitionSchema,
} from '../../packages/core/v2/replacement';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import { MarkedRegionSchema } from '../../packages/core/marked-region';
import { QualitySchema, ViewSchema } from '../../packages/core/schema';
export const BRIEFS_KEY = 'relay.briefs.v1';
export const StoredPhotoSchema = z.object({
  id: z.string(),
  view: ViewSchema,
  uri: z.string(),
  quality: QualitySchema,
  fromOverview: MarkedRegionSchema.optional(),
  width: z.number(),
  height: z.number(),
});
const BriefSchema = z.object({
  id: z.string().min(1).max(80),
  savedAt: z.string().datetime(),
  title: z.string().max(160),
  category: z.string().max(80),
  text: z.string().min(1).max(30000),
  photos: z.array(StoredPhotoSchema),
  countReceipt: CountReceiptSchema.optional(),
  replacedOverviews: z.array(ReplacementStatusSchema).optional(),
  replacementTransitions: z.array(ReplacementTransitionSchema).optional(),
});
const BriefsSchema = z.array(BriefSchema).max(50);
export type SavedBrief = z.infer<typeof BriefSchema>;
let queue: Promise<unknown> = Promise.resolve();
export async function readBriefs(): Promise<SavedBrief[]> {
  const raw = await AsyncStorage.getItem(BRIEFS_KEY);
  if (!raw) return [];
  try {
    return BriefsSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error('Saved briefs could not be read. Existing records have been left in place.');
  }
}
function changeBriefs(fn: (briefs: SavedBrief[]) => SavedBrief[]) {
  const operation = queue
    .catch(() => undefined)
    .then(async () => {
      const next = fn(await readBriefs());
      await AsyncStorage.setItem(BRIEFS_KEY, JSON.stringify(next));
      return next;
    });
  queue = operation;
  return operation;
}
export function saveBrief(input: SavedBrief) {
  const brief = BriefSchema.parse(input);
  return changeBriefs((current) => {
    const existing = current.filter((b) => b.id !== brief.id);
    if (existing.length >= 50)
      throw new Error(
        'Your notebook has 50 briefs. Export and remove a saved record before saving another.',
      );
    return [brief, ...existing];
  });
}
export function removeBrief(id: string) {
  return changeBriefs((current) => current.filter((b) => b.id !== id));
}
