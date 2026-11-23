import {
  AnalysisResponseSchema,
  SCHEMA_VERSION,
  type AnalysisRequest,
  type AnalysisResponse,
} from '../../packages/core/schema';
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
export async function serviceHealth(connection: Connection, signal?: AbortSignal) {
  const url = validateServiceUrl(connection.url);
  const controller = new AbortController(),
    onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), 6000);
  let response: Response;
  try {
    response = await fetch(url + '/health', {
      headers: headers(connection),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? 'Check the service access token.'
        : 'The analysis service is unavailable.',
    );
  const data = await response.json();
  if (
    data.schemaVersion !== SCHEMA_VERSION ||
    typeof data.externalProvider !== 'boolean' ||
    typeof data.model !== 'string'
  )
    throw new Error('This service uses an incompatible response format.');
  return data as { status: string; provider: string; model: string; externalProvider: boolean };
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
      raw?.error?.message ??
        'The analysis could not be completed. Your photographs are still here.',
    );
  const parsed = AnalysisResponseSchema.parse(raw);
  if (parsed.assessmentId !== draft.id)
    throw new Error('The service returned a different assessment. Please try again.');
  return parsed;
}
