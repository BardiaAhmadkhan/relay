import { describe, expect, it, vi } from 'vitest';
import { LocalInspectionAdapter } from '../packages/vision/inspection';
import { repairReviewIndices } from '../packages/vision/review-repair';
const photo = {
  findings: [
    { evidence: 'Ragged hole with exposed fibers', zone: 'elbow', kind: 'tear', clarity: 'clear' },
  ],
  crashPattern: 'unclear',
  category: 'motorcycle_jacket',
  material: 'textile',
};
const response = (content: unknown) =>
  new Response(
    JSON.stringify({
      model: 'vision:4b',
      done: true,
      done_reason: 'stop',
      message: { content: JSON.stringify(content) },
      prompt_eval_count: 20,
      eval_count: 10,
    }),
  );
const image = { id: 'photo', view: 'front' as const, jpeg: new Uint8Array([1, 2, 3]) };
describe('bounded correction of invalid verifier references', () => {
  it('asks for a new constrained review instead of remapping a nonexistent index', async () => {
    const calls: any[] = [];
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push(body);
      return response(
        calls.length === 1
          ? photo
          : calls.length === 2
            ? { supported: [1], uncertain: [], crashPattern: 'not_observed' }
            : { verdicts: { candidate_0: 'uncertain' }, crashPattern: 'not_observed' },
      );
    });
    const engine = new LocalInspectionAdapter(
      'vision:4b',
      'a'.repeat(64),
      'http://127.0.0.1:11435',
      fetcher as typeof fetch,
    );
    try {
      const r = await engine.analyze([image]);
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(calls[2].format.properties.verdicts.required).toEqual(['candidate_0']);
      expect(calls[2].format.properties.verdicts.additionalProperties).toBe(false);
      expect(calls[2].messages[1].images).toEqual(calls[1].messages[1].images);
      expect(calls[2].messages[1].content).toContain('All candidates may be unsupported');
      expect(r.inspection!.photos[0]!.findings).toEqual([
        { ...photo.findings[0], clarity: 'possible' },
      ]);
      expect(r.usage).toEqual({ inputTokens: 60, outputTokens: 30 });
      expect(r.model).toContain('+review-index-1');
    } finally {
      engine.clearCache();
    }
  });
  it('allows the corrective reviewer to reject the original hypothesis', async () => {
    let n = 0;
    const fetcher = vi.fn(async () =>
      response(
        ++n === 1
          ? photo
          : n === 2
            ? { supported: [1], uncertain: [], crashPattern: 'unclear' }
            : { verdicts: { candidate_0: 'unsupported' }, crashPattern: 'not_observed' },
      ),
    );
    const engine = new LocalInspectionAdapter(
      'vision:4b',
      'a'.repeat(64),
      'http://127.0.0.1:11435',
      fetcher as typeof fetch,
    );
    try {
      expect((await engine.analyze([image])).inspection!.photos[0]!.findings).toEqual([]);
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      engine.clearCache();
    }
  });
  it('does not retry or alter a valid review', async () => {
    let n = 0;
    const fetcher = vi.fn(async () =>
      response(++n === 1 ? photo : { supported: [0], uncertain: [], crashPattern: 'unclear' }),
    );
    const engine = new LocalInspectionAdapter(
      'vision:4b',
      'a'.repeat(64),
      'http://127.0.0.1:11435',
      fetcher as typeof fetch,
    );
    try {
      expect((await engine.analyze([image])).inspection!.photos[0]!.findings).toEqual(
        photo.findings,
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      engine.clearCache();
    }
  });
  it('fails closed after one still-invalid corrective response', async () => {
    let n = 0;
    const fetcher = vi.fn(async () =>
      response(++n === 1 ? photo : { supported: [1], uncertain: [], crashPattern: 'unclear' }),
    );
    const engine = new LocalInspectionAdapter(
      'vision:4b',
      'a'.repeat(64),
      'http://127.0.0.1:11435',
      fetcher as typeof fetch,
    );
    try {
      await expect(engine.analyze([image])).rejects.toThrow('local_verification_invalid_index');
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      engine.clearCache();
    }
  });
  it('has a separate short deadline and propagates a parent abort', async () => {
    const fetcher = vi.fn(
      async (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          }),
        ),
    );
    const args = {
      count: 1,
      initialBody: JSON.stringify({
        messages: [
          { role: 'system', content: '' },
          { role: 'user', content: 'candidates', images: ['AQID'] },
        ],
      }),
      endpoint: 'http://127.0.0.1:11435/api/chat',
      fetcher: fetcher as typeof fetch,
      budgetMs: 20,
    };
    await expect(repairReviewIndices(args)).rejects.toThrow('aborted');
    const controller = new AbortController();
    controller.abort();
    await expect(repairReviewIndices({ ...args, signal: controller.signal })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
