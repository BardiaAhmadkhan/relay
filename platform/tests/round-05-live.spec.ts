import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
const folder = 'output/playwright/round-05';
const callsFile = process.env.RELAY_CANARY_CALLS ?? 'benchmarks/round-05/canary-calls.jsonl';
test.beforeAll(async () => {
  await fs.mkdir(folder, { recursive: true });
});
const definitions = [
  { id: 'sample-01--small320', positive: true },
  { id: 'source-crash--small320', positive: true },
  { id: 'denim--small240-jpeg60', positive: false },
  { id: 'biker-black--small240-jpeg60', positive: false },
];
for (const c of definitions)
  test('low-resolution canary ' + c.id, async ({ page }) => {
    const before = (await fs.readFile(callsFile, 'utf8')).trim().split('\n').filter(Boolean).length;
    await page.addInitScript(() =>
      localStorage.setItem('relay.connection.v1', JSON.stringify({ url: 'http://127.0.0.1:8788' })),
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Start a gear check', exact: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose a photograph', exact: true }).click();
    await (await chooser).setFiles(path.resolve('.cache/round-05-inputs/' + c.id + '.jpg'));
    await expect(
      page.getByRole('button', { name: 'Front photo captured', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('checkbox', {
        name: 'Allow these photos to be processed by the selected Relay service',
        exact: true,
      })
      .check();
    const request = page.waitForResponse((r) => r.url().endsWith('/assess'));
    await page.getByRole('button', { name: 'Review the evidence', exact: true }).click();
    const response = await request;
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.observation.model).toContain('+low-detail-cue-1');
    expect(body.decision.offerRecommended).toBe(false);
    const calls = (await fs.readFile(callsFile, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(before)
      .map((s) => JSON.parse(s));
    const findings = body.observation.inspection.photos[0].findings;
    if (c.positive) expect(findings.length).toBeGreaterThan(0);
    else expect(!findings.length || !calls.some((c) => c.stage === 'low-detail-cue')).toBe(true);
    if (calls.some((c) => c.stage === 'low-detail-cue' && c.returnedCue) && findings.length) {
      expect(findings).toMatchObject([{ kind: 'abrasion', clarity: 'possible', zone: 'unknown' }]);
      expect(body.observation.inspection.photos[0].crashPattern).toBe('unclear');
    }
    await fs.writeFile(
      'benchmarks/round-05/' + c.id + '-ui.json',
      JSON.stringify(
        {
          result: body,
          calls,
          boundary:
            'Actual browser decode/JPEG preparation and API pipeline. A negative control may retain an existing primary-model concern; this check forbids an added recovery flag.',
        },
        null,
        2,
      ),
    );
    await page.screenshot({ path: folder + '/' + c.id + '.png' });
  });

test('restored low-resolution draft exercises the real optional recovery', async ({ page }) => {
  const bytes = await fs.readFile('.cache/round-05-inputs/sample-01--small320.jpg');
  const before = (await fs.readFile(callsFile, 'utf8')).trim().split('\n').filter(Boolean).length;
  await page.addInitScript(
    ({ base64 }) => {
      localStorage.setItem('relay.connection.v1', JSON.stringify({ url: 'http://127.0.0.1:8788' }));
      localStorage.setItem(
        'relay.draft.v1',
        JSON.stringify({
          version: 1,
          id: 'round05-restored',
          updatedAt: new Date().toISOString(),
          disclosures: [],
          corrections: [],
          result: null,
          photos: [
            {
              id: 'restored-front',
              view: 'front',
              uri: 'data:image/jpeg;base64,' + base64,
              width: 240,
              height: 320,
              quality: {
                width: 240,
                height: 320,
                brightness: 120,
                sharpness: 100,
                warnings: ['low_resolution'],
              },
            },
          ],
        }),
      );
    },
    { base64: bytes.toString('base64') },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue your gear check', exact: true }).click();
  await page
    .getByRole('checkbox', {
      name: 'Allow these photos to be processed by the selected Relay service',
      exact: true,
    })
    .check();
  const pending = page.waitForResponse((r) => r.url().endsWith('/assess'));
  await page.getByRole('button', { name: 'Review the evidence', exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  const body = await response.json();
  const calls = (await fs.readFile(callsFile, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(before)
    .map((s) => JSON.parse(s));
  expect(calls.some((c) => c.stage === 'low-detail-cue' && c.returnedCue)).toBe(true);
  expect(body.observation.inspection.photos[0]).toMatchObject({
    imageId: 'restored-front',
    crashPattern: 'unclear',
    findings: [{ kind: 'abrasion', clarity: 'possible', zone: 'unknown' }],
  });
  expect(body.decision.offerRecommended).toBe(false);
  await expect(page.getByText('A detail needs a closer look', { exact: true })).toBeVisible();
  await fs.writeFile(
    'benchmarks/round-05/restored-cue-ui.json',
    JSON.stringify(
      {
        result: body,
        calls,
        boundary:
          'The draft is a disclosed local-storage fixture; actual image bytes, actual local inference and unmodified UI. This tests persisted-photo processing without a second browser re-encode.',
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: folder + '/restored-cue.png' });
});
