import { beforeAll, describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import { LocalInspectionAdapter } from '../packages/vision/inspection';
const model = 'qwen3.5:4b',
  digest = 'd8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04';
let jpeg: Buffer;
beforeAll(async () => {
  jpeg = await sharp({ create: { width: 240, height: 320, channels: 3, background: '#777' } })
    .jpeg()
    .toBuffer();
});
const empty = {
  findings: [],
  crashPattern: 'not_observed',
  category: 'motorcycle_jacket',
  material: 'leather',
};
function setup(positive = false) {
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const value = body.format.properties.abrasion
      ? {
          abrasion: {
            evidence: 'Pale irregular scraping interrupts the leather surface.',
            zone: 'upper_arm',
            cue: 'coating_loss',
          },
        }
      : body.format.properties.supported
        ? { supported: [0], uncertain: [], crashPattern: 'consistent_with_sliding' }
        : positive
          ? {
              ...empty,
              crashPattern: 'consistent_with_sliding',
              findings: [
                {
                  evidence: 'A scraped shoulder panel with rough exposed fibers.',
                  zone: 'shoulder',
                  kind: 'abrasion',
                  clarity: 'clear',
                },
              ],
            }
          : empty;
    return new Response(
      JSON.stringify({
        model: body.model,
        done: true,
        done_reason: 'stop',
        message: { content: JSON.stringify(value) },
        prompt_eval_count: 100,
        eval_count: 20,
      }),
    );
  });
  const engine = new LocalInspectionAdapter(model, digest, 'http://127.0.0.1:11435', fetcher);
  return { engine, fetcher };
}
describe('integrated optional abrasion recovery', () => {
  it('versions, caches and rebinds recovered evidence without repeating inference', async () => {
    const { engine, fetcher } = setup();
    expect(engine.model).toContain('+low-detail-cue-1');
    const a = await engine.analyze([{ id: 'a', view: 'front', jpeg }]);
    expect(a.inspection!.photos[0]!.findings).toMatchObject([
      { zone: 'unknown', kind: 'abrasion', clarity: 'possible' },
    ]);
    expect(a.inspection!.photos[0]!.crashPattern).toBe('unclear');
    expect(a.usage).toEqual({ inputTokens: 200, outputTokens: 40 });
    const b = await engine.analyze([{ id: 'b', view: 'front', jpeg }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(b.concerns[0]?.imageId).toBe('b');
    expect(b.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    engine.clearCache();
  });
  it('keeps primary supported damage and its exact clarity/mechanism with no extra call', async () => {
    const { engine, fetcher } = setup(true);
    const result = await engine.analyze([{ id: 'a', view: 'front', jpeg }]);
    expect(result.inspection!.photos[0]).toMatchObject({
      crashPattern: 'consistent_with_sliding',
      findings: [{ zone: 'shoulder', clarity: 'clear' }],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    engine.clearCache();
  });
  it('preserves explicit label and full-resolution empty results without extra inference', async () => {
    const { engine, fetcher } = setup();
    await engine.analyze([{ id: 'label', view: 'label', jpeg }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const large = await sharp({
      create: { width: 800, height: 1000, channels: 3, background: '#777' },
    })
      .jpeg()
      .toBuffer();
    await engine.analyze([{ id: 'front', view: 'front', jpeg: large }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    engine.clearCache();
  });
  it('does not enable this unvalidated path for a different model digest', async () => {
    const { fetcher } = setup();
    const engine = new LocalInspectionAdapter(
      model,
      'b'.repeat(64),
      'http://127.0.0.1:11435',
      fetcher,
    );
    expect(engine.model).not.toContain('cue');
    const result = await engine.analyze([{ id: 'a', view: 'front', jpeg }]);
    expect(result.inspection!.photos[0]!.findings).toEqual([]);
    expect(fetcher).toHaveBeenCalledOnce();
    engine.clearCache();
  });
  it('does not repopulate a cleared cache with late recovery work', async () => {
    const { engine, fetcher } = setup();
    const real = fetcher.getMockImplementation()!;
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>((r) => (entered = r)),
      resume = new Promise<void>((r) => (release = r));
    let pause = true;
    fetcher.mockImplementation(async (url, init) => {
      if (pause && JSON.parse(String(init?.body)).format.properties.abrasion) {
        pause = false;
        entered();
        await resume;
      }
      return real(url, init);
    });
    const pending = engine.analyze([{ id: 'a', view: 'front', jpeg }]);
    await ready;
    engine.clearCache();
    release();
    await pending;
    await engine.analyze([{ id: 'b', view: 'front', jpeg }]);
    expect(fetcher).toHaveBeenCalledTimes(4);
    engine.clearCache();
  });
});

it('separates label and garment cache scopes without losing reuse across garment views', async () => {
  const { engine, fetcher } = setup();
  await engine.analyze([{ id: 'label', view: 'label', jpeg }]);
  const front = await engine.analyze([{ id: 'front', view: 'front', jpeg }]);
  expect(front.inspection!.photos[0]!.findings).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(3);
  const back = await engine.analyze([{ id: 'back', view: 'back', jpeg }]);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(back.inspection!.photos[0]!.imageId).toBe('back');
  const label = await engine.analyze([{ id: 'label-again', view: 'label', jpeg }]);
  expect(label.inspection!.photos[0]!.findings).toEqual([]);
  expect(fetcher).toHaveBeenCalledTimes(3);
  engine.clearCache();
});
