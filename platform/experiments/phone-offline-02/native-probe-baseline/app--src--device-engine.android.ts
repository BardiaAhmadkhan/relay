import { abortableResult } from '../../packages/mobile/abortable-result';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { NativeModules, DeviceEventEmitter } from 'react-native';
import { initLlama, type LlamaContext } from 'llama.rn';
import {
  DeviceInspector,
  checkCancelled,
  type DeviceReply,
} from '../../packages/mobile/inspection';
import manifest from '../assets/offline/manifest.json';
export const DEVICE_MODEL = manifest.profile;
type Bridge = {
  status(): Promise<{
    profile: string;
    arm64: boolean;
    totalMemoryBytes: number;
    availableMemoryBytes: number;
  }>;
  prepare(): Promise<{ model: string; projector: string; profile: string }>;
  photoInfo(uri: string): Promise<{ sha256: string; byteLength: number }>;
};
function bridge(): Bridge {
  const b = NativeModules.RelayOfflineAssets as Bridge | undefined;
  if (!b)
    throw Error(
      'This build does not include the offline engine. Install the standalone Android APK.',
    );
  return b;
}
let preparedFiles: Awaited<ReturnType<Bridge['prepare']>> | null = null;
let visionBudget = 0;
let forceCpu = false;
let context: LlamaContext | null = null,
  initializing: Promise<LlamaContext> | null = null,
  tail: Promise<unknown> = Promise.resolve();
