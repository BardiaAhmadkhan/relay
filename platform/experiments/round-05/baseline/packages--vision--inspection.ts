import { setTimeout as nodeSetTimeout } from 'node:timers';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  ObservationSchema,
  PhotoInspectionSchema,
  SCHEMA_VERSION,
  type Observation,
  type VisionAdapter,
  type VisionImage,
} from '../core/schema';
import { INSPECTION_PROMPT, INSPECTION_PROMPT_VERSION } from './inspection-prompt';
import { VERIFICATION_PROMPT } from './verification-prompt';
import { validateFindings } from './validation';

type PhotoInspection = z.infer<typeof PhotoInspectionSchema>;
const VerificationSchema = z.strictObject({
  supported: z.array(z.number().int().min(0).max(5)).max(6),
  uncertain: z.array(z.number().int().min(0).max(5)).max(6),
  crashPattern: z.enum(['consistent_with_sliding', 'not_observed', 'unclear']),
});
const protectiveZones = new Set(['shoulder', 'elbow', 'forearm', 'upper_arm', 'back', 'chest']);
export function localRuntimeUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error(
      'Local vision requires a loopback HTTP runtime URL without credentials or a path.',
    );
  return url.origin;
}
/** Real local image inference. No cloud fallback, filename heuristic or stored sample answer. */
export class LocalInspectionAdapter implements VisionAdapter {
  readonly id = 'local_vlm' as const;
  readonly coverage = 'visual_observations' as const;
  readonly model: string;
  private readonly url: string;
  private readonly cache = new Map<
    string,
    { value: PhotoInspection; expires: number; timer: ReturnType<typeof nodeSetTimeout> }
  >();
  private cacheEpoch = 0;
  constructor(
    private readonly modelName: string,
    digest: string,
    url = 'http://127.0.0.1:11435',
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.url = localRuntimeUrl(url);
    if (
      !/^[a-zA-Z0-9_.:/-]{1,90}$/.test(modelName) ||
      modelName.includes('cloud') ||
      !/^[a-f0-9]{64}$/.test(digest)
    )
      throw new Error('A pinned local vision model is required.');
    this.model = `${modelName}@${digest.slice(0, 12)}/${INSPECTION_PROMPT_VERSION}`;
  }
  clearCache() {
    this.cacheEpoch++;
    for (const entry of this.cache.values()) clearTimeout(entry.timer);
    this.cache.clear();
  }
  async analyze(images: VisionImage[], signal?: AbortSignal): Promise<Observation> {
    if (images.length < 1 || images.length > 6) throw new Error('invalid_image_count');
    const started = performance.now(),
      epoch = this.cacheEpoch;
    const photos: Array<PhotoInspection & { imageId: string }> = [];
    let inputTokens = 0,
      outputTokens = 0;
    for (const image of images) {
      signal?.throwIfAborted();
      const key = createHash('sha256').update(image.jpeg).update(this.model).digest('hex');
      const cached = this.cache.get(key);
      if (cached && cached.expires > Date.now()) {
        photos.push({ ...cached.value, imageId: image.id });
        continue;
      }
      const response = await this.fetcher(this.url + '/api/chat', {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          stream: false,
          think: false,
          format: z.toJSONSchema(PhotoInspectionSchema),
          messages: [
            { role: 'system', content: INSPECTION_PROMPT },
            {
              role: 'user',
              content: 'Inspect the visible material condition in this photograph.',
              images: [Buffer.from(image.jpeg).toString('base64')],
            },
          ],
          options: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: 700 },
          keep_alive: '30m',
        }),
      });
      if (!response.ok) throw new Error('local_vision_http_' + response.status);
      const raw = z
        .object({
          model: z.string(),
          done: z.literal(true),
          done_reason: z.literal('stop'),
          message: z.object({ content: z.string().min(2).max(12000) }),
          prompt_eval_count: z.number().int().nonnegative().optional(),
          eval_count: z.number().int().nonnegative().optional(),
        })
        .parse(await response.json());
      if (raw.model !== this.modelName) throw new Error('local_vision_wrong_model');
      const value = PhotoInspectionSchema.parse(JSON.parse(raw.message.content));
      if (value.findings.length) {
        const verificationResponse = await this.fetcher(this.url + '/api/chat', {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.modelName,
            stream: false,
            think: false,
            format: z.toJSONSchema(VerificationSchema),
            messages: [
              { role: 'system', content: VERIFICATION_PROMPT },
              {
                role: 'user',
                content:
                  'Check these candidates (zero-based indices): ' +
                  JSON.stringify(value.findings.map((f, i) => ({ index: i, ...f }))),
                images: [Buffer.from(image.jpeg).toString('base64')],
              },
            ],
            options: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: 180 },
            keep_alive: '30m',
          }),
        });
        if (!verificationResponse.ok) throw new Error('local_verification_unavailable');
        const verificationRaw = z
          .object({
            model: z.literal(this.modelName),
            done: z.literal(true),
            done_reason: z.literal('stop'),
            message: z.object({ content: z.string().max(6000) }),
            prompt_eval_count: z.number().optional(),
            eval_count: z.number().optional(),
          })
          .parse(await verificationResponse.json());
        const verified = VerificationSchema.parse(JSON.parse(verificationRaw.message.content));
        const all = [...verified.supported, ...verified.uncertain];
        if (all.some((i) => i >= value.findings.length) || new Set(all).size !== all.length)
          throw new Error('local_verification_invalid_index');
        value.findings = value.findings.flatMap((f, i) =>
          verified.supported.includes(i)
            ? [f]
            : verified.uncertain.includes(i)
              ? [{ ...f, clarity: 'possible' as const }]
              : [],
        );
        // A second pass can remove unsupported claims, never create or strengthen a crash claim.
        if (
          value.crashPattern !== 'consistent_with_sliding' ||
          verified.crashPattern !== 'consistent_with_sliding'
        )
          value.crashPattern = value.findings.length ? 'unclear' : 'not_observed';
        inputTokens += verificationRaw.prompt_eval_count ?? 0;
        outputTokens += verificationRaw.eval_count ?? 0;
      }
      // Duplicate descriptions add no evidence. Never turn no observed damage into a safety claim.
      const seen = new Set<string>();
      value.findings = value.findings.filter((f) => {
        const fingerprint = [f.zone, f.kind, f.evidence.toLowerCase().replace(/\W+/g, ' ')].join(
          ':',
        );
        if (seen.has(fingerprint)) return false;
        seen.add(fingerprint);
        return true;
      });
      if (
        value.crashPattern === 'consistent_with_sliding' &&
        !value.findings.some((f) => ['abrasion', 'tear', 'seam'].includes(f.kind))
      )
        value.crashPattern = 'unclear';
      inputTokens += raw.prompt_eval_count ?? 0;
      outputTokens += raw.eval_count ?? 0;
      signal?.throwIfAborted();
      // Validate the per-photo evidence before caching it.
      validateFindings(
        {
          schemaVersion: SCHEMA_VERSION,
          category: value.category,
          attributes: [],
          concerns: [],
          missingViews: [],
          multipleItems: false,
          inspection: { version: 'photo-evidence-1', photos: [{ ...value, imageId: image.id }] },
        },
        new Set([image.id]),
      );
      if (this.cache.size >= 48) {
        const oldest = this.cache.keys().next().value!;
        clearTimeout(this.cache.get(oldest)!.timer);
        this.cache.delete(oldest);
      }
      if (epoch === this.cacheEpoch) {
        const timer = nodeSetTimeout(() => this.cache.delete(key), 10 * 60 * 1000);
        (timer as unknown as { unref?: () => void }).unref?.();
        this.cache.set(key, { value, expires: Date.now() + 10 * 60 * 1000, timer });
      }
      photos.push({ ...value, imageId: image.id });
    }
    const garmentPhotos = photos.filter(
      (p) => images.find((i) => i.id === p.imageId)?.view !== 'label',
    );
    const categories = new Set(garmentPhotos.map((p) => p.category).filter((c) => c !== 'unknown'));
    const category = categories.size === 1 ? [...categories][0]! : 'unknown';
    const materialPhotos = garmentPhotos.filter((p) => p.material !== 'unknown');
    const materials = new Set(materialPhotos.map((p) => p.material));
    const observation = ObservationSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      category,
      attributes:
        materials.size === 1
          ? [
              {
                field: 'material',
                value: [...materials][0]!,
                kind: 'inference',
                imageIds: materialPhotos.map((p) => p.imageId),
              },
            ]
          : [],
      concerns: photos
        .flatMap((p) =>
          p.findings.map((f) => ({
            kind: f.kind,
            area: protectiveZones.has(f.zone) ? 'protective' : 'unknown',
            imageId: p.imageId,
          })),
        )
        .slice(0, 16),
      missingViews: (['front', 'back', 'label'] as const).filter(
        (v) => !images.some((i) => i.view === v),
      ),
      multipleItems: categories.size > 1 || photos.some((p) => p.category === 'multiple'),
      provider: this.id,
      model: this.model,
      coverage: this.coverage,
      inspection: { version: 'photo-evidence-1', photos },
      durationMs: performance.now() - started,
      usage: { inputTokens, outputTokens },
    });
    validateFindings(observation, new Set(images.map((i) => i.id)));
    return observation;
  }
}
export async function createLocalInspectionAdapter(
  model = 'qwen3.5:4b',
  url = 'http://127.0.0.1:11435',
  fetcher: typeof fetch = fetch,
) {
  const base = localRuntimeUrl(url);
  const response = await fetcher(base + '/api/tags', { signal: AbortSignal.timeout(5000) });
  if (!response.ok)
    throw new Error('Local vision runtime is unavailable. Run npm run vision:serve.');
  const tags = z
    .object({ models: z.array(z.object({ name: z.string(), digest: z.string() })) })
    .parse(await response.json());
  const found = tags.models.find((row) => row.name === model);
  if (!found) throw new Error('Local vision model is missing. Run npm run vision:pull.');
  if (
    model === 'qwen3.5:4b' &&
    found.digest !== 'd8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04'
  )
    throw new Error(
      'Local model weights changed. Re-evaluate the new digest before using this inspection profile.',
    );
  const capabilities = await fetcher(base + '/api/show', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
    signal: AbortSignal.timeout(5000),
  });
  const details = z.object({ capabilities: z.array(z.string()) }).parse(await capabilities.json());
  if (!details.capabilities.includes('vision'))
    throw new Error('The selected model cannot inspect images.');
  return new LocalInspectionAdapter(model, found.digest, base, fetcher);
}
