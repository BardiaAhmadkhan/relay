import { beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  canFocusTear,
  recoverFocusedTear,
  contextualFocusFetch,
} from '../packages/vision/focused-tear';
import { LocalInspectionAdapter } from '../packages/vision/inspection';
import type { z } from 'zod';
import type { PhotoInspectionSchema } from '../packages/core/schema';
type Photo = z.infer<typeof PhotoInspectionSchema>;
const clear: Photo = {
  findings: [],
  crashPattern: 'not_observed',
  category: 'trousers',
  material: 'denim',
};
const tear: Photo = {
  ...clear,
  findings: [
    { evidence: 'Ragged hole with severed fibers', kind: 'tear', zone: 'elbow', clarity: 'clear' },
  ],
  crashPattern: 'consistent_with_sliding',
};
let jpeg: Buffer;
beforeAll(async () => {
  jpeg = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#888888' } })
    .jpeg()
    .toBuffer();
});
function grounding(value: unknown = { target: 'wearable_item', box: [350, 200, 600, 700] }) {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          model: 'qwen3.5:4b',
          done: true,
          done_reason: 'stop',
          message: { content: JSON.stringify(value) },
          prompt_eval_count: 15,
          eval_count: 10,
        }),
      ),
  );
}
function options(fetcher: typeof fetch = grounding()) {
  return {
    photo: clear,
    jpeg,
    view: 'front',
    model: 'qwen3.5:4b',
    url: 'http://127.0.0.1:11435',
    fetcher,
    inspect: vi.fn(async (_jpeg: Uint8Array, _signal: AbortSignal) => ({
      photo: tear,
      usage: { inputTokens: 20, outputTokens: 10 },
    })),
  };
}
describe('bounded focused tear recovery (disclosed model doubles)', () => {
  it('retains category/material, caps recovered evidence at possible, and does not infer a crash', async () => {
    const args = options(),
      r = await recoverFocusedTear(args);
    expect(r.attempted).toBe(true);
    expect(args.inspect).toHaveBeenCalledTimes(1);
    expect(r.photo).toEqual({
      ...clear,
      crashPattern: 'unclear',
      findings: [{ ...tear.findings[0]!, zone: 'unknown', clarity: 'possible' }],
    });
    expect(r.usage).toEqual({ inputTokens: 35, outputTokens: 20 });
    expect((await sharp(args.inspect.mock.calls[0]![0]).metadata()).format).toBe('png');
  });
  it.each(['label', 'unrelated'])(
    'does not inspect a label or an unsupported subject: %s',
    async (kind) => {
      const args = options();
      if (kind === 'label') args.view = 'label';
      else args.photo = { ...clear, category: 'other' };
      const r = await recoverFocusedTear(args);
      expect(r.photo).toBe(args.photo);
      expect(r.attempted).toBe(false);
      expect(args.fetcher).not.toHaveBeenCalled();
    },
  );
  it('never reinterprets existing physical evidence', async () => {
    const args = { ...options(), photo: tear };
    expect(canFocusTear(tear, 'front')).toBe(false);
    expect((await recoverFocusedTear(args)).photo).toBe(tear);
    expect(args.fetcher).not.toHaveBeenCalled();
  });
  it('targets an unresolved linear detail but leaves ordinary spots and cosmetic-only descriptions alone', () => {
    const weak = (evidence: string): Photo => ({
      ...clear,
      findings: [{ evidence, zone: 'unknown', kind: 'other', clarity: 'possible' }],
    });
    expect(canFocusTear(weak('A thin dark linear mark'), 'detail')).toBe(true);
    expect(canFocusTear(weak('A small dark spot'), 'detail')).toBe(false);
    expect(canFocusTear(weak('A linear discoloration'), 'detail')).toBe(false);
    expect(canFocusTear(weak('No visible damage on the seam'), 'detail')).toBe(false);
  });
  it.each([
    { target: 'none', box: [0, 0, 0, 0] },
    { target: 'wearable_item', box: [0, 0, 1000, 1000] },
    { target: 'wearable_item', box: [700, 300, 600, 500] },
    { target: 'wearable_item', box: [100, 100, 500] },
    { target: 'wearable_item', box: [-1, 100, 500, 500] },
  ])(
    'rejects absent, whole-frame or malformed targets without calling the crop detector',
    async (target) => {
      const args = options(grounding(target)),
        r = await recoverFocusedTear(args);
      expect(r.photo).toBe(clear);
      expect(args.inspect).not.toHaveBeenCalled();
    },
  );
  it('does not turn an uncertain crop observation or a different damage type into a new tear', async () => {
    for (const photo of [
      { ...tear, findings: [{ ...tear.findings[0]!, clarity: 'possible' as const }] },
      { ...tear, findings: [{ ...tear.findings[0]!, kind: 'abrasion' as const }] },
    ]) {
      const args = {
        ...options(),
        inspect: vi.fn(async () => ({ photo, usage: { inputTokens: 1, outputTokens: 1 } })),
      };
      expect((await recoverFocusedTear(args)).photo).toBe(clear);
    }
  });
  it('retains baseline after the optional deadline but propagates parent cancellation', async () => {
    const fetcher = vi.fn(
      async (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );
    const args = { ...options(fetcher as typeof fetch), budgetMs: 20 };
    expect((await recoverFocusedTear(args)).photo).toBe(clear);
    const controller = new AbortController();
    controller.abort();
    await expect(recoverFocusedTear({ ...args, signal: controller.signal })).rejects.toThrow();
  });
  it('sends both related frames only to the verifier and preserves primary inference', async () => {
    const base = vi.fn(async (_input: unknown, _init?: RequestInit) => new Response('{}')),
      wrapped = contextualFocusFetch(base as typeof fetch, new Uint8Array([1, 2, 3]));
    const body = {
      format: { properties: { supported: {} } },
      messages: [{ role: 'user', content: 'Check candidate', images: ['crop-pixels'] }],
    };
    await wrapped('http://127.0.0.1:11435/api/chat', { body: JSON.stringify(body) });
    const sent = JSON.parse(String(base.mock.calls[0]![1]?.body));
    expect(sent.messages[0].images).toEqual(['AQID', 'crop-pixels']);
    expect(sent.messages[0].content).toContain('full original');
    const primary = { body: JSON.stringify({ ...body, format: { properties: { findings: {} } } }) };
    await wrapped('http://127.0.0.1:11435/api/chat', primary);
    expect(base.mock.calls[1]![1]).toBe(primary);
    await wrapped('http://127.0.0.1:11435/api/chat', {
      body: JSON.stringify({ ...body, format: { properties: { verdicts: {} } } }),
    });
    const repaired = JSON.parse(String(base.mock.calls[2]![1]?.body));
    expect(repaired.messages[0].images).toEqual(['AQID', 'crop-pixels']);
    expect(repaired.messages[0].content).toContain('FIRST image');
  });
});

describe('assessment budget and context cache isolation', () => {
  it('uses one focus per assessment and does not cache an image that skipped its focus stage', async () => {
    const bodies: any[] = [];
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      const value = body.format.properties.box
        ? { target: 'wearable_item', box: [300, 200, 700, 800] }
        : body.format.properties.supported
          ? { supported: [0], uncertain: [], crashPattern: 'not_observed' }
          : body.messages[1].images[0].startsWith('iVBOR')
            ? tear
            : clear;
      return new Response(
        JSON.stringify({
          model: 'qwen3.5:4b',
          done: true,
          done_reason: 'stop',
          message: { content: JSON.stringify(value) },
          prompt_eval_count: 10,
          eval_count: 10,
        }),
      );
    });
    const engine = new LocalInspectionAdapter(
      'qwen3.5:4b',
      'd8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04',
      'http://127.0.0.1:11435',
      fetcher as typeof fetch,
    );
    try {
      const other = await sharp({
        create: { width: 640, height: 480, channels: 3, background: '#777777' },
      })
        .jpeg()
        .toBuffer();
      const images = [
        { id: 'first', view: 'front' as const, jpeg },
        { id: 'second', view: 'back' as const, jpeg: other },
      ];
      const batch = await engine.analyze(images);
      expect(batch.inspection!.photos[0]!.findings).toHaveLength(1);
      expect(batch.inspection!.photos[1]!.findings).toHaveLength(0);
      expect(bodies.filter((b) => b.format.properties.box)).toHaveLength(1);
      const single = await engine.analyze([images[1]!]);
      expect(single.inspection!.photos[0]!.findings).toHaveLength(1);
      expect(bodies.filter((b) => b.format.properties.box)).toHaveLength(2);
      const verifications = bodies.filter((b) => b.format.properties.supported);
      expect(verifications.every((b) => b.messages[1].images.length === 2)).toBe(true);
      expect(verifications[0].messages[1].images[0]).not.toBe(
        verifications[1].messages[1].images[0],
      );
      const calls = bodies.length;
      await engine.analyze([{ ...images[0]!, id: 'new-id' }]);
      expect(bodies).toHaveLength(calls);
    } finally {
      engine.clearCache();
    }
  });
});

