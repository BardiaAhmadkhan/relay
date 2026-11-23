import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POLICY_VERSION, SCHEMA_VERSION, type AnalysisResponse } from '../packages/core/schema';
import type { Draft, LocalPhoto } from '../app/src/session';

const native = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  files: new Map<string, string>(),
  directories: new Set<string>(),
  failingDeletes: new Set<string>(),
  copyFailure: false,
  platform: { OS: 'ios' },
  manipulate: vi.fn(),
}));
const documentDirectory = 'file:///app/documents/';
const managedDirectory = documentDirectory + 'relay-drafts/';
const cacheDirectory = 'file:///app/cache/';
const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
] as const;

vi.mock('react-native', () => ({ Platform: native.platform }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => native.storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      native.storage.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      native.storage.delete(key);
    }),
  },
}));
vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///app/documents/',
  cacheDirectory: 'file:///app/cache/',
  EncodingType: { Base64: 'base64' },
  deleteAsync: vi.fn(async (uri: string) => {
    if (native.failingDeletes.has(uri)) throw new Error('simulated-file-deletion-failure');
    native.files.delete(uri);
  }),
  getInfoAsync: vi.fn(async (uri: string) => ({
    exists: native.files.has(uri) || native.directories.has(uri),
    isDirectory: native.directories.has(uri),
  })),
  readDirectoryAsync: vi.fn(async (uri: string) =>
    [...native.files.keys()]
      .filter((file) => file.startsWith(uri) && !file.slice(uri.length).includes('/'))
      .map((file) => file.slice(uri.length)),
  ),
  makeDirectoryAsync: vi.fn(async (uri: string) => {
    native.directories.add(uri);
  }),
  copyAsync: vi.fn(async ({ from, to }: { from: string; to: string }) => {
    native.files.set(to, native.files.get(from) ?? 'partial-copy');
    if (native.copyFailure) throw new Error('simulated-copy-failure');
  }),
  readAsStringAsync: vi.fn(async (uri: string) => {
    if (!native.files.has(uri)) throw new Error('missing-file');
    return native.files.get(uri)!;
  }),
}));
vi.mock('expo-crypto', () => ({
  randomUUID: vi.fn(() => '55555555-5555-4555-8555-555555555555'),
}));
vi.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: native.manipulate },
  SaveFormat: { JPEG: 'jpeg' },
}));
vi.mock('jpeg-js', () => ({
  default: {
    decode: vi.fn(() => ({ width: 4, height: 4, data: new Uint8Array(4 * 4 * 4).fill(127) })),
  },
}));

let session: typeof import('../app/src/session');

function photo(index = 0, view: LocalPhoto['view'] = 'front'): LocalPhoto {
  return {
    id: ids[index]!,
    view,
    uri: managedDirectory + ids[index]! + '.jpg',
    width: 1200,
    height: 1600,
    quality: { width: 1200, height: 1600, brightness: 120, sharpness: 100, warnings: [] },
  };
}

function draft(id = 'draft-A', photos: LocalPhoto[] = [photo()]): Draft {
  return {
    version: 1,
    id,
    updatedAt: new Date().toISOString(),
    disclosures: [],
    corrections: [],
    photos,
    result: null,
  };
}

function resultFor(value: Draft): AnalysisResponse {
  return {
    schemaVersion: SCHEMA_VERSION,
    assessmentId: value.id,
    status: 'complete',
    photos: value.photos.map((item, index) => ({
      id: item.id,
      view: item.view,
      sha256: String(index + 1).repeat(64),
      byteLength: 1000,
      quality: item.quality,
    })),
    observation: {
      schemaVersion: SCHEMA_VERSION,
      category: 'motorcycle_jacket',
      attributes: [],
      concerns: [],
      missingViews: [],
      multipleItems: false,
      provider: 'test',
      model: 'fixture',
      coverage: 'visual_observations',
      durationMs: 1,
      usage: null,
    },
    decision: {
      state: 'human_inspection',
      policyVersion: POLICY_VERSION,
      title: 'Example review',
      summary: 'Unverified experimental result.',
      reasons: [{ code: 'example', text: 'Test fixture only.' }],
      nextAction: 'Inspect the physical item.',
      offerRecommended: false,
      protectivePerformanceCertified: false,
    },
    timing: { totalMs: 1, preprocessingMs: 0, inferenceMs: 1, cached: false },
  };
}

