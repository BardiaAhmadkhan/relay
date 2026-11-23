import { z } from 'zod';
import { createLocalLogprobScorer } from './scorer-local';

// The digest binds the language weights, projector and model manifest together.
export const inspectionModel = {
  name: 'qwen3.5:4b',
  digest: 'd8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04',
  text: 4_205_751_296,
  vision: 333_514_240,
} as const;

export async function inspectionScorer(
  url = 'http://127.0.0.1:11435',
  fetcher: typeof fetch = fetch,
) {
  const model = inspectionModel;
  const scorer = await createLocalLogprobScorer(model.name, model.digest, url, fetcher);
  const response = await fetcher(url + '/api/show', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model.name }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok)
    throw new Error('The vision runtime could not report the installed model size.');
  const info = z
    .object({
      model_info: z.object({ 'general.parameter_count': z.literal(model.text) }),
      projector_info: z.object({ 'general.parameter_count': z.literal(model.vision) }),
    })
    .parse(await response.json());
  if (
    info.model_info['general.parameter_count'] + info.projector_info['general.parameter_count'] >
    4_539_265_536
  )
    throw new Error('The installed vision model exceeds the parameter limit.');
  return scorer;
}
