import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { header, buildDossier } from '../../server/v4/dossier';
import { sameSidePatterns } from '../../server/v4/appearance';
import { nextObservation } from '../../packages/core/v4/next-observation';
import { describeLabels } from '../../packages/core/v4/disclosure';
import { extractLabel } from '../../packages/core/v4/labels';
import { custodyCardCandidate } from '../../packages/core/v4/acquisition';
import { sizeKey } from '../../packages/core/v4/commerce';
const sha = (v: string) => createHash('sha256').update(v).digest('hex'),
  key = 'e'.repeat(40);
const picture = (id: string, role: string) => ({
  photoId: id,
  workingHash: sha(id),
  sourceHash: sha('src' + id),
  width: 80,
  height: 120,
  metadataChecked: true,
  role,
  roleBasis: 'local',
  label: role === 'tag' ? 'FUEL\nSIZE 40' : '',
  attachment: 'unresolved',
});
const check = (state: string, layer = 'interior') => ({
  state,
  layer,
  zone: 'left_hip',
  box: [0.2, 0.2, 0.6, 0.6],
  method: 'test',
  regionHash: sha(state),
});
const fixture = header.parse({
  id: 'fixture',
  category: 'pants',
  at: '2026-11-21T20:00:00.000Z',
  history: 'no',
  damage: 'no',
  repair: 'no',
  foundation: 'offer',
  images: [
    picture('a', 'outer_front'),
    picture('b', 'outer_back'),
    picture('c', 'tag'),
    picture('d', 'inner_overview'),
  ],
});
describe('observation choice and physical intake controls', () => {
  it('requires the primary interior reading and keeps every existing hold, including unplaced older findings', () => {
    const initial = buildDossier(fixture, key).value;
    expect(initial.result.offerEligible).toBe(false);
    const x = structuredClone(fixture),
      inside = x.images.find((i) => i.role === 'inner_overview')!;
    inside.areaChecks = [check('surface')];
    expect(buildDossier(x, key).value.result.offerEligible).toBe(false);
    inside.findings = [check('unresolved')];
    expect(buildDossier(x, key).value.result.offerEligible).toBe(true);
    inside.areaChecks = [];
    expect(buildDossier(x, key).value.result.offerEligible).toBe(false);
    inside.findings = [
      check('surface'),
      { ...check('open_damage'), regionHash: undefined, decisionUse: 'unplaced' },
    ];
    expect(buildDossier(x, key).value.result.offerEligible).toBe(false);
  });
  it('selects a question that distinguishes a vent fracture from its normal aperture and retains the layer alternative', () => {
    const source = { photo: 'p', zone: 'unknown', layer: 'detail', box: [0, 0, 1, 1] };
    const vent = nextObservation([{ ...source, state: 'hardware_damage' }]);
    expect(vent?.action.key).toBe('oblique_hardware');
    expect(vent?.explanations.map((x) => x.key)).toContain('designed');
    expect(vent?.empiricalResolutionRate).toBeNull();
    const tear = nextObservation([{ ...source, state: 'open_damage' }]);
    expect(tear?.action.key).toBe('layer_connection');
    expect(tear?.explanations.map((x) => x.key)).toContain('liner');
    expect(tear?.requestLimit).toBe(1);
  });
  it('checks separate actual sources and an original road-contact concern before escalating a same-side pattern', () => {
    const a = {
      photo: 'a',
      sourceHash: sha('a'),
      state: 'surface_change',
      layer: 'exterior',
      zone: 'left_shoulder',
    };
    const b = { ...a, photo: 'b', sourceHash: sha('b'), zone: 'left_elbow' };
    expect(sameSidePatterns([a, b], false)[0]?.requiresSpecialist).toBe(false);
    expect(sameSidePatterns([a, b], true)[0]?.requiresSpecialist).toBe(true);
    expect(sameSidePatterns([a, { ...b, sourceHash: a.sourceHash }], true)).toEqual([]);
    expect(sameSidePatterns([a, { ...b, zone: 'right_elbow' }], true)).toEqual([]);
  });
  it('separates date conflict, draft comparison, shop receipt size, and a one-line photographed case identifier', () => {
    const fields = extractLabel('AA\nprEN17092-3:2019\nPROD-2018-02').map((f) => ({
      ...f,
      photo: 'tag',
      attachment: 'custodial',
    }));
    const d = describeLabels(fields, false);
    expect(d.flags.join(' ')).toMatch(/precedes/);
    expect(d.dating.production[0]?.precision).toBe('month');
    expect(d.suggestions.every((s) => !s.primary)).toBe(true);
    expect(sizeKey('US: W27/L32')).toBe(sizeKey('27W/32L'));
    expect(sizeKey('UK 6')).not.toBe(sizeKey('US 6'));
    expect(custodyCardCandidate({ role: 'tag', label: 'SAMPLE-105' }, 'SAMPLE-105')).toBe(true);
    expect(custodyCardCandidate({ role: 'tag', label: 'Manufacturer\nSAMPLE-105' }, 'SAMPLE-105')).toBe(
      false,
    );
  });
});
