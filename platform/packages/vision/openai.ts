import { z } from 'zod';
import {
  VisualFindingsSchema,
  ObservationSchema,
  type VisionAdapter,
  type VisionImage,
  type Observation,
} from '../core/schema';
import { VISION_PROMPT } from './prompt';
import { validateFindings } from './validation';
/** Optional paid adapter. Caller must separately authorize provider use and image disclosure. */
export class OpenAIVisionAdapter implements VisionAdapter {
  readonly id = 'openai' as const;
  constructor(
    readonly model: string,
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!model || !apiKey)
      throw new Error('OpenAI adapter needs an explicit model and server-side key');
  }
  async analyze(images: VisionImage[], signal?: AbortSignal): Promise<Observation> {
    const start = performance.now();
    const response = await this.fetcher('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal,
      headers: { Authorization: 'Bearer ' + this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        store: false,
        max_output_tokens: 1800,
        instructions: VISION_PROMPT,
        input: [
          {
            role: 'user',
            content: images.flatMap((p) => [
              { type: 'input_text', text: 'Image ID ' + p.id + '; requested view ' + p.view },
              {
                type: 'input_image',
                image_url: 'data:image/jpeg;base64,' + Buffer.from(p.jpeg).toString('base64'),
                detail: 'high',
              },
            ]),
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'gear_observations',
            strict: true,
            schema: z.toJSONSchema(VisualFindingsSchema),
          },
        },
      }),
    });
    if (!response.ok) throw new Error('provider_http_' + response.status);
    const raw: unknown = await response.json();
    const envelope = z
      .object({
        status: z.literal('completed'),
        output: z.array(
          z
            .object({
              type: z.string(),
              content: z
                .array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())
                .optional(),
            })
            .passthrough(),
        ),
        usage: z
          .object({
            input_tokens: z.number().int().nonnegative(),
            output_tokens: z.number().int().nonnegative(),
          })
          .optional(),
      })
      .passthrough()
      .parse(raw);
    const content = envelope.output.flatMap((o) => o.content ?? []);
    if (content.some((c) => c.type === 'refusal')) throw new Error('provider_refusal');
    const text = content
      .filter((c) => c.type === 'output_text')
      .map((c) => c.text ?? '')
      .join('');
    if (!text || text.length > 30_000) throw new Error('provider_invalid_output');
    const findings = VisualFindingsSchema.parse(JSON.parse(text));
    const ids = new Set(images.map((p) => p.id));
    validateFindings(findings, ids);
    if (
      findings.attributes.some((a) => a.imageIds.some((id) => !ids.has(id))) ||
      findings.concerns.some((c) => !ids.has(c.imageId))
    )
      throw new Error('provider_unknown_image');
    // Do not allow free-form attribute text to carry a decision/certification claim into the interface.
    if (
      findings.attributes.some((a) =>
        /certif|safe to|crash.free|undamaged|approved|offer|\$|ignore|instruction/i.test(a.value),
      )
    )
      throw new Error('provider_unsupported_claim');
    return ObservationSchema.parse({
      ...findings,
      provider: this.id,
      model: this.model,
      coverage: 'visual_observations',
      durationMs: performance.now() - start,
      usage: envelope.usage
        ? { inputTokens: envelope.usage.input_tokens, outputTokens: envelope.usage.output_tokens }
        : null,
    });
  }
}
