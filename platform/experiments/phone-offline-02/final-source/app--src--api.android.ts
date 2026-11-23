import {
  AnalysisResponseSchema,
  SCHEMA_VERSION,
  type AnalysisResponse,
} from '../../packages/core/schema';
import { decide } from '../../packages/core/policy';
import { checkCancelled, type DevicePhoto } from '../../packages/mobile/inspection';
import type { Draft } from './session';
import {
  DEVICE_MODEL,
  deviceInspector,
  devicePhotoInfo,
  offlineStatus,
  releaseDeviceEngine,
  prepareDeviceEngine,
} from './device-engine.android';
export type Connection = { url: string; token: string };
export type Health = {
  status: string;
  provider: string;
  model: string;
  externalProvider: boolean;
  coverage?: string;
};
export const isOnDevice = true;
export function validateServiceUrl(_value: string) {
  return 'local://relay-device';
}
export async function serviceHealth(
  _connection: Connection,
  signal?: AbortSignal,
): Promise<Health> {
  if (signal) checkCancelled(signal);
  await offlineStatus();
  if (signal) checkCancelled(signal);
  return {
    status: 'ok',
    provider: 'local_vlm',
    model: DEVICE_MODEL,
    externalProvider: false,
    coverage: 'visual_observations',
  };
}
export async function analyzeDraft(
  draft: Draft,
  _connection: Connection,
  _externalConsent: boolean,
  signal: AbortSignal,
  expected: { provider: string; model: string },
  progress?: (phase: string) => void,
): Promise<AnalysisResponse> {
  checkCancelled(signal);
  if (expected.provider !== 'local_vlm' || expected.model !== DEVICE_MODEL)
    throw Error('The offline engine changed. Please start the review again.');
  const started = performance.now();
  const exclusion = decide({ disclosures: draft.disclosures });
  if (exclusion.state === 'not_eligible')
    return AnalysisResponseSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      assessmentId: draft.id,
      status: 'excluded',
      photos: [],
      observation: null,
      decision: exclusion,
      timing: {
        totalMs: performance.now() - started,
        preprocessingMs: 0,
        inferenceMs: 0,
        cached: false,
      },
    });
  if (!draft.photos.length || draft.photos.length > 6)
    throw Error('Choose between one and six photographs.');
  progress?.('Preparing the offline engine');
  const preprocessing = performance.now(),
    images: DevicePhoto[] = [];
  for (const photo of draft.photos) {
    checkCancelled(signal);
    const info = await devicePhotoInfo(photo.uri);
    images.push({
      id: photo.id,
      view: photo.view,
      uri: photo.uri,
      quality: photo.quality,
      ...info,
    });
  }
  const preprocessingMs = performance.now() - preprocessing;
  const usable = images.filter(
    (p) => !p.quality.warnings.some((w) => ['dark', 'bright'].includes(w)),
  );
  let observation = null;
  try {
    if (usable.length) {
      const inferenceStarted = performance.now();
      progress?.('Preparing the offline engine');
      await prepareDeviceEngine(signal, progress);
      observation = await deviceInspector.analyze(usable, signal, progress);
      observation = { ...observation, durationMs: performance.now() - inferenceStarted };
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    console.warn(
      'Relay offline review failed',
      error instanceof Error ? error.name : 'UnknownError',
    );
    throw new Error(
      'The offline review could not finish. Your photographs are still here. Try one clear photo, or close other apps and try again.',
    );
  }
  checkCancelled(signal);
  const photos = images.map(({ uri, ...photo }) => photo);
  const result = AnalysisResponseSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    assessmentId: draft.id,
    status: 'complete',
    photos,
    observation,
    decision: decide({
      disclosures: draft.disclosures,
      photos,
      observation,
      corrections: draft.corrections,
    }),
    timing: {
      totalMs: performance.now() - started,
      preprocessingMs,
      inferenceMs: observation?.durationMs ?? 0,
      cached: false,
    },
  });
  return result;
}

export const clearAnalysisMemory = releaseDeviceEngine;
