import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tradeOffer, signedProfile, garmentSize } from '../src/engine/trade-value.mjs';
import { normalizeProduct, scrapeCatalog } from '../server/store-catalog.mjs';
import { tradeLedger, hash } from '../server/trade-ledger.mjs';
import { tradeService, catalogCache } from '../server/trade-service.mjs';
import { shopifyCredit } from '../server/shopify-credit.mjs';
const rates = { resaleRatio: 0.5, buyRate: 0.4, creditPremium: 0.1 };
function product(i, price, extra = {}) {
  return {
    handle: 'ride-' + i,
    title: 'Harbour ' + i + ' jacket',
    brand: 'Demo Gear',
    category: 'jacket',
    type: 'Jacket',
    fabric: ['textile'],
    styles: ['touring'],
    cut: 'unspecified',
    url: 'https://gear.example/products/ride-' + i,
    image: null,
    currency: 'CAD',
    variants: [{ id: 'v' + i, price, available: true, size: 'M', length: '' }],
    ...extra,
  };
}
const catalog = {
  origin: 'https://gear.example',
  currency: 'CAD',
  updated: new Date().toISOString(),
  products: [product(1, 30000), product(2, 40000), product(3, 50000)],
  variantCount: 3,
};
const profile = { eligible: true, category: 'jacket', brand: '', model: '', fabric: ['textile'] };
test('signed eligibility gates every amount even when the retail catalog has a strong match', () => {
  for (const eligible of [false, undefined]) {
    const o = tradeOffer({ ...profile, eligible }, catalog, rates);
    assert.equal(o.credit, null);
    assert.deepEqual(o.recommendations, []);
  }
  for (const h of ['combined', 'crash', 'damage', 'repair'])
    assert.equal(
      signedProfile({
        result: { offerEligible: true, action: 'keep' },
        history: { [h]: 'yes' },
        fields: [],
        names: [],
      }).eligible,
      false,
    );
});
test('each comparable contributes one price and preferences cannot raise a trade-in offer', () => {
  const o = tradeOffer(profile, catalog, rates);
  assert.equal(o.retail.mid, 40000);
  assert.equal(o.used, 20000);
  assert.equal(o.credit, 8800);
  assert.equal(o.comparables.length, 3);
  assert.equal(
    signedProfile({
      result: { offerEligible: true, action: 'keep' },
      names: ['Detached maker'],
      fields: [],
      identity: { unresolved: false },
    }).brand,
    '',
  );
  assert.equal(tradeOffer(profile, catalog, rates, { size: 'XS' }).credit, 8800);
  assert.equal(tradeOffer(profile, catalog, rates, { size: 'XS' }).recommendations.length, 0);
  assert.equal(tradeOffer(profile, catalog, { ...rates, buyRate: null }).credit, null);
  assert.equal(
    tradeOffer(profile, { ...catalog, products: catalog.products.slice(0, 2) }, rates).credit,
    null,
  );
});
test('identified model, gender, size, sold-out status and sale price are independent checks', () => {
  const c = {
    ...catalog,
    products: [
      ...catalog.products,
      product(7, 25000, {
        cut: 'women',
        title: 'Merlin 88 Riding Jacket',
        variants: [
          { id: 'no', available: false, price: 100, size: 'L' },
          { id: 'buy', available: true, price: 25000, size: 'M' },
        ],
      }),
    ],
  };
  const p = { ...profile, brand: 'Demo', model: 'Merlin 88' };
  const v = tradeOffer(p, c, rates, { fit: 'women', size: 'M' });
  assert.equal(v.basis, 'same-model');
  assert.equal(v.retail.mid, 25000);
  assert.equal(v.recommendations[0].variant, 'buy');
  assert.equal(
    tradeOffer(p, c, rates, { fit: 'men' }).recommendations.some((r) => r.variant === 'buy'),
    false,
  );
  assert.equal(garmentSize('W32 / L32'), '32/32');
  assert.notEqual(garmentSize('EU 48'), garmentSize('US 48'));
});
test('published title corrects inconsistent store types and rainwear is separate from protective riding gear', () => {
  const src = {
    title: 'Riding pants for women',
    type: 'Motorcycle jacket',
    handle: 'riding-pants',
    vendor: 'Shop',
    tags: [],
    options: [{ name: 'Size' }],
    variants: [{ id: 23, title: 'M', price: 18000, available: true, options: ['M'] }],
    images: [],
  };
  const url = new URL('https://gear.example/products/riding-pants');
  assert.equal(normalizeProduct(src, url, 'CAD').category, 'pants');
  assert.equal(normalizeProduct({ ...src, title: 'Rain pants' }, url, 'CAD').category, 'outerwear');
  assert.throws(() => normalizeProduct({ ...src, variants: [{ price: '12.99' }] }, url, 'CAD'));
});
test('size punctuation preserves waist, inseam and regional sizing across catalog matches', () => {
  const pants = product(9, 34000, {
    category: 'pants',
    variants: [
      { id: 'short', available: true, price: 34000, size: 'W32', length: 'L30' },
      { id: 'long', available: true, price: 34000, size: 'W32', length: 'L34' },
    ],
  });
  for (const size of ['W32 / L34', '32/34', '32 × 34', '32x34', '32W 34L']) {
    assert.equal(garmentSize(size), '32/34');
    const result = tradeOffer(
      { ...profile, category: 'pants' },
      { ...catalog, products: [pants] },
      rates,
      { size },
    );
    assert.deepEqual(
      result.recommendations.map((r) => r.variant),
      ['long'],
    );
  }
  assert.notEqual(garmentSize('32–34'), garmentSize('32/34'));
  assert.equal(garmentSize('EU48'), garmentSize('EU 48'));
  assert.notEqual(garmentSize('EU48'), garmentSize('US48'));
});
test('a garment bundled with a liner is distinct from a standalone accessory', () => {
  const url = new URL('https://gear.example/products/gear');
  for (const [title, type, expected] of [
    ['Touring Pant', 'Motorcycle Pant', 'pants'],
    ['Riding Jean', '', 'pants'],
    ['Overboots for riding pants', 'Rain protection', 'outerwear'],
    ['Winter Gloves for riding jackets', 'Gloves', 'gloves'],
    ['Road Jacket with removable liner', 'Motorcycle Jacket', 'jacket'],
    ['Riding Pant including knee protectors', 'Trousers', 'pants'],
    ['Removable liner for riding jacket', 'Liner', 'outerwear'],
    ['Knee protectors for riding pants', 'Protection', 'armour'],
  ]) {
    const p = {
      title,
      type,
      handle: 'gear',
      variants: [{ id: 1, title: 'M', price: 10000, available: true }],
    };
    assert.equal(normalizeProduct(p, url, 'CAD').category, expected, title);
  }
});
test('sitemap import selects the requested market, retains sizes and sold-out variants, and fails closed on blocked product paths', async () => {
  let blocked = false;
  const calls = [];
  const fetcher = async (url) => {
    const p = url.pathname;
    calls.push(p);
    if (p === '/robots.txt')
      return new Response('User-agent: *\n' + (blocked ? 'Disallow: /products/' : 'Allow: /'));
    if (p === '/') return new Response('Shopify.currency = {"active":"CAD"}');
    if (p === '/sitemap.xml')
      return new Response(
        '<sitemap><loc>https://gear.example/sitemap_products_1.xml</loc></sitemap>',
      );
    if (p === '/sitemap_products_1.xml')
      return new Response(
        '<url><loc>https://gear.example/products/coat</loc></url><url><loc>https://gear.example/fr/products/manteau</loc></url>',
      );
    if (p !== '/products/coat.js') throw Error(p);
    return Response.json({
      title: 'Urban jacket',
      type: 'Jacket',
      handle: 'coat',
      vendor: 'Gear',
      variants: [
        { id: 1, price: 20000, available: false, options: ['S'] },
        { id: 2, price: 23000, available: true, options: ['M'] },
      ],
      options: [{ name: 'Size' }],
    });
  };
  const c = await scrapeCatalog({ store: 'https://gear.example', fetcher, pause: async () => {} });
  assert.equal(c.products.length, 1);
  assert.equal(c.variantCount, 2);
  assert.deepEqual(
    c.products[0].variants.map((v) => v.price),
    [20000, 23000],
  );
  assert.ok(!calls.some((u) => u.includes('manteau')));
  blocked = true;
  await assert.rejects(
    scrapeCatalog({ store: 'https://gear.example', fetcher, pause: async () => {} }),
    /crawl rules/,
  );
});
test('a failed catalog refresh preserves last known inventory and reports staleness', async () => {
  const db = tradeLedger(':memory:');
  try {
    db.saveCatalog('https://gear.example', {
      ...catalog,
      updated: new Date(Date.now() - 12 * 3600000).toISOString(),
    });
    const c = catalogCache({ RELAY_STORE_URL: 'https://gear.example' }, db, async () => {
      throw Error('store offline');
    });
    const s = await c.read();
    assert.equal(s.fresh, false);
    assert.equal(s.catalog.products.length, 3);
  } finally {
    db.close();
  }
});
test('dated estimates return before the shared catalog refresh while settlement waits for current prices', async () => {
  const db = tradeLedger(':memory:'),
    store = 'https://gear.example';
  let finish,
    calls = 0;
  const previous = { ...catalog, updated: new Date(Date.now() - 8 * 3600000).toISOString() };
  db.saveCatalog(store, previous);
  const cache = catalogCache({ RELAY_STORE_URL: store }, db, () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  try {
    const [first, second] = await Promise.all([cache.read(), cache.read()]);
    assert.equal(first.fresh, false);
    assert.equal(second.catalog.updated, previous.updated);
    const settlement = cache.read({ requireFresh: true });
    assert.equal(calls, 1);
    finish({ ...catalog, updated: new Date().toISOString() });
    assert.equal((await settlement).fresh, true);
    assert.equal((await cache.read()).fresh, true);
    assert.equal(calls, 1);
  } finally {
    db.close();
  }
});
test('invalid, future and expired inventory cannot be displayed after refresh failure', async () => {
  const store = 'https://gear.example';
  for (const updated of [
    'invalid',
    new Date(Date.now() + 2 * 86400000).toISOString(),
    new Date(Date.now() - 31 * 86400000).toISOString(),
  ]) {
    const db = tradeLedger(':memory:');
    try {
      db.saveCatalog(store, { ...catalog, updated });
      const cache = catalogCache({ RELAY_STORE_URL: store }, db, async () => {
        throw Error('offline');
      });
      await assert.rejects(cache.read(), /unavailable/);
      await assert.rejects(cache.read({ requireFresh: true }), /unavailable/);
    } finally {
      db.close();
    }
  }
});
test('a physical item creates one credit, keeps its original amount on retry, and cannot overspend', () => {
  const db = tradeLedger(':memory:');
  try {
    const a = db.reserve('space', 'item', 'r1', 8000, 'counter', 'Clerk'),
      b = db.reserve('space', 'item', 'r2', 12000, 'counter', 'Clerk');
    assert.match(a.code, /^[A-Z0-9]{20}$/);
    assert.equal(b.code, a.code);
    assert.equal(b.amount, 8000);
    assert.deepEqual(db.redeem('space', 'item', '123', 'v1', 5000, 'Clerk'), {
      applied: 5000,
      remaining: 3000,
    });
    assert.deepEqual(db.redeem('space', 'item', '123', 'v1', 5000, 'Clerk'), {
      applied: 5000,
      remaining: 3000,
    });
    assert.throws(() => db.redeem('space', 'item', '123', 'v1', 4000, 'Clerk'));
    assert.deepEqual(db.redeem('space', 'item', '124', 'v2', 5000, 'Clerk'), {
      applied: 3000,
      remaining: 0,
    });
    assert.throws(() => db.redeem('space', 'item', '125', 'v3', 100, 'Clerk'));
  } finally {
    db.close();
  }
});
test('staff receipt, physical handover, current policy and origin-bound rider ticket are required for a spendable credit', async () => {
  const db = tradeLedger(':memory:'),
    staff = new Map([
      [hash('clerk'), { name: 'Counter', demo: false, expires: Date.now() + 50000 }],
    ]);
  let receipt = 'signed-one',
    safe = true,
    fresh = true,
    creates = 0,
    terms = { ...rates };
  const h = 'b'.repeat(48);
  const fetcher = async (url) => {
    const p = url.pathname;
    if (p.endsWith('/health')) return Response.json({ demo: false });
    if (p.endsWith('/intakes')) {
      creates++;
      return Response.json({ id: 'new-1', state: 'capture' });
    }
    if (p.includes('/items/'))
      return Response.json({
        sha256: receipt,
        value: {
          result: { offerEligible: safe, action: safe ? 'keep' : 'retire' },
          category: 'jacket',
          names: [],
          fields: [],
          appearance: { grade: 'B' },
        },
      });
    return Response.json({ inspection: receipt, eligible: safe, terms: { terms } });
  };
  const app = tradeService(
    { RELAY_RESALE_GRADE_B: '.6' },
    {
      staff,
      upstream: new URL('http://localhost'),
      db,
      cache: { store: catalog.origin, read: async () => ({ catalog, fresh }) },
      fetcher,
      online: null,
    },
  );
  try {
    await Promise.all([1, 2].map(() => app.handle('begin', { claim: h, history: 'no' })));
    assert.equal(creates, 1);
    let q = await app.handle('offer', { id: 'new-1', claim: h });
    assert.equal(q.offer.credit, 10560);
    assert.equal(q.gradeRateApplied, true);
    const request = { id: 'new-1', quote: q.quote, receipt: q.receipt, received: true };
    await assert.rejects(app.handle('issue', request), /staff session/);
    await assert.rejects(
      app.handle('issue', { ...request, received: false }, 'clerk'),
      /handed over/,
    );
    receipt = 'signed-two';
    await assert.rejects(app.handle('issue', request, 'clerk'), /changed/);
    receipt = 'signed-one';
    fresh = false;
    await assert.rejects(app.handle('issue', request, 'clerk'), /changed/);
    fresh = true;
    terms = { ...rates, buyRate: 0.25 };
    await assert.rejects(app.handle('issue', request, 'clerk'), /changed/);
    terms = { ...rates };
    safe = false;
    await assert.rejects(app.handle('issue', request, 'clerk'));
    safe = true;
    const awarded = (await app.handle('issue', request, 'clerk')).wallet;
    assert.equal(awarded.amount, 10560);
    terms = { ...rates, buyRate: 0.2 };
    assert.equal((await app.handle('offer', { id: 'new-1', claim: h })).offer.credit, 10560);
    assert.equal((await app.handle('offer', { id: 'new-1' })).offer.credit, 5280);
    terms = { ...rates };
    assert.equal((await app.handle('offer', { id: 'new-1' })).wallet, null);
    assert.equal(
      (await app.handle('balance', { id: 'new-1', claim: h })).wallet.code,
      awarded.code,
    );
    assert.equal((await app.handle('balance', { code: awarded.code })).item, 'new-1');
    safe = false;
    const held = await app.handle('offer', { id: 'new-1', claim: h });
    assert.equal(held.offer.credit, null);
    assert.equal(held.wallet.amount, 10560);
    safe = true;
    const sale = {
      id: 'new-1',
      code: awarded.code,
      sale: 'invoice-1',
      amount: 3000,
      variant: 'v1',
    };
    await assert.rejects(app.handle('redeem', { ...sale, amount: 40000 }, 'clerk'));
    assert.equal((await app.handle('redeem', sale, 'clerk')).remaining, 7560);
    assert.equal((await app.handle('redeem', sale, 'clerk')).remaining, 7560);
  } finally {
    app.close();
  }
});
test('an uncertain Shopify result is recoverable with one stable code and no duplicate gift card', async () => {
  let stored = null,
    creates = 0;
  const c = {
    ref: 'opaque-ref',
    code: 'A'.repeat(20),
    amount: 7500,
    created: new Date().toISOString(),
  };
  const provider = shopifyCredit(
    {
      RELAY_SHOPIFY_ADMIN_DOMAIN: 'example.myshopify.com',
      RELAY_SHOPIFY_ADMIN_TOKEN: 'unit-test',
      RELAY_STORE_URL: 'https://gear.example',
    },
    async (_url, opt) => {
      const { query, variables } = JSON.parse(opt.body);
      if (query.includes('giftCards('))
        return Response.json({
          data: { giftCards: { nodes: stored ? [stored] : [], pageInfo: { hasNextPage: false } } },
        });
      if (query.includes('shop{'))
        return Response.json({
          data: { shop: { currencyCode: 'CAD', primaryDomain: { host: 'gear.example' } } },
        });
      if (query.includes('giftCardCreate')) {
        creates++;
        stored = {
          id: 'test-card',
          note: variables.input.note,
          lastCharacters: 'AAAA',
          initialValue: { currencyCode: 'CAD', amount: '75' },
          balance: { currencyCode: 'CAD', amount: '75' },
        };
        throw Error('connection interrupted');
      }
      return Response.json({
        data: { giftCard: { enabled: true, balance: { currencyCode: 'CAD', amount: '12.50' } } },
      });
    },
  );
  await assert.rejects(provider.activate(c));
  assert.equal(await provider.activate(c), 'test-card');
  assert.equal(creates, 1);
  assert.equal(await provider.balance('test-card'), 1250);
});
