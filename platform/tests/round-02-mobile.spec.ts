import { test, expect, type Page, type Route, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { decide } from '../packages/core/policy';
import {
  POLICY_VERSION,
  SCHEMA_VERSION,
  type AnalysisRequest,
  type AnalysisResponse,
  type Observation,
} from '../packages/core/schema';

const run = process.env.RELAY_ROUND02_RUN ?? 'baseline';
const root = process.cwd();
const fixtures = path.join(root, 'experiments/round-02/experience/fixtures');
const outputs = path.join(root, 'benchmarks/round-02/experience', run);
const questions = [
  'Has it been worn in a crash?',
  'Any damage in a protective area?',
  'Any repairs in a protective area?',
];
const coreConsent = 'Allow these photos to be processed by the selected Relay service';
const externalConsent = 'Allow external provider image processing';
const local = {
  status: 'ok',
  schemaVersion: SCHEMA_VERSION,
  policyVersion: POLICY_VERSION,
  provider: 'local_clip',
  model: 'round02-disclosed-local-double',
  externalProvider: false,
};
const external = {
  ...local,
  provider: 'openai',
  model: 'round02-disclosed-external-double',
  externalProvider: true,
};
type Health = typeof local;
type StoredDraft = {
  id: string;
  photos: Array<{ id: string; view: string; uri: string }>;
  disclosures: AnalysisRequest['disclosures'];
  result: AnalysisResponse | null;
  corrections: AnalysisRequest['corrections'];
};

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release };
}
async function draft(page: Page): Promise<StoredDraft> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('relay.draft.v1') ?? 'null'));
}
async function saveRecord(info: TestInfo, name: string, value: unknown) {
  await fs.mkdir(outputs, { recursive: true });
  const safe = info.title.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 100);
  const file = path.join(outputs, safe + '-' + name + '.json');
  await fs.writeFile(file, JSON.stringify(value, null, 2));
  await info.attach(name, { path: file, contentType: 'application/json' });
}
async function capture(page: Page, info: TestInfo, name: string) {
  const file = path.join(
    outputs,
    info.title.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 85) + '-' + name + '.png',
  );
  await fs.mkdir(outputs, { recursive: true });
  await page.screenshot({ path: file, fullPage: true });
  await info.attach(name, { path: file, contentType: 'image/png' });
}
async function choose(page: Page, index: number) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose a photograph', exact: true }).click();
  await (await chooser).setFiles(path.join(fixtures, index + '.png'));
}
async function captured(page: Page) {
  await page.getByRole('button', { name: 'Start a gear check', exact: true }).click();
  await page.getByRole('button', { name: 'Add item history', exact: true }).click();
  for (const question of questions)
    await page.getByRole('radio', { name: question + ' No', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to photos', exact: true }).click();
  for (let i = 0; i < 3; i++) {
    await page
      .getByRole('button', { name: ['Front', 'Back', 'Label'][i] + ' photo needed', exact: true })
      .click();
    await choose(page, i);
    await expect(
      page.getByRole('button', {
        name: ['Front', 'Back', 'Label'][i] + ' photo captured',
        exact: true,
      }),
    ).toBeVisible();
  }
  await page.getByRole('checkbox', { name: coreConsent, exact: true }).check();
  await expect.poll(async () => (await draft(page))?.photos.length).toBe(3);
}
function response(
  input: AnalysisRequest,
  health: Health = local,
  changes: Partial<Observation> = {},
): AnalysisResponse {
  const photos = input.images.map((image, index) => ({
    id: image.id,
    view: image.view,
    sha256: String(index + 1).repeat(64),
    byteLength: 1000 + index,
    quality: { width: 720, height: 960, brightness: 130, sharpness: 100, warnings: [] },
  }));
  const observation = {
    schemaVersion: SCHEMA_VERSION,
    category: 'motorcycle_jacket' as const,
    attributes: [],
    concerns: [],
    missingViews: [],
    multipleItems: false,
    provider: health.provider as Observation['provider'],
    model: health.model,
    coverage: health.externalProvider
      ? ('visual_observations' as const)
      : ('category_only' as const),
    durationMs: 1,
    usage: null,
    ...changes,
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    assessmentId: input.assessmentId,
    status: 'complete',
    photos,
    observation,
    decision: decide({
      disclosures: input.disclosures,
      photos,
      observation,
      corrections: input.corrections,
    }),
    timing: { totalMs: 2, preprocessingMs: 1, inferenceMs: 1, cached: false },
  };
}
async function serve(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
async function goodRoutes(page: Page, health: Health = local) {
  await page.route('**/health', (route) => serve(route, health));
  await page.route('**/assess', (route) =>
    serve(route, response(route.request().postDataJSON(), health)),
  );
}
async function analyzeToEvidence(page: Page) {
  await page.getByRole('button', { name: 'Review the evidence', exact: true }).click();
  await expect(page.getByText('Model inference · not verified', { exact: true })).toBeVisible();
}
async function allowExternal(page: Page) {
  await page.getByRole('button', { name: 'Review the evidence', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: externalConsent, exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: externalConsent, exact: true }).check();
}
async function noLostPhotos(page: Page, before: StoredDraft) {
  const after = await draft(page);
  expect(after.id).toBe(before.id);
  expect(after.photos.map((p) => [p.view, p.id])).toEqual(before.photos.map((p) => [p.view, p.id]));
}
async function scaleText(page: Page, factor: number) {
  return page.evaluate((factor) => {
    const nodes = [...document.querySelectorAll<HTMLElement>('body *')].filter(
      (el) =>
        [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) ||
        el.matches('input,textarea'),
    );
    const base = nodes.map((el) => ({
      el,
      size: parseFloat(getComputedStyle(el).fontSize),
      line: parseFloat(getComputedStyle(el).lineHeight),
    }));
    for (const { el, size, line } of base) {
      if (Number.isFinite(size)) el.style.fontSize = size * factor + 'px';
      if (Number.isFinite(line)) el.style.lineHeight = line * factor + 'px';
    }
    return base.length;
  }, factor);
}

test.beforeAll(async () => {
  await fs.mkdir(fixtures, { recursive: true });
  await fs.mkdir(outputs, { recursive: true });
  for (let i = 0; i < 5; i++) {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="960"><rect width="720" height="960" fill="' +
      ['#C2C9AD', '#C8B7A6', '#9DACB3', '#BCBD9F', '#BEA9A1'][i] +
      '"/><path d="M30 40h660v840H30Z M80 ' +
      (160 + i * 50) +
      'h560v280H80Z" stroke="#314136" stroke-width="12" fill="none"/><text x="55" y="700" font-size="30">ROUND 02 SYNTHETIC ' +
      i +
      '</text><text x="55" y="750" font-size="28">NOT GEAR EVIDENCE</text></svg>';
    await sharp(Buffer.from(svg))
      .png()
      .toFile(path.join(fixtures, i + '.png'));
  }
});
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start a gear check', exact: true })).toBeVisible({
    timeout: 30000,
  });
});