async function seed(value: Draft) {
  for (const item of value.photos) native.files.set(item.uri, 'owned-test-photo');
  await session.persistDraft(value);
}

async function restartModule() {
  vi.resetModules();
  session = await import('../app/src/session');
}

beforeEach(async () => {
  native.storage.clear();
  native.files.clear();
  native.directories.clear();
  native.directories.add(managedDirectory);
  native.failingDeletes.clear();
  native.copyFailure = false;
  native.platform.OS = 'ios';
  native.manipulate.mockReset();
  vi.clearAllMocks();
  await restartModule();
});

describe('native session cleanup using mocked storage and filesystem', () => {
  it('keeps draft metadata and a cleanup tombstone after a partial deletion failure', async () => {
    const original = draft('draft-A', [photo(0, 'front'), photo(1, 'back')]);
    await seed(original);
    native.failingDeletes.add(original.photos[1]!.uri);

    await expect(session.forgetDraft(original)).rejects.toThrow('simulated-file-deletion-failure');

    expect(JSON.parse(native.storage.get(session.DRAFT_KEY)!)).toMatchObject({ id: original.id });
    expect(JSON.parse(native.storage.get(session.CLEANUP_KEY)!)).toEqual({
      id: original.id,
      uris: original.photos.map((item) => item.uri),
    });
    expect(native.files.has(original.photos[0]!.uri)).toBe(false);
    expect(native.files.has(original.photos[1]!.uri)).toBe(true);
  });

  it('replays owned cleanup after restart and only then removes the matching draft and tombstone', async () => {
    const original = draft('draft-A', [photo(0), photo(1, 'back')]);
    await seed(original);
    native.failingDeletes.add(original.photos[1]!.uri);
    await expect(session.forgetDraft(original)).rejects.toThrow();
    native.failingDeletes.clear();

    await restartModule();
    const restored = await session.loadDraft();

    expect(restored.draft).toBeNull();
    expect(native.storage.has(session.DRAFT_KEY)).toBe(false);
    expect(native.storage.has(session.CLEANUP_KEY)).toBe(false);
    expect(original.photos.every((item) => !native.files.has(item.uri))).toBe(true);
  });

  it('preserves a different current draft while finishing an older cleanup job', async () => {
    const older = draft('draft-A', [photo(0)]);
    const newer = draft('draft-B', [photo(1), photo(2, 'back')]);
    await seed(older);
    native.storage.set(
      session.CLEANUP_KEY,
      JSON.stringify({ id: older.id, uris: older.photos.map((item) => item.uri) }),
    );
    await seed(newer);

    await restartModule();
    const restored = await session.loadDraft();

    expect(restored.draft?.id).toBe('draft-B');
    expect(JSON.parse(native.storage.get(session.DRAFT_KEY)!).id).toBe('draft-B');
    expect(newer.photos.every((item) => native.files.has(item.uri))).toBe(true);
    expect(native.files.has(older.photos[0]!.uri)).toBe(false);
    expect(native.storage.has(session.CLEANUP_KEY)).toBe(false);
  });

  it('does not let an older forget operation remove a newly persisted draft', async () => {
    const older = draft('draft-A', [photo(0)]);
    const newer = draft('draft-B', [photo(1)]);
    await seed(older);
    await seed(newer);

    await session.forgetDraft(older);

    expect(JSON.parse(native.storage.get(session.DRAFT_KEY)!).id).toBe('draft-B');
    expect(native.files.has(newer.photos[0]!.uri)).toBe(true);
    expect(native.files.has(older.photos[0]!.uri)).toBe(false);
  });

  it('expires an inactive draft and removes only its owned generated photos and owned orphans', async () => {
    const expired = draft();
    expired.updatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000 - 1).toISOString();
    await seed(expired);
    const orphan = photo(3).uri;
    const unrelated = managedDirectory + 'notes.txt';
    const originalGallery = 'file:///shared/DCIM/original.jpg';
    native.files.set(orphan, 'orphan');
    native.files.set(unrelated, 'unrelated');
    native.files.set(originalGallery, 'gallery-original');

    const restored = await session.loadDraft();

    expect(restored.draft).toBeNull();
    expect(restored.notice).toMatch(/expired after 24 hours/);
    expect(native.storage.has(session.DRAFT_KEY)).toBe(false);
    expect(native.storage.has(session.CLEANUP_KEY)).toBe(false);
    expect(native.files.has(expired.photos[0]!.uri)).toBe(false);
    expect(native.files.has(orphan)).toBe(false);
    expect(native.files.has(unrelated)).toBe(true);
    expect(native.files.has(originalGallery)).toBe(true);
  });

  it('retains recovery metadata when expiration cleanup fails', async () => {
    const expired = draft();
    expired.updatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await seed(expired);
    native.failingDeletes.add(expired.photos[0]!.uri);

    const restored = await session.loadDraft();

    expect(restored.draft?.id).toBe(expired.id);
    expect(restored.notice).toMatch(/expired draft could not be fully removed/i);
    expect(native.storage.has(session.DRAFT_KEY)).toBe(true);
    expect(native.storage.has(session.CLEANUP_KEY)).toBe(true);
    expect(native.files.has(expired.photos[0]!.uri)).toBe(true);
  });

  it('invalidates a saved analysis when a referenced local photograph is missing', async () => {
    const original = draft('draft-A', [photo(0, 'front'), photo(1, 'back')]);
    original.result = resultFor(original);
    await seed(original);
    native.files.delete(original.photos[1]!.uri);

    const restored = await session.loadDraft();

    expect(restored.draft?.photos.map((item) => item.id)).toEqual([original.photos[0]!.id]);
    expect(restored.draft?.result).toBeNull();
    expect(restored.notice).toMatch(/photos are no longer/);
  });

  it.each([
    'file:///shared/DCIM/original.jpg',
    documentDirectory + 'relay-drafts-other/' + ids[0] + '.jpg',
    managedDirectory + '../original.jpg',
    managedDirectory + 'nested/' + ids[0] + '.jpg',
    managedDirectory + 'not-generated.jpg',
    managedDirectory + ids[0] + '.png',
    managedDirectory + ids[0] + '.jpg?query=1',
    managedDirectory + '%2e%2e%2foriginal.jpg',
  ])('does not delete an unowned or non-generated file: %s', async (uri) => {
    native.files.set(uri, 'preserve');
    await session.removePhoto({ uri });
    expect(native.files.has(uri)).toBe(true);
  });

  it('removes an exact generated UUID JPEG in the managed directory', async () => {
    const owned = photo(0);
    native.files.set(owned.uri, 'owned');
    await session.removePhoto(owned);
    expect(native.files.has(owned.uri)).toBe(false);
  });

  it('cleans owned orphan photos without deleting unrelated files after corrupt metadata', async () => {
    native.storage.set(session.DRAFT_KEY, '{broken json');
    native.files.set(photo(0).uri, 'owned-orphan');
    native.files.set(managedDirectory + 'not-a-generated-photo.jpg', 'unrelated');

    const restored = await session.loadDraft();

    expect(restored.draft).toBeNull();
    expect(native.files.has(photo(0).uri)).toBe(false);
    expect(native.files.has(managedDirectory + 'not-a-generated-photo.jpg')).toBe(true);
    expect(native.storage.has(session.DRAFT_KEY)).toBe(false);
  });

  it('removes temporary outputs and a partial retained copy when photo preparation fails', async () => {
    const original = 'file:///shared/DCIM/original.jpg';
    const saved = cacheDirectory + 'normalized.jpg';
    const preview = cacheDirectory + 'preview.jpg';
    const retained = managedDirectory + '55555555-5555-4555-8555-555555555555.jpg';
    native.files.set(original, 'gallery-original');
    native.files.set(saved, 'normalized');
    native.files.set(preview, 'preview');
    native.copyFailure = true;
    native.manipulate
      .mockReturnValueOnce({
        resize: vi.fn(),
        renderAsync: vi.fn(async () => ({
          saveAsync: vi.fn(async () => ({ uri: saved, width: 1200, height: 1600 })),
        })),
      })
      .mockReturnValueOnce({
        resize: vi.fn(),
        renderAsync: vi.fn(async () => ({
          saveAsync: vi.fn(async () => ({ uri: preview, width: 4, height: 4, base64: 'AQIDBA==' })),
        })),
      });

    await expect(session.preparePhoto(original, 'front', 1200, 1600)).rejects.toThrow(
      'simulated-copy-failure',
    );

    expect(native.files.has(saved)).toBe(false);
    expect(native.files.has(preview)).toBe(false);
    expect(native.files.has(retained)).toBe(false);
    expect(native.files.has(original)).toBe(true);
  });

  it('performs no native filesystem deletion on the web path', async () => {
    native.platform.OS = 'web';
    const original = draft();
    await seed(original);
    await session.forgetDraft(original);
    expect(native.files.has(original.photos[0]!.uri)).toBe(true);
    expect(native.storage.has(session.DRAFT_KEY)).toBe(false);
  });
});

