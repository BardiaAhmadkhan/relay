import { expect, it } from 'vitest';
import { zoneReport } from '../../packages/core/v4/zone-report';
import { visibleZones } from '../../packages/core/v4/zone-visibility';
const box = [0.15, 0.15, 0.65, 0.65],
  source = { id: 'p', hash: 'parent', regions: [{ zone: 'right_hip', layer: 'exterior', box }] };
const read = {
  photo: 'p',
  zone: 'left_hip',
  layer: 'interior',
  state: 'surface',
  box,
  regionHash: 'crop',
  decisionUse: 'observation',
};
const base = { category: 'pants', images: [source], visible: [], areaChecks: [read] };
const at = (fraction: number) => ({
  'p:crop': {
    photo: 'p',
    source: 'parent',
    region: 'crop',
    box,
    width: 300,
    height: 300,
    fraction,
    outlines: [],
    exact: true,
  },
});
it('separates a read, an estimated photographed area, and eight genuinely unpictured zone views', () => {
  const raw = zoneReport(base);
  expect(raw).toMatchObject({ checked: 1, unread: 1, missing: 8, total: 10 });
  const full = visibleZones(base, at(0.6));
  expect(full).toMatchObject({ checked: 1, partial: 0, unusable: 0, unread: 1, missing: 8 });
  const partial = visibleZones(base, at(0.25));
  expect(partial).toMatchObject({ checked: 1, partial: 1 });
  expect(partial.rows[0]!.cells[1]!.finding).toContain('visible part');
  const low = visibleZones(base, at(0.24999));
  expect(low.checked).toBe(0);
  expect(low.rows[0]!.cells[1]!.finding).not.toContain('No hole');
  const unlinked = at(0.99);
  unlinked['p:crop'].source = 'different source';
  expect(visibleZones(base, unlinked).checked).toBe(0);
});
it('keeps an original adverse reading visible even when placement is rejected or its historical crop is unavailable', () => {
  const adverse = { ...read, state: 'open_damage' },
    other = { ...adverse, zone: 'unknown', layer: 'detail', regionHash: undefined };
  const flagged = { ...base, visible: [adverse, other] };
  const masked = visibleZones(flagged, at(0));
  expect(masked.checked).toBe(0);
  expect(masked.adverse).toBe(1);
  expect(masked.rows[0]!.cells[1]!.finding).toMatch(/screening cue/i);
  expect(masked.other).toHaveLength(1);
  expect(masked.summary).toContain('left hip (inside)');
  expect(visibleZones(flagged, {}).adverse).toBe(1);
});
