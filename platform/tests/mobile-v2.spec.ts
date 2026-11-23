import { createHash } from 'node:crypto';
import type { Scorer } from '../packages/vision/v2/scorer';
import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PolicyConfigSchema, ThresholdsSchema } from '../packages/core/v2/schema';
import { ScorerChain } from '../packages/vision/v2/scorer-chain';
import { createAppV2 } from '../server/app-v2';
import { CLEAN_ITEM, stubScorer, type StubAnswers } from '../server/stub-scorer';

/** Work package 11 end to end: the app in a browser, a real v2 service over HTTP, the stub scorer in
 * place of the model (no GPU). Everything except the model is real: upload, preparation, the focus
 * gate, signing, the rules, the phone's safety floor and the result screen. */
const PORT = 8790,
  SERVICE = 'http://127.0.0.1:' + PORT,
  out = process.env.RELAY_UI_EVIDENCE_DIR ?? 'output/playwright/v2',
  fixtures = process.env.RELAY_UI_FIXTURE_DIR ?? 'artifacts/ui-fixtures-v2';
const questions = [
  'Has it been worn in a crash?',
  'Any damage in a protective area?',
  'Any repairs in a protective area?',
];
const state: { answers: StubAnswers; delayMs: number } = { answers: CLEAN_ITEM, delayMs: 0 };
let carried: { level: number; original?: string } | null = null;
let service: ReturnType<typeof createAppV2>;

test.beforeAll(async () => {
  await fs.mkdir(out, { recursive: true });
  await fs.mkdir(fixtures, { recursive: true });
  // Committed public photographs (assets/fixtures/ATTRIBUTION.md), resized like a phone upload. The
  // flat SVG cards used by the v1 suite would fail the calibrated focus gate, which is the point of it.
  const sources = {
    front: 'leather-jacket.jpg',
    back: 'armour-jacket.jpg',
    label: 'backpack-label.jpg',
    detail: 'crashed-shoulder.jpg',
  };
  for (const [name, file] of Object.entries(sources))
    await sharp(path.resolve('assets/fixtures', file))
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toFile(path.join(fixtures, name + '.jpg'));
  await sharp(path.resolve('assets/fixtures/leather-jacket.jpg'))
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .blur(6)
    .jpeg({ quality: 88 })
    .toFile(path.join(fixtures, 'blurred.jpg'));
  const read = async (p: string) => JSON.parse(await fs.readFile(p, 'utf8'));
  const base = stubScorer(state);
  const sourceAware: Scorer = {
    ...base,
    async score(photo, questions, signal) {
      if (carried && photo.view === 'front') {
        const hash = createHash('sha256').update(photo.jpeg).digest('hex');
        carried.original ??= hash;
        if (carried.original === hash)
          return stubScorer({
            ...state,
            answers: { ...state.answers, road_contact: carried.level },
          }).score(photo, questions, signal);
      }
      return base.score(photo, questions, signal);
    },
  };
  service = createAppV2({
    // No cache: the stub's answers change between tests, while the pixels stay the same.
    chain: new ScorerChain([sourceAware], { cacheTtlMs: 0 }),
    thresholds: ThresholdsSchema.parse(await read('packages/core/v2/thresholds.json')),
    config: PolicyConfigSchema.parse(await read('packages/core/v2/policy.config.json')),
    signingKey: 'browser-test-signing-key-0123456789abcdef',
    workingEdge: 1024,
  });
  await service.listen({ host: '127.0.0.1', port: PORT });
});
test.afterAll(async () => {
  await service?.close();
});
test.beforeEach(async ({ page }) => {
  carried = null;
  state.answers = CLEAN_ITEM;
  state.delayMs = 0;
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start a gear check', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Connection and privacy settings' }).click();
  await page.getByLabel('Analysis service URL', { exact: true }).fill(SERVICE);
  await page.getByRole('button', { name: 'Save and check connection' }).click();
  await expect(page.getByText(/Connected · Relay v2 · photo check gear-2/)).toBeVisible();
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
});

