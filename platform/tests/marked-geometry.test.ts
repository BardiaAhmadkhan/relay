import { describe, expect, it } from 'vitest';
import {
  containFrame,
  cropPixels,
  MarkedRegionSchema,
  photoPoint,
} from '../packages/core/marked-region';
import { inspectionModel, inspectionScorer } from '../packages/vision/v2/inspection-model';
describe('original-pixel geometry', () => {
  it.each([
    [4000, 3000],
    [3000, 4000],
    [1000, 100],
    [64, 64],
  ])('keeps every square inside an oriented %s by %s source', (w, h) => {
    for (const x of [0, 0.5, 1])
      for (const y of [0, 0.5, 1])
        for (const extent of [0.001, 0.025, 0.5]) {
          const c = cropPixels(w, h, { x, y, extent });
          expect(c.side).toBe(Math.min(w, h, Math.max(64, Math.ceil(3 * extent * Math.min(w, h)))));
          expect(
            MarkedRegionSchema.safeParse({
              parentId: 'p',
              parentView: 'back',
              source: 'capture',
              sourceWidth: w,
              sourceHeight: h,
              ...c,
            }).success,
          ).toBe(true);
        }
  });
  it('rejects letterbox taps and invalid or oversized original inputs', () => {
    const frame = containFrame(4000, 2000, 300, 300);
    expect(photoPoint(frame, 150, 40)).toBe(null);
    expect(photoPoint(frame, NaN, 40)).toBe(null);
    expect(photoPoint(frame, 150, 150)).toEqual({ x: 0.5, y: 0.5 });
    expect(photoPoint(containFrame(0, 20, 300, 300), 0, 0)).toBe(null);
    for (const [w, h] of [
      [63, 100],
      [10000, 10000],
      [NaN, 800],
    ])
      expect(() => cropPixels(w!, h!, { x: 0.5, y: 0.5, extent: 0.025 })).toThrow();
  });
  it('verifies both the exact digest and the multimodal parameter cap', async () => {
    const fake = (d: string, v: number) =>
      (async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith('/api/tags')
              ? { models: [{ name: inspectionModel.name, digest: d }] }
              : {
                  model_info: { 'general.parameter_count': inspectionModel.text },
                  projector_info: { 'general.parameter_count': v },
                },
          ),
        )) as typeof fetch;
    await expect(
      inspectionScorer('http://localhost', fake(inspectionModel.digest, inspectionModel.vision)),
    ).resolves.toHaveProperty('id', 'local_logprob');
    await expect(
      inspectionScorer('http://localhost', fake('0'.repeat(64), inspectionModel.vision)),
    ).rejects.toThrow();
    await expect(
      inspectionScorer('http://localhost', fake(inspectionModel.digest, 3_000_000_000)),
    ).rejects.toThrow();
  });
});

it('serializes original and marked checks across a recycle and recovers from an aborted queue entry', async () => {
  const { InspectionLane } = await import('../packages/vision/v2/inspection-lane');
  const events: string[] = [];
  let finish!: () => void;
  const hold = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const lane = new InspectionLane(2, async () => {
    events.push('unload');
  });
  const worker = (name: string) =>
    lane.wrap({
      id: 'local_logprob',
      model: 'pinned',
      score: async () => {
        events.push('start ' + name);
        if (name === 'whole') await hold;
        events.push('finish ' + name);
        return { answers: {}, ms: 1, inputTokens: 1 };
      },
    });
  const img = { jpeg: new Uint8Array([1]), view: 'detail' as const };
  const signal = new AbortController().signal,
    cancel = new AbortController();
  const a = worker('whole').score(img, [], signal);
  const b = worker('cancelled')
    .score(img, [], cancel.signal)
    .catch(() => null);
  cancel.abort();
  const c = worker('mark').score(img, [], signal);
  await Promise.resolve();
  expect(events).toEqual(['start whole']);
  finish();
  await Promise.all([a, b, c]);
  expect(events).toEqual(['start whole', 'finish whole', 'start mark', 'finish mark', 'unload']);
});
