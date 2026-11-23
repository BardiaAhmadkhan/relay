import { CountReceiptSchema } from '../../packages/core/v2/count-review';
import {
  ReplacementStatusSchema,
  ReplacementTransitionSchema,
  SignedFindingSchema,
  isCue,
  type SignedFinding,
  type ReplacementStatus,
} from '../../packages/core/v2/replacement';
import {
  EarlierAssessmentSchema,
  type EarlierAssessment,
  type ReplacedOverview,
} from '../../packages/core/v2/schema';
import type { HistoricalArea } from '../../packages/core/v2/schema';
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
import {
  DecisionSchema2,
  PhotoRecordSchema,
  SignedScoresSchema,
} from '../../packages/core/v2/schema';
export const DRAFT_KEY = 'relay.draft.v1',
  SETTINGS_KEY = 'relay.connection.v1',
  CLEANUP_KEY = 'relay.cleanup.v1';
/** The v2 service's record of one photograph (work package 11): the prepared photograph's hash and
 * quality, the signed score record, and the retake hints. Kept with the photograph so a restored
 * draft does not have to be checked again. Saved briefs never store it. */
export const V2PhotoSchema = z.object({
  record: PhotoRecordSchema,
  signed: SignedScoresSchema,
  scoreContext: z.string().optional(),
  retainOnReplacement: z.boolean().optional(),
  feedback: z.array(z.object({ code: z.string(), text: z.string() })).max(8),
});
const PhotoSchema = StoredPhotoSchema.extend({
  v2: V2PhotoSchema.optional(),
  finding: SignedFindingSchema.optional(),
});
const ReplacedLocalSchema = z.object({
  photo: PhotoSchema,
  replacementId: z.string().nullable(),
  legacyAssessment: EarlierAssessmentSchema.optional(),
  status: ReplacementStatusSchema.optional(),
  originalExclusion: DecisionSchema2.optional(),
});
const DraftSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  updatedAt: z.string(),
  disclosures: z.array(DisclosureSchema),
  corrections: z.array(CorrectionSchema),
  photos: z.array(PhotoSchema).max(6),
  historicalAreas: z
    .array(
      z.object({
        crop: PhotoSchema.extend({ fromOverview: StoredPhotoSchema.shape.fromOverview.unwrap() }),
        overview: PhotoSchema.optional(),
      }),
    )
    .max(6)
    .optional(),
  countReceipt: CountReceiptSchema.optional().catch(undefined),
  replacedOverviews: z.array(ReplacedLocalSchema).optional(),
  replacementTransitions: z.array(ReplacementTransitionSchema).optional(),
  result: z.unknown().optional(),
  /** The v2 service's decision, cleared whenever a photograph or an answer changes. */
  decision2: DecisionSchema2.nullable().optional(),
  /** How many close-ups the v2 service has asked for in this assessment (policy maxCloseUpRequests). */
  closeUps: z.number().int().min(0).max(3).optional(),
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
  decision2: null,
  closeUps: 0,
});
export function allDraftPhotos(draft: Draft): LocalPhoto[] {
  const photos = [
    ...draft.photos,
    ...(draft.replacedOverviews ?? []).map((e) => e.photo),
    ...(draft.historicalAreas ?? []).flatMap((a) => (a.overview ? [a.crop, a.overview] : [a.crop])),
  ];
  return [...new Map(photos.map((p) => [p.id, p])).values()];
}
export function historicReceipts(draft: Draft): HistoricalArea[] {
  return (draft.historicalAreas ?? []).map(({ crop, overview }) => ({
    photoId: crop.id,
    region: crop.fromOverview!,
    cropSha256: crop.v2?.record.sha256,
    cropReceipt: crop.v2?.signed,
    overviewSha256: overview?.v2?.record.sha256,
    overviewReceipt: overview?.v2?.signed,
  }));
}
export function replacementNotes(draft: Draft): ReplacementStatus[] {
  return (draft.replacedOverviews ?? []).map((entry) => {
    if (entry.status) return { ...entry.status, replacementId: entry.replacementId };
    const photo = entry.photo,
      finding = photo.finding?.finding;
    const bound =
      finding?.assessmentId === draft.id &&
      finding.photoId === photo.id &&
      finding.sha256 === photo.v2?.record.sha256;
    const status =
      (bound && finding.kind === 'exclusion') || entry.originalExclusion
        ? 'unverified_exclusion'
        : (bound && finding.kind === 'observation') || photo.v2?.retainOnReplacement
          ? 'possible'
          : 'unverified';
    return {
      photoId: photo.id,
      view: photo.view as 'front' | 'back',
      replacementId: entry.replacementId,
      sha256: photo.v2?.record.sha256,
      status,
      codes: bound ? finding.codes : [],
    };
  });
}