test('R01 replacement and optional detail preserve other views and invalidate prior analysis', async ({
  page,
}, info) => {
  await captured(page);
  await goodRoutes(page);
  await analyzeToEvidence(page);
  const before = await draft(page);
  expect(before.result).not.toBeNull();
  await page.getByRole('button', { name: 'Revisit photographs', exact: true }).click();
  await page.getByRole('button', { name: 'Front photo captured', exact: true }).click();
  await choose(page, 3);
  await expect
    .poll(async () => (await draft(page)).photos.find((p) => p.view === 'front')?.id)
    .not.toBe(before.photos.find((p) => p.view === 'front')?.id);
  const replaced = await draft(page);
  expect(replaced.result).toBeNull();
  for (const view of ['back', 'label'])
    expect(replaced.photos.find((p) => p.view === view)?.id).toBe(
      before.photos.find((p) => p.view === view)?.id,
    );
  await page.getByRole('button', { name: 'Detail photo needed', exact: true }).click();
  await choose(page, 4);
  await expect.poll(async () => (await draft(page)).photos.length).toBe(4);
  await analyzeToEvidence(page);
  const after = await draft(page);
  expect(after.result?.photos.map((p) => p.id).sort()).toEqual(
    after.photos.map((p) => p.id).sort(),
  );
  await saveRecord(info, 'view-integrity', {
    before: before.photos.map((p) => ({ id: p.id, view: p.view })),
    after: after.photos.map((p) => ({ id: p.id, view: p.view })),
    resultInvalidated: replaced.result === null,
  });
});

