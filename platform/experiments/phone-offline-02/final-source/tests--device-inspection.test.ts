import { describe, it, expect, vi, afterEach } from 'vitest';
import { DeviceInspector, type DevicePhoto, type DeviceReply } from '../packages/mobile/inspection';
const photo: DevicePhoto = {
  id: 'front',
  view: 'front',
  uri: 'file:///owned/front.jpg',
  sha256: 'a'.repeat(64),
  byteLength: 500,
  quality: { width: 800, height: 1000, brightness: 120, sharpness: 100, warnings: [] },
};
const damaged = {
  findings: [
    { evidence: 'Ragged hole with frayed threads', kind: 'tear', zone: 'elbow', clarity: 'clear' },
  ],
  category: 'motorcycle_jacket',
  material: 'textile',
  crashPattern: 'consistent_with_sliding',
};
const reply = (data: unknown): DeviceReply => ({
  text: JSON.stringify(data),
  complete: true,
  inputTokens: 20,
  outputTokens: 10,
});
afterEach(() => vi.useRealTimers());
describe('on-device evidence contracts (model doubles)', () => {
  it('verifies visible evidence and binds it to the actual photo without inferring crash history', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce(reply(damaged))
      .mockResolvedValueOnce(reply({ verdicts: { candidate_0: 'supported' } }));
    const inspector = new DeviceInspector({ model: 'phone-test', generate });
    const result = await inspector.analyze([photo], new AbortController().signal);
    expect(result.inspection!.photos[0]).toMatchObject({
      imageId: 'front',
      crashPattern: 'unclear',
      findings: damaged.findings,
    });
    expect(result.usage).toEqual({ inputTokens: 40, outputTokens: 20 });
    expect(result.concerns[0]).toEqual({ kind: 'tear', area: 'protective', imageId: 'front' });
    expect(generate.mock.calls[1]![0]).toEqual([photo.uri]);
    inspector.clear();
  });
  it('rejects unsupported hypotheses and downgrades uncertain evidence', async () => {
    for (const verdict of ['unsupported', 'uncertain']) {
      const generate = vi
        .fn()
        .mockResolvedValueOnce(reply(damaged))
        .mockResolvedValueOnce(reply({ verdicts: { candidate_0: verdict } }));
      const inspector = new DeviceInspector({ model: 'phone-test', generate });
      const r = await inspector.analyze([photo], new AbortController().signal);
      expect(r.inspection!.photos[0]!.findings).toEqual(
        verdict === 'unsupported' ? [] : [{ ...damaged.findings[0], clarity: 'possible' }],
      );
      inspector.clear();
    }
  });
  it('does not cache truncated output or an invalid fixed-slot review', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ ...reply(damaged), complete: false })
      .mockResolvedValueOnce(reply(damaged))
      .mockResolvedValueOnce(reply({ verdicts: { candidate_1: 'supported' } }))
      .mockResolvedValueOnce(reply(damaged))
      .mockResolvedValueOnce(reply({ verdicts: { candidate_0: 'supported' } }));
    const inspector = new DeviceInspector({ model: 'phone-test', generate });
    await expect(inspector.analyze([photo], new AbortController().signal)).rejects.toThrow();
    await expect(inspector.analyze([photo], new AbortController().signal)).rejects.toThrow();
    expect(
      (await inspector.analyze([photo], new AbortController().signal)).inspection!.photos[0]!
        .findings,
    ).toHaveLength(1);
    expect(generate).toHaveBeenCalledTimes(5);
    inspector.clear();
  });
  it('keeps cache scoped to pixels and view while rebinding a new photo ID', async () => {
    const generate = vi.fn(async () => reply({ ...damaged, findings: [] }));
    const inspector = new DeviceInspector({ model: 'phone-test', generate }),
      signal = new AbortController().signal;
    await inspector.analyze([photo], signal);
    expect(
      (await inspector.analyze([{ ...photo, id: 'new-id' }], signal)).inspection!.photos[0]!
        .imageId,
    ).toBe('new-id');
    expect(generate).toHaveBeenCalledTimes(1);
    await inspector.analyze([{ ...photo, view: 'detail' }], signal);
    await inspector.analyze([{ ...photo, sha256: 'b'.repeat(64) }], signal);
    expect(generate).toHaveBeenCalledTimes(3);
    inspector.clear();
  });
  it('honors cancellation even on native AbortSignals without throwIfAborted', async () => {
    const controller = new AbortController();
    Object.defineProperty(controller.signal, 'throwIfAborted', { value: undefined });
    controller.abort();
    const generate = vi.fn(),
      inspector = new DeviceInspector({ model: 'phone-test', generate });
    await expect(inspector.analyze([photo], controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(generate).not.toHaveBeenCalled();
  });
  it('does not cache a result cancelled during verification', async () => {
    const controller = new AbortController();
    let count = 0;
    const generate = vi.fn(async () => {
      if (++count === 1) return reply(damaged);
      controller.abort();
      return reply({ verdicts: { candidate_0: 'supported' } });
    });
    const inspector = new DeviceInspector({ model: 'phone-test', generate });
    await expect(inspector.analyze([photo], controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    generate.mockImplementation(async () => reply({ ...damaged, findings: [] }));
    await inspector.analyze([photo], new AbortController().signal);
    expect(generate).toHaveBeenCalledTimes(3);
    inspector.clear();
  });
  it('rejects model-authored safety claims instead of turning them into findings', async () => {
    const invalid = {
      ...damaged,
      findings: [{ ...damaged.findings[0], evidence: 'Certified safe to ride' }],
    };
    const generate = vi
      .fn()
      .mockResolvedValueOnce(reply(invalid))
      .mockResolvedValueOnce(reply({ verdicts: { candidate_0: 'supported' } }));
    const inspector = new DeviceInspector({ model: 'phone-test', generate });
    await expect(inspector.analyze([photo], new AbortController().signal)).rejects.toThrow(
      'provider_invalid_evidence',
    );
    inspector.clear();
  });
});
