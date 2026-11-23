import { CountReceiptSchema } from './count-review';
import { SignedFindingSchema } from './replacement';
import { z } from 'zod';
import { MarkedRegionSchema } from '../marked-region';
import { DisclosureSchema, QualitySchema, ViewSchema } from '../schema';

/** Backend v2 contracts. v1 contracts in ../schema.ts stay untouched until the service is switched over.
 * Design record: docs/22-backend-v2/build-guide.md. */
export const SCHEMA_VERSION_2 = '2.0' as const;
export const CategorySchema2 = z.enum([
  'jacket',
  'trousers',
  'suit',
  'gloves',
  'boots',
  'helmet',
  'armour',
  'other',
  'unknown',
]);
export const EXCLUSION_QUESTIONS = ['broken', 'road_contact', 'repair'] as const;
export type ExclusionQuestion = (typeof EXCLUSION_QUESTIONS)[number];

const Probability = z.number().min(0).max(1);
/** One closed question answered about one photograph. Never free text. */
export const AnswerSchema2 = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('yesno'), p: Probability }),
  z.strictObject({
    type: z.literal('choice'),
    choice: z.string().min(1).max(64),
    probabilities: z.record(z.string().min(1).max(64), Probability),
  }),
  z.strictObject({
    type: z.literal('level'),
    /** Probability-weighted level index, 0 = lowest. */
    score: z.number().min(0).max(9),
    probabilities: z.array(Probability).min(2).max(10),
  }),
]);
export const ScorerIdSchema = z.enum(['decisions', 'local_logprob', 'verbal']);
export const PhotoScoresSchema = z.strictObject({
  photoId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  view: ViewSchema,
  fromOverview: MarkedRegionSchema.optional(),
  parentSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  batteryVersion: z.string().min(1).max(40),
  scorer: z.strictObject({ id: ScorerIdSchema, model: z.string().min(1).max(160) }),
  answers: z.record(z.string().regex(/^[a-z0-9_]{1,40}$/), AnswerSchema2),
  usage: z.strictObject({
    inputTokens: z.number().int().nonnegative(),
    ms: z.number().nonnegative(),
  }),
  scoredAt: z.string().datetime(),
});
/** Returned to the phone and sent back at decision time, so the service keeps no assessment state. */
export const SignedScoresSchema = z.strictObject({
  scores: PhotoScoresSchema,
  signature: z.string().regex(/^[a-f0-9]{64}$/),
});

const Band = z
  .strictObject({ clear: Probability, block: Probability })
  .refine((b) => b.clear <= b.block, { message: 'clear must not exceed block' });
export const ThresholdsSchema = z.strictObject({
  version: z.string().min(1).max(80),
  batteryVersion: z.string().min(1).max(40),
  source: z.string().max(400),
  /** True when a band was fitted on too few labelled examples. Policy then never offers. */
  lowEvidence: z.boolean(),
  /** `damage` applies to max(broken, road_contact); `repair` to the repair question. */
  perScorer: z.partialRecord(
    ScorerIdSchema,
    z.strictObject({
      damage: Band,
      repair: Band,
      models: z.array(z.string().min(1).max(160)).min(1).optional(),
    }),
  ),
  usableMin: Probability,
  gearMin: Probability,
  singleItemMin: Probability,
  categoryMin: Probability,
  zoneMin: Probability,
  labelLegibleMin: Probability,
});

export const PolicyConfigSchema = z.strictObject({
  version: z.string().min(1).max(40),
  supportedCategories: z.array(CategorySchema2),
  reviewOnlyCategories: z.array(CategorySchema2),
  requiredViews: z.array(ViewSchema),
  maxCloseUpRequests: z.number().int().min(0).max(3),
  /** Ascending [upper bound of the wear score, grade]. */
  gradeFromWear: z.array(z.tuple([z.number(), z.enum(['A', 'B', 'C', 'D'])])).min(1),
  offerGrades: z.array(z.enum(['A', 'B', 'C', 'D'])),
  /** category -> zone key -> label shown to people. Zone keys match battery questions `zone_<key>`. */
  protectiveZones: z.record(z.string(), z.record(z.string(), z.string())),
});

