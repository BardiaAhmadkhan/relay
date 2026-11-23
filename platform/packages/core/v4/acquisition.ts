import { z } from 'zod';
import type { LabelField } from './labels';

export const processingTiers = {
  version: '2026-11-21.1',
  tasks: {
    geometry: {
      tier: 'deterministic',
      basis: 'Coordinates, parent digest, SIFT/RANSAC and typed evidence links',
    },
    privacy: { tier: 'deterministic', basis: 'JPEG segment validation' },
    identity: {
      tier: 'deterministic',
      basis: 'Conflicting garment makers keep identity unresolved until the evidence is linked.',
    },
    fusion: {
      tier: 'deterministic',
      basis: 'Robust action across admissible states; no trained policy',
    },
    disposition: { tier: 'deterministic', basis: 'Posted tariffs and operator-supplied amounts' },
    category: { tier: 'local', basis: 'The foundation scorer reads whole-garment overviews.' },
    roles: {
      tier: 'local',
      basis: 'Closed-choice two-stage shot understanding; ambiguous cues require confirmation',
    },
    label_identity: {
      tier: 'local',
      basis: 'Identity fields come from a readable label linked to the photographed item.',
    },
    label_standard_composition: {
      tier: 'specialist_reader',
      basis:
        'A specialist reads ambiguous printed standards, editions and fibre percentages.',
    },
    item_count: {
      tier: 'specialist_reader',
      basis: 'Separate V3.5 count protocol, same-image count disputes only',
    },
    unresolved: { tier: 'person', basis: 'Evidence spans multiple permissible actions' },
  },
  reference: 'Source-linked photographic observations and rider disclosures.',
} as const;
export const permittedRemoteTask = (x: string) =>
  x === 'label_standard_composition' || x === 'missing_maker_on_composition_tag';
const areaObservation = z.object({
  state: z.string(),
  zone: z.string(),
  layer: z.string(),
  box: z.array(z.number()).length(4),
  regionHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  method: z.string(),
  decisionUse: z
    .enum(['review', 'screening_cue', 'unplaced', 'context_reclassified', 'observation'])
    .optional(),
  firstSupport: z.number().min(0).max(1).nullish(),
  context: z.string().max(32).nullish(),
  contextSupport: z.number().min(0).max(1).nullish(),
  otherSource: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullish(),
  otherState: z.string().max(40).nullish(),
});
export const imageFact = z.strictObject({
  photoId: z.string().regex(/^[A-Za-z0-9_-]{1,96}$/),
  sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
  workingHash: z.string().regex(/^[0-9a-f]{64}$/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  role: z.string().max(28),
  garment: z.enum(['jacket', 'pants', 'unknown']).default('unknown'),
  roleBasis: z.enum(['local', 'capture_hint', 'derived']),
  metadataChecked: z.literal(true),
  liningFront: z
    .strictObject({
      supported: z.boolean(),
      conclusive: z.boolean(),
      method: z.literal('pelvis-front.1'),
    })
    .optional(),
  label: z.string().max(14000).default(''),
  localOriginRead: z
    .strictObject({
      text: z.string().max(80),
      method: z.literal('two local explicit made-in reads'),
    })
    .optional(),
  verifiedMakerRead: z
    .strictObject({
      text: z.string().max(160),
      cropHash: z.string().regex(/^[0-9a-f]{64}$/),
      rect: z.tuple([
        z.number().min(0).max(1),
        z.number().min(0).max(1),
        z.number().min(0).max(1),
        z.number().min(0).max(1),
      ]),
    })
    .optional(),
  acceptedLabel: z.string().max(9000).optional(),
  acceptedLabelCrop: z
    .strictObject({
      hash: z.string().regex(/^[0-9a-f]{64}$/),
      rect: z.tuple([
        z.number().min(0).max(1),
        z.number().min(0).max(1),
        z.number().min(0).max(1),
        z.number().min(0).max(1),
      ]),
    })
    .optional(),
  region: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  attachment: z
    .enum(['unresolved', 'same_frame', 'continuity', 'custodial', 'conflict'])
    .default('unresolved'),
  anchor: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  regions: z
    .array(
      z.object({
        zone: z.string(),
        layer: z.string(),
        box: z.array(z.number()).length(4),
        polygon: z.array(z.array(z.number()).length(2)).max(64).optional(),
        status: z.string(),
      }),
    )
    .default([]),
  findings: z.array(areaObservation.extend({ regionHash: z.string().optional() })).default([]),
  areaChecks: z.array(areaObservation).default([]),
});
export type ImageFact = z.infer<typeof imageFact>;
export function custodyCardCandidate(im: Pick<ImageFact, 'role' | 'label'>, itemId: string) {
  if (im.role === 'id_card') return true;
  const text = im.label
    .trim()
    .replace(/^\[|\]$/g, '')
    .trim();
  return (
    im.role === 'tag' &&
    /^[A-Z0-9]+(?:[-_][A-Z0-9]+)+$/i.test(text) &&
    text.length >= 5 &&
    text.length <= 40 &&
    text.toUpperCase() === itemId.toUpperCase()
  );
}
export type TagRead = {
  photo: string;
  root?: string;
  fields: LabelField[];
  attachment: string;
  component?: boolean;
};
