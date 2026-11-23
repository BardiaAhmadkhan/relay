import { matchesCount } from './count-receipt';
import { bindingCountPhoto, CountReceiptSchema } from '../packages/core/v2/count-review';
import { verifyReplacements } from './replacement';
import { ReplacedOverviewsSchema } from '../packages/core/v2/schema';
import { preserveExclusions } from '../packages/core/v2/replacement';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { DisclosureSchema, Questions, ViewSchema } from '../packages/core/schema';
import { historicalReasons } from './historical-areas';
import { withHistoricalAreas } from '../packages/core/v2/historical-areas';
import { HistoricalAreasSchema } from '../packages/core/v2/schema';
import { decide2, decisionBands } from '../packages/core/v2/policy';
import {
  DecisionSchema2,
  SCHEMA_VERSION_2,
  SignedScoresSchema,
  type Decision2,
  type PhotoRecord,
  type PhotoScores,
  type PolicyConfig,
  type Thresholds,
} from '../packages/core/v2/schema';
import { verifyScores } from '../packages/vision/v2/scorer-chain';
import { measureFocus, withFocus } from './focus';
import { IntakeError, prepareImages } from './images';
import { REVIEW_PAGE, REVIEW_SCRIPT } from './review-page';

/** Expert console (work package 12, added 2026-11-17). This is where a person's expertise enters, and
 * where labelled examples for the next calibration come from.
 *
 * - A phone submits an assessment it wants a specialist to see, with its photographs and its signed
 *   score records. Signatures are verified, every photograph is prepared again and must hash to the
 *   pixels its record was scored on, and the decision is recomputed: nothing the phone says is shown
 *   as fact.
 * - Items live in memory only, capped and expiring. Nothing is written except verdicts.
 * - A verdict appends one line to the verdicts file: per photograph the expert's own labels and the
 *   score record, which scripts/v2-verdicts-to-labels.ts turns into calibration input.
 * - A reported crash, protective damage or protective repair can never be overridden into an offer.
 */
