import type { CountReceipt } from '../packages/core/v2/count-review';
import { resolveCount } from './count-assessment';
import type { CountReader } from './count-reader';
import { observedCues, signFindings, verifyReplacements } from './replacement';
import { preserveExclusions, offerTransitions } from '../packages/core/v2/replacement';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { withHistoricalAreas } from '../packages/core/v2/historical-areas';
import { historicalReasons } from './historical-areas';
import { MarkedRegionSchema } from '../packages/core/marked-region';
import { SignedScoresSchema } from '../packages/core/v2/schema';
import { ViewSchema } from '../packages/core/schema';
import { photoFeedback } from '../packages/core/v2/feedback';
import { decide2 } from '../packages/core/v2/policy';
import {
  AssessRequestSchema2,
  DecisionSchema2,
  SCHEMA_VERSION_2,
  type PhotoScores,
  type PolicyConfig,
  type Thresholds,
} from '../packages/core/v2/schema';
import { BATTERY_VERSION, questionsFor } from '../packages/vision/v2/battery';
import { ScorerChain, signScores, verifyScores } from '../packages/vision/v2/scorer-chain';
import { ScorerFailure } from '../packages/vision/v2/scorer';
import { measureFocus, withFocus } from './focus';
import { IntakeError, prepareImages } from './images';
import { registerReview, type ReviewOptions } from './review-v2';

/** Backend v2 service. Stateless: score records are signed and handed to the client, which sends them
 * back when it asks for a decision. Images are held in memory. Optional metering stores only the
 * administrative count-check record. Images and provider response text are never logged. */
export interface ServerOptionsV2 {
  chain: ScorerChain;
  /** Retain the ordinary V3.1 receipt context for services that supported linked crops. */
  legacyPhotoContext?: boolean;
  countReview?: CountReader;
  intakeMeter?: {
    record(id: string): void;
    recordPhoto(assessment: string, id: string): void;
    close(): void;
  };
  countTimeoutMs?: number;
  thresholds: Thresholds;
  config: PolicyConfig;
  signingKey: string;
  token?: string;
  /** Long edge of the image handed to scorers. */
  workingEdge?: number;
  /** USD per million input tokens, per scorer id, for the running cost estimate. */
  inputRates?: Partial<Record<PhotoScores['scorer']['id'], number>>;
  allowedOrigins?: string[];
  /** Expert console (work package 12). Off unless set; items then live in memory only. */
  review?: ReviewOptions;
  /** v3: the scorers follow the question plan (packages/vision/v2/plan.ts), which asks zone questions
   * itself when they can decide, so the service's own zone call is skipped. */
  planned?: boolean;
  /** v3: also prepare a small rendition (512 px) for a cascading scorer. */
  lowEdge?: number;
}
/** The focus gate was calibrated on photographs prepared at this long edge (E10). */
const FOCUS_EDGE = 1024;
/** The console shell and its script carry no data, so they load before the expert types the token. */
const OPEN_ROUTES = new Set(['/v2/review', '/v2/review/console.js']);
/** Scorers that send the photograph to a provider outside this machine. */
const EXTERNAL_SCORERS = new Set<string>(['decisions', 'verbal']);
const ScoreRequestSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION_2),
  assessmentId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  photoId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  view: ViewSchema,
  fromOverview: MarkedRegionSchema.optional(),
  parent: SignedScoresSchema.optional(),
  base64: z
    .string()
    .min(80)
    .max(5_600_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  /** The rider's separate choice to let photographs reach an external provider (work package 11). */
  consent: z.strictObject({ externalProvider: z.boolean() }).optional(),
});
const yes = (scores: PhotoScores, key: string) => {
  const a = scores.answers[key];
  return a?.type === 'yesno' ? a.p : null;
};