async function startCheck(page: Page, answers = ['No', 'No', 'No']) {
  await page.getByRole('button', { name: 'Start a gear check', exact: true }).click();
  await page.getByRole('button', { name: 'Add item history', exact: true }).click();
  for (const [i, q] of questions.entries())
    await page.getByRole('radio', { name: q + ' ' + answers[i], exact: true }).click();
}
async function addPhoto(page: Page, view: 'Front' | 'Back' | 'Label' | 'Detail', file: string) {
  await page
    .getByRole('button', { name: new RegExp('^' + view + ' photo (needed|captured)$') })
    .click();
  const prior = await page.evaluate(
    (v) =>
      JSON.parse(localStorage.getItem('relay.draft.v1') ?? '{}').photos?.find(
        (p: { view: string }) => p.view === v,
      )?.id ?? null,
    view.toLowerCase(),
  );
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose a photograph', exact: true }).click();
  await (await chooser).setFiles(path.resolve(fixtures, file));
  await expect
    .poll(async () =>
      page.evaluate(
        ({ v, id }) => {
          const next = JSON.parse(localStorage.getItem('relay.draft.v1') ?? '{}').photos?.find(
            (p: { view: string }) => p.view === v,
          )?.id;
          return !!next && next !== id;
        },
        { v: view.toLowerCase(), id: prior },
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole('button', { name: view + ' photo captured', exact: true }),
  ).toBeVisible();
}
const allow = (page: Page) =>
  page
    .getByRole('checkbox', {
      name: 'Allow these photos to be processed by the selected Relay service',
    })
    .check();

test('v2: photos are checked as they are taken, then a clean item gets an offer with a grade', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const scored: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/v2/photos/score')) scored.push(r.url());
  });
  await startCheck(page);
  await page.getByRole('button', { name: 'Continue to photos' }).click();
  await addPhoto(page, 'Front', 'front.jpg');
  expect(scored).toHaveLength(0); // nothing leaves the phone before the rider allows it
  await allow(page);
  await expect(page.getByText('Photo checked: clear enough to use.')).toBeVisible();
  await addPhoto(page, 'Back', 'back.jpg');
  await expect(page.getByText('Photo checked: clear enough to use.')).toBeVisible();
  await addPhoto(page, 'Label', 'label.jpg');
  await expect(page.getByText('Photo checked: clear enough to use.')).toBeVisible();
  expect(scored).toHaveLength(3);
  await page.screenshot({ path: out + '/capture-checked.png', fullPage: true });
  await page.getByRole('button', { name: 'Review the evidence' }).click();
  await expect(page.getByText('Offer recommended', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/This is not a safety certification/)).toBeVisible();
  await expect(page.getByText('Condition grade', { exact: true })).toBeVisible();
  await expect(page.getByText('Riding jacket', { exact: true })).toBeVisible();
  expect(scored).toHaveLength(3); // the result reused the records made while photographing
  await page.screenshot({ path: out + '/result-offer.png', fullPage: true });
  await page.getByRole('button', { name: 'Copy inspection brief' }).click();
  await expect(page.getByText(/Inspection brief copied\. It includes the result/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('v2: the review band asks for one close-up, then hands over to a specialist', async ({
  page,
}) => {
  state.answers = { ...CLEAN_ITEM, road_contact: 0.4 }; // between the fitted clear and block bands
  await startCheck(page);
  await page.getByRole('button', { name: 'Continue to photos' }).click();
  await addPhoto(page, 'Front', 'front.jpg');
  await allow(page);
  await addPhoto(page, 'Back', 'back.jpg');
  await addPhoto(page, 'Label', 'label.jpg');
  await page.getByRole('button', { name: 'Review the evidence' }).click();
  await expect(page.getByText('One more photo needed', { exact: true })).toBeVisible();
  await expect(page.getByText(/may show road-contact damage/).first()).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'The photograph this reason refers to' }).first(),
  ).toBeVisible();
  await page.screenshot({ path: out + '/result-close-up.png', fullPage: true });
  await page.getByRole('button', { name: 'Take the close-up photo' }).click();
  await addPhoto(page, 'Detail', 'detail.jpg');
  await page.getByRole('button', { name: 'Review the evidence' }).click();
  await expect(page.getByText('A specialist takes it from here', { exact: true })).toBeVisible();
  await expect(page.getByText('Take the close-up photo')).toHaveCount(0); // only one is ever asked
  await page.screenshot({ path: out + '/result-review.png', fullPage: true });
});

