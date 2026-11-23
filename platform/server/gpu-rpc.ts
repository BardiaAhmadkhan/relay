import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import { z } from 'zod';
import { ViewSchema, type PhotoView } from '../packages/core/schema';
import { PhotoScoresSchema } from '../packages/core/v2/schema';
import {
  BATTERY_SYSTEM,
  BATTERY_VERSION,
  GARMENT_QUESTIONS,
  LABEL_QUESTIONS,
  ZONE_QUESTIONS,
  type Question,
} from '../packages/vision/v2/battery';
import { inspectionModel } from '../packages/vision/v2/inspection-model';
import { ScorerFailure, type Scorer } from '../packages/vision/v2/scorer';
import fullBands from '../packages/core/v2/thresholds.json' with { type: 'json' };
import lowBands from '../packages/core/v2/thresholds.cascade512.json' with { type: 'json' };

const hash = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
const questions = [
  ...GARMENT_QUESTIONS,
  ...LABEL_QUESTIONS,
  ...Object.values(ZONE_QUESTIONS).flat(),
];
const byKey = new Map(questions.map((q) => [q.key, q]));
// The detail cascade preserves these measured stage-one observations alongside its final answers.
const detailEvidence = new Set(['road_contact_low', 'broken_low']);
export const workerModel =
  inspectionModel.name + '@' + inspectionModel.digest.slice(0, 12) + ' cascade';
export const workerProfile = hash(
  JSON.stringify([
    'relay-3.5-photo-rpc-1',
    inspectionModel,
    BATTERY_VERSION,
    BATTERY_SYSTEM,
    questions,
    fullBands,
    lowBands,
  ]),
);
const encoded = z
  .string()
  .min(4)
  .max(5600000)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);
const input = z.strictObject({
  profile: z.literal(workerProfile),
  view: ViewSchema,
  jpeg: encoded,
  low: encoded.optional(),
  keys: z.array(z.string().max(40)).min(1).max(byKey.size),
});
const failureBody = z.strictObject({
  code: z.enum([
    'timeout',
    'unavailable',
    'rate_limited',
    'refused',
    'invalid_response',
    'not_configured',
  ]),
  retryable: z.boolean(),
});
const output = z.strictObject({
  profile: z.literal(workerProfile),
  binding: z.string().length(64),
  answers: PhotoScoresSchema.shape.answers,
  inputTokens: z.number().int().nonnegative(),
  ms: z.number().nonnegative(),
});
type Photo = { jpeg: Uint8Array; low?: Uint8Array; view: PhotoView };
function binding(p: Photo, keys: string[]) {
  return hash(
    JSON.stringify([workerProfile, p.view, hash(p.jpeg), p.low ? hash(p.low) : null, keys]),
  );
}
function same(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function checkedSecret(s: string | undefined) {
  if (!s || s.length < 32) throw Error('Configure a separate private GPU transport secret.');
  return s;
}

/** One network request per uncached planner invocation, preserving the exact JPEGs and question order. */
export function remoteGpuScorer(
  origin: string,
  secret: string | undefined,
  endpointKey?: string,
): Scorer {
  const url = new URL(origin);
  const token = checkedSecret(secret);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    )
  )
    throw Error('Use the trusted HTTPS GPU endpoint origin.');
  return {
    id: 'local_logprob',
    model: workerModel,
    async score(p: Photo, qs, signal) {
      const keys = qs.map((q) => q.key);
      const budget = AbortSignal.any([signal, AbortSignal.timeout(95_000)]);
      let r: Response;
      try {
        r = await fetch(new URL('/internal/v1/photo', url), {
          method: 'POST',
          redirect: 'error',
          signal: budget,
          headers: {
            'Content-Type': 'application/json',
            'X-Relay-Worker': token,
            ...(endpointKey ? { Authorization: 'Bearer ' + endpointKey } : {}),
          },
          body: JSON.stringify({
            profile: workerProfile,
            view: p.view,
            keys,
            jpeg: Buffer.from(p.jpeg).toString('base64'),
            ...(p.low ? { low: Buffer.from(p.low).toString('base64') } : {}),
          }),
        });
      } catch {
        throw new ScorerFailure(budget.aborted ? 'timeout' : 'unavailable', !signal.aborted);
      }
      if (!r.ok) {
        const known = failureBody.safeParse(await r.json().catch(() => null));
        if (known.success) throw new ScorerFailure(known.data.code, known.data.retryable);
        throw new ScorerFailure(
          r.status === 429 ? 'rate_limited' : 'unavailable',
          r.status === 429 || r.status >= 500,
        );
      }
      let body: z.infer<typeof output>;
      try {
        body = output.parse(await r.json());
      } catch {
        throw new ScorerFailure('invalid_response', false);
      }
      if (
        body.binding !== binding(p, keys) ||
        Object.keys(body.answers).some(
          (k) => !byKey.has(k) && !(p.view === 'detail' && detailEvidence.has(k)),
        )
      )
        throw new ScorerFailure('invalid_response', false);
      return { answers: body.answers, inputTokens: body.inputTokens, ms: body.ms };
    },
  };
}

export function createGpuWorker(scorer: Scorer, secret: string) {
  const token = checkedSecret(secret);
  if (scorer.model !== workerModel || scorer.id !== 'local_logprob')
    throw Error('GPU worker requires the original calibrated cascade.');
  const app = Fastify({ logger: false, bodyLimit: 12_000_000, requestTimeout: 120_000 });
  app.addHook('onRequest', async (req, reply) => {
    if (!same(String(req.headers['x-relay-worker'] ?? ''), token))
      return reply.code(401).send({ error: 'unauthorized' });
  });
  app.post('/internal/v1/photo', async (req, reply) => {
    const data = input.safeParse(req.body);
    if (!data.success) return reply.code(400).send({ error: 'invalid_photo_contract' });
    const d = data.data,
      qs = d.keys.map((k) => byKey.get(k));
    if (qs.some((x) => !x) || new Set(d.keys).size !== d.keys.length)
      return reply.code(400).send({ error: 'invalid_question_set' });
    const photo = {
      view: d.view,
      jpeg: Buffer.from(d.jpeg, 'base64'),
      ...(d.low ? { low: Buffer.from(d.low, 'base64') } : {}),
    };
    const controller = new AbortController();
    const stop = () => {
      if (!reply.raw.writableFinished) controller.abort();
    };
    reply.raw.once('close', stop);
    try {
      const scored = await scorer.score(
        photo,
        qs as Question[],
        AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]),
      );
      return output.parse({
        profile: workerProfile,
        binding: binding(photo, d.keys),
        answers: scored.answers,
        inputTokens: scored.inputTokens,
        ms: scored.ms,
      });
    } catch (e) {
      const failure = e instanceof ScorerFailure ? e : new ScorerFailure('unavailable', true);
      return reply
        .code(failure.code === 'rate_limited' ? 429 : 503)
        .send({ code: failure.code, retryable: failure.retryable });
    } finally {
      reply.raw.off('close', stop);
    }
  });
  return app;
}