describe('cache retention when optional work is deferred', () => {
  it('does not evict a completed image merely because another image skipped its optional stage', async () => {
    let mode: 'physical' | 'empty' = 'physical';
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const value = body.format.properties.box
        ? { target: 'wearable_item', box: [300, 200, 700, 800] }
        : body.format.properties.supported
          ? { supported: [0], uncertain: [], crashPattern: 'not_observed' }
          : mode === 'physical' || body.messages[1].images[0].startsWith('iVBOR')
            ? tear
            : clear;
      return new Response(
        JSON.stringify({
          model: 'qwen3.5:4b',
          done: true,
          done_reason: 'stop',
          message: { content: JSON.stringify(value) },
          prompt_eval_count: 10,
          eval_count: 10,
        }),
      );
    });
    const engine = new LocalInspectionAdapter(
      'qwen3.5:4b',
      'd8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04',
      'http://127.0.0.1:11435',
      fetcher as typeof fetch,
    );
    try {
      // Synthetic bytes exercise only the cache contract; model transport is a disclosed double.
      const stored = Array.from({ length: 48 }, (_, i) => ({
        id: 'cached-' + i,
        view: 'front' as const,
        jpeg: new Uint8Array([1, 2, i]),
      }));
      for (const image of stored) await engine.analyze([image]);
      mode = 'empty';
      const second = await sharp({
        create: { width: 640, height: 480, channels: 3, background: '#666666' },
      })
        .jpeg()
        .toBuffer();
      await engine.analyze([
        { id: 'focus-first', view: 'front', jpeg },
        { id: 'deferred', view: 'front', jpeg: second },
      ]);
      mode = 'physical';
      const calls = fetcher.mock.calls.length;
      await engine.analyze([stored[1]!]);
      expect(fetcher).toHaveBeenCalledTimes(calls);
    } finally {
      engine.clearCache();
    }
  });
});