export function retainedReceipts(draft: Draft): ReplacedOverview[] {
  return (draft.replacedOverviews ?? []).map((e) => ({
    photoId: e.photo.id,
    view: e.photo.view as 'front' | 'back',
    replacementId: e.replacementId,
    record: e.photo.v2?.record,
    signed: e.photo.v2?.signed,
    finding: e.photo.finding,
    legacyAssessment: e.legacyAssessment,
    ...(e.originalExclusion ? { previouslyExcluded: true as const } : {}),
  }));
}
/** A specialist reconciles a previously displayed exclusion when the service or signing key changes. */
export function rememberedExclusion(
  draft: Draft,
  statuses: Array<{ photoId: string; status: string }>,
) {
  const prior = draft.replacedOverviews?.find((e) => {
    if (statuses.some((s) => s.photoId === e.photo.id && s.status === 'confirmed_exclusion'))
      return false;
    const f = e.photo.finding?.finding;
    const matches =
      !!f &&
      f.kind === 'exclusion' &&
      f.assessmentId === draft.id &&
      f.photoId === e.photo.id &&
      f.view === e.photo.view &&
      f.sha256 === e.photo.v2?.record.sha256 &&
      f.sha256 === e.photo.v2?.signed.scores.sha256;
    return !!e.originalExclusion || matches;
  });
  if (!prior) return null;
  const f = prior.photo.finding?.finding;
  const earlier = prior.originalExclusion;
  const decision: z.infer<typeof DecisionSchema2> = {
    outcome: 'review',
    grade: null,
    requestPhoto: null,
    protectivePerformanceCertified: false,
    policyVersion: earlier?.policyVersion ?? f!.policyVersion,
    thresholdsVersion: earlier?.thresholdsVersion ?? f!.thresholdsVersion,
    category: earlier?.category ?? 'unknown',
    title: 'A specialist will take a look',
    summary: 'An earlier exclusion needs to be reconciled.',
    nextAction:
      'Show the saved record to the specialist. The current service could not verify the original finding.',
    reasons: [
      {
        code: 'previous_exclusion_unreconciled',
        photoId: prior.photo.id,
        question: null,
        score: null,
        text:
          'The saved ' +
          prior.photo.view +
          ' photograph previously led to an exclusion. Its earlier receipt is unverified on this service.',
      },
    ],
  };
  return decision;
}
export function retainFinding(current: SignedFinding | undefined, next: SignedFinding) {
  return current?.finding.kind === 'exclusion' && current.finding.sha256 === next.finding.sha256
    ? current
    : next;
}
/** Transfer ownership before the photograph is removed. Use the actual previous disposition
 * if the original version had no finding receipt. Superseded images never count toward coverage. */
