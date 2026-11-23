import robotsParser from 'robots-parser';
import { categoryKey } from '../src/engine/trade-value.mjs';
export const STORE_AGENT = 'RelayCatalog';
const entities = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
const locs = (xml) =>
  [...xml.matchAll(/<loc(?:\s[^>]*)?>([\s\S]*?)<\/loc>/gi)].map((m) => entities(m[1].trim()));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
function cleanOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw Error('Use an HTTPS storefront with an optional market path.');
  return url;
}
function taxonomy(title, type, tags) {
  const primary = title.toLowerCase(),
    fields = (type + ' ' + tags.join(' ')).toLowerCase();
  if (
    /rain (?:jacket|pants)|rain suit|overpants|overtrousers|liner|base layer|overboots/i.test(
      primary + ' ' + type,
    )
  )
    return 'outerwear';
  if (/\b(gloves?|protectors?|helmets?|vests?|boots?|suits?)\b/.test(primary))
    return categoryKey(primary);
  if (/\b(pants|jeans|trousers|denim jean)\b/.test(primary)) return 'pants';
  if (/jacket|overshirt|hoodie/.test(primary)) return 'jacket';
  if (/jacket|overshirt/.test(fields)) return 'jacket';
  if (/pants|jeans|trousers/.test(fields)) return 'pants';
  const kind = categoryKey(type);
  return ['gloves', 'armour', 'helmet', 'boots', 'vest', 'suit'].includes(kind) ? kind : 'other';
}
export function normalizeProduct(p, url, currency) {
  if (!p || typeof p.title !== 'string' || !Array.isArray(p.variants) || !p.variants.length)
    throw Error('Incomplete published product at ' + url.pathname);
  const tags = Array.isArray(p.tags) ? p.tags : [],
    options = (p.options ?? []).map((o) => String(o.name ?? o).toLowerCase());
  const vi = options.findIndex((x) => /^(?:size|waist|waist size|taille)/.test(x)),
    li = options.findIndex((x) => /inseam|leg length|^length$/.test(x));
  const variants = p.variants.map((v) => {
    if (!v.id || !Number.isSafeInteger(v.price) || v.price < 0 || typeof v.available !== 'boolean')
      throw Error('Cannot validate price or stock for ' + p.title);
    const vals = v.options ?? [v.option1, v.option2, v.option3];
    return {
      id: String(v.id),
      title: String(v.title ?? ''),
      price: v.price,
      available: v.available,
      size: vi >= 0 ? String(vals[vi] ?? '') : '',
      length: li >= 0 ? String(vals[li] ?? '') : '',
    };
  });
  const desc = entities(String(p.description ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .toLowerCase();
  const fabric = ['leather', 'denim', 'textile', 'waxed cotton', 'mesh', 'aramid'].filter((f) =>
    (p.title + ' ' + p.type + ' ' + desc).toLowerCase().includes(f),
  );
  const styles = ['touring', 'adventure', 'commuting', 'urban', 'classic', 'sport'].filter((s) =>
    (p.title + ' ' + tags.join(' ') + ' ' + desc).toLowerCase().includes(s),
  );
  const t = (p.title + ' ' + tags.join(' ')).toLowerCase();
  const cut = /\bwomen(?:'s|’s|s)?\b|\bladies\b|\bfemale\b/.test(t)
    ? 'women'
    : /\bmen(?:'s|’s|s)?\b|\bmale\b/.test(t)
      ? 'men'
      : 'unspecified';
  let image = null;
  try {
    const i = new URL(p.featured_image ?? p.images?.[0] ?? '', url);
    if (
      i.protocol === 'https:' &&
      (i.hostname === url.hostname || i.hostname === 'cdn.shopify.com') &&
      /\.(?:png|jpe?g|webp|avif)(?:$|\?)/i.test(i.pathname)
    ) {
      i.searchParams.set('width', '560');
      image = i.href;
    }
  } catch {}
  return {
    handle: p.handle,
    title: p.title,
    brand: String(p.vendor ?? ''),
    category: taxonomy(p.title, String(p.type ?? ''), tags),
    type: String(p.type ?? ''),
    fabric,
    styles,
    cut,
    currency,
    url: url.href,
    image,
    variants,
  };
}
export async function scrapeCatalog({
  store,
  fetcher = fetch,
  pause = delay,
  now = Date.now,
} = {}) {
  const market = cleanOrigin(store),
    origin = market.origin,
    prefix = market.pathname.replace(/\/$/, '');
  let policy,
    last = 0;
  const reader = async (url, kind, optional = false) => {
    url = new URL(url, origin);
    if (url.origin !== origin || url.username || url.password || url.protocol !== 'https:')
      throw Error('Unexpected catalog origin.');
    if (policy && policy.isAllowed(url.href, STORE_AGENT) === false) {
      if (optional) return null;
      throw Error('Store crawl rules do not permit this catalog request.');
    }
    const wait = Math.max(120, (policy?.getCrawlDelay(STORE_AGENT) ?? 0) * 1000) - (now() - last);
    if (wait > 0) await pause(wait);
    last = now();
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetcher(url, {
        redirect: 'manual',
        headers: {
          'user-agent': STORE_AGENT + '/1.0 (retail product and price index)',
          accept: kind === 'json' ? 'application/json' : 'text/html,application/xml,text/plain',
        },
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 429 || res.status === 503) {
        if (attempt === 2) throw Error('Store asked the catalog to try again later.');
        const retry = res.headers.get('retry-after');
        const seconds = Number(retry) || 0;
        const waitMs = Math.max(
          700 * (attempt + 1),
          seconds * 1000,
          Date.parse(retry ?? '') - now() || 0,
        );
        if (waitMs > 30000) throw Error('Store requested a later refresh.');
        await pause(waitMs);
        continue;
      }
      if (optional && [404, 410].includes(res.status)) return null;
      if (!res.ok) throw Error('Store returned ' + res.status + ' for ' + url.pathname);
      const body = await res.text();
      if (body.length > 12_000_000) throw Error('Catalog page exceeds the supported size.');
      return kind === 'json' ? JSON.parse(body) : body;
    }
  };
  const rules = await reader('/robots.txt', 'text', true);
  policy = robotsParser(origin + '/robots.txt', rules ?? '');
  const home = await reader(prefix + '/', 'text');
  const active = /Shopify\.currency\s*=\s*(\{[^}]+\})/.exec(home)?.[1];
  const curr = active
    ? JSON.parse(active).active
    : home.match(/["']priceCurrency["']\s*:\s*["']([A-Z]{3})/i)?.[1];
  if (curr !== 'CAD') throw Error('The selected storefront must display Canadian dollar prices.');
  const urls = new Map(),
    pending = [origin + '/sitemap.xml'],
    seen = new Set();
  let catalogMap = false;
  while (pending.length) {
    const next = pending.shift();
    if (seen.has(next)) continue;
    if (seen.size >= 1000) throw Error('Oversize sitemap; previous catalog retained.');
    seen.add(next);
    const xml = await reader(next, 'text', seen.size === 1);
    if (!xml) break;
    for (const l of locs(xml)) {
      const u = new URL(l, origin);
      if (u.origin !== origin) continue;
      if (/\/sitemap_products[^/]*\.xml$/i.test(u.pathname)) {
        catalogMap = true;
        if (!seen.has(u.href)) pending.push(u.href);
        continue;
      }
      const m = /^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/products\/([\w-]+)\/?$/i.exec(u.pathname);
      if (m && u.pathname.startsWith(prefix + '/products/')) {
        catalogMap = true;
        urls.set(m[1], new URL(prefix + '/products/' + m[1], origin));
      }
    }
  }
  if (!catalogMap || !urls.size) {
    let prior = '';
    for (let page = 1; page <= 400; page++) {
      const feed = await reader(prefix + '/products.json?limit=250&page=' + page, 'json');
      if (!Array.isArray(feed?.products)) throw Error('No complete public product index.');
      if (!feed.products.length) break;
      const fingerprint = feed.products.map((p) => p.handle).join(',');
      if (fingerprint === prior) throw Error('Store pagination repeated.');
      prior = fingerprint;
      for (const p of feed.products) {
        if (!/^[\w-]+$/.test(p.handle)) throw Error('Invalid product handle');
        urls.set(p.handle, new URL(prefix + '/products/' + p.handle, origin));
      }
      if (feed.products.length < 250) break;
      if (page === 400) throw Error('Product index exceeded page limit.');
    }
  }
  if (!urls.size) throw Error('The storefront returned no public products.');
  const products = [];
  for (const u of urls.values()) {
    const p = await reader(u.href + '.js', 'json');
    products.push(normalizeProduct(p, u, curr));
  }
  return {
    origin,
    currency: curr,
    updated: new Date(now()).toISOString(),
    products,
    variantCount: products.reduce((n, p) => n + p.variants.length, 0),
  };
}