test('R02 missing-label result targets label replacement and retains the other evidence', async ({
  page,
}, info) => {
  await captured(page);
  let count = 0;
  await page.route('**/health', (route) => serve(route, external));
  await page.route('**/assess', (route) =>
    serve(
      route,
      response(route.request().postDataJSON(), external, {
        missingViews: ++count === 1 ? ['label'] : [],
      }),
    ),
  );
  await allowExternal(page);
  await analyzeToEvidence(page);
  const before = await draft(page);
  await page.getByRole('button', { name: 'See the next step', exact: true }).click();
  await page.getByRole('button', { name: 'Add the label view', exact: true }).click();
  await expect(page.getByText('Get close to the label', { exact: true })).toBeVisible();
  await choose(page, 3);
  await expect
    .poll(async () => (await draft(page)).photos.find((p) => p.view === 'label')?.id)
    .not.toBe(before.photos.find((p) => p.view === 'label')?.id);
  for (const view of ['front', 'back'])
    expect((await draft(page)).photos.find((p) => p.view === view)?.id).toBe(
      before.photos.find((p) => p.view === view)?.id,
    );
  await analyzeToEvidence(page);
  await page.getByRole('button', { name: 'See the next step', exact: true }).click();
  await expect(page.getByText('Ready for specialist review', { exact: true })).toBeVisible();
  await saveRecord(info, 'deterministic-fixture', {
    requests: count,
    mode: 'Routed synthetic observations only; no external call or real condition evaluation.',
  });
});

test('R03 unreadable replacement is recoverable and preserves the existing full photo set', async ({
  page,
}, info) => {
  await captured(page);
  const before = await draft(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose a photograph', exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: 'corrupt.png',
    mimeType: 'image/png',
    buffer: Buffer.from('ROUND 02 INTENTIONALLY CORRUPT IMAGE'),
  });
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 8000 });
  await noLostPhotos(page, before);
  await expect(
    page.getByRole('button', { name: 'Choose a photograph', exact: true }),
  ).toBeEnabled();
  await capture(page, info, 'corrupt-replacement');
});

