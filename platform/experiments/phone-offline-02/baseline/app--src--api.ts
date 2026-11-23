import {
  AnalysisResponseSchema,
  SCHEMA_VERSION,
  type AnalysisRequest,
  type AnalysisResponse,
} from '../../packages/core/schema';
import { decide } from '../../packages/core/policy';
import { validateFindings } from '../../packages/vision/validation';
import type { Draft } from './session';
import { photoBase64 } from './session';
export type Connection = { url: string; token: string };
export function validateServiceUrl(value: string): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['http:', 'https:'].includes(url.protocol)
  )
    throw new Error('Use a service URL without credentials, query parameters or fragments.');
  const local =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]' ||
    /^10\.\d+\.\d+\.\d+$/.test(url.hostname) ||
    /^192\.168\.\d+\.\d+$/.test(url.hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(url.hostname);
  if (url.protocol !== 'https:' && !local) throw new Error('Remote services require HTTPS.');
  return url.toString().replace(/\/$/, '');
}
function headers(connection: Connection) {
  return {
    'Content-Type': 'application/json',
    ...(connection.token ? { 'X-Relay-Token': connection.token } : {}),
  };
}
export type Health = {
  status: string;
  provider: string;
  model: string;
  externalProvider: boolean;
  coverage?: string;
};
export async function serviceHealth(connection: Connection, signal?: AbortSignal): Promise<Health> {
  const url = validateServiceUrl(connection.url),
    controller = new AbortController(),
    onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(url + '/health', {
      headers: headers(connection),
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? 'Check the service access token.'
          : 'The analysis service is unavailable.',
      );
    const data = await response.json();
    if (
      data.schemaVersion !== SCHEMA_VERSION ||
      data.status !== 'ok' ||
      typeof data.externalProvider !== 'boolean' ||
      typeof data.model !== 'string' ||
      !data.model.length ||
      !['local_clip', 'local_siglip', 'local_vlm', 'openai', 'gemini', 'test'].includes(
        data.provider,
      ) ||
      data.externalProvider !== ['openai', 'gemini'].includes(data.provider)
    )
      throw new Error('This service uses an incompatible response format.');
    return data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
export async function analyzeDraft(
  draft: Draft,
  connection: Connection,
  externalConsent: boolean,
  signal: AbortSignal,
  expected: { provider: string; model: string },
): Promise<AnalysisResponse> {
  const images = await Promise.all(
    draft.photos.map(async (p) => ({ id: p.id, view: p.view, base64: await photoBase64(p) })),
  );
  // React Native's AbortSignal does not implement throwIfAborted on all engines.
  if (signal.aborted) {
    const cancelled = new Error('Analysis cancelled before upload.');
    cancelled.name = 'AbortError';
    throw cancelled;
  }
  const body: AnalysisRequest = {
    schemaVersion: SCHEMA_VERSION,
    assessmentId: draft.id,
    disclosures: draft.disclosures,
    corrections: draft.corrections,
    images,
    consent: {
      processImages: true,
      externalProvider: externalConsent,
      expectedProvider: expected.provider,
      expectedModel: expected.model,
    },
  };
  const response = await fetch(validateServiceUrl(connection.url) + '/assess', {
    method: 'POST',
    headers: headers(connection),
    body: JSON.stringify(body),
    signal,
  });
  const raw = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof raw?.error?.message === 'string' && raw.error.message.length < 350
        ? raw.error.message
        : 'The analysis could not be completed. Your photographs are still here.',
    );
  const validated = AnalysisResponseSchema.safeParse(raw);
  if (!validated.success)
    throw new Error(
      'The service returned an incomplete result. Your photographs are still here; please try again.',
    );
  const parsed = validated.data;
  if (parsed.assessmentId !== draft.id)
    throw new Error('The service returned a different assessment. Please try again.');
  if (parsed.status === 'excluded') {
    if (
      decide({ disclosures: draft.disclosures }).state !== 'not_eligible' ||
      parsed.observation ||
      parsed.photos.length
    )
      throw new Error('The service returned an inconsistent result. Please try again.');
  } else if (
    parsed.photos.length !== images.length ||
    new Set(parsed.photos.map((p) => p.id)).size !== images.length ||
    parsed.photos.some((p) => !images.some((i) => i.id === p.id && i.view === p.view))
  )
    throw new Error('The result does not match your photographs. Please try again.');
  if (parsed.observation) {
    const o = parsed.observation;
    if (
      o.provider !== expected.provider ||
      o.model !== expected.model ||
      (['openai', 'gemini'].includes(o.provider) && !externalConsent)
    )
      throw new Error('The analysis provider changed. Check the connection and review again.');
    if (
      ['local_clip', 'local_siglip'].includes(o.provider) &&
      (o.coverage !== 'category_only' || o.concerns.length || o.attributes.length || o.inspection)
    )
      throw new Error('The service returned an incompatible analysis. Please try again.');
    try {
      const inspectedIds = parsed.photos
        .filter(
          (p) =>
            o.provider !== 'local_vlm' ||
            !p.quality.warnings.some((w) => ['dark', 'bright'].includes(w)),
        )
        .map((p) => p.id);
      validateFindings(o, new Set(inspectedIds));
    } catch {
      throw new Error('The findings could not be linked to your photographs. Please try again.');
    }
  }
  // The mobile client also owns its deterministic decision. Never render a provider-supplied decision as authority.
  parsed.decision = decide({
    disclosures: draft.disclosures,
    photos: parsed.photos,
    observation: parsed.observation,
    corrections: draft.corrections,
  });
  return parsed;
}
