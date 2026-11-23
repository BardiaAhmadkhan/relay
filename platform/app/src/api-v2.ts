import {
  bindingCountPhoto,
  CountReceiptSchema,
  type CountReceipt,
} from '../../packages/core/v2/count-review';
import {
  ReplacementStatusSchema,
  ReplacementTransitionSchema,
  SignedFindingSchema,
  preserveExclusions,
} from '../../packages/core/v2/replacement';
import { z } from 'zod';
import { withHistoricalAreas, historicalReason } from '../../packages/core/v2/historical-areas';
import { Questions, type Disclosure } from '../../packages/core/schema';
import {
  DecisionSchema2,
  PhotoRecordSchema,
  SCHEMA_VERSION_2,
  SignedScoresSchema,
  type Decision2,
  type HistoricalArea,
  type ReplacedOverview,
  type PhotoRecord,
  type SignedScores,
} from '../../packages/core/v2/schema';

/** Client for the backend v2 service. No UI and no device modules, so it runs in Expo Go and in tests.
 *
 * Flow: call scorePhoto() as soon as a photograph is accepted and keep the returned record with the
 * draft photo; call assess() when the rider asks for the result. The service stores nothing.
 * The service holds the calibrated thresholds, so its decision is used, but only after the checks in
 * safetyFloor(): a reported exclusion can never come back as anything but "no offer". */
export type ConnectionV2 = { url: string; token: string };

export function serviceBase(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash)
    throw new Error('Use a service URL without credentials, query parameters or fragments.');
  const local =
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    /^10\.\d+\.\d+\.\d+$/.test(url.hostname) ||
    /^192\.168\.\d+\.\d+$/.test(url.hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    throw new Error('Remote services require HTTPS.');
  return url.toString().replace(/\/$/, '');
}
const headers = (c: ConnectionV2) => ({
  'Content-Type': 'application/json',
  ...(c.token ? { 'X-Relay-Token': c.token } : {}),
});
const FeedbackSchema = z.object({ code: z.string().max(40), text: z.string().max(300) });
export type PhotoFeedbackItem = z.infer<typeof FeedbackSchema>;
const ScoreResponse = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION_2),
  assessmentId: z.string(),
  photo: PhotoRecordSchema,
  signed: SignedScoresSchema,
  feedback: z.array(FeedbackSchema).max(8).default([]),
  retainOnReplacement: z.boolean().optional(),
});
export const HealthV2Schema = z.object({
  status: z.literal('ok'),
  engineRelease: z.string().max(40).optional(),
  schemaVersion: z.literal(SCHEMA_VERSION_2),
  batteryVersion: z.string().min(1).max(40),
  policyVersion: z.string().max(40),
  thresholdsVersion: z.string().max(80),
  calibratedScorers: z.array(z.string()),
  scorers: z.array(z.object({ id: z.string(), model: z.string() })).default([]),
  externalProcessing: z.boolean().default(false),
  historicalAreas: z.boolean().optional(),
  retainedEvidence: z.boolean().optional(),
  processingNotice: z.literal('terms').optional().catch(undefined),
  scoreContext: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .optional(),
});
export type HealthV2 = z.infer<typeof HealthV2Schema>;

/** Ask whether the service speaks v2. Returns null for a service that does not (an older service
 * answers 404, or something that is not a v2 health record), so the caller can fall back to v1.
 * Throws a ServiceError only when the service cannot be reached or refuses the access token. */