test('v2: one picture can never stand in for two views', async ({ page }) => {
  await startCheck(page);
  await page.getByRole('button', { name: 'Continue to photos' }).click();
  await addPhoto(page, 'Front', 'front.jpg');
  await allow(page);
  await addPhoto(page, 'Back', 'front.jpg');
  await addPhoto(page, 'Label', 'label.jpg');
  await page.getByRole('button', { name: 'Review the evidence' }).click();
  await expect(page.getByText(/Two photographs are the same picture/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take the back photo' })).toBeVisible();
});

test('v2: an out-of-focus photo is flagged while the rider is still photographing', async ({
  page,
}) => {
  await startCheck(page);
  await page.getByRole('button', { name: 'Continue to photos' }).click();
  await addPhoto(page, 'Front', 'blurred.jpg');
  await allow(page);
  await expect(page.getByText(/This photo is out of focus/)).toBeVisible();
  await page.screenshot({ path: out + '/capture-out-of-focus.png', fullPage: true });
  await addPhoto(page, 'Front', 'front.jpg');
  await expect(page.getByText('Photo checked: clear enough to use.')).toBeVisible();
});

test('v2: a reported crash closes the offer process without any upload', async ({ page }) => {
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith(SERVICE + '/v2/') && !r.url().endsWith('/v2/health'))
      calls.push(r.url());
  });
  await startCheck(page, ['Yes', 'No', 'No']);
  await page.getByRole('button', { name: 'See the next step' }).click();
  await expect(page.getByText('Not eligible for an offer', { exact: true })).toBeVisible();
  expect(calls).toEqual([]);
});

test('fresh intakes offer no area selector and still support ordinary close-ups', async ({
  page,
}) => {
  await startCheck(page);
  await page.getByRole('button', { name: 'Continue to photos' }).click();
  await addPhoto(page, 'Front', 'front.jpg');
  await addPhoto(page, 'Back', 'back.jpg');
  await addPhoto(page, 'Label', 'label.jpg');
  await addPhoto(page, 'Detail', 'detail.jpg');
  await expect(
    page.getByRole('button', { name: /mark an area|adjust marked area|start at centre/i }),
  ).toHaveCount(0);
  await allow(page);
  await page.getByRole('button', { name: 'Review the evidence' }).click();
  await expect(page.getByText('Offer recommended', { exact: true }).first()).toBeVisible();
});

