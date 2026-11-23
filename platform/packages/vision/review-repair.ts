import { z } from 'zod';
export const REVIEW_INDEX_VERSION = 'review-index-1';
/** One corrective review after invalid references. Ordinary reviews are unchanged.
 * Fixed input slots prevent invented indices, duplicates and conflicting memberships.
 */
export async function repairReviewIndices(options: {
  count: number;
  initialBody: string;
  endpoint: string;
  fetcher: typeof fetch;
  signal?: AbortSignal;
  budgetMs?: number;
}) {
  if (!Number.isInteger(options.count) || options.count < 1 || options.count > 6)
    throw new Error('local_verification_invalid_index');
  options.signal?.throwIfAborted();
  const verdict = z.enum(['supported', 'uncertain', 'unsupported']);
  const slots = Object.fromEntries(
    Array.from({ length: options.count }, (_, i) => ['candidate_' + i, verdict]),
  );
  const schema = z.strictObject({
    verdicts: z.strictObject(slots),
    crashPattern: z.enum(['consistent_with_sliding', 'not_observed', 'unclear']),
  });
  const body = JSON.parse(options.initialBody);
  body.format = z.toJSONSchema(schema);
  body.messages[1].content =
    'The previous review contained an unavailable or repeated candidate reference. ' +
    'Return one verdict for each fixed key candidate_0 through candidate_' +
    (options.count - 1) +
    '. ' +
    'Use supported for visible physical evidence, uncertain for an actual defect needing confirmation, ' +
    'and unsupported for a normal feature or unsupported claim. All candidates may be unsupported. ' +
    'Judge the photograph again; do not add candidates or force a finding. ' +
    body.messages[1].content;
  const deadline = AbortSignal.timeout(options.budgetMs ?? 2500);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const response = await options.fetcher(options.endpoint, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('local_verification_invalid_index');
  const raw: unknown = await response.json();
  signal.throwIfAborted();
  const envelope = z
    .object({ message: z.object({ content: z.string().max(6000) }) })
    .passthrough()
    .parse(raw);
  const result = schema.parse(JSON.parse(envelope.message.content));
  const supported: number[] = [],
    uncertain: number[] = [];
  for (let i = 0; i < options.count; i++) {
    const state = result.verdicts['candidate_' + i];
    if (state === 'supported') supported.push(i);
    else if (state === 'uncertain') uncertain.push(i);
  }
  // Server-owned input slots determine addresses; bad model references are never remapped.
  return {
    ...envelope,
    message: {
      ...envelope.message,
      content: JSON.stringify({ supported, uncertain, crashPattern: result.crashPattern }),
    },
  };
}
