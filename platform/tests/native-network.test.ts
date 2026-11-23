import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('../app/src/session', () => ({ photoBase64: vi.fn(async () => 'AQID') }));
import { analyzeDraft } from '../app/src/api';
import type { Draft } from '../app/src/session';
const draft: Draft = {
  version: 1,
  id: 'native-transport',
  updatedAt: new Date().toISOString(),
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
afterEach(() => vi.unstubAllGlobals());
describe('native AbortSignal compatibility', () => {
  it('reaches transport without relying on optional AbortSignal methods', async () => {
    const controller = new AbortController();
    Object.defineProperty(controller.signal, 'throwIfAborted', { value: undefined });
    const fetcher = vi.fn(async () => {
      throw new Error('test transport reached');
    });
    vi.stubGlobal('fetch', fetcher);
    await expect(
      analyzeDraft(draft, { url: 'http://127.0.0.1:8787', token: '' }, false, controller.signal, {
        provider: 'local_vlm',
        model: 'test',
      }),
    ).rejects.toThrow('test transport reached');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('blocks upload after native-compatible cancellation', async () => {
    const controller = new AbortController();
    Object.defineProperty(controller.signal, 'throwIfAborted', { value: undefined });
    controller.abort();
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(
      analyzeDraft(draft, { url: 'http://127.0.0.1:8787', token: '' }, false, controller.signal, {
        provider: 'local_vlm',
        model: 'test',
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
