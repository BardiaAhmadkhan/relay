import { LocalInspectionAdapter } from '../packages/vision/inspection';
import { markIncompleteObservation } from '../packages/vision/cache-policy';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { createApp } from '../server/app';
import {
  AnalysisResponseSchema,
  Questions,
  SCHEMA_VERSION,
  type AnalysisRequest,
  type Observation,
  type VisionImage,
} from '../packages/core/schema';

// These adapters are local test doubles. Even an "openai" identity never calls a provider.
const stamp = '2026-10-26T12:00:00.000Z';
const apps: ReturnType<typeof createApp>[] = [];
let fixtureImages: AnalysisRequest['images'];

async function patternedImage(seed: number, background?: number) {
  const width = 480,
    height = 480;
  const bytes = Buffer.alloc(width * height * 3);
  let state = seed >>> 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const noise = state >>> 27;
      const stripe = ((Math.floor(x / (12 + seed)) + Math.floor(y / 17)) % 2) * 55;
      const at = (y * width + x) * 3;
      bytes[at] = background ?? 65 + stripe + noise;
      bytes[at + 1] = background ?? 90 + stripe + noise;
      bytes[at + 2] = background ?? 110 + stripe + noise;
    }
  }
  return (
    await sharp(bytes, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 90 })
      .toBuffer()
  ).toString('base64');
}

