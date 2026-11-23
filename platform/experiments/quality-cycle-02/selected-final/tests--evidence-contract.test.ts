import { isOrdinaryFeatureDescription } from '../packages/vision/evidence-contract';
import { describe, expect, it } from 'vitest';
import {
  isWhollyNegativeEvidence,
  removeNegativeEvidence,
} from '../packages/vision/evidence-contract';
import {
  isOnlyCosmeticDescription,
  normalizeEvidenceClaims,
} from '../packages/vision/evidence-contract';
import type { z } from 'zod';
import type { PhotoInspectionSchema } from '../packages/core/schema';

describe('physical-evidence assertion consistency', () => {
  it.each([
    'Black gloves inside a case show no visible surface damage, abrasion, or fraying.',
    'No visible abrasion, tear, fraying, or exposed fibers on any panel or seam',
    'The black fur-like material shows no signs of abrasion, tears, or exposed fibers.',
    'There are no visible holes or tears on the sleeve.',
    'A leather panel without abrasion or exposed fibers.',
  ])('excludes a completely negated observation: %s', (value) => {
    expect(isWhollyNegativeEvidence(value)).toBe(true);
  });
  it.each([
    'No abrasion, but a ragged tear at the elbow.',
    'The torn sleeve shows no abrasion.',
    'There is a hole. No abrasion is visible.',
    'No abrasion on the sleeve; frayed fibers at the cuff.',
    'No obvious abrasion except around the ragged hole.',
    'No abrasion is visible although a seam has opened.',
    'No abrasion or holes, a seam is separating.',
    'The fabric is not without tears.',
    'A ragged hole with exposed fibers on the outer sleeve.',
    'A narrow cut with no fraying.',
    'No abrasion, only a small split in the material.',
    'No abrasion or holes above the rip.',
    'A smooth mark on the fabric.',
    'No visible fuzzing on the patch.',
    'The seam has no fraying and two missing stitches.',
  ])('preserves positive, mixed or unfamiliar evidence: %s', (value) => {
    expect(isWhollyNegativeEvidence(value)).toBe(false);
  });
  it('keeps positive evidence, metadata and uncertainty unchanged', () => {
    const positive = {
      evidence: 'A ragged hole through the sleeve',
      kind: 'tear' as const,
      zone: 'elbow' as const,
      clarity: 'possible' as const,
    };
    const photo: z.infer<typeof PhotoInspectionSchema> = {
      category: 'motorcycle_jacket',
      material: 'textile',
      crashPattern: 'unclear',
      findings: [
        positive,
        {
          evidence: 'No visible abrasion or tears on the chest.',
          kind: 'other',
          zone: 'chest',
          clarity: 'clear',
        },
      ],
    };
    const result = removeNegativeEvidence(photo);
    expect(result).toEqual({ ...photo, findings: [positive] });
    expect(photo.findings).toHaveLength(2);
    expect(result.findings[0]).toBe(positive);
    expect(removeNegativeEvidence(result)).toBe(result);
  });
  it('does not leave an inferred sliding pattern supported only by a negative statement', () => {
    const photo: z.infer<typeof PhotoInspectionSchema> = {
      category: 'unknown',
      material: 'unknown',
      crashPattern: 'consistent_with_sliding',
      findings: [
        {
          evidence: 'No visible damage on the panel.',
          zone: 'unknown',
          kind: 'abrasion',
          clarity: 'clear',
        },
      ],
    };
    expect(removeNegativeEvidence(photo)).toEqual({
      ...photo,
      findings: [],
      crashPattern: 'not_observed',
    });
  });
});

describe('cosmetic descriptions are not physical defect assertions', () => {
  it('preserves every uncertain cosmetic observation for further inspection', () => {
    const uncertain = { ...finding('Small dark stain on fabric'), clarity: 'possible' as const };
    expect(isOnlyCosmeticDescription(uncertain)).toBe(false);
    const photo = {
      category: 'unknown' as const,
      material: 'unknown' as const,
      crashPattern: 'unclear' as const,
      findings: [uncertain],
    };
    expect(normalizeEvidenceClaims(photo)).toBe(photo);
  });

  const finding = (evidence: string, kind: 'other' | 'tear' = 'other') => ({
    evidence,
    kind,
    zone: 'unknown' as const,
    clarity: 'clear' as const,
  });
  it.each([
    'A faint circular stain on the fabric surface.',
    'A blue stain or discoloration on the panel.',
    'Natural creasing and wrinkles on the leather surface.',
    'The printed lettering is faded.',
  ])('identifies an explicitly cosmetic-only description: %s', (value) =>
    expect(isOnlyCosmeticDescription(finding(value))).toBe(true),
  );
  it.each([
    'A faded patch with frayed fibers.',
    'A brown stain beside a narrow cut.',
    'A circular discoloration around a small hole.',
    'Discoloration and a fractured fastener.',
    'Discolored and matted fabric.',
    'A creased area with delaminated coating.',
    'Staining near a burned surface.',
    'Discoloration around damaged material.',
    'An unexplained small dark spot.',
    'A small dark spot or stain on the material.',
    'A white puckered spot.',
    'A stain or possible abrasion.',
    'The surface is not stained.',
    'No discoloration, but a split in the fabric.',
    'A faded edge with a pulled thread.',
    'A worn and discolored surface.',
    'Staining beside a malfunctioning zipper.',
    'Discoloration with fretting near the fastener.',
    'A stain around a seized zip.',
    'Fading beside a chipped snap.',
    'Discoloration and an unfamiliar physical phenomenon.',
  ])('retains physical or unresolved evidence: %s', (value) =>
    expect(isOnlyCosmeticDescription(finding(value))).toBe(false),
  );
  it('never uses cosmetic text alone to erase a proposed structural kind', () =>
    expect(isOnlyCosmeticDescription(finding('Discoloration at a damaged edge', 'tear'))).toBe(
      false,
    ));
  it('is idempotent and preserves a mixed evidence list without strengthening any claim', () => {
    const physical = finding('Small dark spot on the material');
    const photo: z.infer<typeof PhotoInspectionSchema> = {
      category: 'unknown',
      material: 'unknown',
      crashPattern: 'unclear',
      findings: [finding('A faint yellow stain.'), physical],
    };
    const after = normalizeEvidenceClaims(photo);
    expect(after).toEqual({ ...photo, findings: [physical] });
    expect(normalizeEvidenceClaims(after)).toBe(after);
    expect(photo.findings).toHaveLength(2);
  });
});

describe('ordinary feature descriptions', () => {
  const f = (evidence: string) => ({
    evidence,
    kind: 'other' as const,
    zone: 'unknown' as const,
    clarity: 'possible' as const,
  });
  it.each([
    'A circular white graphic with puzzle-piece shapes and symbols is printed on the chest.',
    'Blue woven fabric with a zipper running vertically through the center.',
    'A star logo is printed on the upper sleeve.',
  ])('does not turn a simple feature into a physical concern: %s', (value) =>
    expect(isOrdinaryFeatureDescription(f(value))).toBe(true),
  );
  it.each([
    'A hole beside the printed graphic.',
    'The logo is faded.',
    'A zipper with an unfamiliar malfunction.',
    'The zipper is seized.',
    'A small dark spot on a printed emblem.',
    'The zipper has missing teeth.',
    'A white mark could be printed.',
    'A misaligned zipper.',
  ])('preserves damage, appearance uncertainty and unfamiliar wording: %s', (value) =>
    expect(isOrdinaryFeatureDescription(f(value))).toBe(false),
  );
});
