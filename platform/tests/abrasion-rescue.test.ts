import { beforeAll, describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import { rescueAbrasion } from '../experiments/round-05/abrasion-rescue';
import { PhotoInspectionSchema } from '../packages/core/schema';
const empty = PhotoInspectionSchema.parse({
  findings: [],
  crashPattern: 'not_observed',
  category: 'motorcycle_jacket',
  material: 'leather',
});
const candidate = PhotoInspectionSchema.parse({
  ...empty,
  findings: [
    {
      evidence: 'Pale rough scrape on the shoulder panel',
      zone: 'shoulder',
      kind: 'abrasion',
      clarity: 'clear',
    },
  ],
});
let image: Buffer;
beforeAll(async () => {
  image = await sharp({ create: { width: 240, height: 320, channels: 3, background: '#777' } })
    .jpeg()
    .toBuffer();
});
function input(verified = empty, extracted = candidate) {
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          model: 'vision:4b',
          done: true,
          done_reason: 'stop',
          message: {
            content: JSON.stringify({
              supported: [0],
              uncertain: [],
              crashPattern: 'consistent_with_sliding',
            }),
          },
          prompt_eval_count: 1400,
          eval_count: 30,
        }),
        { status: 200 },
      ),
  );
  return {
    verified: structuredClone(verified),
    extracted: structuredClone(extracted),
    jpeg: image,
    model: 'vision:4b',
    url: 'http://127.0.0.1:11435',
    fetcher,
  };
}
describe('isolated abrasion rescue contract - transport is a unit double, not accuracy evidence', () => {
  it('does no processing or extra inference when a finding already exists', async () => {
    const i = input(candidate);
    const r = await rescueAbrasion(i);
    expect(r.photo).toBe(i.verified);
    expect(r.state).toBe('existing-finding');
    expect(i.fetcher).not.toHaveBeenCalled();
  });
  it('never expands this task to labels, tears or other feature types', async () => {
    for (const kind of ['other', 'tear', 'seam', 'repair', 'closure', 'insert'] as const) {
      const i = input(empty, { ...candidate, findings: [{ ...candidate.findings[0]!, kind }] });
      expect((await rescueAbrasion(i)).state).toBe('no-abrasion-candidate');
      expect(i.fetcher).not.toHaveBeenCalled();
    }
  });
  it('keeps metadata and original bytes while making supported rescue evidence only possible', async () => {
    const i = input();
    const original = Buffer.from(i.jpeg);
    const result = await rescueAbrasion(i);
    expect(result.photo.category).toBe(empty.category);
    expect(result.photo.material).toBe(empty.material);
    expect(result.photo.crashPattern).toBe('unclear');
    expect(result.photo.findings[0]?.clarity).toBe('possible');
    expect(result.photo.findings[0]?.kind).toBe('abrasion');
    expect(i.jpeg).toEqual(original);
    expect(i.verified.findings).toEqual([]);
    expect(result.usage).toEqual({ inputTokens: 1400, outputTokens: 30 });
    expect(i.fetcher).toHaveBeenCalledOnce();
  });
  it.each([
    [640, 853],
    [60, 320],
    [96, 440],
  ])('leaves an input outside the detail window alone (%i x %i)', async (width, height) => {
    const i = input();
    i.jpeg = await sharp({ create: { width, height, channels: 3, background: '#777' } })
      .jpeg()
      .toBuffer();
    expect((await rescueAbrasion(i)).state).toBe('outside-detail-window');
    expect(i.fetcher).not.toHaveBeenCalled();
  });
  it.each([
    { supported: [1], uncertain: [], crashPattern: 'unclear' },
    { supported: [0], uncertain: [0], crashPattern: 'unclear' },
    { supported: [], uncertain: [0], crashPattern: 'unclear' },
  ])('rejects unsupported, duplicated or uncertain-only rescue evidence %j', async (value) => {
    const i = input();
    i.fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: 'vision:4b',
          done: true,
          done_reason: 'stop',
          message: { content: JSON.stringify(value) },
        }),
      ),
    );
    const r = await rescueAbrasion(i);
    expect(r.photo).toEqual(empty);
  });
  it('keeps the original valid result after HTTP, schema or decode failure', async () => {
    for (const response of [
      new Response('unavailable', { status: 503 }),
      new Response('{bad json'),
      new Response(
        JSON.stringify({
          model: 'wrong',
          done: true,
          done_reason: 'stop',
          message: { content: '{}' },
        }),
      ),
    ]) {
      const i = input();
      i.fetcher.mockResolvedValueOnce(response);
      expect((await rescueAbrasion(i)).photo).toEqual(empty);
    }
    const i = input();
    i.jpeg = Buffer.from('invalid');
    expect((await rescueAbrasion(i)).photo).toEqual(empty);
    expect(i.fetcher).not.toHaveBeenCalled();
  });
  it('propagates parent cancellation and never starts a cancelled rescue', async () => {
    const i = input();
    const abort = new AbortController();
    abort.abort();
    await expect(rescueAbrasion({ ...i, signal: abort.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(i.fetcher).not.toHaveBeenCalled();
  });
});
