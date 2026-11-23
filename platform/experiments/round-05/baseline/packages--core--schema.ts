import { z } from 'zod';

export const SCHEMA_VERSION = '1.0' as const;
export const POLICY_VERSION = '2026-10-26.2' as const;
export const Questions = ['crash', 'protective_damage', 'protective_repair'] as const;
export const QuestionSchema = z.enum(Questions);
export const AnswerSchema = z.enum(['yes', 'no', 'unknown']);
export const ViewSchema = z.enum(['front', 'back', 'label', 'detail']);
export const CategorySchema = z.enum([
  'motorcycle_jacket',
  'trousers',
  'gloves',
  'boots',
  'helmet',
  'other',
  'multiple',
  'unknown',
]);
export const DisclosureSchema = z.strictObject({
  id: z.string().min(1).max(80),
  question: QuestionSchema,
  answer: AnswerSchema,
  recordedAt: z.string().datetime(),
});
export const CorrectionSchema = z.strictObject({
  field: z.enum(['category', 'brand', 'model', 'size', 'material']),
  value: z.string().trim().min(1).max(120),
  recordedAt: z.string().datetime(),
});
export const QualitySchema = z.strictObject({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  brightness: z.number().min(0).max(255),
  sharpness: z.number().nonnegative(),
  warnings: z.array(z.enum(['low_resolution', 'dark', 'bright', 'soft'])),
});
export const PhotoEvidenceSchema = z.strictObject({
  id: z.string().min(1).max(80),
  view: ViewSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  byteLength: z.number().int().positive(),
  quality: QualitySchema,
});
export const VisualFindingsSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  category: CategorySchema,
  attributes: z
    .array(
      z.strictObject({
        field: z.enum(['brand', 'model', 'size', 'material', 'marking']),
        value: z.string().trim().min(1).max(120),
        kind: z.enum(['visible_text', 'inference']),
        imageIds: z.array(z.string().min(1).max(80)).min(1).max(6),
      }),
    )
    .max(16),
  concerns: z
    .array(
      z.strictObject({
        kind: z.enum([
          'abrasion',
          'tear',
          'seam',
          'repair',
          'closure',
          'insert',
          'obscured',
          'other',
        ]),
        area: z.enum(['protective', 'nonprotective', 'unknown']),
        imageId: z.string().min(1).max(80),
      }),
    )
    .max(16),
  missingViews: z.array(ViewSchema).max(4),
  multipleItems: z.boolean(),
});
// Per-photo evidence is generated before a mechanism interpretation. History remains rider-supplied.
export const PhotoInspectionSchema = z.strictObject({
  findings: z
    .array(
      z.strictObject({
        evidence: z.string().trim().min(1).max(240),
        zone: z.enum([
          'shoulder',
          'elbow',
          'forearm',
          'upper_arm',
          'back',
          'chest',
          'cuff',
          'hem',
          'collar',
          'unknown',
        ]),
        kind: z.enum(['abrasion', 'tear', 'seam', 'repair', 'closure', 'insert', 'other']),
        clarity: z.enum(['clear', 'possible']),
      }),
    )
    .max(6),
  crashPattern: z.enum(['consistent_with_sliding', 'not_observed', 'unclear']),
  category: CategorySchema,
  material: z.enum(['leather', 'textile', 'mesh', 'denim', 'mixed', 'unknown']),
});
export const InspectionSchema = z.strictObject({
  version: z.literal('photo-evidence-1'),
  photos: z
    .array(PhotoInspectionSchema.extend({ imageId: z.string().min(1).max(80) }))
    .min(1)
    .max(6),
});
export const ObservationSchema = VisualFindingsSchema.extend({
  inspection: InspectionSchema.optional(),
  provider: z.enum(['local_clip', 'local_siglip', 'openai', 'gemini', 'local_vlm', 'test']),
  model: z.string().min(1).max(160),
  coverage: z.enum(['category_only', 'visual_observations']),
  durationMs: z.number().nonnegative(),
  usage: z
    .strictObject({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
    })
    .nullable(),
});
export const DecisionSchema = z.strictObject({
  state: z.enum(['not_eligible', 'more_information', 'human_inspection', 'ready_for_review']),
  policyVersion: z.literal(POLICY_VERSION),
  title: z.string(),
  summary: z.string(),
  reasons: z.array(z.strictObject({ code: z.string(), text: z.string() })),
  nextAction: z.string(),
  offerRecommended: z.literal(false),
  protectivePerformanceCertified: z.literal(false),
});
export const ImageInputSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  view: ViewSchema,
  base64: z
    .string()
    .min(80)
    .max(5_600_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
export const AnalysisRequestSchema = z
  .strictObject({
    schemaVersion: z.literal(SCHEMA_VERSION),
    assessmentId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    disclosures: z.array(DisclosureSchema).max(60),
    corrections: z.array(CorrectionSchema).max(30),
    images: z.array(ImageInputSchema).min(1).max(6),
    consent: z.strictObject({
      processImages: z.literal(true),
      externalProvider: z.boolean(),
      expectedProvider: z.string().max(40).optional(),
      expectedModel: z.string().max(160).optional(),
    }),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.images.map((p) => p.id)).size !== value.images.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Photo identifiers must be unique',
        path: ['images'],
      });
    }
    if (new Set(value.disclosures.map((d) => d.id)).size !== value.disclosures.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Disclosure identifiers must be unique',
        path: ['disclosures'],
      });
    }
  });
export const AnalysisResponseSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  assessmentId: z.string(),
  status: z.enum(['complete', 'excluded']),
  photos: z.array(PhotoEvidenceSchema),
  observation: ObservationSchema.nullable(),
  decision: DecisionSchema,
  timing: z.strictObject({
    totalMs: z.number().nonnegative(),
    preprocessingMs: z.number().nonnegative(),
    inferenceMs: z.number().nonnegative(),
    cached: z.boolean(),
  }),
});
export type Disclosure = z.infer<typeof DisclosureSchema>;
export type Correction = z.infer<typeof CorrectionSchema>;
export type Answer = z.infer<typeof AnswerSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type PhotoView = z.infer<typeof ViewSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type Quality = z.infer<typeof QualitySchema>;
export type PhotoEvidence = z.infer<typeof PhotoEvidenceSchema>;
export type Observation = z.infer<typeof ObservationSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type AnalysisRequest = z.infer<typeof AnalysisRequestSchema>;
export type AnalysisResponse = z.infer<typeof AnalysisResponseSchema>;
export interface VisionImage {
  id: string;
  view: PhotoView;
  jpeg: Uint8Array;
}
export interface VisionAdapter {
  readonly id: Observation['provider'];
  readonly model: string;
  readonly coverage?: Observation['coverage'];
  clearCache?(): void;
  analyze(images: VisionImage[], signal?: AbortSignal): Promise<Observation>;
}
