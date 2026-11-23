import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
const run = process.env.RELAY_LIVE_RUN ?? 'verified-v2';
const out = 'output/playwright/round-03/' + run;
test.beforeAll(async () => {
  await fs.mkdir(out, { recursive: true });
});
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('relay.connection.v1', JSON.stringify({ url: 'http://127.0.0.1:8788' })),
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start a gear check', exact: true })).toBeVisible();
});
for (const [id, file] of [
  ['sample-01', 'sample-01.webp'],
  ['sample-02', 'sample-02.jpg'],
  ['sample-03', 'sample-03.jpg'],
]) {
  test('real single-photo damage inspection ' + id, async ({ page }) => {
    await page.getByRole('button', { name: 'Start a gear check', exact: true }).click();
    const picker = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose a photograph', exact: true }).click();
    await (await picker).setFiles(path.resolve('assets/fixtures/round-03/' + file));
    await expect(
      page.getByRole('button', { name: 'Front photo captured', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('img', { name: 'Your front photograph' })).toBeVisible();
    await page
      .getByRole('checkbox', {
        name: 'Allow these photos to be processed by the selected Relay service',
        exact: true,
      })
      .check();
    await page.screenshot({ path: out + '/' + id + '-capture.png' });
    const response = page.waitForResponse((r) => r.url().endsWith('/assess'));
    await page.getByRole('button', { name: 'Review the evidence', exact: true }).click();
    const result = await (await response).json();
    expect(result.observation?.provider).toBe('local_vlm');
    expect(result.observation?.concerns.length).toBeGreaterThan(0);
    expect(result.decision.offerRecommended).toBe(false);
    expect(result.observation.inspection.photos[0].crashPattern).toBe('consistent_with_sliding');
    await expect(page.getByText('Crash-like damage detected', { exact: true })).toBeVisible();
    await fs.writeFile(
      'benchmarks/round-03/' + id + '-live-ui-' + run + '.json',
      JSON.stringify(result, null, 2),
    );
    await page.screenshot({ path: out + '/' + id + '-evidence.png' });
    await page.getByText('Crash history', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: out + '/' + id + '-findings.png' });
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(axe.violations.filter((v) => ['critical', 'serious'].includes(v.impact ?? ''))).toEqual(
      [],
    );
    if (id === 'sample-03') {
      await page.getByRole('button', { name: 'Go back', exact: true }).click();
      const before = await page.evaluate(() => JSON.parse(localStorage.getItem('relay.draft.v1')!));
      await page.getByRole('button', { name: 'Remove this photograph', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Front photo needed', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Undo removal', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Front photo captured', exact: true }),
      ).toBeVisible();
      await expect
        .poll(async () =>
          page.evaluate(() => JSON.parse(localStorage.getItem('relay.draft.v1')!).photos),
        )
        .toEqual(before.photos);
      const after = await page.evaluate(() => JSON.parse(localStorage.getItem('relay.draft.v1')!));
      expect(after.disclosures).toEqual(before.disclosures);
      expect(after.result).toBeNull();
    }
    if (id === 'sample-02') {
      await page.getByRole('button', { name: 'Revisit photographs', exact: true }).click();
      await page.getByRole('button', { name: 'Detail photo needed', exact: true }).click();
      await page.getByRole('button', { name: 'Review the evidence', exact: true }).click();
      await expect(page.getByText('Crash-like damage detected', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'See the next step', exact: true }).click();
      await page.getByRole('button', { name: 'Save brief & check next item', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Front photo needed', exact: true }),
      ).toBeVisible();
      await expect(page.getByText('The whole front', { exact: true })).toBeVisible();
      const saved = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('relay.briefs.v1') ?? '[]'),
      );
      expect(saved).toHaveLength(1);
      expect(saved[0].photos).toHaveLength(1);
      expect(saved[0].photos[0].uri).toMatch(/^data:image\/jpeg;base64,/);
      await page.reload();
      await page.getByRole('button', { name: 'Saved briefs · 1', exact: true }).click();
      await expect(
        page.getByRole('img', { name: 'Saved inspection photograph 1', exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: out + '/notebook.png' });
    }
  });
}
