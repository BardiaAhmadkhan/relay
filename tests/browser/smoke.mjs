import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { withPreview } from '../support/preview.mjs';

const name = process.argv[2] ?? 'chromium';
if (!['chromium', 'webkit'].includes(name)) throw Error('Choose chromium or webkit.');
const photo = (file) =>
  fileURLToPath(new URL('../../public/media/' + file + '.webp', import.meta.url));
const button = (page, label) => page.getByRole('button', { name: label, exact: true });

await withPreview(async (base) => {
  const browser = await { chromium, webkit }[name].launch({
    ...(name === 'chromium' && process.env.RELAY_TEST_CHANNEL
      ? { channel: process.env.RELAY_TEST_CHANNEL }
      : {}),
  });
  try {
    for (const width of [390, 1440]) {
      const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 990 },
      });
      try {
        const page = await context.newPage(),
          errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('response', (r) => {
          if (r.status() >= 400) errors.push(r.status() + ' ' + r.url());
        });
        page.on('request', (r) => {
          const u = new URL(r.url());
          if (['http:', 'https:'].includes(u.protocol) && u.origin !== base)
            errors.push('Unexpected external request to ' + u.origin);
        });
        const open = (fragment) => page.goto(base + '/?workspace=examples#/' + fragment);
        await open('guide');
        await button(page, 'Trousers').click();
        assert.equal(await button(page, 'Trousers').getAttribute('aria-pressed'), 'true');
        assert.ok(
          (
            await page.locator('.guide-grid img').evaluateAll((imgs) => imgs.map((img) => img.src))
          ).every((src) => src.includes('selvedge')),
        );
        await open('trade');
        await page.getByRole('link', { name: 'Start a trade-in', exact: true }).click();
        await button(page, 'Riding jacket').click();
        await page.getByRole('button', { name: /^Yes A crash/ }).click();
        await button(page, 'Open inspection').click();
        await page.getByRole('heading', { name: 'No trade-in offer', exact: true }).waitFor();
        assert.equal(await page.locator('.offer-ticket').count(), 0);
        await open('intake');
        await button(page, 'Riding jacket').click();
        await page.getByRole('button', { name: /^No None/ }).click();
        await button(page, 'Continue to photos').click();
        await page.getByRole('button', { name: /^Upload existing photos/ }).click();
        for (const [label, file] of [
          ['Front', 'fieldway'],
          ['Back', 'fieldway-back'],
          ['Attached label', 'fieldway-label'],
          ['Inside front', 'fieldway-inside'],
        ]) {
          await page
            .getByLabel('Choose ' + label + ' photograph', { exact: true })
            .setInputFiles(photo(file));
          await page.getByTitle('Retake ' + label, { exact: true }).waitFor();
          if (label === 'Back') await page.reload();
        }
        await page.getByRole('heading', { name: 'Four views captured' }).waitFor();
        assert.equal(await page.locator('.capture-proof img').count(), 4);
        assert.equal(await page.locator('.slot-list button').count(), 4);
        await button(page, 'Add a close-up').click();
        await page.getByText('Optional close-up', { exact: true }).last().waitFor();
        await button(page, 'Open inspection').click();
        await page.locator('.reason-sheet').waitFor();
        assert.match(await page.locator('.record-meta').innerText(), /4 source photos/);
        await open('items/RW-001/overview');
        await page
          .getByRole('button', { name: /See the photo behind this decision.*Shoulder seam/i })
          .click();
        await page.getByRole('dialog').getByRole('heading', { name: 'Shoulder seam' }).waitFor();
        await button(page, 'Close photo').click();
        await open('items/RW-003/result');
        await page
          .locator('.price-breakdown')
          .getByText(/Illustrated shop/)
          .waitFor();
        await page.getByText('Shop counter', { exact: true }).click();
        await page.getByLabel('I have received this garment from the rider.').check();
        await button(page, 'Issue practice credit').click();
        await page.locator('.voucher-code').waitFor();
        const code = await page.locator('.voucher-code').innerText();
        await open('wallet');
        await page.locator('.wallet-page .voucher-code').waitFor();
        await page.reload();
        await page.locator('.wallet-page .voucher-code').waitFor();
        assert.equal(await page.locator('.voucher-code').innerText(), code);
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        );
        assert.deepEqual(errors, []);
        console.log(
          name +
            ' ' +
            width +
            'px: history exclusion, four-photo intake, draft recovery, linked evidence and practice wallet passed.',
        );
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
});
