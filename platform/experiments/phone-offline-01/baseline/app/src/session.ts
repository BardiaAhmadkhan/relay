import { readBriefs, StoredPhotoSchema } from './briefs';
import { prepareWebPhoto } from './photo-web';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import jpeg from 'jpeg-js';
import { z } from 'zod';
import {
  DisclosureSchema,
  CorrectionSchema,
  QualitySchema,
  AnalysisResponseSchema,
  type PhotoView,
} from '../../packages/core/schema';
import { analyzePixels } from '../../packages/core/quality';
export const DRAFT_KEY = 'relay.draft.v1',
  SETTINGS_KEY = 'relay.connection.v1',
  CLEANUP_KEY = 'relay.cleanup.v1';
const PhotoSchema = StoredPhotoSchema;
const DraftSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  updatedAt: z.string(),
  disclosures: z.array(DisclosureSchema),
  corrections: z.array(CorrectionSchema),
  photos: z.array(PhotoSchema).max(6),
  result: z.unknown().optional(),
});
export type LocalPhoto = z.infer<typeof PhotoSchema>;
export type Draft = Omit<z.infer<typeof DraftSchema>, 'result'> & {
  result: z.infer<typeof AnalysisResponseSchema> | null;
};
export const newDraft = (): Draft => ({
  version: 1,
  id: Crypto.randomUUID(),
  updatedAt: new Date().toISOString(),
  disclosures: [],
  corrections: [],
  photos: [],
  result: null,
});
const directory = FileSystem.documentDirectory
  ? FileSystem.documentDirectory + 'relay-drafts/'
  : null;