beforeAll(async () => {
  const encoded = await Promise.all([1, 2, 3].map((seed) => patternedImage(seed)));
  fixtureImages = (['front', 'back', 'label'] as const).map((view, index) => ({
    id: 'photo-' + view,
    view,
    base64: encoded[index]!,
  }));
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function request(): AnalysisRequest {
  return {
    schemaVersion: SCHEMA_VERSION,
    assessmentId: 'api-case-1',
    disclosures: Questions.map((question, index) => ({
      id: 'event-' + index,
      question,
      answer: 'no',
      recordedAt: stamp,
    })),
    corrections: [],
    images: fixtureImages.map((image) => ({ ...image })),
    consent: { processImages: true, externalProvider: false },
  };
}

function observation(
  provider: Observation['provider'] = 'test',
  model = 'fixture-model',
): Observation {
  return {
    schemaVersion: SCHEMA_VERSION,
    category: 'motorcycle_jacket',
    attributes: [],
    concerns: [],
    missingViews: [],
    multipleItems: false,
    provider,
    model,
    coverage: 'visual_observations',
    durationMs: 2,
    usage: null,
  };
}

function adapter(provider: Observation['provider'] = 'test') {
  const model = 'fixture-model';
  const analyze = vi.fn(
    async (_images: VisionImage[], _signal?: AbortSignal): Promise<Observation> =>
      observation(provider, model),
  );
  return { id: provider, model, analyze };
}

function start(options: Parameters<typeof createApp>[0]) {
  const app = createApp(options);
  apps.push(app);
  return app;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('API intake and deterministic preflight', () => {
  it('processes three distinct synthetic views through the injected adapter and a strict safe response', async () => {
    const provider = adapter();
    const app = start({ adapter: provider });
    const response = await app.inject({ method: 'POST', url: '/assess', payload: request() });
    expect(response.statusCode).toBe(200);
    const body = AnalysisResponseSchema.parse(response.json());
    expect(body.status).toBe('complete');
    expect(body.photos).toHaveLength(3);
    expect(new Set(body.photos.map((photo) => photo.sha256)).size).toBe(3);
    expect(body.photos.every((photo) => photo.quality.warnings.length === 0)).toBe(true);
    expect(body.observation?.provider).toBe('test');
    expect(body.decision.state).toBe('human_inspection');
    expect(body.decision.offerRecommended).toBe(false);
    expect(body.decision.protectivePerformanceCertified).toBe(false);
    expect(provider.analyze).toHaveBeenCalledTimes(1);
    const [images, signal] = provider.analyze.mock.calls[0]!;
    expect(images.map((image) => image.id)).toEqual(fixtureImages.map((image) => image.id));
    expect(images.every((image) => image.jpeg.byteLength > 0)).toBe(true);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.body).not.toContain(fixtureImages[0]!.base64);
  });

  it.each(Questions)(
    'a positive %s history excludes before decoding or inference',
    async (question) => {
      const provider = adapter('openai');
      const app = start({ adapter: provider });
      const input = request();
      input.disclosures = input.disclosures.map((event) =>
        event.question === question ? { ...event, answer: 'yes' } : event,
      );
      // Structurally valid transport containing corrupt image bytes proves image processing is bypassed.
      input.images = [
        { id: 'corrupt', view: 'front', base64: Buffer.alloc(90, 1).toString('base64') },
      ];
      const response = await app.inject({ method: 'POST', url: '/assess', payload: input });
      expect(response.statusCode).toBe(200);
      const body = AnalysisResponseSchema.parse(response.json());
      expect(body.status).toBe('excluded');
      expect(body.photos).toEqual([]);
      expect(body.observation).toBeNull();
      expect(body.decision.state).toBe('not_eligible');
      expect(body.decision.reasons.some((reason) => reason.code === question)).toBe(true);
      expect(provider.analyze).not.toHaveBeenCalled();
    },
  );

  it('does not erase a positive disclosure when a later event changes it to no', async () => {
    const provider = adapter();
    const app = start({ adapter: provider });
    const input = request();
    input.disclosures.unshift({
      id: 'prior-crash',
      question: 'crash',
      answer: 'yes',
      recordedAt: stamp,
    });
    const response = await app.inject({ method: 'POST', url: '/assess', payload: input });
    expect(response.json().decision.state).toBe('not_eligible');
    expect(provider.analyze).not.toHaveBeenCalled();
  });

  it.each(['missing-history', 'unknown-history', 'missing-view', 'dark-image'] as const)(
    'keeps history unresolved but only blocks visual inference for unusable images: %s',
    async (scenario) => {
      const provider = adapter();
      const app = start({ adapter: provider });
      const input = request();
      if (scenario === 'missing-history') input.disclosures = [];
      if (scenario === 'unknown-history') input.disclosures[0]!.answer = 'unknown';
      if (scenario === 'missing-view') input.images = input.images.slice(0, 2);
      if (scenario === 'dark-image') input.images[0]!.base64 = await patternedImage(4, 0);
      const response = await app.inject({ method: 'POST', url: '/assess', payload: input });
      expect(response.statusCode).toBe(200);
      const body = AnalysisResponseSchema.parse(response.json());
      expect(body.decision.state).toBe('more_information');
      expect(body.decision.offerRecommended).toBe(false);
      if (scenario === 'dark-image') {
        expect(body.observation).toBeNull();
        expect(provider.analyze).not.toHaveBeenCalled();
      } else {
        expect(body.observation).not.toBeNull();
        expect(provider.analyze).toHaveBeenCalledOnce();
      }
    },
  );

  it.each([
    [
      'client approval field',
      (input: AnalysisRequest) => ({ ...input, decision: { state: 'ready_for_review' } }),
    ],
    [
      'processing consent denied',
      (input: AnalysisRequest) => ({
        ...input,
        consent: { processImages: false, externalProvider: false },
      }),
    ],
    [
      'missing schema version',
      (input: AnalysisRequest) => ({ ...input, schemaVersion: undefined }),
    ],
    [
      'duplicate image ids',
      (input: AnalysisRequest) => ({ ...input, images: [input.images[0], input.images[0]] }),
    ],
    [
      'remote URL instead of bytes',
      (input: AnalysisRequest) => ({
        ...input,
        images: [{ ...input.images[0], base64: 'https://example.invalid/private-image' }],
      }),
    ],
  ] as const)('rejects %s at the HTTP boundary without inference', async (_name, change) => {
    const provider = adapter();
    const app = start({ adapter: provider });
    const response = await app.inject({
      method: 'POST',
      url: '/assess',
      payload: change(request()),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_request');
    expect(provider.analyze).not.toHaveBeenCalled();
  });

  it('rejects corrupt image contents without leaking bytes or calling inference', async () => {
    const provider = adapter();
    const app = start({ adapter: provider });
    const input = request();
    input.images[0]!.base64 = Buffer.alloc(90, 1).toString('base64');
    const response = await app.inject({ method: 'POST', url: '/assess', payload: input });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('invalid_image');
    expect(response.body).not.toContain(input.images[0]!.base64);
    expect(provider.analyze).not.toHaveBeenCalled();
  });

  it('rejects duplicate photo content even when its view and identifier differ', async () => {
    const provider = adapter();
    const app = start({ adapter: provider });
    const input = request();
    input.images[1]!.base64 = input.images[0]!.base64;
    const response = await app.inject({ method: 'POST', url: '/assess', payload: input });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('duplicate_photo');
    expect(provider.analyze).not.toHaveBeenCalled();
  });
});

describe('authentication and external image-processing consent', () => {
  it('protects health, analysis and session deletion without leaking the configured token', async () => {
    const provider = adapter();
    const token = 'local-test-access-token';
    const app = start({ adapter: provider, token });
    for (const endpoint of [
      { method: 'GET' as const, url: '/health' },
      { method: 'POST' as const, url: '/assess', payload: request() },
      { method: 'DELETE' as const, url: '/session' },
    ]) {
      const response = await app.inject(endpoint);
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('unauthorized');
      expect(response.body).not.toContain(token);
    }
    const wrong = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-relay-token': 'local-test-access-tokex' },
    });
    expect(wrong.statusCode).toBe(401);
    const allowed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-relay-token': token },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().provider).toBe('test');
    expect(provider.analyze).not.toHaveBeenCalled();
  });

  it('allows authenticated assessment and preflight while only echoing allowed CORS origins', async () => {
    const provider = adapter();
    const app = start({ adapter: provider, token: 'test-token' });
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/assess',
      headers: {
        origin: 'http://localhost:8081',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'X-Relay-Token,Content-Type',
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:8081');
    const allowed = await app.inject({
      method: 'POST',
      url: '/assess',
      payload: request(),
      headers: { 'x-relay-token': 'test-token', origin: 'http://localhost:8081' },
    });
    expect(allowed.statusCode).toBe(200);
    const other = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-relay-token': 'test-token', origin: 'https://untrusted.invalid' },
    });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it.each(['openai', 'gemini'] as const)(
    'requires explicit consent for the %s adapter identity',
    async (id) => {
      const provider = adapter(id);
      const app = start({ adapter: provider });
      const denied = await app.inject({ method: 'POST', url: '/assess', payload: request() });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.code).toBe('external_consent_required');
      expect(provider.analyze).not.toHaveBeenCalled();
      const input = request();
      input.consent = {
        processImages: true,
        externalProvider: true,
        expectedProvider: id,
        expectedModel: provider.model,
      };
      const allowed = await app.inject({ method: 'POST', url: '/assess', payload: input });
      expect(allowed.statusCode).toBe(200);
      const result = AnalysisResponseSchema.parse(allowed.json());
      expect(result.decision.state).toBe('ready_for_review');
      expect(result.decision.offerRecommended).toBe(false);
      expect(result.decision.protectivePerformanceCertified).toBe(false);
      expect(provider.analyze).toHaveBeenCalledTimes(1);
    },
  );

  it('does not reuse a previously consented external result after consent is withdrawn', async () => {
    const provider = adapter('openai');
    const app = start({ adapter: provider });
    const consented = request();
    consented.consent = {
      processImages: true,
      externalProvider: true,
      expectedProvider: provider.id,
      expectedModel: provider.model,
    };
    expect(
      (await app.inject({ method: 'POST', url: '/assess', payload: consented })).statusCode,
    ).toBe(200);
    const denied = await app.inject({ method: 'POST', url: '/assess', payload: request() });
    expect(denied.statusCode).toBe(403);
    expect(provider.analyze).toHaveBeenCalledTimes(1);
  });
});

describe('external consent is bound to the actual provider and model', () => {
  it.each(['openai', 'gemini'] as const)(
    'rejects a true checkbox without an identity binding for %s',
    (id) => {
      return (async () => {
        const provider = adapter(id);
        const app = start({ adapter: provider });
        const input = request();
        input.consent.externalProvider = true;
        const response = await app.inject({ method: 'POST', url: '/assess', payload: input });
        expect(response.statusCode).toBe(409);
        expect(response.json().error.code).toBe('provider_changed');
        expect(response.json()).not.toHaveProperty('decision');
        expect(provider.analyze).not.toHaveBeenCalled();
      })();
    },
  );

  it.each([
    ['different provider', { expectedProvider: 'gemini', expectedModel: 'fixture-model' }],
    ['different model', { expectedProvider: 'openai', expectedModel: 'previous-model' }],
    ['missing provider', { expectedModel: 'fixture-model' }],
    ['missing model', { expectedProvider: 'openai' }],
  ] as const)('rejects %s before image processing or inference', async (_name, binding) => {
    const provider = adapter('openai');
    const app = start({ adapter: provider });
    const input = request();
    const payload = {
      ...input,
      consent: { processImages: true, externalProvider: true, ...binding },
    };
    payload.images[0]!.base64 = Buffer.alloc(90, 1).toString('base64');
    const response = await app.inject({ method: 'POST', url: '/assess', payload });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('provider_changed');
    expect(response.json()).not.toHaveProperty('decision');
    expect(provider.analyze).not.toHaveBeenCalled();
  });

  it('does not treat an identity binding as image-sharing consent', async () => {
    const provider = adapter('openai');
    const app = start({ adapter: provider });
    const input = request();
    const response = await app.inject({
      method: 'POST',
      url: '/assess',
      payload: {
        ...input,
        consent: { ...input.consent, expectedProvider: provider.id, expectedModel: provider.model },
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('external_consent_required');
    expect(provider.analyze).not.toHaveBeenCalled();
  });

  it('closes the health-to-upload model-change race and permits explicit consent to the new model', async () => {
    const provider = adapter('openai');
    provider.analyze.mockImplementation(async () => observation(provider.id, provider.model));
    const app = start({ adapter: provider });
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    const approved = health.json() as { provider: string; model: string };
    const input = request();
    const stalePayload = {
      ...input,
      consent: {
        processImages: true,
        externalProvider: true,
        expectedProvider: approved.provider,
        expectedModel: approved.model,
      },
    };
    provider.model = 'newly-configured-model';
    const denied = await app.inject({ method: 'POST', url: '/assess', payload: stalePayload });
    expect(denied.statusCode).toBe(409);
    expect(denied.json().error.code).toBe('provider_changed');
    expect(provider.analyze).not.toHaveBeenCalled();
    const updated = {
      ...input,
      consent: {
        processImages: true,
        externalProvider: true,
        expectedProvider: provider.id,
        expectedModel: provider.model,
      },
    };
    const accepted = await app.inject({ method: 'POST', url: '/assess', payload: updated });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().observation.model).toBe('newly-configured-model');
    expect(accepted.json().decision.offerRecommended).toBe(false);
    expect(provider.analyze).toHaveBeenCalledTimes(1);
  });
});

describe('untrusted provider output', () => {
  it.each([
    ['unstructured result', (): unknown => 'private-provider-details'],
    ['unknown decision field', () => ({ ...observation(), approved: true })],
    [
      'unknown attribute image',
      () => ({
        ...observation(),
        attributes: [
          { field: 'brand', value: 'Example', kind: 'visible_text', imageIds: ['not-in-request'] },
        ],
      }),
    ],
    [
      'unknown concern image',
      () => ({
        ...observation(),
        concerns: [{ kind: 'repair', area: 'protective', imageId: 'not-in-request' }],
      }),
    ],
    ['spoofed provider identity', () => ({ ...observation(), provider: 'openai' })],
    ['spoofed model identity', () => ({ ...observation(), model: 'another-model' })],
  ] as const)('returns unavailable for %s and permits a clean retry', async (_name, malformed) => {
    const provider = adapter();
    provider.analyze.mockResolvedValueOnce(malformed() as unknown as Observation);
    const app = start({ adapter: provider });
    const response = await app.inject({ method: 'POST', url: '/assess', payload: request() });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('analysis_unavailable');
    expect(response.json()).not.toHaveProperty('decision');
    expect(response.body).not.toContain('private-provider-details');
    const retry = await app.inject({ method: 'POST', url: '/assess', payload: request() });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().timing.cached).toBe(false);
    expect(provider.analyze).toHaveBeenCalledTimes(2);
  });

  it('rejects a local model claiming condition-observation scope', async () => {
    const provider = adapter('local_clip');
    const app = start({ adapter: provider });
    const response = await app.inject({ method: 'POST', url: '/assess', payload: request() });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('analysis_unavailable');
  });

  it('accepts category-only local observations without unlocking review readiness', async () => {
    const provider = adapter('local_clip');
    provider.analyze.mockResolvedValue({ ...observation('local_clip'), coverage: 'category_only' });
    const app = start({ adapter: provider });
    const response = await app.inject({ method: 'POST', url: '/assess', payload: request() });
    expect(response.statusCode).toBe(200);
    expect(response.json().decision.state).toBe('human_inspection');
  });
});

describe('bounded inference, coalescing and cache lifecycle', () => {
  it('coalesces identical concurrent requests and rejects a different concurrent assessment', async () => {
    const provider = adapter();
    const entered = deferred<void>();
    const result = deferred<Observation>();
    provider.analyze.mockImplementation(async () => {
      entered.resolve();
      return result.promise;
    });
    const app = start({ adapter: provider, timeoutMs: 5_000 });
    const first = app.inject({ method: 'POST', url: '/assess', payload: request() });
    await entered.promise;
    try {
      const second = app.inject({ method: 'POST', url: '/assess', payload: request() });
      const busy = await app.inject({
        method: 'POST',
        url: '/assess',
        payload: { ...request(), assessmentId: 'different-case' },
      });
      expect(busy.statusCode).toBe(429);
      expect(busy.headers['retry-after']).toBe('2');
      expect(provider.analyze).toHaveBeenCalledTimes(1);
      result.resolve(observation());
      const responses = await Promise.all([first, second]);
      for (const response of responses) {
        expect(response.statusCode).toBe(200);
        expect(response.json().assessmentId).toBe('api-case-1');
      }
      expect(provider.analyze).toHaveBeenCalledTimes(1);
      const cached = await app.inject({ method: 'POST', url: '/assess', payload: request() });
      expect(cached.json().timing.cached).toBe(true);
    } finally {
      result.resolve(observation());
      await first;
    }
  });

  it('keys cache by the entire assessment and expires it after the configured lifetime', async () => {
    let now = 1;
    const provider = adapter();
    const app = start({ adapter: provider, now: () => now });
    const first = await app.inject({ method: 'POST', url: '/assess', payload: request() });
    expect(first.json().timing.cached).toBe(false);
    const cached = await app.inject({ method: 'POST', url: '/assess', payload: request() });
    expect(cached.json().timing.cached).toBe(true);
    expect(provider.analyze).toHaveBeenCalledTimes(1);
    const changed = request();
    changed.corrections.push({ field: 'brand', value: 'Rider correction', recordedAt: stamp });
    expect(
      (await app.inject({ method: 'POST', url: '/assess', payload: changed })).json().timing.cached,
    ).toBe(false);
    expect(provider.analyze).toHaveBeenCalledTimes(2);
    const other = { ...request(), assessmentId: 'another-item' };
    expect(
      (await app.inject({ method: 'POST', url: '/assess', payload: other })).json().assessmentId,
    ).toBe('another-item');
    expect(provider.analyze).toHaveBeenCalledTimes(3);
    now += 10 * 60 * 1000;
    expect(
      (await app.inject({ method: 'POST', url: '/assess', payload: request() })).json().timing
        .cached,
    ).toBe(false);
    expect(provider.analyze).toHaveBeenCalledTimes(4);
  });

  it('clears settled cache entries through the session endpoint', async () => {
    const provider = adapter();
    const app = start({ adapter: provider });
    await app.inject({ method: 'POST', url: '/assess', payload: request() });
    const cleared = await app.inject({ method: 'DELETE', url: '/session' });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().cleared).toBe(true);
    const again = await app.inject({ method: 'POST', url: '/assess', payload: request() });
    expect(again.json().timing.cached).toBe(false);
    expect(provider.analyze).toHaveBeenCalledTimes(2);
  });

  it('does not repopulate a cleared cache when older in-flight work finishes', async () => {
    const provider = adapter();
    const entered = deferred<void>();
    const result = deferred<Observation>();
    provider.analyze.mockImplementationOnce(async () => {
      entered.resolve();
      return result.promise;
    });
    const app = start({ adapter: provider, timeoutMs: 5_000 });
    const pending = app.inject({ method: 'POST', url: '/assess', payload: request() });
    await entered.promise;
    try {
      const cleared = await app.inject({ method: 'DELETE', url: '/session' });
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json().cleared).toBe(true);
      result.resolve(observation());
      await pending;
      const fresh = await app.inject({ method: 'POST', url: '/assess', payload: request() });
      expect(fresh.statusCode).toBe(200);
      expect(fresh.json().timing.cached).toBe(false);
      expect(provider.analyze).toHaveBeenCalledTimes(2);
    } finally {
      result.resolve(observation());
      await pending;
    }
  });

  it('times out, aborts the adapter signal, keeps a busy kernel bounded and never caches its late result', async () => {
    const provider = adapter();
    const entered = deferred<void>();
    const late = deferred<Observation>();
    let signal: AbortSignal | undefined;
    provider.analyze.mockImplementationOnce(async (_images, suppliedSignal) => {
      signal = suppliedSignal;
      entered.resolve();
      return late.promise;
    });
    const app = start({ adapter: provider, timeoutMs: 250 });
    const pending = app.inject({ method: 'POST', url: '/assess', payload: request() });
    await entered.promise;
    try {
      const timeout = await pending;
      expect(timeout.statusCode).toBe(503);
      expect(timeout.json().error.code).toBe('analysis_unavailable');
      expect(timeout.json()).not.toHaveProperty('decision');
      expect(signal?.aborted).toBe(true);
      const busy = await app.inject({
        method: 'POST',
        url: '/assess',
        payload: { ...request(), assessmentId: 'while-kernel-runs' },
      });
      expect(busy.statusCode).toBe(429);
      expect(provider.analyze).toHaveBeenCalledTimes(1);
      late.resolve(observation());
      await nextTurn();
      const retry = await app.inject({ method: 'POST', url: '/assess', payload: request() });
      expect(retry.statusCode).toBe(200);
      expect(retry.json().timing.cached).toBe(false);
      expect(provider.analyze).toHaveBeenCalledTimes(2);
    } finally {
      late.resolve(observation());
      await pending;
    }
  });
});

it('inspects usable local photos even when another view is black, while retaining every photo in the record', async () => {
  const provider = adapter('local_vlm');
  provider.analyze.mockImplementation(async (images) => ({
    ...observation('local_vlm'),
    inspection: {
      version: 'photo-evidence-1',
      photos: images.map((image) => ({
        imageId: image.id,
        category: 'motorcycle_jacket',
        material: 'textile',
        crashPattern: 'consistent_with_sliding',
        findings: [
          {
            zone: 'elbow',
            kind: 'tear',
            clarity: 'clear',
            evidence: 'Ragged torn sleeve with exposed fibers',
          },
        ],
      })),
    },
  }));
  const app = start({ adapter: provider });
  const payload = request();
  payload.disclosures = [];
  payload.images = [
    fixtureImages[0]!,
    { id: 'black-detail', view: 'detail', base64: await patternedImage(8, 0) },
  ];
  payload.consent.expectedProvider = 'local_vlm';
  payload.consent.expectedModel = 'fixture-model';
  const response = await app.inject({ method: 'POST', url: '/assess', payload });
  expect(response.statusCode).toBe(200);
  const body = response.json();
  expect(body.photos).toHaveLength(2);
  expect(provider.analyze.mock.calls[0]![0].map((p) => p.id)).toEqual(['photo-front']);
  expect(body.observation.inspection.photos).toHaveLength(1);
  expect(body.decision.title).toBe('Crash-like damage detected');
  expect(body.decision.offerRecommended).toBe(false);
});

describe('real HTTP inference deadline', () => {
  it('returns a slow result and its coalesced request without a 10s socket disconnect', async () => {
    const entered = deferred<void>();
    const provider = adapter();
    provider.analyze.mockImplementationOnce(async () => {
      entered.resolve();
      await new Promise<void>((resolve) => setTimeout(resolve, 11_000));
      return observation();
    });
    const app = start({ adapter: provider });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const send = (payload = request()) =>
      fetch(address + '/assess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(18_000),
      });
    const pending = send();
    await entered.promise;
    const duplicate = send();
    const busy = await send({ ...request(), assessmentId: 'different-slow-assessment' });
    expect(busy.status).toBe(429);
    expect(busy.headers.get('retry-after')).toBe('2');
    await busy.json();
    const responses = await Promise.all([pending, duplicate]);
    for (const response of responses) {
      expect(response.status).toBe(200);
      const body = AnalysisResponseSchema.parse(await response.json());
      expect(body.status).toBe('complete');
      expect(body.decision.offerRecommended).toBe(false);
      expect(body.timing.cached).toBe(false);
    }
    expect(provider.analyze).toHaveBeenCalledTimes(1);
    const cached = await send();
    expect(cached.status).toBe(200);
    expect((await cached.json()).timing.cached).toBe(true);
    expect(provider.analyze).toHaveBeenCalledTimes(1);
  }, 20_000);

  it('returns the bounded 503 over HTTP and aborts inference instead of disconnecting', async () => {
    const provider = adapter();
    let aborted = false;
    provider.analyze.mockImplementationOnce(async (_images, signal) => {
      await new Promise<void>((_resolve, reject) => {
        signal!.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(new Error('aborted'));
          },
          { once: true },
        );
      });
      return observation();
    });
    const app = start({ adapter: provider, timeoutMs: 200 });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const response = await fetch(address + '/assess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request()),
      signal: AbortSignal.timeout(3_000),
    });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('analysis_unavailable');
    expect(aborted).toBe(true);
  });
});