export async function serviceHealthV2(
  c: ConnectionV2,
  signal: AbortSignal,
): Promise<HealthV2 | null> {
  const controller = new AbortController(),
    onAbort = () => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), 6000);
  let response: Response;
  try {
    response = await fetch(serviceBase(c.url) + '/v2/health', {
      headers: c.token ? { 'X-Relay-Token': c.token } : {},
      signal: controller.signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ServiceError('offline', 'The Relay service could not be reached.', true);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
  if (response.status === 401)
    throw new ServiceError('unauthorized', 'Check the service access token.', false);
  if (!response.ok) return null;
  const parsed = HealthV2Schema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}
const AssessResponse = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION_2),
  assessmentId: z.string(),
  decision: DecisionSchema2,
  countReceipt: CountReceiptSchema.optional(),
  findings: z.array(SignedFindingSchema).max(8).default([]),
  replacements: z.array(ReplacementStatusSchema).default([]),
  transitions: z.array(ReplacementTransitionSchema).default([]),
  cost: z.object({ inputTokens: z.number(), estimatedUsd: z.number() }),
  timing: z.object({ decideMs: z.number(), scoringMs: z.number() }),
});
export class ServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    /** True when trying again later can succeed (offline, busy, scorer down). */
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}
async function post(c: ConnectionV2, path: string, body: unknown, signal: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(serviceBase(c.url) + path, {
      method: 'POST',
      headers: headers(c),
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ServiceError(
      'offline',
      'No connection. Your photographs are kept on this device.',
      true,
    );
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const e = (json as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    throw new ServiceError(
      typeof e?.code === 'string' ? e.code : 'request_failed',
      typeof e?.message === 'string' && e.message.length < 350
        ? e.message
        : 'The request could not be completed. Your photographs are still here.',
      response.status === 429 || response.status >= 500,
    );
  }
  return json;
}

/** Score one photograph. Call it when the photograph is accepted, not when the rider asks for a result. */
export async function scorePhoto(
  c: ConnectionV2,
  input: {
    assessmentId: string;
    photoId: string;
    view: PhotoRecord['view'];
    base64: string;
    /** Required by services that send photographs to an external provider. */
    consent?: { externalProvider: boolean };
  },
  signal: AbortSignal,
): Promise<{
  photo: PhotoRecord;
  signed: SignedScores;
  feedback: PhotoFeedbackItem[];
  retainOnReplacement?: boolean;
}> {
  const parsed = ScoreResponse.safeParse(
    await post(c, '/v2/photos/score', { schemaVersion: SCHEMA_VERSION_2, ...input }, signal),
  );
  if (!parsed.success)
    throw new ServiceError('invalid_response', 'The service returned an incomplete result.', true);
  const { photo, signed, assessmentId, feedback } = parsed.data;
  if (
    assessmentId !== input.assessmentId ||
    photo.id !== input.photoId ||
    photo.view !== input.view ||
    signed.scores.photoId !== input.photoId ||
    signed.scores.view !== input.view ||
    signed.scores.fromOverview !== undefined ||
    signed.scores.parentSha256 !== undefined ||
    signed.scores.sha256 !== photo.sha256
  )
    throw new ServiceError(
      'mismatched_response',
      'The result does not match this photograph.',
      true,
    );
  return {
    photo,
    signed,
    feedback,
    ...(parsed.data.retainOnReplacement === undefined
      ? {}
      : { retainOnReplacement: parsed.data.retainOnReplacement }),
  };
}

/** The reported-history rule, applied on the device. Needs no network and no photographs. */
export function reportedExclusion(disclosures: Disclosure[]) {
  return Questions.filter((q) => disclosures.some((e) => e.question === q && e.answer === 'yes'));
}

/** Refuse a decision that the device can prove is wrong, whatever service sent it. */
export function safetyFloor(
  decision: Decision2,
  disclosures: Disclosure[],
  photos: PhotoRecord[],
  signedScores: SignedScores[],
): Decision2 {
  if (reportedExclusion(disclosures).length && decision.outcome !== 'no_offer')
    throw new ServiceError(
      'unsafe_decision',
      'The service returned an inconsistent result. Please try again.',
      false,
    );
  if (decision.outcome === 'offer') {
    const latest: Record<string, string> = {};
    for (const e of disclosures) latest[e.question] = e.answer;
    const scored = new Set(signedScores.map((s) => s.scores.photoId + ':' + s.scores.sha256));
    if (
      signedScores.some((s) => s.scores.fromOverview) ||
      Questions.some((q) => latest[q] !== 'no') ||
      !photos.length ||
      photos.some((p) => !scored.has(p.id + ':' + p.sha256)) ||
      // One picture can never stand in for two views (policy rule 3, added 2026-11-17).
      new Set(photos.map((p) => p.sha256)).size !== photos.length
    )
      throw new ServiceError(
        'unsafe_decision',
        'The service returned an inconsistent result. Please try again.',
        false,
      );
  }
  return decision;
}

export async function assess(
  c: ConnectionV2,
  input: {
    assessmentId: string;
    disclosures: Disclosure[];
    photos: PhotoRecord[];
    signedScores: SignedScores[];
    closeUpsRequested: number;
    historicalAreas?: HistoricalArea[];
    replacedOverviews?: ReplacedOverview[];
    countReceipt?: CountReceipt;
    countCheck?: { notice: 'terms'; photoId: string; base64: string };
  },
  signal: AbortSignal,
) {
  const parsed = AssessResponse.safeParse(
    await post(c, '/v2/assess', { schemaVersion: SCHEMA_VERSION_2, ...input }, signal),
  );
  if (!parsed.success)
    throw new ServiceError('invalid_response', 'The service returned an incomplete result.', true);
  if (parsed.data.assessmentId !== input.assessmentId)
    throw new ServiceError(
      'mismatched_response',
      'The service returned a different assessment.',
      true,
    );
  if (
    input.replacedOverviews?.some(
      (e) =>
        !parsed.data.replacements.some(
          (r) =>
            r.photoId === e.photoId && r.view === e.view && r.replacementId === e.replacementId,
        ),
    )
  )
    throw new ServiceError(
      'incomplete_history',
      'The service did not reconcile all earlier overviews. Your photographs are saved.',
      true,
    );
  return {
    countReceipt: parsed.data.countReceipt,
    findings: parsed.data.findings,
    replacements: parsed.data.replacements,
    transitions: parsed.data.transitions,
    decision: safetyFloor(
      withHistoricalAreas(
        preserveExclusions(parsed.data.decision, parsed.data.replacements),
        (input.historicalAreas ?? []).map((a) => historicalReason(a, false)),
      ),
      input.disclosures,
      input.photos,
      input.signedScores,
    ),
    cost: parsed.data.cost,
  };
}

/** The local decision exists before the optional request. Empty budgets, missing bytes, timeout
 * or an unavailable service therefore do not add a new manual review on the phone. */
export async function assessWithCount(
  c: ConnectionV2,
  input: Parameters<typeof assess>[1],
  signal: AbortSignal,
  termsCovered: boolean,
  readPhoto: (id: string) => Promise<string>,
) {
  const local = await assess(c, input, signal);
  if (!termsCovered || signal.aborted || input.countReceipt || local.countReceipt) return local;
  const held =
    !!input.historicalAreas?.length ||
    input.signedScores.some((s) => s.scores.fromOverview) ||
    local.replacements.some(
      (r) => r.status === 'confirmed_exclusion' || r.status === 'unverified_exclusion',
    );
  const photo = bindingCountPhoto(
    local.decision,
    input.disclosures,
    input.photos,
    input.signedScores.map((s) => s.scores),
    held,
  );
  if (!photo) return local;
  const controller = new AbortController(),
    onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  // The server budgets eight seconds for its work. Allow a bounded transit margin.
  const timer = setTimeout(onAbort, 8500);
  const stopped = new Promise<typeof local>((resolve) => {
    controller.signal.addEventListener('abort', () => resolve(local), { once: true });
  });
  try {
    return await Promise.race([
      stopped,
      (async () => {
        const base64 = await readPhoto(photo.id);
        if (controller.signal.aborted || signal.aborted) return local;
        return assess(
          c,
          { ...input, countCheck: { notice: 'terms', photoId: photo.id, base64 } },
          controller.signal,
        );
      })().catch(() => local),
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}