export function changePhoto(
  d: Draft,
  old: LocalPhoto | undefined,
  next: LocalPhoto | null,
  pending: boolean,
): Draft {
  let retained = [...(d.replacedOverviews ?? [])];
  if (next) {
    retained = retained
      .filter((e) => e.photo.id !== next.id)
      .map((e) =>
        e.replacementId === null && e.photo.view === next.view
          ? { ...e, replacementId: next.id }
          : e,
      );
  }
  if (old && (old.view === 'front' || old.view === 'back')) {
    const previousReason = d.decision2?.reasons.some(
      (reason) => reason.photoId === old.id && isCue(reason.code),
    );
    const needsReceipt = pending || (!!old.v2 && old.v2.retainOnReplacement === undefined);
    if (old.finding || previousReason || old.v2?.retainOnReplacement === true || needsReceipt) {
      let legacyAssessment: EarlierAssessment | undefined;
      if (previousReason && !old.finding && d.photos.every((p) => p.v2)) {
        legacyAssessment = {
          photos: d.photos.map((p) => p.v2!.record),
          signedScores: d.photos.map((p) => p.v2!.signed),
          disclosures: d.disclosures,
          closeUpsRequested: d.closeUps ?? 0,
        };
      }
      const originalExclusion =
        d.decision2?.outcome === 'no_offer' &&
        d.decision2.reasons.some((r) => r.photoId === old.id && r.code.startsWith('visible_'))
          ? d.decision2
          : undefined;
      if (!retained.some((e) => e.photo.id === old.id))
        retained.push({
          photo: old,
          replacementId: next?.id ?? null,
          legacyAssessment,
          originalExclusion,
        });
    }
  }
  const photos = d.photos.filter((p) => p.id !== old?.id && p.id !== next?.id);
  if (next) photos.push(next);
  return {
    ...d,
    photos,
    replacedOverviews: retained.length ? retained : undefined,
    result: null,
    decision2: null,
    updatedAt: new Date().toISOString(),
  };
}
function restoreHistoricalAreas(draft: Draft): Draft {
  const marked = draft.photos.filter((p) => p.fromOverview);
  if (!marked.length)
    return draft.historicalAreas?.length && draft.decision2?.outcome === 'offer'
      ? { ...draft, decision2: null, result: null }
      : draft;
  const previous = draft.historicalAreas ?? [];
  const areas = marked
    .filter((crop) => !previous.some((a) => a.crop.id === crop.id))
    .map((crop) => ({
      crop: { ...crop, fromOverview: crop.fromOverview! },
      overview: draft.photos.find(
        (p) =>
          p.id === crop.fromOverview!.parentId &&
          p.view === crop.fromOverview!.parentView &&
          !p.fromOverview,
      ),
    }));
  return {
    ...draft,
    photos: draft.photos.filter((p) => !p.fromOverview),
    historicalAreas: [...previous, ...areas],
    decision2: null,
    result: null,
  };
}
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
/** Keep the prior files recoverable until the new metadata is durably written. */
export async function persistDraftWithCleanup(
  draft: Draft | null,
  retired: Set<string>,
  current: () => Draft | null,
) {
  await persistDraft(draft);
  const retained = new Set(draft ? allDraftPhotos(draft).map((p) => p.uri) : []);
  for (const uri of retired) {
    if (current() !== draft) return;
    if (retained.has(uri)) continue;
    try {
      await removePhoto({ uri });
      retired.delete(uri);
    } catch {
      /* A later save or the normal orphan sweep retries owned files. */
    }
  }
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
  if (Platform.OS === 'web' && uri.startsWith('blob:')) URL.revokeObjectURL(uri);
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
  const job = z.object({ id: z.string(), uris: z.array(z.string()) }).parse(JSON.parse(pending));
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
    JSON.stringify({ id: draft.id, uris: allDraftPhotos(draft).map((p) => p.uri) }),
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
    const raw = JSON.parse(stored);
    // Some early drafts have only geometry or a receipt from a service that is now gone.
    // Preserve the photograph and the concern even when its optional receipt is malformed.
    if (Array.isArray(raw?.photos)) {
      const parents = new Set(
        raw.photos
          .filter((p: { fromOverview?: { parentId?: string } } | null) => p?.fromOverview)
          .map((p: { fromOverview: { parentId: string } }) => p.fromOverview.parentId),
      );
      for (const p of raw.photos)
        if (
          p &&
          (p.fromOverview || parents.has(p.id)) &&
          p.v2 &&
          !V2PhotoSchema.safeParse(p.v2).success
        )
          delete p.v2;
    }
    const saved = DraftSchema.parse(raw);
    const analysis = AnalysisResponseSchema.safeParse(saved.result);
    draft = restoreHistoricalAreas({ ...saved, result: analysis.success ? analysis.data : null });
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
    if (photos.length !== draft.photos.length)
      draft = { ...draft, photos, result: null, decision2: null };
    await removeOrphans(allDraftPhotos(draft)).catch(() => undefined);
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
  readOrientedSize = false,
): Promise<LocalPhoto> {
  const id = Crypto.randomUUID();
  if (Platform.OS === 'web') return prepareWebPhoto(uri, view, id);
  const temporary = new Set<string>([uri]);
  let retained: string | null = null,
    success = false;
  try {
    if (!directory) throw new Error('Persistent photo storage is unavailable on this device.');
    // Read the oriented dimensions before reducing a camera image. This preserves the original
    // acquisition path for overview photos, including EXIF-rotated portrait shots.
    const decoded = readOrientedSize ? await ImageManipulator.manipulate(uri).renderAsync() : null;
    if (decoded) {
      width = decoded.width;
      height = decoded.height;
      if (width * height > 50_000_000) throw new Error('Choose a photograph under 50 megapixels.');
    }
    const context = ImageManipulator.manipulate(decoded ?? uri);
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
