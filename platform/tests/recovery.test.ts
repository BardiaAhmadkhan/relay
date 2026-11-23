import { describe, it, expect } from 'vitest';
import { recoveryAction } from '../packages/core/recovery';
import type { Decision } from '../packages/core/schema';
const decision = (code: string) =>
  ({ state: 'more_information', reasons: [{ code, text: 'Request' }] }) as Decision;
describe('result recovery goes to the evidence actually requested', () => {
  it.each(['front', 'back', 'label', 'detail'] as const)('opens requested %s view', (view) => {
    expect(recoveryAction(decision('vision_missing_' + view), [])).toMatchObject({
      screen: 'capture',
      view,
    });
    expect(recoveryAction(decision('missing_' + view), [])).toMatchObject({
      screen: 'capture',
      view,
    });
  });
  it('opens the original low-quality image slot', () =>
    expect(
      recoveryAction(decision('quality_label-123'), [{ id: 'label-123', view: 'label' }]),
    ).toMatchObject({ view: 'label', label: 'Retake the label view' }));
  it('sends unknown history to disclosures and a suspected seam to closeup', () => {
    expect(recoveryAction(decision('unknown_crash'), []).screen).toBe('history');
    expect(recoveryAction(decision('concern_seam'), []).view).toBe('detail');
  });
});
