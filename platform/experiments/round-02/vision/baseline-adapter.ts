import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import {
  AutoModel,
  AutoProcessor,
  AutoTokenizer,
  RawImage,
  ZeroShotImageClassificationPipeline,
} from '@huggingface/transformers';
import {
  ObservationSchema,
  SCHEMA_VERSION,
  type Category,
  type Observation,
  type VisionAdapter,
  type VisionImage,
} from './baseline-schema.js';

export type LocalKind = 'local_clip' | 'local_siglip';
const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const MODEL_SPECS = {
  local_clip: {
    model: 'Xenova/clip-vit-base-patch32',
    revision: 'd15189d7028b43f1d3e65039190477f6af591c2a',
    tokenizer: 'Xenova/clip-vit-base-patch32',
    tokenizerRevision: 'd15189d7028b43f1d3e65039190477f6af591c2a',
    scoreSemantics: 'candidate-relative softmax; uncalibrated',
  },
  local_siglip: {
    model: 'onnx-community/siglip-base-patch16-224-ONNX',
    revision: '9f0328bdd0eb4f62d0f6c10625f43d882b32102b',
    tokenizer: 'google/siglip-base-patch16-224',
    tokenizerRevision: '7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed',
    scoreSemantics: 'independent sigmoid; uncalibrated',
  },
} as const;

export const LABELS: ReadonlyArray<{ label: string; category: Category }> = [
  { label: 'a motorcycle riding jacket', category: 'motorcycle_jacket' },
  { label: 'motorcycle riding trousers', category: 'trousers' },
  { label: 'motorcycle riding gloves', category: 'gloves' },
  { label: 'motorcycle riding boots', category: 'boots' },
  { label: 'a motorcycle helmet', category: 'helmet' },
  { label: 'ordinary clothing not designed for motorcycle riding', category: 'other' },
  { label: 'multiple different pieces of motorcycle gear', category: 'multiple' },
  { label: 'an unrelated object or an empty scene', category: 'other' },
];
export const PROMPT_TEMPLATES = ['A photo of {}.', 'This image shows {}.'] as const;
export interface RawPrediction {
  label: string;
  category: Category;
  score: number;
}
export interface PromptEvidence {
  template: string;
  durationMs: number;
  ranking: RawPrediction[];
}
export interface ViewEvidence {
  imageId: string;
  view: VisionImage['view'];
  category: Category;
  durationMs: number;
  rejectedAsUniform: boolean;
  prompts: PromptEvidence[];
}
export interface LocalEvaluation {
  observation: Observation;
  views: ViewEvidence[];
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Analysis cancelled', 'AbortError');
}
function agreedCategory(categories: Category[]): Category {
  if (categories.length === 0 || categories.some((c) => c === 'unknown')) return 'unknown';
  return categories.every((c) => c === categories[0]) ? categories[0]! : 'unknown';
}

