import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const mocks = vi.hoisted(() => ({ info: vi.fn(), analyze: vi.fn(), status: vi.fn() }));
vi.mock('../app/src/device-engine.android', () => ({
  DEVICE_MODEL: 'offline-test',
  devicePhotoInfo: mocks.info,
  deviceInspector: { analyze: mocks.analyze },
  offlineStatus: mocks.status,
  releaseDeviceEngine: vi.fn(async () => undefined),
  prepareDeviceEngine: vi.fn(async () => undefined),
}));
import { analyzeDraft, serviceHealth, isOnDevice } from '../app/src/api.android';
import type { Draft } from '../app/src/session';
const draft: Draft = {
  version: 1,
  id: 'offline-case',
  updatedAt: '2026-10-26T00:00:00.000Z',
  disclosures: [],
  corrections: [],
  result: null,
  photos: [
    {
      id: 'photo',
      view: 'front',
      uri: 'file:///owned/photo.jpg',
      width: 800,
      height: 1000,
      quality: { width: 800, height: 1000, brightness: 100, sharpness: 100, warnings: [] },
    },
  ],
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.status.mockResolvedValue({ profile: 'offline-test' });
  mocks.info.mockResolvedValue({ sha256: 'a'.repeat(64), byteLength: 400 });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw Error('Network forbidden in native test');
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
describe('standalone native analysis route', () => {
  it('gets health locally and ignores a saved computer service address', async () => {
    expect(isOnDevice).toBe(true);
    expect(
      await serviceHealth({ url: 'http://old-computer.invalid', token: 'old-token' }, signal()),
    ).toMatchObject({ provider: 'local_vlm', model: 'offline-test', externalProvider: false });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('known crash history excludes before file access or inference', async () => {
    const d = {
      ...draft,
      disclosures: [
        {
          id: 'crash',
          question: 'crash' as const,
          answer: 'yes' as const,
          recordedAt: '2026-10-26T00:00:00.000Z',
        },
      ],
    };
    const r = await analyzeDraft(d, { url: 'ignored', token: '' }, false, signal(), {
      provider: 'local_vlm',
      model: 'offline-test',
    });
    expect(r.status).toBe('excluded');
    expect(r.decision.offerRecommended).toBe(false);
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.analyze).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('unusable photos keep their quality evidence without running the model', async () => {
    const d = {
      ...draft,
      photos: [
        {
          ...draft.photos[0]!,
          quality: { ...draft.photos[0]!.quality, warnings: ['dark' as const] },
        },
      ],
    };
    const r = await analyzeDraft(d, { url: 'ignored', token: '' }, false, signal(), {
      provider: 'local_vlm',
      model: 'offline-test',
    });
    expect(r.observation).toBeNull();
    expect(r.photos[0]!.sha256).toBe('a'.repeat(64));
    expect(r.decision.offerRecommended).toBe(false);
    expect(mocks.analyze).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('cannot silently switch the expected model', async () => {
    await expect(
      analyzeDraft(draft, { url: 'ignored', token: '' }, false, signal(), {
        provider: 'local_vlm',
        model: 'different',
      }),
    ).rejects.toThrow('changed');
    expect(mocks.info).not.toHaveBeenCalled();
  });
});