test('a saved concern survives reopening and replacing its overview and reaches the specialist brief', async ({
  page,
}) => {
  await startCheck(page);
  await page.getByRole('button', { name: 'Continue to photos' }).click();
  await addPhoto(page, 'Front', 'front.jpg');
  await addPhoto(page, 'Back', 'back.jpg');
  await addPhoto(page, 'Label', 'label.jpg');
  await page.evaluate(() => {
    const key = 'relay.draft.v1',
      d = JSON.parse(localStorage.getItem(key)!);
    const original = d.photos.find((p: { view: string }) => p.view === 'front');
    d.photos.push({
      ...original,
      id: 'old-unverified-chip',
      view: 'detail',
      v2: undefined,
      fromOverview: {
        parentId: original.id,
        parentView: 'front',
        source: 'saved_overview',
        sourceWidth: 1600,
        sourceHeight: 1200,
        left: 20,
        top: 30,
        side: 128,
      },
    });
    localStorage.setItem(key, JSON.stringify(d));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Continue your gear check', exact: true }).first().click();
  await addPhoto(page, 'Front', 'front.jpg');
  await page.reload();
  await page.getByRole('button', { name: 'Continue your gear check', exact: true }).first().click();
  const sent: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/v2/photos/score')) sent.push(r.postDataJSON().photoId);
  });
  await allow(page);
  await page.getByRole('button', { name: 'Review the evidence' }).click();
  await expect(
    page.getByText('A specialist will take a look', { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText(/Unverified\. The saved crop/)).toBeVisible();
  await expect(page.getByLabel('Original overview for this marked area')).toBeVisible();
  expect(sent).not.toContain('old-unverified-chip');
  const d = await page.evaluate(() => JSON.parse(localStorage.getItem('relay.draft.v1')!));
  expect(d.historicalAreas[0].overview.id).not.toBe(
    d.photos.find((p: { view: string }) => p.view === 'front').id,
  );
  await page.getByRole('button', { name: 'Save brief & check next item', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('relay.briefs.v1') ?? '[]')[0]?.text),
    )
    .toContain('Unverified saved crop of the front');
});

for (const [name, level] of [
  ['possible', 0.35],
  ['exclusion', 0.94],
] as const) {
  test(
    'V3.5 retains an earlier ' + name + ' after replacing and reopening with the original receipts',
    async ({ page }) => {
      carried = { level };
      await startCheck(page);
      await page.getByRole('button', { name: 'Continue to photos' }).click();
      await addPhoto(page, 'Front', 'front.jpg');
      await addPhoto(page, 'Back', 'back.jpg');
      await addPhoto(page, 'Label', 'label.jpg');
      await allow(page);
      const assessUI = async () => {
        const wait = page.waitForResponse((r) => r.url().endsWith('/v2/assess'));
        await page.getByRole('button', { name: 'Review the evidence' }).click();
        const res = await wait;
        expect(res.status()).toBe(200);
        return res.json();
      };
      const original = await assessUI();
      expect(original.decision.outcome).toBe(name === 'exclusion' ? 'no_offer' : 'retake');
      expect(original.findings[0].finding.kind).toBe(
        name === 'exclusion' ? 'exclusion' : 'observation',
      );
      await page.getByRole('button', { name: 'Back to your notebook' }).click();
      await page.reload();
      await page
        .getByRole('button', { name: 'Continue your gear check', exact: true })
        .first()
        .click();
      await addPhoto(page, 'Front', 'detail.jpg');
      await page.reload();
      await page
        .getByRole('button', { name: 'Continue your gear check', exact: true })
        .first()
        .click();
      await allow(page);
      const decided = await assessUI();
      expect(decided.replacements[0].status).toBe(
        name === 'exclusion' ? 'confirmed_exclusion' : 'possible',
      );
      expect(decided.decision.outcome).toBe(name === 'exclusion' ? 'no_offer' : 'offer');
      if (name === 'possible') expect(decided.transitions).toHaveLength(1);
      await page.getByRole('button', { name: 'Back to your notebook' }).click();
      await page
        .getByRole('button', { name: 'Continue your gear check', exact: true })
        .first()
        .click();
      expect((await assessUI()).decision).toEqual(decided.decision);
      await page.getByRole('button', { name: 'Save brief & check next item', exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(() => JSON.parse(localStorage.getItem('relay.briefs.v1') ?? '[]').length),
        )
        .toBe(1);
      const item = await page.evaluate(
        () => JSON.parse(localStorage.getItem('relay.briefs.v1')!)[0],
      );
      expect(item.photos).toHaveLength(4);
      expect(item.replacedOverviews[0].photoId).toBe(original.findings[0].finding.photoId);
      expect(
        item.photos.some((p: { id: string }) => p.id === item.replacedOverviews[0].replacementId),
      ).toBe(true);
      expect(item.replacementTransitions).toHaveLength(name === 'possible' ? 1 : 0);
      if (name === 'possible') expect(item.text).toContain('a possible road-contact cue');
      expect(item.photos.every((p: { v2?: unknown }) => p.v2 === undefined)).toBe(true);
      await page.reload();
      await page.getByRole('button', { name: 'Saved briefs · 1', exact: true }).click();
      await expect(page.getByRole('img', { name: 'Superseded front photograph' })).toBeVisible();
    },
  );
}

test('an in-flight replaced overview is retained as evidence without fabricating a prior exclusion', async ({
  page,
}) => {
  carried = { level: 0.94 };
  state.delayMs = 900;
  await startCheck(page);
  await page.getByRole('button', { name: 'Continue to photos' }).click();
  await addPhoto(page, 'Front', 'front.jpg');
  const started = page.waitForRequest(
    (r) => r.url().endsWith('/v2/photos/score') && r.postDataJSON().view === 'front',
  );
  await allow(page);
  const source = (await started).postDataJSON().photoId;
  await addPhoto(page, 'Front', 'detail.jpg');
  await addPhoto(page, 'Back', 'back.jpg');
  await addPhoto(page, 'Label', 'label.jpg');
  const wait = page.waitForResponse((r) => r.url().endsWith('/v2/assess'));
  await page.getByRole('button', { name: 'Review the evidence' }).click();
  const result = await (await wait).json();
  expect(result.decision.outcome).toBe('offer');
  expect(result.replacements).toContainEqual(
    expect.objectContaining({ status: 'possible', photoId: source }),
  );
  expect(result.transitions).toHaveLength(1);
});

test('undo restores the actual source and removes its superseded relationship', async ({
  page,
}) => {
  carried = { level: 0.94 };
  await startCheck(page);
  await page.getByRole('button', { name: 'Continue to photos' }).click();
  await addPhoto(page, 'Front', 'front.jpg');
  await addPhoto(page, 'Back', 'back.jpg');
  await addPhoto(page, 'Label', 'label.jpg');
  await allow(page);
  const first = page.waitForResponse((r) => r.url().endsWith('/v2/assess'));
  await page.getByRole('button', { name: 'Review the evidence' }).click();
  const previous = await (await first).json();
  expect(previous.decision.outcome).toBe('no_offer');
  await page.getByRole('button', { name: 'Back to your notebook' }).click();
  await page.getByRole('button', { name: 'Continue your gear check', exact: true }).first().click();
  await page.getByRole('button', { name: /^Front photo captured$/ }).click();
  await page.getByRole('button', { name: 'Remove this photograph' }).click();
  await page.getByRole('button', { name: 'Undo removal' }).click();
  const again = page.waitForResponse((r) => r.url().endsWith('/v2/assess'));
  await page.getByRole('button', { name: 'Review the evidence' }).click();
  const restored = await (await again).json();
  expect(restored.decision).toEqual(previous.decision);
  expect(restored.replacements ?? []).toEqual([]);
});

test('the terms-enabled count check resolves just the disputed front and is reused from the draft', async ({
  page,
}) => {
  let calls = 0;
  const normal = stubScorer({
    answers: { ...CLEAN_ITEM, category: { choice: 'boots' } },
    delayMs: 0,
  });
  const paired: Scorer = {
    ...normal,
    async score(photo, qs, signal) {
      return stubScorer({
        answers: {
          ...CLEAN_ITEM,
          category: { choice: 'boots' },
          single_item: photo.view === 'front' ? 0.2 : 0.95,
        },
        delayMs: 0,
      }).score(photo, qs, signal);
    },
  };
  const cfg = JSON.parse(await fs.readFile('packages/core/v2/policy.config.json', 'utf8'));
  const bands = JSON.parse(await fs.readFile('packages/core/v2/thresholds.json', 'utf8'));
  const local = createAppV2({
    chain: new ScorerChain([paired]),
    config: cfg,
    thresholds: bands,
    planned: true,
    workingEdge: 1600,
    signingKey: 'neutral-browser-transport-test-'.repeat(2),
    countReview: {
      async read() {
        calls++;
        return 'matched_pair';
      },
    },
  });
  const address = await local.listen({ host: '127.0.0.1', port: 0 });
  const uploaded: string[] = [];
  page.on('request', (req) => {
    if (req.url() === address + '/v2/assess' && req.postDataJSON().countCheck)
      uploaded.push(req.postDataJSON().countCheck.photoId);
  });
  try {
    await page.getByRole('button', { name: 'Connection and privacy settings' }).click();
    await page.getByLabel('Analysis service URL', { exact: true }).fill(address);
    await page.getByRole('button', { name: 'Save and check connection' }).click();
    await expect(
      page.getByText(/processed by the Relay assessment service under the terms you accepted/),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Go back', exact: true }).click();
    await startCheck(page);
    await page.getByRole('button', { name: 'Continue to photos' }).click();
    await addPhoto(page, 'Front', 'front.jpg');
    await addPhoto(page, 'Back', 'back.jpg');
    await addPhoto(page, 'Label', 'label.jpg');
    await allow(page);
    await page.getByRole('button', { name: 'Review the evidence' }).click();
    await expect(page.getByText('Offer recommended', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Back to your notebook' }).click();
    await page.reload();
    await page
      .getByRole('button', { name: 'Continue your gear check', exact: true })
      .first()
      .click();
    await allow(page);
    await page.getByRole('button', { name: 'Review the evidence' }).click();
    await expect(page.getByText('Offer recommended', { exact: true }).first()).toBeVisible();
    expect(calls).toBe(1);
    expect(uploaded).toHaveLength(1);
    const d = await page.evaluate(() => JSON.parse(localStorage.getItem('relay.draft.v1')!));
    expect(d.countReceipt.check.photoId).toBe(uploaded[0]);
    expect(
      d.photos.find((p: { view: string }) => p.view === 'front').v2.signed.scores.answers
        .single_item.p,
    ).toBe(0.2);
  } finally {
    await local.close();
  }
});

test('a newly reported crash keeps the earlier possible cue in the notebook without another photo assessment', async ({
  page,
}) => {
  carried = { level: 0.35 };
  await startCheck(page);
  await page.getByRole('button', { name: 'Continue to photos' }).click();
  await addPhoto(page, 'Front', 'front.jpg');
  await addPhoto(page, 'Back', 'back.jpg');
  await addPhoto(page, 'Label', 'label.jpg');
  await allow(page);
  const wait = page.waitForResponse((r) => r.url().endsWith('/v2/assess'));
  await page.getByRole('button', { name: 'Review the evidence' }).click();
  const first = await (await wait).json();
  expect(first.decision.reasons[0].code).toBe('possible_road_contact');
  await page.getByRole('button', { name: 'Back to your notebook' }).click();
  await page.getByRole('button', { name: 'Continue your gear check', exact: true }).first().click();
  await addPhoto(page, 'Front', 'detail.jpg');
  await page.getByRole('button', { name: 'Add item history', exact: true }).click();
  await page.getByRole('radio', { name: 'Has it been worn in a crash? Yes', exact: true }).click();
  await page.getByRole('button', { name: 'See the next step' }).click();
  await page.getByRole('button', { name: 'Save brief & check next item' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('relay.briefs.v1') ?? '[]')[0]?.text),
    )
    .toContain('a possible road-contact cue');
  const b = await page.evaluate(() => JSON.parse(localStorage.getItem('relay.briefs.v1')!)[0]);
  expect(b.replacedOverviews[0].photoId).toBe(first.findings[0].finding.photoId);
  expect(b.photos.length).toBe(4);
});
