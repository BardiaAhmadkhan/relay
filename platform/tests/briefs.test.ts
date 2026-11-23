import { describe, it, expect, vi, beforeEach } from 'vitest';
const db = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => db.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      db.set(key, value);
    }),
  },
}));
import { saveBrief, readBriefs, removeBrief, BRIEFS_KEY } from '../app/src/briefs';
const record = (id = 'case-a') => ({
  id,
  savedAt: '2026-10-26T12:00:00.000Z',
  title: 'Visible damage detected',
  category: 'Motorcycle jacket',
  text: 'An inspection brief with its sources.',
  photos: [
    {
      id: 'photo-' + id,
      view: 'front' as const,
      uri: 'file:///owned/' + id + '.jpg',
      width: 600,
      height: 800,
      quality: { width: 600, height: 800, brightness: 120, sharpness: 60, warnings: [] },
    },
  ],
});
beforeEach(() => db.clear());
describe('saved business inspection records', () => {
  it('preserves the photographs and text together', async () => {
    await saveBrief(record());
    expect(await readBriefs()).toEqual([record()]);
  });
  it('serializes simultaneous saves without losing an item', async () => {
    await Promise.all([saveBrief(record('a')), saveBrief(record('b'))]);
    expect((await readBriefs()).map((b) => b.id).sort()).toEqual(['a', 'b']);
  });
  it('never silently discards an old record when full', async () => {
    db.set(BRIEFS_KEY, JSON.stringify(Array.from({ length: 50 }, (_, i) => record(String(i)))));
    const before = db.get(BRIEFS_KEY);
    await expect(saveBrief(record('overflow'))).rejects.toThrow('50 briefs');
    expect(db.get(BRIEFS_KEY)).toBe(before);
  });
  it('preserves unreadable saved data instead of overwriting it', async () => {
    db.set(BRIEFS_KEY, 'corrupt record');
    await expect(saveBrief(record())).rejects.toThrow('left in place');
    expect(db.get(BRIEFS_KEY)).toBe('corrupt record');
  });
  it('removes only the explicitly selected saved record', async () => {
    await saveBrief(record('a'));
    await saveBrief(record('b'));
    await removeBrief('a');
    expect((await readBriefs()).map((b) => b.id)).toEqual(['b']);
  });
});
