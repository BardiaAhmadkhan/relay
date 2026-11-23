import type { z } from 'zod';
import type { VisualFindingsSchema, Observation } from '../core/schema';

type Findings = z.infer<typeof VisualFindingsSchema> & { inspection?: Observation['inspection'] };

/**
 * Validate an already schema-parsed visual extraction before rendering it.
 *
 * This is a narrow observation vocabulary and request-provenance boundary. It
 * does not authenticate a label, measure protection, verify history, or prove
 * that all hostile/false semantics have been detected. Brand/model text remains
 * quoted, unverified text in the UI. The deterministic policy owns every result.
 *
 * Deliberately unfamiliar sizes/materials/markings fail closed instead of being
 * silently rewritten. Extend the vocabulary only with representative fixtures.
 * Errors contain stable codes, never the submitted text or photograph content.
 */
export function validateFindings(findings: Findings, imageIds: Set<string>): void {
  if (!imageIds.size) throw new Error('provider_missing_evidence');
  const inspection = findings.inspection;
  if (inspection) {
    if (
      inspection.photos.length !== imageIds.size ||
      new Set(inspection.photos.map((p) => p.imageId)).size !== imageIds.size ||
      inspection.photos.some((p) => !imageIds.has(p.imageId))
    )
      throw new Error('provider_unknown_image');
    for (const photo of inspection.photos)
      for (const finding of photo.findings) {
        if (
          /[\p{Cc}\p{Cf}<>]/u.test(finding.evidence) ||
          /https?:\/\//i.test(finding.evidence) ||
          unsupportedClaim(finding.evidence)
        )
          throw new Error('provider_invalid_evidence');
      }
  }
  for (const attribute of findings.attributes) {
    if (!attribute.imageIds.length || attribute.imageIds.some((id) => !imageIds.has(id))) {
      throw new Error('provider_unknown_image');
    }
    const raw = attribute.value;
    if (!raw.trim() || raw.length > 120 || /[\p{Cc}\p{Cf}]/u.test(raw)) {
      throw new Error('provider_invalid_attribute');
    }
    const value = raw
      .normalize('NFKC')
      .replace(/[\u2010-\u2015\u2212]/gu, '-')
      .trim();
    if (!value || value.length > 120 || /[<>{}|]/u.test(value)) {
      throw new Error('provider_invalid_attribute');
    }
    if (unsupportedClaim(value)) throw new Error('provider_unsupported_claim');

    if (attribute.field !== 'material' && attribute.kind !== 'visible_text') {
      throw new Error('provider_invalid_attribution');
    }
    switch (attribute.field) {
      case 'size':
        if (!validSize(value)) throw new Error('provider_invalid_size');
        break;
      case 'material':
        if (!validMaterial(value, attribute.kind)) throw new Error('provider_invalid_material');
        break;
      case 'marking':
        if (!validMarking(value)) throw new Error('provider_invalid_marking');
        break;
      case 'brand':
      case 'model':
        // Identity labels can contain unfamiliar words and punctuation. Limit
        // them to one bounded, attributable value; never treat them as authority.
        if (/https?:\/\/|www\.|@|\b(?:system|assistant|developer)\s*:/iu.test(value)) {
          throw new Error('provider_invalid_attribute');
        }
        break;
    }
  }
  if (findings.concerns.some((concern) => !imageIds.has(concern.imageId))) {
    throw new Error('provider_unknown_image');
  }
}

/** A secondary guard, not a comprehensive semantic classifier. */
function unsupportedClaim(value: string): boolean {
  return /\b(?:un)?certif(?:ied|ication|y|ies)\b|\bapproved?\b|\broadworthy\b|\bguarantee(?:d|s)?\b|\bundamaged\b|\b(?:crash|accident)[ -]?(?:free|proof)\b|\b(?:safe|ready)\s+(?:to|for)\s+(?:ride|riding|use)\b|\bbuy\s+now\b|\b(?:make|recommend|accept)\s+(?:an?\s+)?offer\b|\boffer\s+(?:recommended|approved|accepted)\b|\b(?:no|zero)\s+(?:injur(?:y|ies)|risk|damage|defects?)\b|\b(?:complete|full|total|maximum|perfect)\s+protection\b|\b100\s*%\s*(?:safe|protect(?:ion|ive))\b|[$€£]|\b(?:CAD|USD|EUR|GBP)\s*\d|\b(?:ignore|instructions?|override|bypass)\b|\bsystem\s+prompt\b/iu.test(
    value,
  );
}