/** Local COMPUTER inference. Never claim on-phone processing or protective condition assessment. */
export class LocalVisionAdapter implements VisionAdapter {
  readonly id: LocalKind;
  readonly model: string;
  private loading?: Promise<ZeroShotImageClassificationPipeline>;
  private queue: Promise<void> = Promise.resolve();
  constructor(kind: LocalKind) {
    this.id = kind;
    const spec = MODEL_SPECS[kind];
    this.model = spec.model + '@' + spec.revision.slice(0, 12) + ':q8';
  }
  async warmup(): Promise<void> {
    await this.getPipeline();
  }
  private getPipeline(): Promise<ZeroShotImageClassificationPipeline> {
    if (!this.loading) {
      const spec = MODEL_SPECS[this.id];
      const cache_dir = path.join(PROJECT_ROOT, '.cache', 'models');
      // SigLIP conversion does not contain tokenizer files. Load its original tokenizer explicitly.
      this.loading = (async () => {
        const [model, tokenizer, processor] = await Promise.all([
          AutoModel.from_pretrained(spec.model, {
            revision: spec.revision,
            cache_dir,
            dtype: 'q8',
            device: 'cpu',
            session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
          }),
          AutoTokenizer.from_pretrained(spec.tokenizer, {
            revision: spec.tokenizerRevision,
            cache_dir,
          }),
          AutoProcessor.from_pretrained(spec.model, { revision: spec.revision, cache_dir }),
        ]);
        return new ZeroShotImageClassificationPipeline({
          task: 'zero-shot-image-classification',
          model,
          tokenizer,
          processor,
        });
      })().catch((error) => {
        this.loading = undefined;
        throw error;
      });
    }
    return this.loading;
  }
  async analyze(images: VisionImage[], signal?: AbortSignal): Promise<Observation> {
    return (await this.evaluateForBenchmark(images, signal)).observation;
  }
  /** Raw scores remain in research artifacts; this method is never part of the mobile response. */
  evaluateForBenchmark(images: VisionImage[], signal?: AbortSignal): Promise<LocalEvaluation> {
    const run = this.queue.then(() => this.evaluate(images, signal));
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  private async evaluate(images: VisionImage[], signal?: AbortSignal): Promise<LocalEvaluation> {
    assertNotAborted(signal);
    const started = performance.now();
    if (images.length > 6) throw new Error('At most six photos may be analyzed');
    const views: ViewEvidence[] = [];
    const usable = images.filter((image) => image.view !== 'label');
    if (usable.length > 0) {
      const classifier = await this.getPipeline();
      assertNotAborted(signal);
      for (const image of usable) {
        assertNotAborted(signal);
        const viewStart = performance.now();
        const input = sharp(image.jpeg, { limitInputPixels: 16_000_000 })
          .rotate()
          .toColourspace('srgb')
          .removeAlpha();
        const stats = await input.clone().stats();
        // Reject information-free solid frames. This is a narrow input heuristic, not a calibrated quality model.
        const uniform = stats.channels.every((channel) => channel.stdev < 1);
        const prompts: PromptEvidence[] = [];
        if (!uniform) {
          const { data, info } = await input.raw().toBuffer({ resolveWithObject: true });
          if (info.channels !== 3) throw new Error('Expected decoded RGB pixels');
          const raw = new RawImage(new Uint8Array(data), info.width, info.height, 3);
          for (const template of PROMPT_TEMPLATES) {
            assertNotAborted(signal);
            const promptStart = performance.now();
            const result = await classifier(
              raw,
              LABELS.map((row) => row.label),
              { hypothesis_template: template },
            );
            assertNotAborted(signal);
            const ranking: RawPrediction[] = result.map((row) => {
              const definition = LABELS.find((candidate) => candidate.label === row.label);
              if (!definition || !Number.isFinite(row.score) || row.score < 0 || row.score > 1) {
                throw new Error('Invalid category model output');
              }
              return { label: row.label, category: definition.category, score: row.score };
            });
            if (ranking.length !== LABELS.length) throw new Error('Incomplete category ranking');
            prompts.push({ template, durationMs: performance.now() - promptStart, ranking });
          }
        }
        const category = agreedCategory(
          prompts.map((prompt) => prompt.ranking[0]?.category ?? 'unknown'),
        );
        views.push({
          imageId: image.id,
          view: image.view,
          category,
          rejectedAsUniform: uniform,
          prompts,
          durationMs: performance.now() - viewStart,
        });
      }
    }
    assertNotAborted(signal);
    const hasOverview = usable.some((image) => image.view === 'front' || image.view === 'back');
    const category = hasOverview ? agreedCategory(views.map((view) => view.category)) : 'unknown';
    const presentViews = new Set(images.map((image) => image.view));
    const observation = ObservationSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      category,
      attributes: [],
      concerns: [],
      missingViews: (['front', 'back', 'label'] as const).filter((view) => !presentViews.has(view)),
      multipleItems: views.some((view) => view.category === 'multiple'),
      provider: this.id,
      model: this.model,
      coverage: 'category_only',
      durationMs: performance.now() - started,
      usage: null,
    });
    return { observation, views };
  }
  async dispose(): Promise<void> {
    await this.queue;
    const pending = this.loading;
    this.loading = undefined;
    if (pending) await (await pending).dispose();
  }
}
const adapters = new Map<LocalKind, LocalVisionAdapter>();
export function createLocalAdapter(kind: LocalKind): LocalVisionAdapter {
  const existing = adapters.get(kind);
  if (existing) return existing;
  const adapter = new LocalVisionAdapter(kind);
  adapters.set(kind, adapter);
  return adapter;
}
