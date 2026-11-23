import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  describeLabels,
  performanceDisclosure,
  publicOutcomes,
} from '../../packages/core/v4/disclosure';
import { extractLabel } from '../../packages/core/v4/labels';
import { modelFusion, type FusionInput } from '../../packages/core/v4/fusion';
const tag = (text: string, attachment = 'same_frame', requiresConfirmation = false) =>
  extractLabel(text).map((f) => ({ ...f, photo: 'photo-1', attachment, requiresConfirmation }));
const x: FusionInput = {
  foundation: 'offer',
  areaDamage: 'no',
  areaRepair: 'no',
  crash: 'no',
  acquisitionComplete: true,
  identityConflict: false,
  needsSourceView: false,
  possibleStructural: false,
  unresolvedComponent: false,
  verifiedProtectiveFailure: false,
};
describe('public outcome and source contracts', () => {
  it('requires bound legible text, keeps draft and part rather than silently repairing the printed claim, and attributes fibres', () => {
    const fields = tag('AA\nFprEN17092-1:2019\nPROD-2019-02\nOuter Shell 25% Dyneema');
    const attached = describeLabels(fields, false);
    expect(
      attached.lines.every((l) => l.text.startsWith('The label states ') && l.photo === 'photo-1'),
    ).toBe(true);
    expect(attached.lines.map((l) => l.text).join(' ')).toMatch(/FprEN17092-1:2019/);
    expect(attached.lines.map((l) => l.text).join(' ')).toMatch(/25% Dyneema/);
    expect(attached.lines.find((l) => l.kind === 'standard')?.text).toBe(
      'The label states FprEN17092-1:2019 on the garment marking.',
    );
    expect(attached.flags.join(' ')).toMatch(/Part 1/);
    const matched = describeLabels(tag('AA\nprEN17092-3:2019\nprEN17092-1:2017'), false);
    expect(matched.flags.join(' ')).not.toMatch(/Part 1/);
    expect(matched.lines.some((l) => l.text.includes('prEN17092-3:2019'))).toBe(true);
    expect(attached.suggestions).toHaveLength(1);
    for (const invalid of [
      describeLabels(tag('AA\nFprEN17092-1:2019', 'unresolved'), false),
      describeLabels(fields, true),
      describeLabels(tag('AA\nFprEN17092-1:2019', 'custodial', true), false),
    ]) {
      expect(invalid.lines).toHaveLength(0);
      expect(invalid.suggestions).toHaveLength(0);
      expect(invalid.flags.join(' ')).toMatch(/Not confirmed/);
    }
  });
  it('keeps an armour-only mark separate and limits manufacturer guidance to the named component', () => {
    const data = describeLabels(tag('EN1621-1:2012'), false, undefined, {
      status: 'replacement_due',
      dueDate: '2025-11-21',
      source: 'https://www.planet-knox.com/',
      photo: 'photo-2',
    });
    expect(data.lines).toHaveLength(1);
    expect(data.lines[0]?.kind).toBe('standard');
    expect(data.flags.join(' ')).toMatch(/protector/);
    expect(data.suggestions[0]?.scope).toBe('component');
    expect(data.disclosure).toBe(performanceDisclosure);
  });
  it('never converts a shop exclusion into an offer or a lower-priority suggestion', () => {
    expect(modelFusion({ ...x, foundation: 'no_offer' })).toMatchObject({
      action: 'retire',
      offerEligible: false,
    });
    expect(modelFusion({ ...x, combinedHistory: 'yes' })).toMatchObject({
      action: 'retire',
      robust: true,
      offerEligible: false,
    });
    expect(Object.values(publicOutcomes)).toEqual([
      'Eligible for an offer',
      'No offer',
      'One more piece of evidence needed',
      'A specialist will review it',
      'Replacement suggested',
    ]);
  });
  it('renders the disclosure in the shared rider, shop and specialist screen and avoids a performance claim in presentation templates', () => {
    const view = readFileSync('app/src/v4/field-desk.tsx', 'utf8');
    const wording = [
      view,
      readFileSync('app/src/v4/intake.tsx', 'utf8'),
      ...Object.values(publicOutcomes),
      performanceDisclosure,
    ].join('\n');
    const placement = view.search(/\{\s*d\.guidance\.disclosure\s*\}/);
    const roleOnly = view.search(/\{\s*view\s*!==\s*['"]Shop['"]/);
    expect(placement).toBeGreaterThan(0);
    expect(roleOnly).toBeGreaterThan(placement);
    expect(wording).not.toMatch(
      /safe to ride|still protects you|guaranteed protection|certified by (?:Relay|Moto Reloaded)|passed our protection test|protection score/i,
    );
  });
});
