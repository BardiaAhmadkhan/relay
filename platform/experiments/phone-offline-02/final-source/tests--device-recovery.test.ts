import { describe, it, expect, vi, afterEach } from 'vitest';
import { DeviceInspector, type DevicePhoto, type DeviceReply } from '../packages/mobile/inspection';
import { focusDeviceTear } from '../packages/mobile/focused-tear';
const image: DevicePhoto = {
  id: 'photo',
  view: 'front',
  uri: 'file:///private/original.jpg',
  sha256: 'a'.repeat(64),
  byteLength: 500,
  quality: { width: 800, height: 1000, brightness: 120, sharpness: 100, warnings: [] },
};
const clean = {
  category: 'motorcycle_jacket' as const,
  material: 'textile' as const,
  findings: [],
  crashPattern: 'not_observed' as const,
};
const tear = {
  evidence: 'Ragged torn hole with frayed threads',
  kind: 'tear' as const,
  zone: 'elbow' as const,
  clarity: 'clear' as const,
};
const reply = (data: unknown): DeviceReply => ({
  text: JSON.stringify(data),
  complete: true,
  inputTokens: 20,
  outputTokens: 10,
});
const signal = () => new AbortController().signal;
afterEach(() => vi.useRealTimers());
describe('phone focused evidence and cache lifetime', () => {
  it('verifies a crop against its full image and keeps the original category', async () => {
    const cropped = {
      ...image,
      id: 'crop',
      uri: 'file:///private/crop.png',
      sha256: 'b'.repeat(64),
    };
    const release = vi.fn(async () => {}),
      cropImage = vi.fn(
        async (
          _photo: DevicePhoto,
          _crop: { left: number; top: number; width: number; height: number },
        ) => ({ photo: cropped, release }),
      );
    const generate = vi
      .fn()
      .mockResolvedValueOnce(reply({ ...clean, category: 'trousers' }))
      .mockResolvedValueOnce(reply({ target: 'wearable_item', box: [100, 200, 500, 700] }))
      .mockResolvedValueOnce(reply({ ...clean, findings: [tear] }))
      .mockResolvedValueOnce(reply({ verdicts: { candidate_0: 'supported' } }));
    const inspector = new DeviceInspector({ model: 'test', generate, cropImage });
    const result = await inspector.analyze([image], signal());
    expect(generate.mock.calls[3]![0]).toEqual([image.uri, cropped.uri]);
    expect(generate.mock.calls[3]![5]).toContain('full photograph');
    expect(generate.mock.calls[3]![1]).not.toContain('full photograph');
    expect(result.inspection!.photos[0]).toMatchObject({
      imageId: image.id,
      category: 'trousers',
      findings: [{ ...tear, clarity: 'possible', zone: 'unknown' }],
      crashPattern: 'unclear',
    });
    expect(cropImage.mock.calls[0]![1]).toMatchObject({
      left: 51,
      top: 155,
      width: 378,
      height: 590,
    });
    expect(release).toHaveBeenCalledOnce();
    inspector.clear();
  });
  it('does not spend a crop on a label or a whole-image box', async () => {
    const generate = vi.fn(async () => reply({ target: 'wearable_item', box: [0, 0, 1000, 1000] }));
    const cropImage = vi.fn(),
      inspect = vi.fn();
    const common = {
      photo: { ...clean, category: 'trousers' as const },
      engine: { model: 'test', generate, cropImage },
      signal: signal(),
      inspect,
    };
    expect(
      (await focusDeviceTear({ ...common, image: { ...image, view: 'label' } })).attempted,
    ).toBe(false);
    expect((await focusDeviceTear({ ...common, image })).complete).toBe(true);
    expect(cropImage).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
  });
  it('releases a crop when its optional deadline expires and rejects its late finding', async () => {
    vi.useFakeTimers();
    const release = vi.fn(async () => {});
    const result = focusDeviceTear({
      photo: { ...clean, category: 'trousers' },
      image,
      engine: {
        model: 'test',
        generate: async () => reply({ target: 'wearable_item', box: [100, 100, 400, 500] }),
        cropImage: async () => ({ photo: image, release }),
      },
      signal: signal(),
      budgetMs: 20,
      inspect: async () => {
        await new Promise((r) => setTimeout(r, 30));
        return { photo: { ...clean, findings: [tear] }, inputTokens: 1, outputTokens: 1 };
      },
    });
    await vi.advanceTimersByTimeAsync(40);
    expect(await result).toMatchObject({
      photo: { findings: [] },
      attempted: true,
      complete: false,
    });
    expect(release).toHaveBeenCalledOnce();
  });
  it('limits the low-detail recovery to one photo, and retries the deferred second photo', async () => {
    const small = { ...image, quality: { ...image.quality, width: 240, height: 320 } };
    const release = vi.fn(async () => {}),
      detailImage = vi.fn(async () => ({ uri: 'file:///private/detail.png', release }));
    const generate = vi.fn(async (_images, _prompt, schema) =>
      reply(schema.properties?.abrasion ? { abrasion: null } : clean),
    );
    const inspector = new DeviceInspector({ model: 'test', generate, detailImage });
    const second = { ...small, id: 'second', sha256: 'c'.repeat(64) };
    await inspector.analyze([small, second], signal());
    expect(detailImage).toHaveBeenCalledTimes(1);
    await inspector.analyze([second], signal());
    expect(detailImage).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
    inspector.clear();
  });
  it('does not accept or cache a cue returned after its deadline', async () => {
    vi.useFakeTimers();
    const small = { ...image, quality: { ...image.quality, width: 240, height: 320 } };
    const release = vi.fn(async () => {}),
      detailImage = vi.fn(async () => ({ uri: 'file:///private/detail.png', release }));
    const generate = vi.fn(async (_images, _prompt, schema) => {
      if (!schema.properties?.abrasion) return reply(clean);
      await new Promise((r) => setTimeout(r, 46000));
      return reply({
        abrasion: {
          evidence: 'Rough scraped patch on upper arm',
          zone: 'upper_arm',
          cue: 'rough_scrape',
        },
      });
    });
    const inspector = new DeviceInspector({ model: 'test', generate, detailImage });
    const pending = inspector.analyze([small], signal());
    await vi.advanceTimersByTimeAsync(47000);
    expect((await pending).inspection!.photos[0]!.findings).toEqual([]);
    expect(release).toHaveBeenCalledOnce();
    generate.mockImplementation(async () => reply(clean));
    const again = inspector.analyze([small], signal());
    await vi.advanceTimersByTimeAsync(1);
    await again;
    expect(detailImage).toHaveBeenCalledTimes(2);
    inspector.clear();
  });
  it('expires cached photos and prevents a forgotten in-flight photo from repopulating memory', async () => {
    vi.useFakeTimers();
    const generate = vi.fn(async () => reply(clean));
    const inspector = new DeviceInspector({ model: 'test', generate });
    await inspector.analyze([image], signal());
    await inspector.analyze([image], signal());
    expect(generate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600001);
    await inspector.analyze([image], signal());
    expect(generate).toHaveBeenCalledTimes(2);
    inspector.clear();
    let finish!: (r: DeviceReply) => void;
    generate.mockImplementationOnce(
      () =>
        new Promise<DeviceReply>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = inspector.analyze([image], signal());
    inspector.clear();
    finish(reply(clean));
    await pending;
    await inspector.analyze([image], signal());
    expect(generate).toHaveBeenCalledTimes(4);
    inspector.clear();
  });
});
