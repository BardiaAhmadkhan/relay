import { config } from '../shared/workshop';
import { personalChannel } from '../shared/rider-access';
import { asset, type Mode, type RecordData } from '../shared/domain';
import { amend, read, write } from '../shared/storage';
import {
  tradeOffer,
  type Catalog,
  type Offer,
  type Preferences,
  type Rates,
} from '../engine/trade-value.mjs';
export type Wallet = {
  amount: number;
  remaining: number | null;
  code: string | null;
  state: 'issued' | 'pending';
  channel: 'counter' | 'shopify';
  created: string;
};
export type Quote = {
  grade?: string | null;
  gradeRateApplied?: boolean;
  demo: boolean;
  receipt: string;
  quote: string | null;
  fresh: boolean;
  updated: string | null;
  source?: string;
  currency?: string;
  terms: Rates | null;
  offer: Offer;
  wallet: Wallet | null;
  creditIssued: boolean;
  illustrated?: boolean;
};
export const dollars = (v: number | null | undefined) =>
  v == null
    ? 'Awaiting shop pricing'
    : new Intl.NumberFormat('en-CA', {
        style: 'currency',
        currency: 'CAD',
        minimumFractionDigits: v % 100 ? 2 : 0,
        maximumFractionDigits: 2,
      }).format(v / 100);
export const claimToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
export type RiderTicket = { claim?: string; prefs?: Preferences; garment?: string };
export const ticketKey = (m: Mode, id: string) => 'rider:' + m + ':' + id;
export async function tradeAPI<T>(action: string, body?: unknown, staff?: string): Promise<T> {
  const url = new URL(
    import.meta.env.BASE_URL +
      (personalChannel() && action !== 'catalog' ? 'relay-rider/trade/' : 'relay-trade/') +
      action,
    document.baseURI,
  );
  const r = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    cache: 'no-store',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(staff ? { 'x-relay-staff': staff } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(85000),
  });
  if (!r.headers.get('content-type')?.includes('application/json'))
    throw Error('A workshop connection is required.');
  const v = await r.json();
  if (!r.ok) throw Error(v.error ?? 'The shop could not complete this action.');
  return v;
}
const fixtures = [
  ['Alpine Field Jacket', 'fieldway', 'jacket', 52000, 'waxed cotton', 'touring'],
  ['Breakwater Riding Jacket', 'meridian', 'jacket', 45000, 'leather', 'classic'],
  ['Crosswind Textile Jacket', 'vector', 'jacket', 41000, 'textile', 'commuting'],
  ['Northpass Riding Jeans', 'selvedge', 'pants', 31000, 'denim', 'commuting'],
  ['Calder Touring Jeans', 'switchback', 'pants', 34000, 'denim', 'touring'],
  ['Coast Road Jeans', 'selvedge', 'pants', 29000, 'denim', 'classic'],
] as const;
function illustratedCatalog(): Catalog {
  return {
    origin: 'Illustrated shop',
    updated: '',
    currency: 'CAD',
    variantCount: 24,
    products: fixtures.map(([title, n, category, price, fabric, style], i) => ({
      handle: 'illustrated-' + i,
      title,
      category,
      type: category,
      brand: 'Illustrated shop',
      fabric: [fabric],
      styles: [style],
      cut: 'unspecified',
      currency: 'CAD',
      url: null,
      image: asset(n + '-card'),
      variants: (category === 'pants' ? ['30', '32', '34', '36'] : ['S', 'M', 'L', 'XL']).map(
        (size, j) => ({ id: 'EX-' + i + '-' + j, available: true, price, size, length: '' }),
      ),
    })),
  };
}
let catalogRequest: Promise<Catalog & { fresh: boolean }> | null = null,
  expires = 0;