describe('saved notebook photograph retention', () => {
  it('preserves archived photographs during draft expiry and orphan cleanup', async () => {
    const original = draft('saved-record', [photo(0)]);
    await seed(original);
    const briefs = await import('../app/src/briefs');
    await briefs.saveBrief({
      id: original.id,
      savedAt: new Date().toISOString(),
      title: 'Inspection',
      category: 'Motorcycle jacket',
      text: 'Saved evidence',
      photos: original.photos,
    });
    const current = draft('current-draft', [photo(1)]);
    current.updatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await seed(current);
    native.files.set(photo(2).uri, 'orphan');
    await session.loadDraft();
    expect(native.files.has(photo(0).uri)).toBe(true);
    expect(native.files.has(photo(1).uri)).toBe(false);
    expect(native.files.has(photo(2).uri)).toBe(false);
    expect(await briefs.readBriefs()).toHaveLength(1);
  });
  it('requires removal of the saved record before a protected photo can be deleted', async () => {
    const original = draft();
    await seed(original);
    const briefs = await import('../app/src/briefs');
    await briefs.saveBrief({
      id: original.id,
      savedAt: new Date().toISOString(),
      title: 'Inspection',
      category: 'Motorcycle jacket',
      text: 'Saved evidence',
      photos: original.photos,
    });
    await session.removePhoto(photo(0));
    expect(native.files.has(photo(0).uri)).toBe(true);
    await briefs.removeBrief(original.id);
    await session.removePhoto(photo(0));
    expect(native.files.has(photo(0).uri)).toBe(false);
  });
  it('does not delete possible archived photos when notebook metadata is unreadable', async () => {
    native.storage.set('relay.briefs.v1', 'broken');
    native.files.set(photo(0).uri, 'preserve');
    await expect(session.removePhoto(photo(0))).rejects.toThrow('Saved briefs could not be read');
    await session.loadDraft();
    expect(native.files.has(photo(0).uri)).toBe(true);
  });
});