describe('optional-stage retry after runtime failure', () => {
  it('does not cache a fallback that would suppress a later successful focus', async () => {
    let grounds = 0;
    const original = jpeg.toString('base64');
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      let value: any;
      if (body.format.properties.box) {
        if (++grounds === 1) throw new Error('temporary_runtime_failure');
        value = { target: 'wearable_item', box: [350, 200, 600, 700] };
      } else if (body.format.properties.findings)
        value = body.messages[1].images[0] === original ? clear : tear;
      else value = { supported: [0], uncertain: [], crashPattern: 'unclear' };
      return new Response(
        JSON.stringify({
          model: 'qwen3.5:4b',
          done: true,
          done_reason: 'stop',
          message: { content: JSON.stringify(value) },
          prompt_eval_count: 10,
          eval_count: 5,
        }),
      );
    });
    const engine = new LocalInspectionAdapter(
      'qwen3.5:4b',
      'd8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04',
      'http://127.0.0.1:11435',
      fetcher as typeof fetch,
    );
    try {
      const input = [{ id: 'photo', view: 'front' as const, jpeg }];
      expect((await engine.analyze(input)).inspection!.photos[0]!.findings).toEqual([]);
      expect((await engine.analyze(input)).inspection!.photos[0]!.findings[0]?.kind).toBe('tear');
      expect(grounds).toBe(2);
      const n = fetcher.mock.calls.length;
      expect((await engine.analyze(input)).inspection!.photos[0]!.findings[0]?.kind).toBe('tear');
      expect(fetcher).toHaveBeenCalledTimes(n);
    } finally {
      engine.clearCache();
    }
  });
});