export const OutcomeSchema = z.enum(['offer', 'no_offer', 'review', 'retake']);
export const DecisionSchema2 = z.strictObject({
  outcome: OutcomeSchema,
  policyVersion: z.string(),
  thresholdsVersion: z.string(),
  category: CategorySchema2,
  grade: z.enum(['A', 'B', 'C', 'D']).nullable(),
  title: z.string(),
  summary: z.string(),
  reasons: z.array(
    z.strictObject({
      code: z.string(),
      text: z.string(),
      photoId: z.string().nullable(),
      question: z.string().nullable(),
      score: z.number().nullable(),
    }),
  ),
  nextAction: z.string(),
  requestPhoto: z.strictObject({ view: ViewSchema, hint: z.string() }).nullable(),
  /** A literal so that no code path can ever set it. */
  protectivePerformanceCertified: z.literal(false),
});

export const PhotoRecordSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  view: ViewSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  quality: QualitySchema,
});
export const HistoricalAreaSchema = z.strictObject({
  photoId: PhotoRecordSchema.shape.id,
  region: MarkedRegionSchema,
  cropSha256: PhotoRecordSchema.shape.sha256.optional(),
  overviewSha256: PhotoRecordSchema.shape.sha256.optional(),
  cropReceipt: SignedScoresSchema.optional(),
  overviewReceipt: SignedScoresSchema.optional(),
});
export type HistoricalArea = z.infer<typeof HistoricalAreaSchema>;
export const HistoricalAreasSchema = z.array(HistoricalAreaSchema).max(6);
export const EarlierAssessmentSchema = z.strictObject({
  disclosures: z.array(DisclosureSchema).max(60),
  photos: z.array(PhotoRecordSchema).max(8),
  signedScores: z.array(SignedScoresSchema).max(8),
  closeUpsRequested: z.number().int().min(0).max(3),
});
export const ReplacedOverviewSchema = z.strictObject({
  photoId: PhotoRecordSchema.shape.id,
  view: z.enum(['front', 'back']),
  replacementId: PhotoRecordSchema.shape.id.nullable(),
  record: PhotoRecordSchema.optional(),
  signed: SignedScoresSchema.optional(),
  finding: SignedFindingSchema.optional(),
  legacyAssessment: EarlierAssessmentSchema.optional(),
  previouslyExcluded: z.literal(true).optional(),
});
export type ReplacedOverview = z.infer<typeof ReplacedOverviewSchema>;
export type EarlierAssessment = z.infer<typeof EarlierAssessmentSchema>;
export const ReplacedOverviewsSchema = z
  .array(ReplacedOverviewSchema)
  .refine(
    (v) => new Set(v.map((e) => e.photoId)).size === v.length,
    'A superseded source must be unique.',
  );
export const AssessRequestSchema2 = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION_2),
  assessmentId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  disclosures: z.array(DisclosureSchema).max(60),
  photos: z.array(PhotoRecordSchema).max(8),
  signedScores: z.array(SignedScoresSchema).max(8),
  historicalAreas: HistoricalAreasSchema.optional(),
  replacedOverviews: ReplacedOverviewsSchema.optional(),
  countReceipt: CountReceiptSchema.optional().catch(undefined),
  countCheck: z
    .strictObject({
      notice: z.literal('terms'),
      photoId: PhotoRecordSchema.shape.id,
      base64: z
        .string()
        .min(80)
        .max(5600000)
        .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    })
    .optional()
    .catch(undefined),
  closeUpsRequested: z.number().int().min(0).max(3),
});

export type Category2 = z.infer<typeof CategorySchema2>;
export type Answer2 = z.infer<typeof AnswerSchema2>;
export type PhotoScores = z.infer<typeof PhotoScoresSchema>;
export type SignedScores = z.infer<typeof SignedScoresSchema>;
export type Thresholds = z.infer<typeof ThresholdsSchema>;
export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;
export type Outcome = z.infer<typeof OutcomeSchema>;
export type Decision2 = z.infer<typeof DecisionSchema2>;
export type PhotoRecord = z.infer<typeof PhotoRecordSchema>;