it('preserves photos and history when an older saved analysis needs a policy refresh', async () => {
  const original = draft();
  original.result = resultFor(original);
  await seed(original);
  const stored = JSON.parse(native.storage.get(session.DRAFT_KEY)!);
  stored.result.decision.policyVersion = '2026-10-26.1';
  native.storage.set(session.DRAFT_KEY, JSON.stringify(stored));
  const restored = await session.loadDraft();
  expect(restored.draft?.id).toBe(original.id);
  expect(restored.draft?.photos).toEqual(original.photos);
  expect(restored.draft?.result).toBeNull();
  expect(native.files.has(photo(0).uri)).toBe(true);
  expect(restored.notice).toContain('Refresh the previous analysis');
});

it('collects replaced photos only after the current draft commits and keeps them on persistence failure', async () => {
  const first = photo(0),
    next = photo(1);
  const value = draft('photo-replacement', [next]);
  native.files.set(first.uri, 'earlier pixels');
  native.files.set(next.uri, 'new pixels');
  const retired = new Set([first.uri]);
  const storage = (await import('@react-native-async-storage/async-storage')).default;
  vi.mocked(storage.setItem).mockRejectedValueOnce(new Error('storage full'));
  await expect(session.persistDraftWithCleanup(value, retired, () => value)).rejects.toThrow(
    'storage full',
  );
  expect(native.files.has(first.uri)).toBe(true);
  await session.persistDraftWithCleanup(value, retired, () => ({ ...value }));
  expect(native.files.has(first.uri)).toBe(true);
  await session.persistDraftWithCleanup(value, retired, () => value);
  expect(native.files.has(first.uri)).toBe(false);
  expect(native.files.has(next.uri)).toBe(true);
  expect(retired.size).toBe(0);
});
