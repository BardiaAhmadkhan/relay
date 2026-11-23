import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { stripMetadata } from '../../packages/core/v4/photo-privacy';
import { modelFusion, scopedService, type FusionInput } from '../../packages/core/v4/fusion';
import { laneQuote, lotQuote, emptyTerms, contribution } from '../../packages/core/v4/commerce';
import { extractLabel, identityConflict } from '../../packages/core/v4/labels';
import { EvidenceLedger } from '../../packages/core/v4/evidence';
import { buildDossier, header } from '../../server/v4/dossier';
import { authentic } from '../../server/v4/seal';
const x: FusionInput = {
  foundation: 'offer',
  crash: 'no',
  areaDamage: 'no',
  areaRepair: 'no',
  verifiedProtectiveFailure: false,
  identityConflict: false,
  unresolvedComponent: false,
  possibleStructural: false,
  acquisitionComplete: true,
  needsSourceView: false,
};
const key = 'v'.repeat(40),
  blank = header.parse({
    id: 'fixture',
    category: 'pants',
    at: '2026-11-21T18:00:00.000Z',
    images: [],
    foundation: 'pending',
  });
describe('V4 independent analysis and economics', () => {
  it('requires the same action under admissible states, identifies joint resolving sets and preserves exclusions', () => {
    expect(modelFusion(x).offerEligible).toBe(true);
    const one = modelFusion({
      ...x,
      crash: 'unknown',
      areaDamage: 'unknown',
      areaRepair: 'unknown',
    });
    expect(one.resolvingSets).toEqual([['history']]);
    expect(one.action).toBe('request');
    const joint = modelFusion({
      ...x,
      possibleStructural: true,
      crash: 'unknown',
      identityConflict: true,
    });
    expect(
      joint.resolvingSets.some(
        (s) => s.includes('history') && s.includes('layer') && s.includes('identity'),
      ),
    ).toBe(true);
    for (const base of ['offer', 'review', 'retake', 'no_offer', 'pending'] as const) {
      for (const field of ['crash', 'areaDamage', 'areaRepair', 'combinedHistory'] as const)
        expect(modelFusion({ ...x, foundation: base, [field]: 'yes' }).action).toBe('retire');
      expect(
        modelFusion({ ...x, foundation: base, verifiedProtectiveFailure: true }).offerEligible,
      ).toBe(false);
    }
    expect(modelFusion({ ...x, combinedHistory: 'unknown' }).action).toBe('specialist');
  });
  it('preserves the scope of a protector, draft prefix, ageing clock and two distinct 100% sections', () => {
    const a = extractLabel(
      'PANDO MOTO\nCE PROTECTOR EN1621-1\nKNOX\nPROD-2020-01\nPocket Bags: 100% Cotton\n100% Polyester\n',
    );
    expect(a.some((f) => f.field === 'garment_class')).toBe(false);
    expect(a.find((f) => f.field === 'production_date')?.value).toBe('2020-01');
    expect(
      a.find((f) => f.field === 'composition' && f.value === '100% POLYESTER')?.component,
    ).toBe('unspecified');
    expect(
      extractLabel('AA\nFprEN17092-1:2019').filter((f) => f.field === 'standard')[0]!.value,
    ).toBe('FPREN 17092-1:2019');
    expect(
      extractLabel('THE DIVA 2008\nSince 1924').some((f) => f.field === 'production_date'),
    ).toBe(false);
    const b = extractLabel('FUEL\nSergeant 2 Pants');
    const c = extractLabel('ROKKER\nCHINO SAND');
    expect(
      identityConflict([
        { photo: 'one', fields: b },
        { photo: 'two', fields: b },
        { photo: 'three', fields: c },
      ]).conflicted,
    ).toBe(true);
    expect(
      identityConflict([
        { photo: 'one', fields: a },
        { photo: 'two', fields: extractLabel('Knox Micro-Lock') },
        { photo: 'three', fields: extractLabel('Dyneema') },
      ]).conflicted,
    ).toBe(false);
    expect(
      scopedService({
        maker: 'Knox',
        componentIdentified: true,
        purchaseDate: '2020-02-29',
        asOf: '2025-02-28',
      }).status,
    ).toBe('replacement_due');
    expect(
      scopedService({ maker: 'Knox', componentIdentified: false, asOf: '2025-02-28' }).status,
    ).toBe('unverified');
  });
  it('strips EXIF and inter-scan metadata without changing the decoded pixels', async () => {
    const e = await sharp({ create: { width: 90, height: 70, channels: 3, background: '#732abc' } })
      .withExif({ IFD0: { Artist: 'private place' } })
      .jpeg({ progressive: true })
      .toBuffer();
    expect((await sharp(e).metadata()).exif).toBeDefined();
    const out = Buffer.from(stripMetadata(e));
    expect((await sharp(out).metadata()).exif).toBeUndefined();
    expect(await sharp(e).raw().toBuffer()).toEqual(await sharp(out).raw().toBuffer());
    expect(Buffer.from(stripMetadata(out))).toEqual(out);
    expect(() => stripMetadata(e.subarray(0, 200))).toThrow();
  });
  it('keeps quoted floor, actual contribution and fixture currency distinct', () => {
    expect(lotQuote('PH', 10, 5000).totalMinor).toBe(7994000);
    expect(lotQuote('PH', 10, 5500).totalMinor).toBe(8696000);
    expect(laneQuote('US', 5000).minor).toBe(9710);
    expect(laneQuote('CA', 5001, 'large').minor).toBeNull();
    expect(laneQuote('DE', 2500).minor).toBe(4799);
    const args = {
      priceMinor: 10000,
      currency: 'CAD',
      terms: emptyTerms,
      freightMinor: 2199,
      dutiesMinor: null,
      saleProbability: null,
      salvageMinor: null,
      acquisitionMinor: null,
    };
    expect(contribution(args).expectedContributionMinor).toBeNull();
    expect(contribution(args).knownCostFloorMinor).toBe(2199);
    const v = contribution({
      ...args,
      terms: { resaleRatio: 1, buyRate: 0.2, handlingMinor: 101, creditPremium: 0.1 },
      dutiesMinor: 0,
      saleProbability: 1,
    });
    expect(v.expectedContributionMinor).toBe(5700);
    expect(v.breakEvenMinor).toBe(4300);
    expect(v.creditMinor).toBe(2200);
  });
  it('makes the receipt invariant to photo order and prices and detects tampering', () => {
    const im = (id: string) => ({
      photoId: id,
      sourceHash: createHash('sha256').update(id).digest('hex'),
      workingHash: createHash('sha256').update(id).digest('hex'),
      width: 100,
      height: 150,
      role: 'outer_front',
      roleBasis: 'local',
      garment: 'pants',
      metadataChecked: true,
      label: '',
      regions: [],
      findings: [],
      attachment: 'unresolved',
    });
    const data = header.parse({ ...blank, images: [im('a'), im('b')] });
    const a = buildDossier(data, key),
      b = buildDossier({ ...data, images: [...data.images].reverse() }, key);
    expect(a.sha256).toBe(b.sha256);
    expect(authentic(a, 'inspection', key)).toBe(true);
    expect(authentic({ ...a, purpose: 'stock_accept' }, 'stock_accept', key)).toBe(false);
  });
  it('keeps exclusions in the append-only record, accepts idempotent retries and rejects forged supersession', () => {
    const l = new EvidenceLedger('fixture');
    const e = {
      id: 'd1',
      caseId: 'fixture',
      at: blank.at,
      fact: 'disclosed_crash',
      value: 'yes',
      status: 'rider_stated',
      instrument: 'history',
      instrumentVersion: '1',
      calibration: 'attested',
      confidence: 'observed',
      sources: [],
      binding: { status: 'unresolved', method: 'rider', reason: 'Recorded history', support: [] },
      knowledgeRefs: [],
    };
    l.append(e);
    l.append(e);
    expect(l.all()).toHaveLength(1);
    expect(l.exclusionHistory()).toHaveLength(1);
    expect(() => l.append({ ...e, id: 'd2', supersedes: 'd1', value: 'no' })).toThrow();
    l.append({ ...e, id: 'd2', status: 'specialist_verified', supersedes: 'd1', value: 'no' });
    expect(l.exclusionHistory()).toHaveLength(1);
  });
});