export type ReviewOptions = {
  verdictsFile: string;
  maxItems?: number;
  ttlMs?: number;
  now?: () => number;
};
type Context = {
  signingKey: string;
  thresholds: Thresholds;
  config: PolicyConfig;
  workingEdge: number;
  countReviewEnabled?: boolean;
};
type Item = {
  assessmentId: string;
  receivedAt: number;
  disclosures: z.infer<typeof DisclosureSchema>[];
  photos: Array<PhotoRecord & { jpeg: Buffer }>;
  scores: PhotoScores[];
  decision: Decision2;
  verdict: VerdictLine | null;
};
const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const SubmitSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION_2),
  assessmentId: Id,
  disclosures: z.array(DisclosureSchema).max(60),
  photos: z
    .array(
      z.strictObject({
        id: Id,
        view: ViewSchema,
        base64: z
          .string()
          .min(80)
          .max(5_600_000)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
      }),
    )
    .min(1)
    .max(8),
  signedScores: z.array(SignedScoresSchema).max(8),
  historicalAreas: HistoricalAreasSchema.optional(),
  replacedOverviews: ReplacedOverviewsSchema.optional(),
  countReceipt: CountReceiptSchema.optional().catch(undefined),
  closeUpsRequested: z.number().int().min(0).max(3),
});
const Label = z.enum(['yes', 'no', 'unsure']);
const VerdictSchema = z.strictObject({
  outcome: z.enum(['offer', 'no_offer', 'more_photos']),
  grade: z.enum(['A', 'B', 'C', 'D']).nullable(),
  note: z.string().trim().max(300),
  reviewer: z
    .string()
    .trim()
    .regex(/^[\p{L}\p{N} ._'-]{1,40}$/u),
  photos: z.record(Id, z.strictObject({ damaged: Label, repair: Label })),
});
export type VerdictLine = {
  at: string;
  assessmentId: string;
  reviewer: string;
  outcome: z.infer<typeof VerdictSchema>['outcome'];
  grade: z.infer<typeof VerdictSchema>['grade'];
  note: string;
  modelOutcome: Decision2['outcome'];
  policyVersion: string;
  thresholdsVersion: string;
  photos: Array<{
    photoId: string;
    view: PhotoRecord['view'];
    sha256: string;
    damaged: z.infer<typeof Label>;
    repair: z.infer<typeof Label>;
    scores: PhotoScores;
  }>;
};
const error = (code: string, message: string) => ({ error: { code, message } });

export function registerReview(app: FastifyInstance, context: Context, options: ReviewOptions) {
  const items = new Map<string, Item>();
  const now = options.now ?? Date.now;
  const maxItems = options.maxItems ?? 100,
    ttlMs = options.ttlMs ?? 12 * 60 * 60 * 1000;
  const prune = () => {
    for (const [id, item] of items) if (now() - item.receivedAt > ttlMs) items.delete(id);
    while (items.size > maxItems) items.delete(items.keys().next().value!);
  };
  let writing = Promise.resolve();

  // The console shell and its script hold no data, so they are served without the access token;
  // every data route below needs it (the token hook in app-v2.ts).
  app.get('/v2/review', async (_req, reply) =>
    reply
      .type('text/html; charset=utf-8')
      .header(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      )
      .send(REVIEW_PAGE),
  );
  app.get('/v2/review/console.js', async (_req, reply) =>
    reply.type('text/javascript; charset=utf-8').send(REVIEW_SCRIPT),
  );

  app.post('/v2/review/submit', { bodyLimit: 24_000_000 }, async (req, reply) => {
    const parsed = SubmitSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send(error('invalid_request', 'The review request is incomplete.'));
    const input = parsed.data;
    if (input.signedScores.some((s) => !verifyScores(s, context.signingKey)))
      return reply
        .code(400)
        .send(
          error('invalid_scores', 'A photo check record was altered or is from another service.'),
        );
    const photos: Item['photos'] = [];
    try {
      for (const p of input.photos) {
        const prepared = await prepareImages([p], context.workingEdge);
        const record = prepared.photos[0]!,
          prepared0 = prepared.images[0]!.jpeg,
          // A Buffer view without a copy, so Fastify sends the bytes as an image, never as JSON.
          jpeg = Buffer.from(prepared0.buffer, prepared0.byteOffset, prepared0.byteLength);
        const signed = input.signedScores.find((s) => s.scores.photoId === p.id);
        // The photograph shown to the expert must be the pixels its score record was made from.
        if (!signed || signed.scores.sha256 !== record.sha256 || signed.scores.view !== p.view)
          return reply
            .code(422)
            .send(error('photo_mismatch', 'A photograph does not match its photo check record.'));
        const quality = withFocus(record.quality, await measureFocus(jpeg));
        photos.push({ id: p.id, view: p.view, sha256: record.sha256, quality, jpeg });
      }
    } catch (e) {
      if (e instanceof IntakeError) return reply.code(e.status).send(error(e.code, e.message));
      throw e;
    }
    const scores = input.signedScores.map((s) => s.scores);
    // Recomputed here: the phone's own decision is never displayed as the model's result.
    const policyInput = {
      disclosures: input.disclosures,
      photos: photos.map(({ jpeg: _jpeg, ...p }) => p),
      scores,
      closeUpsRequested: input.closeUpsRequested,
      thresholds: context.thresholds,
      config: context.config,
    };
    const historical = historicalReasons(
      input.historicalAreas,
      context.signingKey,
      context.thresholds.batteryVersion,
    );
    const retained = verifyReplacements(input.assessmentId, input.replacedOverviews, context);
    const evaluate = (acceptedCountPhotoId?: string) =>
      preserveExclusions(
        withHistoricalAreas(decide2({ ...policyInput, acceptedCountPhotoId }), historical),
        retained,
      );
    let decision = evaluate();
    if (context.countReviewEnabled && input.countReceipt && context.workingEdge === 1600) {
      const hold =
        historical.length > 0 ||
        scores.some((s) => s.fromOverview) ||
        retained.some(
          (r) => r.status === 'confirmed_exclusion' || r.status === 'unverified_exclusion',
        );
      const target = bindingCountPhoto(
        decision,
        input.disclosures,
        policyInput.photos,
        scores,
        hold,
      );
      const signed =
        target && scores.find((s) => s.photoId === target.id && s.sha256 === target.sha256);
      if (
        target &&
        signed &&
        signed.batteryVersion === context.thresholds.batteryVersion &&
        decisionBands(context.thresholds, signed) &&
        matchesCount(input.countReceipt, input.assessmentId, target, context.signingKey)
      )
        decision = evaluate(target.id);
    }
    decision = DecisionSchema2.parse(decision);
    items.delete(input.assessmentId);
    items.set(input.assessmentId, {
      assessmentId: input.assessmentId,
      receivedAt: now(),
      disclosures: input.disclosures,
      photos,
      scores,
      decision,
      verdict: null,
    });
    prune();
    return { queued: true, assessmentId: input.assessmentId, decision, waiting: items.size };
  });

  app.get('/v2/review/items', async () => {
    prune();
    return {
      thresholdsVersion: context.thresholds.version,
      items: [...items.values()].reverse().map((item) => {
        const latest: Record<string, string> = {};
        for (const e of item.disclosures) latest[e.question] = e.answer;
        return {
          assessmentId: item.assessmentId,
          receivedAt: new Date(item.receivedAt).toISOString(),
          history: Questions.map((q) => ({
            question: q,
            answer: latest[q] ?? 'not answered',
            everYes: item.disclosures.some((e) => e.question === q && e.answer === 'yes'),
          })),
          photos: item.photos.map((p) => {
            const s = item.scores.find((x) => x.photoId === p.id)!;
            return {
              id: p.id,
              view: p.view,
              ...(s.fromOverview ? { fromOverview: s.fromOverview } : {}),
              quality: p.quality,
              scorer: s.scorer,
              bands: s.fromOverview ? null : (decisionBands(context.thresholds, s) ?? null),
              answers: s.answers,
            };
          }),
          decision: item.decision,
          verdict: item.verdict,
        };
      }),
    };
  });

  app.get<{ Params: { id: string; photoId: string } }>(
    '/v2/review/items/:id/photos/:photoId',
    async (req, reply) => {
      const photo = items.get(req.params.id)?.photos.find((p) => p.id === req.params.photoId);
      if (!photo) return reply.code(404).send(error('not_found', 'No such photograph.'));
      return reply.type('image/jpeg').send(photo.jpeg);
    },
  );

  app.post<{ Params: { id: string } }>('/v2/review/items/:id/verdict', async (req, reply) => {
    const item = items.get(req.params.id);
    if (!item) return reply.code(404).send(error('not_found', 'This item is no longer waiting.'));
    const parsed = VerdictSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send(error('invalid_verdict', 'The verdict is incomplete.'));
    const v = parsed.data;
    if (item.photos.some((p) => !v.photos[p.id]))
      return reply
        .code(400)
        .send(error('labels_missing', 'Mark every photograph before saving a verdict.'));
    if (v.outcome === 'offer' && !v.grade)
      return reply.code(400).send(error('grade_missing', 'An offer needs a condition grade.'));
    // A reported exclusion stays an exclusion, whoever looks at the photographs.
    if (v.outcome === 'offer' && item.disclosures.some((e) => e.answer === 'yes'))
      return reply
        .code(409)
        .send(
          error(
            'reported_exclusion',
            'The rider reported a crash, protective damage or a protective repair. This item cannot receive an offer.',
          ),
        );
    if (
      v.outcome === 'offer' &&
      Object.values(v.photos).some((l) => l.damaged === 'yes' || l.repair === 'yes') &&
      v.note.length < 10
    )
      return reply
        .code(400)
        .send(
          error(
            'note_missing',
            'Explain in the note why visible damage or a repair does not prevent an offer.',
          ),
        );
    const line: VerdictLine = {
      at: new Date(now()).toISOString(),
      assessmentId: item.assessmentId,
      reviewer: v.reviewer,
      outcome: v.outcome,
      grade: v.outcome === 'offer' ? v.grade : null,
      note: v.note,
      modelOutcome: item.decision.outcome,
      policyVersion: item.decision.policyVersion,
      thresholdsVersion: item.decision.thresholdsVersion,
      photos: item.photos.map((p) => ({
        photoId: p.id,
        view: p.view,
        sha256: p.sha256,
        damaged: v.photos[p.id]!.damaged,
        repair: v.photos[p.id]!.repair,
        scores: item.scores.find((s) => s.photoId === p.id)!,
      })),
    };
    // Appends are serialised so two experts saving at once never interleave a line.
    writing = writing.then(async () => {
      await fs.mkdir(path.dirname(options.verdictsFile), { recursive: true });
      await fs.appendFile(options.verdictsFile, JSON.stringify(line) + '\n');
    });
    await writing;
    item.verdict = line;
    return { saved: true, verdict: line };
  });
}

/** Stable short id for one photograph of one assessment, safe for the score-record id pattern. */
export function verdictPhotoId(assessmentId: string, photoId: string) {
  return (
    'v-' +
    createHash('sha256')
      .update(assessmentId + ':' + photoId)
      .digest('hex')
      .slice(0, 20)
  );
}

/** Verdict lines to calibration input: the latest verdict per assessment, one score record and one
 * label per garment photograph, grouped by assessment (scripts/v2-verdicts-to-labels.ts). */
export function verdictsToCalibration(lines: VerdictLine[]) {
  const latest = new Map<string, VerdictLine>();
  for (const v of lines) latest.set(v.assessmentId, v);
  const scores: PhotoScores[] = [],
    labels: Array<{
      photoId: string;
      damaged: VerdictLine['photos'][number]['damaged'];
      repair: VerdictLine['photos'][number]['repair'];
      group: string;
      domain: string;
      reviewer: string;
    }> = [];
  for (const v of latest.values())
    for (const p of v.photos) {
      if (p.view === 'label' || p.scores.fromOverview) continue; // label photographs carry no damage question
      const photoId = verdictPhotoId(v.assessmentId, p.photoId);
      scores.push({ ...p.scores, photoId });
      labels.push({
        photoId,
        damaged: p.damaged,
        repair: p.repair,
        group: v.assessmentId,
        domain: 'event',
        reviewer: v.reviewer,
      });
    }
  return { assessments: latest.size, scores, labels };
}
