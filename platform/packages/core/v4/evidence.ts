import { z } from 'zod';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,96}$/);
export const rect = z
  .tuple([
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
  ])
  .refine(([l, t, r, b]) => l < r && t < b, 'Empty crop');
export const sourceRegion = z.strictObject({
  photoId: id,
  parentHash: sha,
  cropHash: sha,
  rect,
  pixelWidth: z.number().int().positive().max(50000),
  pixelHeight: z.number().int().positive().max(50000),
  metadataChecked: z.literal(true),
});
export const binding = z
  .strictObject({
    status: z.enum(['same_frame', 'continuity', 'custodial', 'unresolved', 'conflict']),
    method: z.string().min(1).max(100),
    reason: z.string().min(1).max(400),
    support: z.array(sha).max(12),
  })
  .superRefine((v, ctx) => {
    if (
      (v.status === 'same_frame' || v.status === 'continuity' || v.status === 'custodial') &&
      !v.support.length
    )
      ctx.addIssue({
        code: 'custom',
        message: 'A positive link needs a source or custody receipt',
      });
  });
export const ledgerEntry = z
  .strictObject({
    id,
    caseId: id,
    at: z.string().datetime({ offset: true }),
    supersedes: id.optional(),
    fact: z.enum([
      'garment',
      'brand',
      'model',
      'size',
      'origin',
      'standard',
      'garment_class',
      'production_date',
      'purchase_date',
      'service_due',
      'usage',
      'disclosed_crash',
      'disclosed_damage',
      'disclosed_repair',
      'composition',
      'care',
      'zone_condition',
      'coverage',
      'coin_scale',
      'pocket',
      'evidence_link',
      'source_quality',
    ]),
    value: z.string().min(1).max(1000),
    status: z.enum(['read', 'inferred', 'rider_stated', 'specialist_verified', 'missing']),
    instrument: z.string().min(1).max(100),
    instrumentVersion: z.string().min(1).max(80),
    calibration: z.enum([
      'calibrated_for_input',
      'uncalibrated',
      'direct_read',
      'attested',
      'not_applicable',
    ]),
    confidence: z.enum(['observed', 'corroborated', 'tentative', 'unknown']),
    layer: z.enum(['shell', 'protective', 'comfort', 'thermal', 'protector', 'unknown']).optional(),
    zone: z
      .enum([
        'left_shoulder',
        'right_shoulder',
        'left_elbow',
        'right_elbow',
        'upper_back',
        'left_hip',
        'right_hip',
        'left_knee',
        'right_knee',
        'seat',
        'unknown',
      ])
      .optional(),
    sources: z.array(sourceRegion).max(12),
    binding,
    knowledgeRefs: z.array(sha).max(16),
  })
  .superRefine((v, ctx) => {
    if (v.status === 'read' && !v.sources.length)
      ctx.addIssue({ code: 'custom', message: 'A photographic read needs its pixels' });
    if (v.supersedes === v.id)
      ctx.addIssue({ code: 'custom', message: 'An observation cannot replace itself' });
  });
export type Observation = z.infer<typeof ledgerEntry>;
export type SourceRegion = z.infer<typeof sourceRegion>;
export type EvidenceBinding = z.infer<typeof binding>;

/** Arrival order is preserved for the audit. Effective claims use explicit supersession. */
export class EvidenceLedger {
  readonly #entries: Observation[] = [];
  readonly #ids = new Map<string, Observation>();
  readonly #superseded = new Set<string>();
  constructor(
    readonly caseId: string,
    initial: readonly unknown[] = [],
  ) {
    id.parse(caseId);
    for (const entry of initial) this.append(entry);
  }
  append(raw: unknown): Observation {
    const next = ledgerEntry.parse(raw);
    if (next.caseId !== this.caseId) throw Error('Observation belongs to another item');
    const old = this.#ids.get(next.id);
    if (old) {
      if (JSON.stringify(old) !== JSON.stringify(next)) throw Error('Observation ID conflict');
      return structuredClone(old);
    }
    if (next.supersedes) {
      const before = this.#ids.get(next.supersedes);
      if (
        !before ||
        before.fact !== next.fact ||
        before.zone !== next.zone ||
        before.layer !== next.layer ||
        this.#superseded.has(before.id)
      )
        throw Error('Correction has no unique effective observation to replace');
      if (next.status !== 'specialist_verified')
        throw Error('Correcting recorded facts requires specialist reconciliation');
      this.#superseded.add(before.id);
    }
    this.#ids.set(next.id, next);
    this.#entries.push(next);
    return structuredClone(next);
  }
  all(): Observation[] {
    return structuredClone(this.#entries);
  }
  active(): Observation[] {
    return this.all().filter((x) => !this.#superseded.has(x.id));
  }
  /** Prior exclusion disclosures survive ordinary edits and are always visible to the gate. */
  exclusionHistory(): Observation[] {
    return this.all().filter(
      (x) =>
        ['disclosed_crash', 'disclosed_damage', 'disclosed_repair'].includes(x.fact) &&
        x.value === 'yes',
    );
  }
}