let saveChain = Promise.resolve();
export function persistDraft(draft: Draft | null) {
  const next = saveChain
    .catch(() => undefined)
    .then(() =>
      draft
        ? AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
        : AsyncStorage.removeItem(DRAFT_KEY),
    );
  saveChain = next;
  return next;
}
export async function removePhoto(photo: Pick<LocalPhoto, 'uri'>) {
  if (
    Platform.OS !== 'web' &&
    directory &&
    photo.uri.startsWith(directory) &&
    /^[a-f0-9-]{36}\.jpg$/i.test(photo.uri.slice(directory.length))
  ) {
    const saved = await readBriefs();
    if (!saved.some((brief) => brief.photos.some((p) => p.uri === photo.uri)))
      await FileSystem.deleteAsync(photo.uri, { idempotent: true });
  }
}
export async function removeCaptureCache(uri: string) {
  if (
    Platform.OS !== 'web' &&
    FileSystem.cacheDirectory &&
    uri.startsWith(FileSystem.cacheDirectory) &&
    !uri.split('/').includes('..') &&
    !/%2e/i.test(uri)
  )
    await FileSystem.deleteAsync(uri, { idempotent: true });
}
async function finishPendingCleanup() {
  const pending = await AsyncStorage.getItem(CLEANUP_KEY);
  if (!pending) return;
  const job = z
    .object({ id: z.string(), uris: z.array(z.string()).max(6) })
    .parse(JSON.parse(pending));
  await Promise.all(job.uris.map((uri) => removePhoto({ uri })));
  const current = await AsyncStorage.getItem(DRAFT_KEY);
  if (current) {
    try {
      if (JSON.parse(current).id === job.id) await AsyncStorage.removeItem(DRAFT_KEY);
    } catch {
      /* Corrupt metadata is handled by loadDraft. */
    }
  }
  await AsyncStorage.removeItem(CLEANUP_KEY);
}
export async function forgetDraft(draft: Draft | null) {
  await saveChain.catch(() => undefined);
  if (!draft) {
    await persistDraft(null);
    return;
  }
  // The tombstone survives process interruption and partial filesystem failure.
  await AsyncStorage.setItem(
    CLEANUP_KEY,
    JSON.stringify({ id: draft.id, uris: draft.photos.map((p) => p.uri) }),
  );
  await finishPendingCleanup();
}
async function removeOrphans(retained: LocalPhoto[]) {
  if (Platform.OS === 'web' || !directory) return;
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) return;
  const archived = await readBriefs();
  const keep = new Set([...retained, ...archived.flatMap((b) => b.photos)].map((p) => p.uri));
  for (const filename of await FileSystem.readDirectoryAsync(directory)) {
    if (!/^[a-f0-9-]{36}\.jpg$/i.test(filename)) continue;
    const uri = directory + filename;
    if (!keep.has(uri)) await removePhoto({ uri });
  }
}
export async function loadDraft(): Promise<{ draft: Draft | null; notice?: string }> {
  let cleanupNotice: string | undefined;
  try {
    await finishPendingCleanup();
  } catch {
    cleanupNotice =
      'Some local photos could not be removed. Retry removal in Connection & privacy.';
  }
  const stored = await AsyncStorage.getItem(DRAFT_KEY);
  if (!stored) {
    await removeOrphans([]).catch(() => undefined);
    return { draft: null, notice: cleanupNotice };
  }
  let draft: Draft;
  try {
    const saved = DraftSchema.parse(JSON.parse(stored));
    const analysis = AnalysisResponseSchema.safeParse(saved.result);
    draft = { ...saved, result: analysis.success ? analysis.data : null };
    if (saved.result != null && !analysis.success)
      cleanupNotice =
        'Your photos and history were restored. Refresh the previous analysis for the current review rules.';
  } catch {
    // Keep metadata if cleanup fails, so there is a recovery path after restart.
    try {
      await removeOrphans([]);
      await AsyncStorage.removeItem(DRAFT_KEY);
    } catch {
      return {
        draft: null,
        notice:
          'A saved draft is unreadable and local cleanup is pending. Reopen the app to retry.',
      };
    }
    return {
      draft: null,
      notice: 'A saved draft could not be restored. Its owned photographs were removed.',
    };
  }
  if (Date.now() - new Date(draft.updatedAt).getTime() > 24 * 60 * 60 * 1000) {
    try {
      await forgetDraft(draft);
      await removeOrphans([]);
      return {
        draft: null,
        notice: 'Your previous experimental draft expired after 24 hours of inactivity.',
      };
    } catch {
      return {
        draft,
        notice:
          'An expired draft could not be fully removed. Retry removal in Connection & privacy.',
      };
    }
  }
  if (Platform.OS !== 'web') {
    const existence = await Promise.all(draft.photos.map((p) => FileSystem.getInfoAsync(p.uri)));
    const photos = draft.photos.filter((_, i) => existence[i]?.exists);
    if (photos.length !== draft.photos.length) draft = { ...draft, photos, result: null };
    await removeOrphans(photos).catch(() => undefined);
    if (photos.length !== existence.length)
      return { draft, notice: 'Some photos are no longer on this device. Add those views again.' };
  }
  return { draft, notice: cleanupNotice };
}
function decode64(text: string) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
export async function preparePhoto(
  uri: string,
  view: PhotoView,
  width: number,
  height: number,
): Promise<LocalPhoto> {
  const id = Crypto.randomUUID();
  if (Platform.OS === 'web') return prepareWebPhoto(uri, view, id);
  const temporary = new Set<string>([uri]);
  let retained: string | null = null,
    success = false;
  try {
    if (!directory) throw new Error('Persistent photo storage is unavailable on this device.');
    const context = ImageManipulator.manipulate(uri);
    if (Math.max(width, height) > 1600)
      context.resize(width >= height ? { width: 1600 } : { height: 1600 });
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({
      compress: 0.82,
      format: SaveFormat.JPEG,
      base64: false,
    });
    temporary.add(saved.uri);
    const previewContext = ImageManipulator.manipulate(saved.uri);
    previewContext.resize(saved.width >= saved.height ? { width: 192 } : { height: 192 });
    const preview = await (
      await previewContext.renderAsync()
    ).saveAsync({ compress: 0.9, format: SaveFormat.JPEG, base64: true });
    temporary.add(preview.uri);
    if (!preview.base64) throw new Error('Could not check the photograph. Please try again.');
    const pixels = jpeg.decode(decode64(preview.base64), {
      useTArray: true,
      formatAsRGBA: true,
      maxMemoryUsageInMB: 32,
    });
    const quality = analyzePixels(
      pixels.data,
      pixels.width,
      pixels.height,
      saved.width,
      saved.height,
    );
    let finalUri = saved.uri;
    if (directory) {
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      retained = directory + id + '.jpg';
      await FileSystem.copyAsync({ from: saved.uri, to: retained });
      finalUri = retained;
    }
    success = true;
    return { id, view, uri: finalUri, width: saved.width, height: saved.height, quality };
  } finally {
    for (const temp of temporary) await removeCaptureCache(temp).catch(() => undefined);
    if (!success && retained) await removePhoto({ uri: retained }).catch(() => undefined);
  }
}
export async function photoBase64(photo: LocalPhoto) {
  if (photo.uri.startsWith('data:image/jpeg;base64,')) return photo.uri.split(',')[1]!;
  if (Platform.OS !== 'web')
    return FileSystem.readAsStringAsync(photo.uri, { encoding: FileSystem.EncodingType.Base64 });
  const blob = await (await fetch(photo.uri)).blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]!);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