export async function offlineStatus() {
  const status = await bridge().status();
  if (status.profile !== DEVICE_MODEL)
    throw Error('Offline model files do not match this app version.');
  return status;
}
async function loadContext(): Promise<LlamaContext> {
  if (context) return context;
  if (initializing) return initializing;
  initializing = (async () => {
    const status = await offlineStatus();
    if (status.totalMemoryBytes < 7_000_000_000)
      throw Error('This offline build needs at least 8 GB of device memory.');
    if (status.availableMemoryBytes < 4_000_000_000)
      throw Error('Close other apps to free memory for offline analysis.');
    const files = preparedFiles ?? (await bridge().prepare());
    preparedFiles = files;
    if (files.profile !== DEVICE_MODEL) throw Error('Offline model integrity check failed.');
    const create = async (gpu: boolean) => {
      const ctx = await initLlama({
        model: files.model,
        n_ctx: 4096,
        n_parallel: 1,
        n_batch: 512,
        n_ubatch: 128,
        n_threads: 4,
        n_gpu_layers: gpu ? 99 : 0,
        ctx_shift: false,
        use_mmap: true,
        flash_attn_type: 'off',
      });
      try {
        const ok = await ctx.initMultimodal({
          path: files.projector,
          use_gpu: gpu && ctx.gpu,
          image_min_tokens: 64,
          image_max_tokens: 768,
        });
        if (!ok) throw Error('Vision module unavailable');
        visionBudget = 768;
        return ctx;
      } catch (e) {
        await ctx.release();
        throw e;
      }
    };
    try {
      context = await create(status.arm64 && !forceCpu);
    } catch (error) {
      if (!status.arm64) throw error;
      forceCpu = true;
      context = await create(false);
    }
    return context;
  })().finally(() => {
    initializing = null;
  });
  return initializing;
}
export async function prepareDeviceEngine(
  signal: AbortSignal,
  onProgress?: (phase: string) => void,
) {
  checkCancelled(signal);
  const subscription = DeviceEventEmitter.addListener(
    'RelayOfflinePreparation',
    (event: { phase: string; percent: number }) => {
      if (signal.aborted || !Number.isFinite(event.percent)) return;
      const percent = Math.max(0, Math.min(100, Math.round(event.percent)));
      if (event.phase === 'copy') onProgress?.('Setting up the offline engine: ' + percent + '%');
      else if (event.phase === 'verify') onProgress?.('Checking engine files: ' + percent + '%');
      else if (event.phase === 'load') onProgress?.('Loading the offline engine');
    },
  );
  const pending = loadContext();
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      subscription.remove();
      signal.removeEventListener('abort', cancel);
    };
    const cancel = () => {
      cleanup();
      reject(Object.assign(new Error('Analysis cancelled.'), { name: 'AbortError' }));
    };
    signal.addEventListener('abort', cancel, { once: true });
    pending.then(
      () => {
        cleanup();
        if (signal.aborted) cancel();
        else resolve();
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}
export async function devicePhotoInfo(uri: string) {
  return bridge().photoInfo(uri);
}
async function generate(
  images: string[],
  prompt: string,
  schema: object,
  maxTokens: number,
  signal: AbortSignal,
): Promise<DeviceReply> {
  const run = async () => {
    checkCancelled(signal);
    const ctx = await loadContext();
    checkCancelled(signal);
    const abort = () => {
      // This runtime's JSI stop call can return void despite its Promise type.
      try {
        void Promise.resolve(ctx.stopCompletion()).catch(() => undefined);
      } catch {
        /* cancellation still owns the result */
      }
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      const budget = (schema as { properties?: { abrasion?: unknown } }).properties?.abrasion
        ? 1024
        : 768;
      if (visionBudget !== budget) {
        visionBudget = 0;
        await ctx.releaseMultimodal();
        const ready = await ctx.initMultimodal({
          path: preparedFiles!.projector,
          use_gpu: ctx.gpu,
          image_min_tokens: budget === 1024 ? 1024 : 64,
          image_max_tokens: budget,
        });
        if (!ready) throw Error('Offline vision could not be reconfigured.');
        visionBudget = budget;
      }
      checkCancelled(signal);
      // Every inspection and verifier is an independent request. This hybrid model
      // must not inherit recurrent/KV state or image checkpoints from an earlier task.
      // Keep the loaded weights and the separate byte-keyed observation cache.
      await ctx.clearCache(true);
      checkCancelled(signal);
      // Format the image/chat prompt first. The chat-template grammar includes role
      // markers, so it must not replace the task's strict JSON output grammar.
      const formatted = await ctx.getFormattedChat(
        [
          {
            role: 'user',
            content: [
              ...images.map((uri) => ({ type: 'image_url' as const, image_url: { url: uri } })),
              { type: 'text' as const, text: prompt },
            ],
          },
        ],
        undefined,
        { jinja: true, enable_thinking: false, chat_template_kwargs: { enable_thinking: false } },
      );
      if (
        !formatted.prompt ||
        !formatted.has_media ||
        formatted.media_paths?.length !== images.length
      )
        throw Error('The offline prompt did not contain every selected photograph.');
      checkCancelled(signal);
      const result = await ctx.completion({
        prompt: formatted.prompt,
        media_paths: formatted.media_paths,
        grammar_lazy: false,
        stop: 'additional_stops' in formatted ? formatted.additional_stops : [],
        response_format: { type: 'json_schema', json_schema: { strict: true, schema } },
        temperature: 0,
        seed: 42,
        n_predict: maxTokens,
        penalty_repeat: 1,
        penalty_present: 0,
      });
      checkCancelled(signal);
      // Operational counters contain no photographs, prompts or generated descriptions.
      console.info(
        'Relay offline completion',
        JSON.stringify({
          imageBudget: budget,
          maxTokens,
          inputTokens: result.tokens_evaluated,
          outputTokens: result.tokens_predicted,
          stoppedLimit: result.stopped_limit,
          truncated: result.truncated,
          interrupted: result.interrupted,
          contextFull: result.context_full,
          rawCharacters: result.text?.length ?? 0,
          contentCharacters: result.content?.length ?? 0,
          reasoningCharacters: result.reasoning_content?.length ?? 0,
          timings: result.timings,
        }),
      );
      return {
        text: result.content?.trim() ? result.content : result.text,
        complete:
          !result.stopped_limit && !result.truncated && !result.interrupted && !result.context_full,
        inputTokens: result.tokens_evaluated ?? 0,
        outputTokens: result.tokens_predicted ?? 0,
      };
    } finally {
      signal.removeEventListener('abort', abort);
    }
  };
  const job = tail.then(run, run);
  tail = job.catch(() => undefined);
  return abortableResult(job, signal);
}
export const deviceInspector = new DeviceInspector({
  model: DEVICE_MODEL,
  generate,
  cropImage: async (photo, crop) => {
    const source = ImageManipulator.manipulate(photo.uri);
    source.crop({ originX: crop.left, originY: crop.top, width: crop.width, height: crop.height });
    source.resize(crop.width >= crop.height ? { width: 768 } : { height: 768 });
    const rendered = await source.renderAsync(),
      saved = await rendered.saveAsync({ format: SaveFormat.PNG });
    try {
      const info = await devicePhotoInfo(saved.uri);
      return {
        photo: {
          id: 'focused-detail',
          view: 'detail',
          uri: saved.uri,
          ...info,
          quality: { ...photo.quality, width: saved.width, height: saved.height, warnings: [] },
        },
        release: async () => {
          await FileSystem.deleteAsync(saved.uri, { idempotent: true });
        },
      };
    } catch (error) {
      await FileSystem.deleteAsync(saved.uri, { idempotent: true }).catch(() => undefined);
      throw error;
    }
  },
  detailImage: async (photo) => {
    const w = photo.quality.width,
      h = photo.quality.height,
      scale = Math.sqrt((1024 * 32 * 32) / (w * h));
    const source = ImageManipulator.manipulate(photo.uri);
    source.resize({
      width: Math.ceil((w * scale) / 32) * 32,
      height: Math.ceil((h * scale) / 32) * 32,
    });
    const rendered = await source.renderAsync(),
      saved = await rendered.saveAsync({ format: SaveFormat.PNG });
    return {
      uri: saved.uri,
      release: async () => {
        await FileSystem.deleteAsync(saved.uri, { idempotent: true });
      },
    };
  },
});
export async function releaseDeviceEngine() {
  deviceInspector.clear();
  const job = tail.then(async () => {
    if (initializing) await initializing.catch(() => undefined);
    const old = context;
    context = null;
    if (old) await old.release();
  });
  tail = job.catch(() => undefined);
  return job;
}