describe('optional-stage completion across both cache layers', () => {
  it('retries a failed focus through the same HTTP request, then caches the complete result', async () => {
    let inspections = 0,
      grounds = 0;
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      let content: any;
      if (body.format.properties.box) {
        if (++grounds === 1) throw Error('temporary_focus_failure');
        content = { target: 'wearable_item', box: [350, 200, 600, 700] };
      } else if (body.format.properties.findings)
        content = {
          category: 'trousers',
          material: 'denim',
          crashPattern: 'unclear',
          findings:
            ++inspections === 3
              ? [
                  {
                    evidence: 'Ragged hole with frayed edges',
                    kind: 'tear',
                    zone: 'unknown',
                    clarity: 'clear',
                  },
                ]
              : [],
        };
      else content = { supported: [0], uncertain: [], crashPattern: 'unclear' };
      return new Response(
        JSON.stringify({
          model: 'qwen3.5:4b',
          done: true,
          done_reason: 'stop',
          message: { content: JSON.stringify(content) },
        }),
      );
    });
    const provider = new LocalInspectionAdapter(
      'qwen3.5:4b',
      'd8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04',
      'http://127.0.0.1:11435',
      fetcher as typeof fetch,
    );
    const app = start({ adapter: provider });
    const payload = { ...request(), images: [fixtureImages[0]!] };
    try {
      const first = await app.inject({ method: 'POST', url: '/assess', payload });
      expect(first.statusCode).toBe(200);
      expect(first.json().observation.inspection.photos[0].findings).toEqual([]);
      const second = await app.inject({ method: 'POST', url: '/assess', payload });
      expect(second.statusCode).toBe(200);
      expect(second.json().timing.cached).toBe(false);
      expect(second.json().observation.inspection.photos[0].findings[0]?.kind).toBe('tear');
      expect(grounds).toBe(2);
      const n = fetcher.mock.calls.length;
      const third = await app.inject({ method: 'POST', url: '/assess', payload });
      expect(third.json().timing.cached).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(n);
      expect(third.json().decision.offerRecommended).toBe(false);
    } finally {
      provider.clearCache();
    }
  });
  it('does not evict a completed HTTP cache entry when an incomplete result is not inserted', async () => {
    const provider = adapter();
    let calls = 0;
    provider.analyze.mockImplementation(async () => {
      const result = observation();
      return ++calls === 25 ? markIncompleteObservation(result) : result;
    });
    const app = start({ adapter: provider });
    const first = { ...request(), assessmentId: 'cache-complete-0', images: [fixtureImages[0]!] };
    for (let i = 0; i < 24; i++)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/assess',
            payload: { ...first, assessmentId: 'cache-complete-' + i },
          })
        ).statusCode,
      ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/assess',
          payload: { ...first, assessmentId: 'incomplete' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: '/assess', payload: first })).json().timing.cached,
    ).toBe(true);
    expect(provider.analyze).toHaveBeenCalledTimes(25);
  });
});