export function createAppV2(options: ServerOptionsV2) {
  if (options.thresholds.batteryVersion !== BATTERY_VERSION)
    throw new Error(
      'Thresholds were fitted for battery ' +
        options.thresholds.batteryVersion +
        ' but the service asks battery ' +
        BATTERY_VERSION +
        '. Recalibrate first.',
    );
  if (options.signingKey.length < 32)
    throw new Error('RELAY_SIGNING_KEY must be at least 32 characters.');
  const app = Fastify({ logger: false, bodyLimit: 8_000_000, requestTimeout: 120_000 });
  if (options.intakeMeter) {
    const meter = options.intakeMeter;
    app.addHook('onClose', async () => meter.close());
    app.addHook('onResponse', async (req, reply) => {
      if (reply.statusCode !== 200) return;
      const body = req.body as { assessmentId?: string; photoId?: string } | undefined;
      if (typeof body?.assessmentId !== 'string') return;
      try {
        if (req.routeOptions.url === '/v2/assess') meter.record(body.assessmentId);
        else if (req.routeOptions.url === '/v2/photos/score' && typeof body.photoId === 'string')
          meter.recordPhoto(body.assessmentId, body.photoId);
      } catch {
        console.warn('Intake cost denominator is incomplete: usage storage unavailable.');
      }
    });
  }
  const externalProcessing = options.chain.members.some((m) => EXTERNAL_SCORERS.has(m.id));
  const countReader = !externalProcessing ? options.countReview : undefined;
  if (countReader?.close) app.addHook('onClose', async () => countReader.close?.());
  const rates = { decisions: 0.1, local_logprob: 0, verbal: 0.1, ...options.inputRates };
  void app.register(cors, {
    origin: options.allowedOrigins ?? ['http://localhost:8081', 'http://localhost:4173'],
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-Relay-Token'],
    maxAge: 600,
  });
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS' || !options.token) return;
    if (options.review && req.method === 'GET' && OPEN_ROUTES.has(req.url)) return;
    const given = Buffer.from(String(req.headers['x-relay-token'] ?? '')),
      expected = Buffer.from(options.token);
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      return reply
        .code(401)
        .send({ error: { code: 'unauthorized', message: 'Check the service access token.' } });
  });
  app.setErrorHandler((error, _req, reply) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    reply.code(status >= 400 && status < 500 ? status : 500).send({
      error: {
        code: status === 413 ? 'request_too_large' : 'request_failed',
        message:
          status === 413
            ? 'The photograph is too large.'
            : 'The request could not be completed. Your photographs are still on your device.',
      },
    });
  });

  app.get('/v2/health', async () => ({
    status: 'ok',
    engineRelease: '3.5',
    ...(countReader ? { processingNotice: 'terms' } : {}),
    schemaVersion: SCHEMA_VERSION_2,
    batteryVersion: BATTERY_VERSION,
    policyVersion: options.config.version,
    thresholdsVersion: options.thresholds.version,
    calibratedScorers: Object.keys(options.thresholds.perScorer),
    // Which scorers run, in fallback order, and whether any sends photographs off this machine, so the
    // app can ask for the separate external-provider choice before the first upload.
    scorers: options.chain.members,
    externalProcessing,
    markedDetails: false,
    historicalAreas: true,
    retainedEvidence: true,
    scoreContext: createHmac('sha256', options.signingKey)
      .update(
        JSON.stringify([
          'relay-photo-record-v1',
          options.chain.members,
          options.workingEdge ?? 1280,
          options.lowEdge ?? null,
          options.thresholds.version,
          !!options.planned,
          !!options.legacyPhotoContext,
        ]),
      )
      .digest('hex')
      .slice(0, 32),
    processing: 'stateless',
  }));

  app.post('/v2/photos/score', async (req, reply) => {
    const parsed = ScoreRequestSchema.safeParse(req.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: { code: 'invalid_request', message: 'The photograph could not be read.' } });
    const input = parsed.data;
    if (input.fromOverview || input.parent)
      return reply.code(410).send({
        error: {
          code: 'marked_detail_retired',
          message:
            'New marked areas are closed. Take an ordinary close-up if the assessment requests one.',
        },
      });
    if (externalProcessing && input.consent?.externalProvider !== true)
      return reply.code(403).send({
        error: {
          code: 'consent_required',
          message:
            'This service sends photographs to an external provider. Allow that in the app before checking photographs.',
        },
      });
    // Local scoring of one photograph can take several seconds per question.
    req.raw.socket?.setTimeout?.(125_000);
    const controller = new AbortController();
    // Abort the model work only when the client really goes away. Fixed 2026-11-17: the request side
    // (`req.raw`) emits 'close' as soon as its body has been read, which aborted every real HTTP request
    // mid-scoring (503 for all photographs; `inject()` in the unit tests never showed it). The response
    // side emits 'close' early only when the connection drops before the reply is written.
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) controller.abort(new Error('client_closed'));
    });
    try {
      const prepared = await prepareImages(
        [{ id: input.photoId, view: input.view, base64: input.base64 }],
        options.workingEdge ?? 1280,
      );
      const photo = prepared.photos[0]!,
        jpeg = prepared.images[0]!.jpeg;
      // Every rendition comes from the original upload through the same preparation the experiments
      // used, so each calibrated threshold sees the image it was fitted on.
      const rendition = async (edge: number) =>
        edge === (options.workingEdge ?? 1280)
          ? jpeg
          : (
              await prepareImages(
                [{ id: input.photoId, view: input.view, base64: input.base64 }],
                edge,
              )
            ).images[0]!.jpeg;
      // Capture gate (work package 5, added 2026-11-17): the calibrated focus measure on the fixed
      // 512 px grid replaces v1's uncalibrated preview heuristic, measured on the 1024 px rendition it
      // was calibrated on (E10). The photograph is still scored, so the rules can show block-band
      // damage on it; the policy then asks for a retake.
      const quality = withFocus(photo.quality, await measureFocus(await rendition(FOCUS_EDGE)));
      const target = {
        photoId: input.photoId,
        view: input.view,
        jpeg,
        ...(options.lowEdge ? { low: await rendition(options.lowEdge) } : {}),
      };
      let scores = await options.chain.score(target, questionsFor(input.view), controller.signal);
      // Zone questions only matter when damage or a repair is in the review or block band. A planned
      // scorer (v3) has already asked them where they can change the outcome.
      const bands = options.thresholds.perScorer[scores.scorer.id];
      const category = scores.answers.category;
      const damage = Math.max(yes(scores, 'broken') ?? 0, yes(scores, 'road_contact') ?? 0);
      if (
        !options.planned &&
        input.view !== 'label' &&
        category?.type === 'choice' &&
        (!bands ||
          damage >= bands.damage.clear ||
          (yes(scores, 'repair') ?? 0) >= bands.repair.clear)
      ) {
        const zoneQuestions = questionsFor(input.view, category.choice).filter((q) =>
          q.key.startsWith('zone_'),
        );
        if (zoneQuestions.length) {
          try {
            const zoned = await options.chain.score(target, zoneQuestions, controller.signal);
            // Only merge answers from the same scorer: one record, one source.
            if (zoned.scorer.id === scores.scorer.id && zoned.scorer.model === scores.scorer.model)
              scores = {
                ...scores,
                answers: { ...scores.answers, ...zoned.answers },
                usage: {
                  inputTokens: scores.usage.inputTokens + zoned.usage.inputTokens,
                  ms: scores.usage.ms + zoned.usage.ms,
                },
              };
          } catch {
            // Unanswered zones are treated as protective by the policy, so a failure here is safe.
          }
        }
      }
      return {
        schemaVersion: SCHEMA_VERSION_2,
        assessmentId: input.assessmentId,
        photo: { id: photo.id, view: photo.view, sha256: photo.sha256, quality },
        signed: signScores(scores, options.signingKey),
        ...(input.view === 'front' || input.view === 'back'
          ? { retainOnReplacement: observedCues(scores, options.thresholds).length > 0 }
          : {}),
        // Retake hints for the rider while they are still photographing; never a damage finding.
        feedback: photoFeedback(input.view, quality, scores, options.thresholds),
      };
    } catch (error) {
      if (error instanceof IntakeError)
        return reply
          .code(error.status)
          .send({ error: { code: error.code, message: error.message } });
      return reply.code(503).send({
        error: {
          code: error instanceof ScorerFailure ? 'scoring_' + error.code : 'scoring_unavailable',
          message:
            'The photo check did not complete. The photograph is kept on your device; try again, or hand the item to a specialist.',
        },
      });
    }
  });

  app.post('/v2/assess', async (req, reply) => {
    const parsed = AssessRequestSchema2.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: {
          code: 'invalid_request',
          message: 'The assessment data is incomplete or invalid.',
        },
      });
    const input = parsed.data,
      started = performance.now();
    if (input.signedScores.some((s) => !verifyScores(s, options.signingKey)))
      return reply.code(400).send({
        error: {
          code: 'invalid_scores',
          message:
            'A photo check record was altered or is from another service. Check the photographs again.',
        },
      });
    const scores = input.signedScores.map((s) => s.scores);
    const policyInput = {
      disclosures: input.disclosures,
      photos: input.photos,
      scores,
      closeUpsRequested: input.closeUpsRequested,
      thresholds: options.thresholds,
      config: options.config,
    };
    const historical = historicalReasons(
      input.historicalAreas,
      options.signingKey,
      options.thresholds.batteryVersion,
    );
    const replacements = verifyReplacements(input.assessmentId, input.replacedOverviews, options);
    const ordinary = decide2(policyInput);
    let decision = preserveExclusions(withHistoricalAreas(ordinary, historical), replacements);
    let countReceipt: CountReceipt | undefined;
    const malformedReceipt =
      Object.prototype.hasOwnProperty.call(req.body, 'countReceipt') && !input.countReceipt;
    if (countReader && !malformedReceipt && (input.countCheck || input.countReceipt)) {
      const controller = new AbortController();
      const onClose = () => {
        if (!reply.raw.writableFinished) controller.abort();
      };
      reply.raw.once('close', onClose);
      try {
        const accepted = await resolveCount({
          assessmentId: input.assessmentId,
          input: policyInput,
          decision,
          hold:
            historical.length > 0 ||
            scores.some((s) => s.fromOverview) ||
            replacements.some(
              (r) => r.status === 'confirmed_exclusion' || r.status === 'unverified_exclusion',
            ),
          workingEdge: options.workingEdge ?? 1280,
          reader: countReader,
          attachment: input.countCheck,
          receipt: input.countReceipt,
          signingKey: options.signingKey,
          signal: controller.signal,
          timeoutMs: options.countTimeoutMs,
        });
        if (accepted && !controller.signal.aborted) {
          countReceipt = accepted;
          decision = preserveExclusions(
            withHistoricalAreas(
              decide2({ ...policyInput, acceptedCountPhotoId: accepted.check.photoId }),
              historical,
            ),
            replacements,
          );
        }
      } finally {
        reply.raw.off('close', onClose);
      }
    }
    decision = DecisionSchema2.parse(decision);
    const findings = signFindings(input.assessmentId, decision, input.photos, scores, options);
    const transitions = offerTransitions(replacements, decision.outcome);
    const inputTokens = scores.reduce((n, s) => n + s.usage.inputTokens, 0);
    return {
      schemaVersion: SCHEMA_VERSION_2,
      assessmentId: input.assessmentId,
      decision,
      ...(findings.length ? { findings } : {}),
      ...(countReceipt ? { countReceipt } : {}),
      ...(replacements.length ? { replacements, transitions } : {}),
      cost: {
        inputTokens,
        estimatedUsd: +scores
          .reduce((usd, s) => usd + (s.usage.inputTokens * (rates[s.scorer.id] ?? 0)) / 1e6, 0)
          .toFixed(6),
      },
      timing: {
        decideMs: performance.now() - started,
        scoringMs: scores.reduce((n, s) => n + s.usage.ms, 0),
      },
    };
  });

  app.get('/v2/metrics', async () => {
    const byScorer: Record<
      string,
      { ok: number; cached: number; failed: number; ms: number[]; inputTokens: number }
    > = {};
    for (const e of options.chain.events) {
      const row = (byScorer[e.scorer] ??= { ok: 0, cached: 0, failed: 0, ms: [], inputTokens: 0 });
      if (e.outcome === 'ok') {
        row.ok++;
        row.ms.push(e.ms);
        row.inputTokens += e.inputTokens;
      } else if (e.outcome === 'cached') row.cached++;
      else if (e.outcome !== 'skipped_open') row.failed++;
    }
    const quantile = (values: number[], q: number) => {
      if (!values.length) return null;
      const sorted = [...values].sort((a, b) => a - b);
      return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!);
    };
    return Object.fromEntries(
      Object.entries(byScorer).map(([id, row]) => [
        id,
        {
          scored: row.ok,
          cached: row.cached,
          failed: row.failed,
          p50Ms: quantile(row.ms, 0.5),
          p95Ms: quantile(row.ms, 0.95),
          inputTokens: row.inputTokens,
          estimatedUsd: +((row.inputTokens * (rates[id as keyof typeof rates] ?? 0)) / 1e6).toFixed(
            6,
          ),
        },
      ]),
    );
  });
  if (options.review)
    registerReview(
      app,
      {
        signingKey: options.signingKey,
        thresholds: options.thresholds,
        config: options.config,
        workingEdge: options.workingEdge ?? 1280,
        countReviewEnabled: !!countReader,
      },
      options.review,
    );
  return app;
}