for (const mode of ['network', 'http503', 'http401', 'incompatible-health'] as const) {
  test('R04 health ' + mode + ' keeps photos and permits recovery', async ({ page }, info) => {
    await captured(page);
    const before = await draft(page);
    let healthy = false,
      uploads = 0;
    await page.route('**/health', (route) =>
      healthy
        ? serve(route, local)
        : mode === 'network'
          ? route.abort('failed')
          : mode === 'incompatible-health'
            ? serve(route, { schemaVersion: 'wrong', model: 'bad', externalProvider: false })
            : serve(
                route,
                { error: { message: 'Disclosed health fault' } },
                mode === 'http401' ? 401 : 503,
              ),
    );
    await page.route('**/assess', (route) => {
      uploads++;
      return serve(route, response(route.request().postDataJSON()));
    });
    await page.getByRole('button', { name: 'Review the evidence', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    expect(uploads).toBe(0);
    await noLostPhotos(page, before);
    healthy = true;
    await analyzeToEvidence(page);
    expect(uploads).toBe(1);
    await saveRecord(info, 'recovery', { mode, uploads, photosRetained: true });
  });
}

test('R05 unavailable analysis retains photos and a retry can finish', async ({ page }, info) => {
  await captured(page);
  const before = await draft(page);
  let count = 0;
  await page.route('**/health', (route) => serve(route, local));
  await page.route('**/assess', (route) =>
    ++count === 1
      ? serve(
          route,
          { error: { message: 'Disclosed Round 02 service outage; no model call.' } },
          503,
        )
      : serve(route, response(route.request().postDataJSON())),
  );
  await page.getByRole('button', { name: 'Review the evidence', exact: true }).click();
  await expect(
    page.getByText('Disclosed Round 02 service outage; no model call.', { exact: true }),
  ).toBeVisible();
  await noLostPhotos(page, before);
  await analyzeToEvidence(page);
  expect(count).toBe(2);
  await saveRecord(info, 'retry', { attempts: count, photosRetained: true });
});

test('R06 malformed successful response shows an actionable error without raw schema diagnostics', async ({
  page,
}, info) => {
  await captured(page);
  const before = await draft(page);
  await page.route('**/health', (route) => serve(route, local));
  await page.route('**/assess', (route) => serve(route, { schemaVersion: '1.0' }));
  await page.getByRole('button', { name: 'Review the evidence', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  const text = await page.getByRole('alert').innerText();
  await noLostPhotos(page, before);
  await saveRecord(info, 'visible-error', { text });
  await capture(page, info, 'malformed-response');
  expect(text).not.toMatch(/invalid_type|expected.*string|\[\s*\{|schemaVersion.*path/s);
  expect(text.length).toBeLessThan(400);
  await expect(
    page.getByRole('button', { name: 'Review the evidence', exact: true }),
  ).toBeEnabled();
});

for (const kind of [
  'different-assessment',
  'unrelated-photo-ids',
  'swapped-photo-views',
  'wrong-model',
  'unexpected-external-provider',
] as const) {
  test('R07 response binding rejects ' + kind, async ({ page }, info) => {
    await captured(page);
    const before = await draft(page);
    await page.route('**/health', (route) => serve(route, local));
    await page.route('**/assess', (route) => {
      const value = response(route.request().postDataJSON());
      if (kind === 'different-assessment') value.assessmentId = 'unrelated-assessment';
      if (kind === 'unrelated-photo-ids')
        value.photos = value.photos.map((photo, index) => ({
          ...photo,
          id: 'unrelated-photo-' + index,
        }));
      if (kind === 'swapped-photo-views')
        value.photos = value.photos.map((photo) => ({
          ...photo,
          view: photo.view === 'front' ? 'back' : photo.view === 'back' ? 'front' : photo.view,
        }));
      if (kind === 'wrong-model') value.observation!.model = 'not-the-checked-model';
      if (kind === 'unexpected-external-provider')
        value.observation = {
          ...value.observation!,
          provider: 'openai',
          model: 'unconsented-model',
          coverage: 'visual_observations',
        };
      return serve(route, value);
    });
    await page.getByRole('button', { name: 'Review the evidence', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Cancel analysis', exact: true })).toBeHidden();
    const evidence = page.getByText('Model inference · not verified', { exact: true });
    await expect(page.getByRole('alert').or(evidence)).toBeVisible();
    const after = await draft(page);
    await saveRecord(info, 'binding', {
      kind,
      acceptedResult: after.result !== null,
      observation: after.result?.observation,
      returnedPhotos: after.result?.photos.map((p) => ({ id: p.id, view: p.view })),
      expectedPhotos: before.photos.map((p) => ({ id: p.id, view: p.view })),
    });
    expect(
      after.result,
      'A response for different evidence or an unapproved analysis identity must not become the draft result.',
    ).toBeNull();
    await expect(page.getByRole('alert')).toBeVisible();
    await noLostPhotos(page, before);
  });
}

test('R08 cancellation after upload prevents a late response overwriting replacement or exclusion', async ({
  page,
}, info) => {
  await captured(page);
  const before = await draft(page);
  const hold = gate();
  let uploaded = false;
  await page.route('**/health', (route) => serve(route, local));
  await page.route('**/assess', async (route) => {
    uploaded = true;
    const result = response(route.request().postDataJSON());
    await hold.promise;
    await serve(route, result).catch(() => undefined);
  });
  await page.getByRole('button', { name: 'Review the evidence', exact: true }).click();
  await expect.poll(() => uploaded).toBe(true);
  await page.getByRole('button', { name: 'Cancel analysis', exact: true }).click();
  await page.getByRole('button', { name: 'Front photo captured', exact: true }).click();
  await choose(page, 3);
  await expect
    .poll(async () => (await draft(page)).photos.find((p) => p.view === 'front')?.id)
    .not.toBe(before.photos.find((p) => p.view === 'front')?.id);
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await page.getByRole('radio', { name: questions[0] + ' Yes', exact: true }).click();
  await page.getByRole('button', { name: 'See the next step', exact: true }).click();
  hold.release();
  await expect(page.getByText('Not eligible for an offer', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'View your history answers', exact: true }).click();
  await page.getByRole('button', { name: 'See the next step', exact: true }).click();
  await expect(page.getByText('Not eligible for an offer', { exact: true })).toBeVisible();
  expect((await draft(page)).result).toBeNull();
  await saveRecord(info, 'cancelled-upload', {
    uploaded,
    resultPersisted: (await draft(page)).result,
    exclusionSurvivedReload: true,
  });
});

test('R09 external consent withdrawal during delayed health prevents any upload', async ({
  page,
}, info) => {
  await captured(page);
  const hold = gate();
  let healthCalls = 0,
    uploadCount = 0;
  await page.route('**/health', async (route) => {
    if (++healthCalls === 2) await hold.promise;
    await serve(route, external).catch(() => undefined);
  });
  await page.route('**/assess', (route) => {
    uploadCount++;
    return serve(
      route,
      { error: { message: 'Disclosed test intercepted upload; no provider call.' } },
      503,
    );
  });
  await allowExternal(page);
  await page.getByRole('button', { name: 'Review the evidence', exact: true }).click();
  await expect.poll(() => healthCalls).toBe(2);
  await page.getByRole('checkbox', { name: externalConsent, exact: true }).uncheck();
  hold.release();
  await expect(page.getByRole('button', { name: 'Cancel analysis', exact: true })).toBeHidden();
  await saveRecord(info, 'withdrawal', {
    healthCalls,
    uploadCount,
    checked: await page.getByRole('checkbox', { name: externalConsent, exact: true }).isChecked(),
  });
  expect(
    uploadCount,
    'No upload may start using an invocation-time consent value after the current choice was withdrawn.',
  ).toBe(0);
  await expect(
    page.getByRole('button', { name: 'Front photo captured', exact: true }),
  ).toBeVisible();
});

test('R10 core consent cancellation and reload do not silently reauthorize processing', async ({
  page,
}, info) => {
  await captured(page);
  const hold = gate();
  let healthCalls = 0,
    uploads = 0;
  await page.route('**/health', async (route) => {
    healthCalls++;
    await hold.promise;
    await serve(route, local).catch(() => undefined);
  });
  await page.route('**/assess', (route) => {
    uploads++;
    return route.abort();
  });
  await page.getByRole('button', { name: 'Review the evidence', exact: true }).click();
  await expect.poll(() => healthCalls).toBe(1);
  await expect(page.getByRole('checkbox', { name: coreConsent, exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel analysis', exact: true }).click();
  await page.getByRole('checkbox', { name: coreConsent, exact: true }).uncheck();
  hold.release();
  await expect(
    page.getByRole('button', { name: 'Review the evidence', exact: true }),
  ).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: 'Continue your gear check', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: coreConsent, exact: true })).not.toBeChecked();
  expect(uploads).toBe(0);
  await saveRecord(info, 'consent-after-reload', {
    uploads,
    retainedPhotos: (await draft(page)).photos.length,
  });
});

test('R11 newer connection save wins over an older delayed check', async ({ page }, info) => {
  const hold = gate();
  let firstRequested = false,
    firstReleased = false;
  await page.route('http://127.0.0.1:8791/health', async (route) => {
    firstRequested = true;
    await hold.promise;
    await serve(route, { ...local, model: 'older-service-A' });
    firstReleased = true;
  });
  await page.route('http://127.0.0.1:8792/health', (route) =>
    serve(route, { ...local, model: 'latest-service-B' }),
  );
  await page.getByRole('button', { name: 'Connection and privacy settings', exact: true }).click();
  const url = page.getByRole('textbox', { name: 'Analysis service URL', exact: true });
  await url.fill('http://127.0.0.1:8791');
  await page.getByRole('button', { name: 'Save and check connection', exact: true }).click();
  await expect.poll(() => firstRequested).toBe(true);
  await url.fill('http://127.0.0.1:8792');
  await page.getByRole('button', { name: 'Save and check connection', exact: true }).click();
  await expect(
    page.getByText('Connected · local_clip · latest-service-B', { exact: true }),
  ).toBeVisible();
  hold.release();
  await expect.poll(() => firstReleased).toBe(true);
  await expect(
    page
      .getByText('Connected · local_clip · older-service-A', { exact: true })
      .or(page.getByText('Connected · local_clip · latest-service-B', { exact: true })),
  ).toBeVisible();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('relay.connection.v1') ?? 'null'),
  );
  await saveRecord(info, 'connection-race', {
    saved,
    visibleInput: await url.inputValue(),
    visibleStatus: await page.getByText(/^Connected ·/).innerText(),
  });
  expect(saved.url).toBe('http://127.0.0.1:8792');
  await expect(
    page.getByText('Connected · local_clip · latest-service-B', { exact: true }),
  ).toBeVisible();
});

test('R12 320px doubled text keeps history choices inside the horizontal viewport', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole('button', { name: 'Start a gear check', exact: true }).click();
  await page.getByRole('button', { name: 'Add item history', exact: true }).click();
  const textNodes = await scaleText(page, 2);
  const metrics = await page.getByRole('radio').evaluateAll((nodes) =>
    nodes.map((node) => {
      const r = node.getBoundingClientRect();
      return {
        name: node.getAttribute('aria-label'),
        left: r.left,
        right: r.right,
        width: r.width,
        height: r.height,
      };
    }),
  );
  await saveRecord(info, 'doubled-text', {
    simulation: 'Browser-only text-size and line-height doubling; not native Dynamic Type',
    textNodes,
    viewport: 320,
    metrics,
  });
  await capture(page, info, 'history-200pct');
  expect(metrics.every((m) => m.left >= 0 && m.right <= 321 && m.height >= 44)).toBe(true);
  for (const question of questions)
    await page.getByRole('radio', { name: question + ' Not sure', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to photos', exact: true }).click();
  await expect(page.getByText('Start with what you see.', { exact: true })).toBeVisible();
});

test('R13 small-screen reduced-motion camera denial keeps fallback reachable by keyboard', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole('button', { name: 'Start a gear check', exact: true }).click();
  await page.getByRole('button', { name: 'Add item history', exact: true }).click();
  for (const q of questions)
    await page.getByRole('radio', { name: q + ' No', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to photos', exact: true }).click();
  await page.getByRole('button', { name: 'Take a photograph', exact: true }).click();
  const fallback = page.getByRole('button', { name: 'Choose a photograph instead', exact: true });
  await expect(fallback).toBeVisible();
  const box = await fallback.boundingBox();
  const animations = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => animation.playState === 'running')
      .map((animation) => ({
        state: animation.playState,
        effect: animation.effect?.getComputedTiming().duration,
      })),
  );
  await saveRecord(info, 'camera-small', {
    viewport: { width: 320, height: 568 },
    fallback: box,
    animations,
  });
  await capture(page, info, 'camera-320x568');
  await expect(fallback).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: 'Close camera', exact: true }).focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(fallback).toBeFocused();
  await page.getByRole('button', { name: 'Close camera', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Take a photograph', exact: true })).toBeVisible();
});

test('R14 keyboard editing at 320px preserves correction and accessible result', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await captured(page);
  await goodRoutes(page);
  await analyzeToEvidence(page);
  await page.getByRole('button', { name: 'Correct an item detail', exact: true }).click();
  const brand = page.getByRole('textbox', { name: 'Corrected brand', exact: true });
  await brand.focus();
  await page.keyboard.type('Round 02 rider correction');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox', { name: 'Corrected model', exact: true })).toBeFocused();
  await page.keyboard.type('Example only');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Keep my correction', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'See the next step', exact: true }).click();
  await expect(page.getByText('Your corrections are included', { exact: true })).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  await saveRecord(info, 'axe-small-result', {
    violations: axe.violations,
    passes: axe.passes.length,
  });
  await capture(page, info, 'keyboard-correction');
  expect(axe.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual(
    [],
  );
  expect((await draft(page)).corrections.some((c) => c.value === 'Round 02 rider correction')).toBe(
    true,
  );
});

test('R15 real local pipeline rejects duplicate full views and recovers after replacement', async ({
  page,
}, info) => {
  await captured(page);
  const before = await draft(page);
  await page.getByRole('button', { name: 'Back photo captured', exact: true }).click();
  await choose(page, 0);
  await expect
    .poll(async () => (await draft(page)).photos.find((p) => p.view === 'back')?.id)
    .not.toBe(before.photos.find((p) => p.view === 'back')?.id);
  const start = Date.now();
  await page.getByRole('button', { name: 'Review the evidence', exact: true }).click();
  await expect(page.getByText(/Two views contain the same photograph/)).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole('button', { name: 'Back photo captured', exact: true }).click();
  await choose(page, 1);
  await analyzeToEvidence(page);
  const after = await draft(page);
  await saveRecord(info, 'real-local', {
    mode: 'Real local CLIP with labelled synthetic images; this tests pipeline recovery, not gear recognition accuracy.',
    elapsedMs: Date.now() - start,
    provider: after.result?.observation?.provider,
    model: after.result?.observation?.model,
    timing: after.result?.timing,
    decision: after.result?.decision.state,
  });
  expect(after.result?.observation?.provider).toBe('local_clip');
  expect(after.result?.decision.offerRecommended).toBe(false);
});
