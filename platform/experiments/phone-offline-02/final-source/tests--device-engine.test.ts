import { describe, it, expect, vi, beforeEach } from 'vitest';
const native = vi.hoisted(() => ({
  status: vi.fn(),
  prepare: vi.fn(),
  init: vi.fn(),
  complete: vi.fn(),
  format: vi.fn(),
  stop: vi.fn(),
  clearCache: vi.fn(),
  release: vi.fn(),
  multimodal: vi.fn(),
  removeListener: vi.fn(),
  releaseMultimodal: vi.fn(),
}));
vi.mock('react-native', () => ({
  NativeModules: { RelayOfflineAssets: { status: native.status, prepare: native.prepare } },
  DeviceEventEmitter: { addListener: () => ({ remove: native.removeListener }) },
}));
vi.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: { PNG: 'png' } }));
vi.mock('expo-file-system/legacy', () => ({ deleteAsync: vi.fn() }));
vi.mock('llama.rn', () => ({ initLlama: native.init }));
import type { DevicePhoto } from '../packages/mobile/inspection';
const image: DevicePhoto = {
  id: 'front',
  view: 'front',
  uri: 'file:///private/image.jpg',
  sha256: 'a'.repeat(64),
  byteLength: 500,
  quality: { width: 800, height: 1000, brightness: 120, sharpness: 100, warnings: [] },
};
const clean = {
  category: 'motorcycle_jacket',
  material: 'leather',
  findings: [],
  crashPattern: 'not_observed',
};
const result = {
  text: JSON.stringify(clean),
  stopped_limit: false,
  truncated: false,
  tokens_evaluated: 10,
  tokens_predicted: 20,
};
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  const manifest = await import('../app/assets/offline/manifest.json');
  native.status.mockResolvedValue({
    profile: manifest.default.profile,
    arm64: false,
    totalMemoryBytes: 8e9,
    availableMemoryBytes: 6e9,
  });
  native.prepare.mockResolvedValue({
    model: '/private/model',
    projector: '/private/projector',
    profile: manifest.default.profile,
  });
  native.init.mockResolvedValue({
    completion: native.complete,
    getFormattedChat: native.format,
    stopCompletion: native.stop,
    clearCache: native.clearCache,
    release: native.release,
    initMultimodal: native.multimodal,
    releaseMultimodal: native.releaseMultimodal,
    gpu: false,
  });
  native.multimodal.mockResolvedValue(true);
  native.release.mockResolvedValue(undefined);
  native.releaseMultimodal.mockResolvedValue(undefined);
  native.stop.mockReturnValue(undefined);
  native.clearCache.mockResolvedValue(undefined);
  native.complete.mockResolvedValue(result);
  native.format.mockResolvedValue({
    type: 'jinja',
    prompt: '<media>selected photo</media>assistant',
    has_media: true,
    media_paths: ['/private/image.jpg'],
    grammar: 'CHAT-WRAPPER-GRAMMAR',
    grammar_lazy: true,
    additional_stops: ['<eog>'],
  });
});
describe('native runtime boundary (runtime doubles)', () => {
  it('cancels immediately when JSI stop returns void, and waits for native work before retrying', async () => {
    let finish!: (value: typeof result) => void;
    native.complete.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const engine = await import('../app/src/device-engine.android');
    const controller = new AbortController();
    const pending = engine.deviceInspector.analyze([image], controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(native.complete).toHaveBeenCalledOnce());
    expect(() => controller.abort()).not.toThrow();
    await rejected;
    expect(native.stop).toHaveBeenCalledOnce();
    const retry = engine.deviceInspector.analyze([image], new AbortController().signal);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(native.complete).toHaveBeenCalledTimes(1);
    finish(result);
    expect((await retry).inspection!.photos[0]!.findings).toEqual([]);
    expect(native.complete).toHaveBeenCalledTimes(2);
    await engine.releaseDeviceEngine();
  });
  it('removes setup listeners on cancellation and never starts photo work for a cancelled setup', async () => {
    let finish!: (value: unknown) => void;
    native.prepare.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const engine = await import('../app/src/device-engine.android');
    const c = new AbortController();
    const pending = engine.prepareDeviceEngine(c.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(native.prepare).toHaveBeenCalledOnce());
    c.abort();
    await rejected;
    expect(native.removeListener).toHaveBeenCalled();
    expect(native.complete).not.toHaveBeenCalled();
    finish({
      model: '/private/model',
      projector: '/private/projector',
      profile: engine.DEVICE_MODEL,
    });
    await engine.releaseDeviceEngine();
  });
  it('uses parsed content rather than raw reasoning and explicitly disables thinking', async () => {
    native.complete.mockResolvedValueOnce({
      ...result,
      text: '<think>private reasoning</think>' + result.text,
      content: result.text,
      reasoning_content: 'private reasoning',
    });
    const engine = await import('../app/src/device-engine.android');
    expect(
      (await engine.deviceInspector.analyze([image], new AbortController().signal)).inspection!
        .photos[0]!.findings,
    ).toEqual([]);
    expect(native.format.mock.calls[0]![2]).toMatchObject({ enable_thinking: false });
    await engine.releaseDeviceEngine();
  });
  it('rejects a native interruption even when no JS abort was requested', async () => {
    native.complete.mockResolvedValueOnce({ ...result, interrupted: true });
    const engine = await import('../app/src/device-engine.android');
    await expect(
      engine.deviceInspector.analyze([image], new AbortController().signal),
    ).rejects.toThrow('did not finish');
    await engine.releaseDeviceEngine();
  });
  it('keeps the chat wrapper out of the strict JSON sampler while preserving image paths', async () => {
    const engine = await import('../app/src/device-engine.android');
    await engine.deviceInspector.analyze([image], new AbortController().signal);
    const request = native.complete.mock.calls[0]![0];
    expect(request).toMatchObject({
      prompt: '<media>selected photo</media>assistant',
      media_paths: ['/private/image.jpg'],
      grammar_lazy: false,
      stop: ['<eog>'],
      response_format: { type: 'json_schema' },
    });
    expect(request).not.toHaveProperty('grammar');
    expect(request).not.toHaveProperty('messages');
    expect(native.format.mock.calls[0]![2]).not.toHaveProperty('response_format');
    await engine.releaseDeviceEngine();
  });
  it('fails closed when the formatter drops an image', async () => {
    native.format.mockResolvedValueOnce({
      type: 'jinja',
      prompt: 'text only',
      has_media: false,
      media_paths: [],
    });
    const engine = await import('../app/src/device-engine.android');
    await expect(
      engine.deviceInspector.analyze([image], new AbortController().signal),
    ).rejects.toThrow('every selected photograph');
    expect(native.complete).not.toHaveBeenCalled();
    await engine.releaseDeviceEngine();
  });
  it('isolates each photo and verifier from prior native recurrent state while preserving result-cache hits', async () => {
    const trace: string[] = [];
    native.clearCache.mockImplementation(async () => {
      trace.push('clear');
    });
    native.complete.mockImplementation(async () => {
      trace.push('generate');
      return result;
    });
    native.complete
      .mockImplementationOnce(async () => {
        trace.push('generate');
        return {
          ...result,
          text: JSON.stringify({
            ...clean,
            findings: [
              {
                evidence: 'Ragged hole with severed fibers',
                zone: 'elbow',
                kind: 'tear',
                clarity: 'clear',
              },
            ],
          }),
        };
      })
      .mockImplementationOnce(async () => {
        trace.push('generate');
        return { ...result, text: JSON.stringify({ verdicts: { candidate_0: 'supported' } }) };
      });
    const engine = await import('../app/src/device-engine.android');
    const signal = new AbortController().signal;
    await engine.deviceInspector.analyze([image], signal);
    await engine.deviceInspector.analyze(
      [{ ...image, id: 'second', sha256: 'b'.repeat(64) }],
      signal,
    );
    await engine.deviceInspector.analyze([image], signal);
    expect(trace).toEqual(['clear', 'generate', 'clear', 'generate', 'clear', 'generate']);
    expect(native.clearCache.mock.calls).toEqual([[true], [true], [true]]);
    expect(native.init).toHaveBeenCalledOnce();
    const verificationMessages = native.format.mock.calls[1]![0];
    expect(verificationMessages[0]).toMatchObject({ role: 'system' });
    expect(verificationMessages[0].content).toContain('PHYSICAL DAMAGE');
    expect(verificationMessages[0].content).not.toContain('Ragged hole');
    expect(verificationMessages[1].role).toBe('user');
    expect(verificationMessages[1].content[0].text).toContain('Ragged hole');
    expect(verificationMessages[1].content[1].image_url.url).toBe(image.uri);
    await engine.releaseDeviceEngine();
  });
  it('does not infer when native state isolation fails', async () => {
    native.clearCache.mockRejectedValueOnce(new Error('state reset failed'));
    const engine = await import('../app/src/device-engine.android');
    await expect(
      engine.deviceInspector.analyze([image], new AbortController().signal),
    ).rejects.toThrow('state reset failed');
    expect(native.complete).not.toHaveBeenCalled();
    await engine.releaseDeviceEngine();
  });
});
