import { problem } from './trade-ledger.mjs';
const projection =
  'id note lastCharacters initialValue { amount currencyCode } balance { amount currencyCode }';
export function shopifyCredit(env, fetcher = fetch) {
  const domain = env.RELAY_SHOPIFY_ADMIN_DOMAIN,
    token = env.RELAY_SHOPIFY_ADMIN_TOKEN;
  if (!domain && !token) return null;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain ?? '') || !token)
    throw Error('Configure the Shopify admin domain and token together.');
  async function graphql(query, variables = {}) {
    const response = await fetcher('https://' + domain + '/admin/api/2026-10/graphql.json', {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw problem(503, 'The store could not confirm this credit. Retry with the same trade.');
    const result = await response.json();
    if (result.errors?.length)
      throw problem(503, 'Shopify could not verify this credit. Check the store connection.');
    return result.data;
  }
  const note = (c) => 'Relay trade ' + c.ref;
  const valid = (g, c) =>
    g &&
    g.note === note(c) &&
    g.lastCharacters?.toUpperCase() === c.code.slice(-4) &&
    g.initialValue.currencyCode === 'CAD' &&
    Math.round(Number(g.initialValue.amount) * 100) === c.amount;
  async function find(c) {
    let after = null;
    do {
      const d = await graphql(
        'query($q:String!,$after:String){giftCards(first:100,query:$q,after:$after){nodes{' +
          projection +
          '} pageInfo{hasNextPage endCursor}}}',
        { q: c.code, after },
      );
      const match = d.giftCards.nodes.find((g) => valid(g, c));
      if (match) return match;
      after = d.giftCards.pageInfo.hasNextPage ? d.giftCards.pageInfo.endCursor : null;
    } while (after);
    return null;
  }
  return {
    async activate(c, { allowCreate = true } = {}) {
      const shop = await graphql('query{shop{currencyCode primaryDomain{host}}}');
      if (
        !env.RELAY_STORE_URL ||
        shop.shop.currencyCode !== 'CAD' ||
        shop.shop.primaryDomain.host.replace(/^www\./, '') !==
          new URL(env.RELAY_STORE_URL).hostname.replace(/^www\./, '')
      )
        throw problem(409, 'The credit account must match the Canadian storefront.');
      const found = await find(c);
      if (found) return found.id;
      if (!allowCreate)
        throw problem(
          409,
          'The inspection changed before this credit was confirmed. Ask the shop to review the pending trade.',
        );
      const d = await graphql(
        'mutation($input:GiftCardCreateInput!){giftCardCreate(input:$input){giftCard{' +
          projection +
          '} userErrors{message}}}',
        { input: { initialValue: (c.amount / 100).toFixed(2), code: c.code, note: note(c) } },
      );
      if (valid(d.giftCardCreate.giftCard, c)) return d.giftCardCreate.giftCard.id;
      const recovered = await find(c);
      if (recovered) return recovered.id;
      throw problem(
        503,
        'Shopify has not confirmed the credit. Retry this trade; its code is reserved.',
      );
    },
    async balance(id) {
      const d = await graphql(
        'query($id:ID!){giftCard(id:$id){enabled balance{amount currencyCode}}}',
        { id },
      );
      return d.giftCard?.balance.currencyCode === 'CAD'
        ? d.giftCard.enabled
          ? Math.round(Number(d.giftCard.balance.amount) * 100)
          : 0
        : null;
    },
  };
}
