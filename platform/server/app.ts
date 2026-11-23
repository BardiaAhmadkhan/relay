import { observationMayBeCached } from '../packages/vision/cache-policy';
import Fastify from 'fastify';
import { setTimeout as nodeSetTimeout } from 'node:timers';
import cors from '@fastify/cors';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  AnalysisRequestSchema,
  AnalysisResponseSchema,
  ObservationSchema,
  POLICY_VERSION,
  SCHEMA_VERSION,
  type AnalysisResponse,
  type VisionAdapter,
} from '../packages/core/schema';
import { decide } from '../packages/core/policy';
import { PROMPT_VERSION } from '../packages/vision/prompt';
import { validateFindings } from '../packages/vision/validation';
import { IntakeError, prepareImages } from './images';
export interface ServerOptions {
  adapter: VisionAdapter;
  token?: string;
  timeoutMs?: number;
  now?: () => number;
  allowedOrigins?: string[];
}
export function createApp(options: ServerOptions) {
  const app = Fastify({
    logger: false,
    bodyLimit: 24_000_000,
    requestTimeout: 75_000,
    connectionTimeout: 10_000,
  });
  const now = options.now ?? Date.now,
    ttl = 10 * 60 * 1000;
  const cache = new Map<
    string,
    { value: AnalysisResponse; expires: number; expiryTimer: ReturnType<typeof nodeSetTimeout> }
  >();
  const inflight = new Map<string, Promise<AnalysisResponse>>();
  let running = 0,
    cacheEpoch = 0;
  const allowed = options.allowedOrigins ?? [
    'http://localhost:8081',
    'http://127.0.0.1:8081',
    'http://localhost:8082',
    'http://127.0.0.1:8082',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
  ];
  void app.register(cors, {
    origin: allowed,
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-Relay-Token'],
    maxAge: 600,
  });
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') return;
    if (options.token) {
      const given = req.headers['x-relay-token'];
      const a = Buffer.from(typeof given === 'string' ? given : ''),
        b = Buffer.from(options.token);
      if (a.length !== b.length || !timingSafeEqual(a, b))
        return reply.code(401).send({
          error: {
            code: 'unauthorized',
            message: 'Check the service access token in connection settings.',
          },
        });
    }
  });
  app.setErrorHandler((error, _req, reply) => {
    const status =
      typeof (error as { statusCode?: number }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
    reply.code(status >= 400 && status < 500 ? status : 500).send({
      error: {
        code: status === 413 ? 'request_too_large' : 'request_failed',
        message:
          status === 413
            ? 'The photo set is too large. Choose smaller photographs.'
            : 'The request could not be completed. Your draft is still on your device.',
      },
    });
  });
  // A v2-capable phone can probe an older service without producing a failed HTTP request.
  app.get('/v2/health', async (_request, reply) => reply.code(204).send());
  app.get('/health', async () => ({
    status: 'ok',
    schemaVersion: SCHEMA_VERSION,
    policyVersion: POLICY_VERSION,
    provider: options.adapter.id,
    model: options.adapter.model,
    externalProvider: options.adapter.id === 'openai' || options.adapter.id === 'gemini',
    processing: 'ephemeral',
    coverage:
      options.adapter.coverage ??
      (['local_clip', 'local_siglip'].includes(options.adapter.id)
        ? 'category_only'
        : 'visual_observations'),
    maxImages: 6,
  }));
  app.addHook('onClose', async () => {
    options.adapter.clearCache?.();
    for (const entry of cache.values()) clearTimeout(entry.expiryTimer);
    cache.clear();
  });
  app.delete('/session', async () => {
    cacheEpoch++;
    options.adapter.clearCache?.();
    for (const entry of cache.values()) clearTimeout(entry.expiryTimer);
    cache.clear();
    return { cleared: true, inFlight: inflight.size };
  });
  app.post('/assess', async (req, reply) => {
    // The request body has arrived. Keep the socket alive for the bounded computation
    // and its error response; the intake idle timeout must not kill valid inference.
    req.raw.socket?.setTimeout?.((options.timeoutMs ?? 60_000) + 5_000);
    const parsed = AnalysisRequestSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: {
          code: 'invalid_request',
          message:
            'The assessment data is incomplete or invalid. Review the history and photographs.',
        },
      });
    const input = parsed.data,
      started = performance.now();
    const first = decide({ disclosures: input.disclosures });
    if (first.state === 'not_eligible')
      return AnalysisResponseSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        assessmentId: input.assessmentId,
        status: 'excluded',
        photos: [],
        observation: null,
        decision: first,
        timing: {
          totalMs: performance.now() - started,
          preprocessingMs: 0,
          inferenceMs: 0,
          cached: false,
        },
      });
    const external = options.adapter.id === 'openai' || options.adapter.id === 'gemini';
    if (external && !input.consent.externalProvider)
      return reply.code(403).send({
        error: {
          code: 'external_consent_required',
          message:
            'This service sends photographs to an external vision provider. Review that disclosure before continuing.',
        },
      });
    if (
      external &&
      (input.consent.expectedProvider !== options.adapter.id ||
        input.consent.expectedModel !== options.adapter.model)
    )
      return reply.code(409).send({
        error: {
          code: 'provider_changed',
          message:
            'The vision provider changed. Review the image-sharing choice again before continuing.',
        },
      });
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          input,
          options.adapter.id,
          options.adapter.model,
          POLICY_VERSION,
          PROMPT_VERSION,
        ]),
      )
      .digest('hex');
    for (const [k, v] of cache)
      if (v.expires <= now()) {
        clearTimeout(v.expiryTimer);
        cache.delete(k);
      }
    const existing = cache.get(key);
    if (existing)
      return {
        ...existing.value,
        timing: { ...existing.value.timing, totalMs: performance.now() - started, cached: true },
      };
    const pending = inflight.get(key);
    if (pending) {
      try {
        return await pending;
      } catch {
        return reply.code(503).send({
          error: {
            code: 'analysis_unavailable',
            message: 'Analysis did not complete. Keep your photographs and try again.',
          },
        });
      }
    }
    if (running >= 1)
      return reply
        .code(429)
        .header('Retry-After', '2')
        .send({
          error: {
            code: 'busy',
            message: 'The local vision service is busy. Wait a moment and try again.',
          },
        });
    running++;
    const workEpoch = cacheEpoch;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const computation = (async () => {
      const preprocessingStart = performance.now();
      const prepared = await prepareImages(input.images);
      const preprocessingMs = performance.now() - preprocessingStart;
      const preflight = decide({ disclosures: input.disclosures, photos: prepared.photos });
      // Observe usable photos immediately. Missing history/views cannot hide visible damage.
      // Category-only adapters retain their original complete-intake contract.
      const categoryOnly = ['local_clip', 'local_siglip'].includes(options.adapter.id);
      const unusable = prepared.photos.some((p) =>
        p.quality.warnings.some((w) => ['dark', 'bright'].includes(w)),
      );
      const inspectionImages =
        options.adapter.id === 'local_vlm'
          ? prepared.images.filter(
              (image) =>
                !prepared.photos
                  .find((p) => p.id === image.id)!
                  .quality.warnings.some((w) => ['dark', 'bright'].includes(w)),
            )
          : prepared.images;
      const blocked =
        (options.adapter.id === 'local_vlm' ? !inspectionImages.length : unusable) ||
        (categoryOnly &&
          preflight.reasons.some((r) => /^(quality_|missing_|unknown_)/.test(r.code)));
      const extracted = blocked
        ? null
        : await options.adapter.analyze(inspectionImages, controller.signal);
      const cacheComplete = !extracted || observationMayBeCached(extracted);
      const observation = extracted ? ObservationSchema.parse(extracted) : null;
      if (controller.signal.aborted) throw new Error('analysis_timeout');
      if (observation) {
        if (observation.inspection && observation.provider !== 'local_vlm')
          throw new Error('invalid_inspection_provider');
        const ids = new Set(inspectionImages.map((p) => p.id));
        validateFindings(observation, ids);
        if (
          observation.attributes.some((a) => a.imageIds.some((id) => !ids.has(id))) ||
          observation.concerns.some((c) => !ids.has(c.imageId))
        )
          throw new Error('invalid_provenance');
        if (
          observation.provider !== options.adapter.id ||
          observation.model !== options.adapter.model
        )
          throw new Error('invalid_provider_identity');
        if (
          ['local_clip', 'local_siglip'].includes(observation.provider) &&
          (observation.coverage !== 'category_only' ||
            observation.attributes.length ||
            observation.concerns.length)
        )
          throw new Error('invalid_local_scope');
      }
      const result = AnalysisResponseSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        assessmentId: input.assessmentId,
        status: 'complete',
        photos: prepared.photos,
        observation,
        decision: decide({
          disclosures: input.disclosures,
          photos: prepared.photos,
          observation,
          corrections: input.corrections,
        }),
        timing: {
          totalMs: performance.now() - started,
          preprocessingMs,
          inferenceMs: observation?.durationMs ?? 0,
          cached: false,
        },
      });
      if (cacheComplete && workEpoch === cacheEpoch) {
        if (cache.size >= 24) {
          const oldest = cache.keys().next().value!;
          clearTimeout(cache.get(oldest)!.expiryTimer);
          cache.delete(oldest);
        }
        const expiryTimer = nodeSetTimeout(() => {
          if (cache.get(key)?.value === result) cache.delete(key);
        }, ttl);
        cache.set(key, { value: result, expires: now() + ttl, expiryTimer });
      }
      return result;
    })();
    const work = Promise.race([
      computation,
      new Promise<AnalysisResponse>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('analysis_timeout'));
        }, options.timeoutMs ?? 60_000);
      }),
    ]);
    inflight.set(key, work);
    // A non-cancellable local kernel may finish after timeout. Keep the CPU slot occupied until it settles.
    void computation
      .finally(() => {
        running--;
      })
      .catch(() => undefined);
    try {
      return await work;
    } catch (error) {
      if (error instanceof IntakeError)
        return reply
          .code(error.status)
          .send({ error: { code: error.code, message: error.message } });
      return reply.code(503).send({
        error: {
          code: 'analysis_unavailable',
          message:
            'Analysis did not complete. No assessment was made. Your photographs are kept on this device; try again or take them to a specialist.',
        },
      });
    } finally {
      if (timer) clearTimeout(timer);
      inflight.delete(key);
    }
  });
  return app;
}
