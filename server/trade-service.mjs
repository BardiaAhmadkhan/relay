import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tradeLedger, problem, hash } from './trade-ledger.mjs';
import { scrapeCatalog } from './store-catalog.mjs';
import { shopifyCredit } from './shopify-credit.mjs';
import { signedProfile, tradeOffer } from '../src/engine/trade-value.mjs';
const defaultDb = fileURLToPath(new URL('../.local/trade-in.sqlite', import.meta.url));
const day = 24 * 3600000;
export async function bodyJSON(req, limit = 8192) {
  let size = 0;
  const chunks = [];
  for await (const part of req) {
    const c = Buffer.from(part);
    size += c.length;
    if (size > limit) throw problem(413, 'This request is too large.');
    chunks.push(c);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error();
    return parsed;
  } catch {
    throw problem(400, 'Check the submitted fields.');
  }
}
export function catalogCache(env, db, scraper = scrapeCatalog) {
  const store = env.RELAY_STORE_URL || '';
  let updating,
    lastFailure = 0;
  function age(snapshot) {
    const elapsed = Date.now() - Date.parse(snapshot?.updated);
    return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : Infinity;
  }
  async function refresh() {
    if (!store) throw problem(503, 'The shop has not connected its catalog.');
    if (!updating)
      updating = scraper({ store })
        .then((c) => {
          db.saveCatalog(store, c);
          lastFailure = 0;
          return c;
        })
        .catch((e) => {
          lastFailure = Date.now();
          throw e;
        })
        .finally(() => {
          updating = null;
        });
    return updating;
  }
  return {
    store,
    refresh,
    async read({ requireFresh = false } = {}) {
      let c = db.snapshot(store);
      if (age(c) < 6 * 3600000) return { catalog: c, fresh: true };
      if (!lastFailure || Date.now() - lastFailure >= 300000) {
        const refreshJob = refresh();
        // A recent complete inventory can render a dated estimate immediately.
        // Staff handovers and debits wait for current inventory and check freshness.
        if (!requireFresh && age(c) <= 30 * day) {
          void refreshJob.catch(() => {});
          return { catalog: c, fresh: false };
        }
        try {
          c = await refreshJob;
        } catch {
          /* report availability below */
        }
      }
      if (age(c) > 30 * day)
        throw problem(503, 'The shop catalog is unavailable. Please try again later.');
      return { catalog: c, fresh: age(c) < 6 * 3600000 };
    },
  };
}
export function openLedger(env) {
  const file = env.RELAY_TRADE_DB ? path.resolve(env.RELAY_TRADE_DB) : defaultDb;
  const repo = fileURLToPath(new URL('../', import.meta.url));
  for (const name of ['public', 'dist', '.git']) {
    const rel = path.relative(path.join(repo, name), file);
    if (!rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)))
      throw Error(
        'The credit database must be outside public assets, build output and Git metadata.',
      );
  }
  return tradeLedger(file);
}
const claimOK = (s) => typeof s === 'string' && /^[a-f0-9]{48,64}$/.test(s);
export function tradeService(
  env,
  {
    staff,
    upstream,
    db = openLedger(env),
    cache = catalogCache(env, db),
    online = shopifyCredit(env),
    fetcher = fetch,
  },
) {
  const jobs = new Map(),
    legacy = (upstream?.origin ?? 'examples') + '|' + cache.store;
  const space = upstream
    ? db.assignSpace(
        env.RELAY_WORKSHOP_ID ?? 'primary',
        legacy,
        cache.store ? new URL(cache.store).origin : null,
      )
    : 'examples';
  async function api(p, body) {
    const response = await fetcher(new URL('/v4' + p, upstream), {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      headers: {
        ...(env.RELAY_UPSTREAM_TOKEN ? { 'x-relay-token': env.RELAY_UPSTREAM_TOKEN } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(18000),
    });
    if (!response.ok)
      throw problem(
        response.status === 404 ? 404 : 503,
        'The inspection service could not confirm this record.',
      );
    return response.json();
  }
  const person = (t) => {
    const x = staff.get(hash(String(t ?? '')));
    return x && x.expires > Date.now() ? x : null;
  };
  function checkId(id) {
    if (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id))
      throw problem(400, 'Invalid inspection number.');
  }
  async function context(id, scenario) {
    checkId(id);
    const health = await api('/health');
    if (
      !['actual', 'clear', 'custody_clear', 'crash'].includes(scenario) ||
      (!health.demo && scenario !== 'actual')
    )
      throw problem(400, 'This history is available only in rehearsal.');
    return { demo: !!health.demo, scope: space + '|' + (health.demo ? 'practice' : 'live') };
  }
  async function quote(id, s, prefs, requireFresh = false) {
    const ctx = await context(id, s),
      suffix = '?scenario=' + encodeURIComponent(s);
    const raw = await api('/items/' + id + suffix),
      profile = signedProfile(raw.value);
    if (!profile.eligible)
      return {
        ...ctx,
        receipt: raw.sha256,
        offer: tradeOffer(profile, { products: [], currency: 'CAD' }, null),
        terms: null,
        quote: null,
        updated: null,
        fresh: false,
      };
    const [shop, source] = await Promise.all([
      api('/shop/' + id + suffix + '&market=CA'),
      cache.read({ requireFresh }).catch(() => null),
    ]);
    if (!shop.eligible || shop.inspection !== raw.sha256)
      throw problem(409, 'The inspection changed. Reopen this trade to see the current decision.');
    if (!source) {
      const offer = tradeOffer(profile, { currency: 'CAD', products: [] }, shop.terms.terms);
      offer.reason =
        'The shop’s current prices are unavailable. Recheck the catalog to calculate credit.';
      return {
        ...ctx,
        receipt: raw.sha256,
        offer,
        terms: shop.terms.terms,
        quote: null,
        updated: null,
        fresh: false,
      };
    }
    const grade = /^[A-D]$/.test(raw.value.appearance?.grade ?? '')
      ? raw.value.appearance.grade
      : null;
    const gradeRate = grade ? env['RELAY_RESALE_GRADE_' + grade] : undefined;
    const rates = { ...shop.terms.terms };
    if (gradeRate !== undefined && gradeRate !== '') {
      const v = Number(gradeRate);
      if (!Number.isFinite(v) || v < 0 || v > 1)
        throw problem(503, 'Check the configured resale rate for this condition grade.');
      rates.resaleRatio = v;
    }
    const c = source.catalog,
      offer = tradeOffer(profile, c, rates, { ...prefs, size: prefs?.size || profile.size });
    const fingerprint = hash(
      JSON.stringify([
        raw.sha256,
        space,
        offer.credit,
        offer.retail,
        offer.used,
        offer.basis,
        rates,
        c.currency,
      ]),
    );
    return {
      ...ctx,
      receipt: raw.sha256,
      offer,
      grade,
      gradeRateApplied: gradeRate !== undefined && gradeRate !== '',
      terms: rates,
      quote: fingerprint,
      updated: c.updated,
      fresh: source.fresh,
      source: c.origin,
      currency: c.currency,
    };
  }
  async function wallet(c) {
    if (!c) return null;
    const balance =
      c.state === 'issued' && c.channel === 'shopify'
        ? ((await online?.balance(c.remote).catch(() => null)) ?? null)
        : c.remaining;
    return {
      amount: c.amount,
      remaining: balance,
      code: c.state === 'issued' ? c.code : null,
      state: c.state,
      channel: c.channel,
      created: c.created,
    };
  }
  const allowed = (ctx, item, b, actor) =>
    (!!actor && actor.demo === ctx.demo) || (claimOK(b.claim) && db.rider(space, b.claim) === item);
  return {
    cache,
    owns: (id, claim) => claimOK(claim) && db.rider(space, claim) === id,
    hasClaim: (claim) => claimOK(claim) && !!db.rider(space, claim),
    async handle(route, b, token) {
      if (route === 'catalog') {
        const { catalog, fresh } = await cache.read();
        return { ...catalog, fresh };
      }
      if (!upstream) throw problem(404, 'A connected workshop is required.');
      if (route === 'begin') {
        if (!claimOK(b.claim) || !['yes', 'no', 'unknown'].includes(b.history))
          throw problem(400, 'The garment history is incomplete.');
        const existing = db.rider(space, b.claim);
        if (existing) return { id: existing, state: 'capture' };
        if (jobs.has(b.claim)) return jobs.get(b.claim);
        if (!db.lockStart(space, b.claim))
          throw problem(409, 'This intake is already opening. Retry with the same saved draft.');
        const start = api('/intakes', { exclusionHistory: b.history, captureMode: 'guided' })
          .then((r) => {
            db.bind(space, b.claim, r.id);
            return r;
          })
          .finally(() => {
            jobs.delete(b.claim);
            db.unlockStart(space, b.claim);
          });
        jobs.set(b.claim, start);
        return start;
      }
      const id = b.id,
        s = b.scenario ?? 'actual',
        actor = person(token);
      if (route === 'balance') {
        const h = await api('/health'),
          scope = space + '|' + (h.demo ? 'practice' : 'live');
        let c;
        if (typeof b.code === 'string' && /^[A-Z0-9 -]{16,40}$/i.test(b.code)) {
          c = db.byCode(scope, b.code.replace(/[ -]/g, '').toUpperCase());
          if (!c || c.state !== 'issued') throw problem(404, 'No issued credit matches that code.');
        } else {
          checkId(id);
          if (!allowed({ demo: !!h.demo }, id, b, actor))
            throw problem(403, 'Open this credit on the original device or enter its code.');
          c = db.credit(scope, id);
        }
        return { item: c?.item ?? id, wallet: await wallet(c), practice: !!h.demo };
      }
      checkId(id);
      if (route === 'offer') {
        const q = await quote(id, s, b.prefs);
        const c = db.credit(q.scope, id),
          owns = allowed(q, id, b, actor);
        if (c?.offer_json && owns && q.offer.kind === 'eligible') {
          const saved = JSON.parse(c.offer_json);
          Object.assign(q, {
            terms: saved.terms,
            grade: saved.grade,
            gradeRateApplied: saved.gradeRateApplied,
            updated: saved.updated,
            offer: { ...q.offer, ...saved.offer },
          });
        }
        return { ...q, scope: undefined, wallet: owns ? await wallet(c) : null, creditIssued: !!c };
      }
      if (!actor) throw problem(403, 'Open a staff session to handle a store credit.');
      const ctx = await context(id, s);
      if (ctx.demo !== actor.demo)
        throw problem(403, 'This staff session belongs to a different workspace.');
      if (route === 'issue') {
        if (b.received !== true) throw problem(422, 'Confirm the garment has been handed over.');
        let c = db.credit(ctx.scope, id);
        if (!c) {
          const q = await quote(id, s, {}, true);
          if (!q.offer.credit || !q.fresh || q.receipt !== b.receipt || q.quote !== b.quote)
            throw problem(
              409,
              'The inspection, catalog or trade-in amount changed. Refresh the offer before accepting the garment.',
            );
          const last = await api('/items/' + id + '?scenario=' + encodeURIComponent(s));
          if (last.sha256 !== q.receipt || !signedProfile(last.value).eligible)
            throw problem(409, 'The inspection changed during this handover. Reopen the result.');
          const { recommendations, ...fixed } = q.offer;
          c = db.reserve(
            ctx.scope,
            id,
            q.receipt,
            q.offer.credit,
            !ctx.demo && online ? 'shopify' : 'counter',
            actor.name,
            {
              offer: fixed,
              terms: q.terms,
              grade: q.grade,
              gradeRateApplied: q.gradeRateApplied,
              updated: q.updated,
            },
          );
        }
        if (c.channel === 'shopify' && c.state === 'pending') {
          if (!online)
            throw problem(503, 'Reconnect the same Shopify account to confirm this credit.');
          const decision = await api('/items/' + id + '?scenario=' + encodeURIComponent(s));
          c = db.activate(
            ctx.scope,
            id,
            await online.activate(c, {
              allowCreate: decision.sha256 === c.receipt && signedProfile(decision.value).eligible,
            }),
          );
        }
        return { wallet: await wallet(c), practice: ctx.demo };
      }
      if (route === 'redeem') {
        const c = db.credit(ctx.scope, id);
        if (
          !c ||
          c.channel !== 'counter' ||
          typeof b.code !== 'string' ||
          b.code.replace(/[\s-]/g, '').toUpperCase() !== c.code
        )
          throw problem(403, 'Present the credit code for this trade.');
        if (!/^[\w ./-]{2,80}$/.test(b.sale ?? ''))
          throw problem(422, 'Enter the store sale reference.');
        const order = b.sale.trim().toUpperCase();
        if (order.length < 2) throw problem(422, 'Enter the store sale reference.');
        const past = db.sale(ctx.scope, order);
        if (past) {
          const result = db.redeem(ctx.scope, id, order, b.variant, b.amount, actor.name);
          return { ...result, wallet: await wallet(c), practice: ctx.demo };
        }
        const { catalog, fresh } = await cache.read({ requireFresh: true });
        const v = catalog.products.flatMap((p) => p.variants).find((v) => v.id === b.variant);
        if (
          !fresh ||
          !v ||
          !v.available ||
          !Number.isSafeInteger(b.amount) ||
          b.amount <= 0 ||
          b.amount > v.price
        )
          throw problem(
            422,
            'Choose an available item and enter a sale amount within its listed price.',
          );
        const result = db.redeem(ctx.scope, id, order, v.id, b.amount, actor.name);
        return { ...result, wallet: await wallet(db.credit(ctx.scope, id)), practice: ctx.demo };
      }
      throw problem(404, 'Unknown trade action.');
    },
    close: () => db.close(),
  };
}
