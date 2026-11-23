import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
const out = 'output/playwright',
  questions = [
    'Has it been worn in a crash?',
    'Any damage in a protective area?',
    'Any repairs in a protective area?',
  ];
test.beforeAll(async () => {
  await fs.mkdir(out, { recursive: true });
  await fs.mkdir('artifacts/ui-fixtures', { recursive: true });
  for (let i = 0; i < 3; i++) {
    const svg =
      '<svg width="720" height="960" xmlns="http://www.w3.org/2000/svg"><rect width="720" height="960" fill="' +
      ['#C2C9AD', '#C8B7A6', '#9DACB3'][i] +
      '"/><path d="M30 80h660v800H30Z M80 ' +
      (200 + i * 60) +
      'h560v300H80Z" fill="none" stroke="#314136" stroke-width="10"/><text x="80" y="600" font-size="30" fill="#202822">UI TEST FIXTURE ' +
      i +
      '</text><text x="80" y="660" font-size="24" fill="#202822">NOT GEAR EVIDENCE</text></svg>';
    await sharp(Buffer.from(svg))
      .png()
      .toFile('artifacts/ui-fixtures/' + i + '.png');
  }
});
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start a gear check', exact: true })).toBeVisible({
    timeout: 60_000,
  });
});
test('mobile layouts, keyboard access, accessibility and camera recovery', async ({ page }) => {
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.screenshot({ path: out + '/home-' + width + '.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Connection and privacy settings' })).toBeFocused();
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  await fs.writeFile(out + '/accessibility-home.json', JSON.stringify(axe, null, 2));
  expect(axe.violations.filter((v) => ['critical', 'serious'].includes(v.impact ?? ''))).toEqual(
    [],
  );
  await page.getByRole('button', { name: 'Start a gear check', exact: true }).click();
  await page.getByRole('button', { name: 'Add item history', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue to photos' })).toBeDisabled();
  await page.screenshot({ path: out + '/history.png', fullPage: true });
  for (const q of questions)
    await page.getByRole('radio', { name: q + ' No', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to photos' }).click();
  await expect(page.getByRole('button', { name: 'Review the evidence' })).toHaveCount(0);
  await page.screenshot({ path: out + '/capture-empty.png', fullPage: true });
  await page.getByRole('button', { name: 'Take a photograph', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose a photograph instead' })).toBeVisible();
  await page.screenshot({ path: out + '/camera-permission.png', fullPage: true });
  await page.getByRole('button', { name: 'Close camera' }).click();
  await page.getByRole('button', { name: 'Connection and privacy settings' }).click();
  await page.screenshot({ path: out + '/settings.png', fullPage: true });
});
test('crash exclusion survives a changed answer without photographs', async ({ page }) => {
  await page.getByRole('button', { name: 'Start a gear check', exact: true }).click();
  await page.getByRole('button', { name: 'Add item history', exact: true }).click();
  await page.getByRole('radio', { name: questions[0] + ' Yes', exact: true }).click();
  await page.getByRole('radio', { name: questions[0] + ' No', exact: true }).click();
  await page.getByRole('button', { name: 'See the next step' }).click();
  await expect(page.getByText('Not eligible for an offer', { exact: true })).toBeVisible();
  await expect(
    page.getByText('A crash has been reported for this item.', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: out + '/exclusion.png', fullPage: true });
  await page.getByRole('button', { name: 'Copy inspection brief' }).click();
  await expect(page.getByText(/Inspection brief copied/)).toBeVisible();
});
test('real photo import, local inference, correction, persistence and deletion', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  await page.getByRole('button', { name: 'Start a gear check', exact: true }).click();
  await page.getByRole('button', { name: 'Add item history', exact: true }).click();
  for (const q of questions)
    await page.getByRole('radio', { name: q + ' No', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to photos' }).click();
  for (let i = 0; i < 3; i++) {
    await page
      .getByRole('button', { name: ['Front', 'Back', 'Label'][i] + ' photo needed', exact: true })
      .click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose a photograph', exact: true }).click();
    await (await chooser).setFiles(path.resolve('artifacts/ui-fixtures/' + i + '.png'));
    await expect(
      page.getByRole('button', {
        name: ['Front', 'Back', 'Label'][i] + ' photo captured',
        exact: true,
      }),
    ).toBeVisible();
  }
  await page
    .getByRole('checkbox', {
      name: 'Allow these photos to be processed by the selected Relay service',
    })
    .check();
  await page.screenshot({ path: out + '/capture-filled.png', fullPage: true });
  await page.getByRole('button', { name: 'Review the evidence' }).click();
  await expect(page.getByText('Model inference · not verified', { exact: true })).toBeVisible({
    timeout: 70_000,
  });
  await page.screenshot({ path: out + '/evidence.png', fullPage: true });
  await page.getByRole('button', { name: 'Correct an item detail' }).click();
  await page.getByLabel('Corrected brand', { exact: true }).fill('Rider-reported example');
  await page.getByRole('button', { name: 'Keep my correction' }).click();
  await page.getByRole('button', { name: 'See the next step' }).click();
  await expect(
    page.getByText(
      /A specialist should take a look|Your corrections are included|Ready for a closer look/,
    ),
  ).toBeVisible();
  await page.screenshot({ path: out + '/result.png', fullPage: true });
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  await fs.writeFile(out + '/accessibility-result.json', JSON.stringify(axe, null, 2));
  expect(axe.violations.filter((v) => ['critical', 'serious'].includes(v.impact ?? ''))).toEqual(
    [],
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Continue your gear check' })).toBeVisible();
  await page.getByRole('button', { name: 'Connection and privacy settings' }).click();
  await page.getByRole('button', { name: 'Remove this device’s draft', exact: true }).click();
  await page.getByRole('button', { name: 'Keep the draft', exact: true }).click();
  await page.getByRole('button', { name: 'Remove this device’s draft', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm removal of this draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start a gear check', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

async function capturedDraft(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Start a gear check', exact: true }).click();
  await page.getByRole('button', { name: 'Add item history', exact: true }).click();
  for (const q of questions)
    await page.getByRole('radio', { name: q + ' No', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to photos' }).click();
  for (let i = 0; i < 3; i++) {
    await page
      .getByRole('button', { name: ['Front', 'Back', 'Label'][i] + ' photo needed', exact: true })
      .click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose a photograph', exact: true }).click();
    await (await chooser).setFiles(path.resolve('artifacts/ui-fixtures/' + i + '.png'));
    await expect(
      page.getByRole('button', {
        name: ['Front', 'Back', 'Label'][i] + ' photo captured',
        exact: true,
      }),
    ).toBeVisible();
  }
  await page
    .getByRole('checkbox', {
      name: 'Allow these photos to be processed by the selected Relay service',
    })
    .check();
}
test('external consent is renewed after a model change before any upload', async ({ page }) => {
  await capturedDraft(page);
  let model = 'contract-test-model-a';
  const requests: unknown[] = [];
  await page.route('**/health', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        schemaVersion: '1.0',
        provider: 'openai',
        model,
        externalProvider: true,
      }),
    }),
  );
  await page.route('**/assess', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { message: 'Disclosed test: provider unavailable; no external call was made.' },
      }),
    });
  });
  await page.getByRole('button', { name: 'Review the evidence' }).click();
  const external = page.getByRole('checkbox', { name: 'Allow external provider image processing' });
  await expect(external).toBeVisible();
  await expect(external).not.toBeChecked();
  await external.check();
  model = 'contract-test-model-b';
  await page.getByRole('button', { name: 'Review the evidence' }).click();
  await expect(external).not.toBeChecked();
  expect(requests).toHaveLength(0);
  await external.check();
  await page.getByRole('button', { name: 'Review the evidence' }).click();
  await expect(
    page.getByText('Disclosed test: provider unavailable; no external call was made.'),
  ).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    consent: {
      externalProvider: true,
      expectedProvider: 'openai',
      expectedModel: 'contract-test-model-b',
    },
  });
  await expect(page.getByRole('button', { name: 'Front photo captured' })).toBeVisible();
});
test('cancelled network work preserves photos and cannot replace a later exclusion', async ({
  page,
}) => {
  await capturedDraft(page);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let uploadCount = 0;
  await page.route('**/health', async (route) => {
    await gate;
    await route
      .fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          schemaVersion: '1.0',
          provider: 'local_clip',
          model: 'delayed-test',
          externalProvider: false,
        }),
      })
      .catch(() => undefined);
  });
  await page.route('**/assess', async (route) => {
    uploadCount++;
    await route.abort();
  });
  await page.getByRole('button', { name: 'Review the evidence' }).click();
  await expect(page.getByText('Connecting to the analysis service', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel analysis' }).click();
  await expect(
    page.getByText('Analysis cancelled. Your photographs are still here.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Front photo captured' })).toBeVisible();
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await page.getByRole('radio', { name: questions[0] + ' Yes', exact: true }).click();
  await page.getByRole('button', { name: 'See the next step' }).click();
  release();
  await expect(page.getByText('Not eligible for an offer', { exact: true })).toBeVisible();
  expect(uploadCount).toBe(0);
});