function validSize(value: string): boolean {
  const upper = value.toUpperCase();
  if (/[^A-Z0-9\s,;:()\/-]/u.test(upper)) return false;
  const tokens = upper
    .replace(/[,;:()\/-]/gu, ' ')
    .trim()
    .split(/\s+/u);
  const modifiers = new Set([
    'SIZE',
    'EU',
    'US',
    'UK',
    'IT',
    'FR',
    'DE',
    'JP',
    'SHORT',
    'REGULAR',
    'LONG',
    'TALL',
    'PETITE',
    'EXTRA',
    'ONE',
  ]);
  const isSize = (token: string) =>
    /^(?:X{0,4}[SL]|M|[2-6]X[SL]|SMALL|MEDIUM|LARGE|OS|OSFA|(?:EU|US|UK|IT|FR|DE|JP)?\d{1,3}|[WL]\d{1,3}|\d{1,3}[WL])$/u.test(
      token,
    );
  return (
    (tokens.some(isSize) && tokens.every((token) => modifiers.has(token) || isSize(token))) ||
    upper === 'ONE SIZE'
  );
}

const visualMaterials = new Set(['LEATHER', 'TEXTILE', 'MESH', 'DENIM', 'HYBRID', 'MIXED']);
const compositionMaterials = new Set([
  'LEATHER',
  'COWHIDE',
  'COW',
  'BOVINE',
  'GOATSKIN',
  'GOAT',
  'KANGAROO',
  'SHEEPSKIN',
  'SHEEP',
  'SUEDE',
  'NUBUCK',
  'TEXTILE',
  'MESH',
  'DENIM',
  'ARAMID',
  'POLYESTER',
  'POLYAMIDE',
  'NYLON',
  'COTTON',
  'ELASTANE',
  'SPANDEX',
  'POLYURETHANE',
  'POLYETHYLENE',
  'RUBBER',
  'PU',
  'PE',
  'PVC',
  'KEVLAR',
  'CORDURA',
  'DYNEEMA',
  'UHMWPE',
  'PEKEV',
  'GORE',
  'TEX',
]);
const materialQualifiers = new Set([
  'AND',
  'GENUINE',
  'SYNTHETIC',
  'FULL',
  'TOP',
  'GRAIN',
  'PARA',
  'OUTER',
  'SHELL',
  'INNER',
  'LINING',
  'REINFORCEMENT',
  'MAIN',
  'BODY',
  'UPPER',
  'MATERIAL',
  'MATERIALS',
  'COMPOSITION',
]);

function validMaterial(value: string, kind: 'visible_text' | 'inference'): boolean {
  const upper = value.toUpperCase();
  if (kind === 'inference') {
    const tokens = upper
      .replace(/-LIKE\b/gu, '')
      .replace(/\bAND\b/gu, ' ')
      .replace(/[,/&+]/gu, ' ')
      .trim()
      .split(/\s+/u);
    return tokens.length > 0 && tokens.every((token) => visualMaterials.has(token));
  }
  const withoutPercentages = upper.replace(/\b(?:100(?:\.0+)?|\d{1,2}(?:\.\d+)?)\s*%/gu, ' ');
  if (/[^A-Z\s,;:/()+&-]/u.test(withoutPercentages)) return false;
  const tokens = withoutPercentages
    .replace(/[,;:/()+&-]/gu, ' ')
    .trim()
    .split(/\s+/u);
  return (
    tokens.some((token) => compositionMaterials.has(token)) &&
    tokens.every((token) => compositionMaterials.has(token) || materialQualifiers.has(token))
  );
}

function validMarking(value: string): boolean {
  let recognized = false;
  let remaining = value.toUpperCase();
  const consume = (pattern: RegExp) => {
    remaining = remaining.replace(pattern, () => {
      recognized = true;
      return ' ';
    });
  };
  consume(
    /\b(?:FPR|PR)?EN\s*(?:17092(?:\s*-\s*[1-6])?|1621(?:\s*-\s*[1-4])?)(?:\s*:\s*\d{4})?\b/gu,
  );
  consume(/\bCLASS\s+(?:AAA|AA|A|B|C)\b/gu);
  consume(/\bLEVEL\s*[12]\b/gu);
  consume(/\b(?:AAA|AA|A|B|C|CE|UKCA)\b/gu);
  return recognized && /^[\s,;/()+-]*$/u.test(remaining);
}
