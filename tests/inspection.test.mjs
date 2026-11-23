import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
let server, commerce, vision, images, capture;
before(async () => {
  server = await createServer({
    configFile: false,
    server: { middlewareMode: true, watch: null, hmr: false },
    appType: 'custom',
    logLevel: 'silent',
  });
  [commerce, vision, images, capture] = await Promise.all(
    [
      '/src/engine/commerce.ts',
      '/src/engine/zone-visibility.ts',
      '/src/intake/photo-format.ts',
      '/src/engine/capture-views.ts',
    ].map((s) => server.ssrLoadModule(s)),
  );
});
after(async () => {
  await server?.close();
});
test('four distinct standard views with one optional condition detail', () => {
  assert.deepEqual(capture.requiredViews, ['front', 'back', 'label', 'inside']);
  assert.deepEqual(capture.intakeViews, [...capture.requiredViews, 'detail']);
});
test('a native mobile picker can omit the file type without losing a valid raster photo', () => {
  assert.equal(images.rasterMime(Buffer.from('RIFF0000WEBP', 'ascii')), 'image/webp');
  assert.equal(images.rasterMime(Buffer.from([255, 216, 255, 224])), 'image/jpeg');
  assert.equal(images.rasterMime(Buffer.from('0000ftypmif10000avif', 'ascii')), 'image/avif');
  assert.equal(images.rasterMime(Buffer.from('0000ftypheic', 'ascii')), 'image/heif');
  assert.equal(images.rasterMime(Buffer.from('<svg />', 'utf8')), undefined);
  assert.equal(images.rasterMime(new Uint8Array()), undefined);
});
test('amounts are rounded to minor units and unknown costs cannot support a quote', () => {
  const params = {
    priceMinor: 10000,
    currency: 'CAD',
    terms: { buyRate: 0.3, resaleRatio: 0.7, handlingMinor: 500, creditPremium: 0.1 },
    freightMinor: 200,
    dutiesMinor: 0,
    saleProbability: 1,
    salvageMinor: null,
    acquisitionMinor: 1000,
  };
  const full = commerce.contribution(params);
  assert.equal(full.breakEvenMinor, 1700);
  assert.equal(full.expectedContributionMinor, 5300);
  assert.equal(full.creditMinor, 1100);
  const missing = commerce.contribution({ ...params, dutiesMinor: null });
  assert.equal(missing.breakEvenMinor, null);
  assert.equal(missing.expectedContributionMinor, null);
  assert.ok(missing.missing.length);
  assert.equal(
    commerce.contribution({ ...params, saleProbability: 0, salvageMinor: 100 }).breakEvenMinor,
    null,
  );
  assert.throws(() => commerce.contribution({ ...params, saleProbability: 1.2 }));
  assert.equal(commerce.sizeKey('32W / 30L'), 'W32/L30');
  assert.notEqual(commerce.sizeKey('UK 40'), commerce.sizeKey('EU 40'));
});
test('a cue needs matching source pixels, region and usable placement before it counts as checked', () => {
  const box = [0.12, 0.1, 0.42, 0.63],
    photo = 'front',
    region = 'source-detail',
    hash = 'original-frame';
  const reading = {
    photo,
    box,
    zone: 'left_shoulder',
    layer: 'exterior',
    state: 'surface',
    regionHash: region,
    decisionUse: 'screening_cue',
  };
  const item = {
    category: 'jacket',
    images: [{ id: photo, hash, regions: [] }],
    visible: [],
    areaChecks: [reading],
  };
  const key = photo + ':' + region,
    place = {
      photo,
      source: hash,
      region,
      box,
      width: 240,
      height: 320,
      fraction: 0.8,
      outlines: [],
      exact: true,
    };
  assert.equal(vision.visibleZones(item, {}).checked, 0);
  assert.equal(
    vision.visibleZones(item, { [key]: { ...place, source: 'another-frame' } }).checked,
    0,
  );
  assert.equal(
    vision.visibleZones(item, { [key]: { ...place, box: [0, 0, 0.5, 0.5] } }).checked,
    0,
  );
  assert.equal(vision.visibleZones(item, { [key]: { ...place, fraction: 0.1 } }).checked, 0);
  const usable = vision.visibleZones(item, { [key]: place });
  assert.equal(usable.checked, 1);
  assert.equal(usable.total, 10);
  const conflict = vision.visibleZones(
    { ...item, visible: [{ ...reading, state: 'open_damage' }] },
    { [key]: place },
  );
  assert.equal(conflict.adverse, 1);
  assert.match(conflict.summary, /specialist/);
});