export function currentCatalog() {
  if (!catalogRequest || Date.now() > expires) {
    expires = Date.now() + 300000;
    catalogRequest = tradeAPI<Catalog & { fresh: boolean }>('catalog').catch((e) => {
      catalogRequest = null;
      throw e;
    });
  }
  return catalogRequest;
}
export async function exampleCatalog() {
  try {
    if ((await config()).catalogConnected === false)
      return { ...illustratedCatalog(), fresh: true, illustrated: true };
    return { ...(await currentCatalog()), illustrated: false };
  } catch {
    return { ...illustratedCatalog(), fresh: true, illustrated: true };
  }
}
export async function getQuote(
  r: RecordData,
  m: Mode,
  scenario: string,
  prefs: Preferences,
  staff: string,
) {
  const t = await read<RiderTicket>(ticketKey(m, r.card.id)).catch(() => undefined);
  if (m !== 'examples')
    return tradeAPI<Quote>('offer', { id: r.card.id, scenario, prefs, claim: t?.claim }, staff);
  const c = await exampleCatalog();
  const saved = await read<Rates>('terms:CA').catch(() => undefined);
  const rates = saved ?? { resaleRatio: 0.55, buyRate: 0.4, creditPremium: 0.1 };
  const material = ['leather', 'cotton', 'textile', 'denim']
    .filter((f) => r.card.details.toLowerCase().includes(f))
    .map((f) => (f === 'cotton' ? 'waxed cotton' : f));
  const offer = tradeOffer(
    {
      eligible: r.eligible && r.card.outcome === 'keep',
      category: r.card.category,
      brand: '',
      model: r.card.name,
      styles: ['touring', 'adventure', 'commuting', 'classic', 'sport'].filter((s) =>
        r.card.name.toLowerCase().includes(s),
      ),
      fabric: material,
    },
    c,
    rates,
    prefs,
  );
  const wallet = await read<Wallet>('example-credit:' + r.card.id).catch(() => undefined);
  return {
    demo: true,
    receipt: 'example',
    quote: 'example',
    fresh: c.fresh,
    updated: c.updated,
    source: c.origin,
    currency: 'CAD',
    terms: rates,
    offer,
    wallet: wallet ?? null,
    creditIssued: !!wallet,
    illustrated: c.illustrated,
  } satisfies Quote;
}
export async function issueExample(id: string, amount: number) {
  const key = 'example-credit:' + id;
  const value: Wallet = {
    amount,
    remaining: amount,
    code: 'DEMO' + claimToken().slice(0, 16).toUpperCase(),
    state: 'issued',
    channel: 'counter',
    created: new Date().toISOString(),
  };
  return amend<Wallet>(key, value, (v) => v);
}
export async function spendExample(id: string, price: number, sale: string, variant: string) {
  type Entry = Wallet & { sales?: Record<string, { amount: number; variant: string }> };
  const key = 'example-credit:' + id,
    c = await read<Entry>(key);
  if (!c) throw Error('Receive the example garment first.');
  return amend<Entry>(key, c, (v) => {
    const ref = sale.trim().toUpperCase();
    if (ref.length < 2 || !Number.isSafeInteger(price) || price <= 0)
      throw Error('Enter a sale reference and a positive purchase amount.');
    if (v.sales?.[ref]) {
      if (v.sales[ref].amount !== price || v.sales[ref].variant !== variant)
        throw Error('That reference was already used for a different sale.');
      return v;
    }
    if (!v.remaining) throw Error('This example credit has been spent.');
    return {
      ...v,
      remaining: Math.max(0, v.remaining - price),
      sales: { ...v.sales, [ref]: { amount: price, variant } },
    };
  });
}
export async function rememberOwnWallet(mode: Mode, id: string) {
  if (
    mode === 'examples' ||
    (await read<RiderTicket>(ticketKey(mode, id)))?.claim ||
    (await read<string>('voucher:' + id))
  )
    await rememberWallet(mode, id);
}
export const rememberWallet = (mode: Mode, id: string) =>
  amend<string[]>('wallet-items:' + mode, [], (a) => (a.includes(id) ? a : [id, ...a]));
export async function saveTicket(mode: Mode, id: string, data: RiderTicket) {
  await write(ticketKey(mode, id), data);
  if (mode !== 'examples' && data.claim) await rememberWallet(mode, id);
}
