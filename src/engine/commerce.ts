export type ShopTerms = {
  resaleRatio: number | null;
  buyRate: number | null;
  handlingMinor: number | null;
  creditPremium: number | null;
};
export function sizeKey(value: string) {
  const s = value.normalize('NFKC').toUpperCase().trim().replace(/\s+/g, ' ');
  const jeans = s.match(
    /^(?:US\s*:?\s*)?(?:W\s*(\d{2,3})\s*[/X×, -]+\s*L\s*(\d{2,3})|(\d{2,3})\s*W\s*[/X×, -]+\s*(\d{2,3})\s*L|(\d{2,3})\s*[X×]\s*(\d{2,3}))$/,
  );
  if (jeans)
    return 'W' + (jeans[1] ?? jeans[3] ?? jeans[5]) + '/L' + (jeans[2] ?? jeans[4] ?? jeans[6]);
  return s
    .replace(/^(US|UK|EU)\s*:?\s*(?=\d)/, '$1 ')
    .replace(/^2XL$/, 'XXL')
    .replace(/^3XL$/, 'XXXL');
}
export const emptyTerms: ShopTerms = {
  resaleRatio: null,
  buyRate: null,
  handlingMinor: null,
  creditPremium: null,
};
export function validateTerms(terms: ShopTerms) {
  for (const key of ['resaleRatio', 'buyRate', 'creditPremium'] as const) {
    const n = terms[key];
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > (key === 'creditPremium' ? 2 : 1)))
      throw Error('Shop rate out of range');
  }
  if (
    terms.handlingMinor !== null &&
    (!Number.isSafeInteger(terms.handlingMinor) || terms.handlingMinor < 0)
  )
    throw Error('Handling must be a nonnegative minor-currency integer');
  return { ...terms };
}
export function contribution(input: {
  priceMinor: number | null;
  currency: string;
  terms: ShopTerms;
  freightMinor: number | null;
  dutiesMinor: number | null;
  saleProbability: number | null;
  salvageMinor: number | null;
  acquisitionMinor: number | null;
}) {
  const t = validateTerms(input.terms),
    q = input.saleProbability;
  if (q !== null && (!Number.isFinite(q) || q < 0 || q > 1))
    throw Error('Invalid acceptance and sale probability');
  for (const k of [
    'priceMinor',
    'freightMinor',
    'dutiesMinor',
    'salvageMinor',
    'acquisitionMinor',
  ] as const) {
    const n = input[k];
    if (n !== null && (!Number.isSafeInteger(n) || n < 0)) throw Error('Invalid money amount');
  }
  const revenue =
    input.priceMinor !== null && t.resaleRatio !== null
      ? Math.round(input.priceMinor * t.resaleRatio)
      : null;
  const acquisition =
    input.acquisitionMinor ??
    (revenue !== null && t.buyRate !== null ? Math.round(revenue * t.buyRate) : null);
  const credit =
    acquisition !== null && t.creditPremium !== null
      ? Math.round(acquisition * (1 + t.creditPremium))
      : null;
  const missing: string[] = [];
  for (const [name, value] of [
    ['transport', input.freightMinor],
    ['handling', t.handlingMinor],
    ['non-recoverable duties / clearance', input.dutiesMinor],
    ['acquisition price', acquisition],
    ['acceptance and sale chance', q],
  ] as const)
    if (value === null) missing.push(name);
  if (q !== 1 && input.salvageMinor === null) missing.push('rejection salvage');
  const costFloor =
    (input.freightMinor ?? 0) +
    (t.handlingMinor ?? 0) +
    (input.dutiesMinor ?? 0) +
    (acquisition ?? 0);
  const breakEven =
    !missing.length && q !== null && q > 0
      ? Math.ceil((costFloor - (1 - q) * (input.salvageMinor ?? 0)) / q)
      : null;
  const net =
    !missing.length && q !== null && revenue !== null
      ? Math.round(q * revenue + (1 - q) * (input.salvageMinor ?? 0) - costFloor)
      : null;
  return {
    currency: input.currency,
    assumedRevenueMinor: revenue,
    cashMinor: acquisition,
    creditMinor: credit,
    knownCostFloorMinor: costFloor,
    breakEvenMinor: breakEven,
    expectedContributionMinor: net,
    missing,
    revenueBasis:
      revenue === null
        ? 'Not set; requires comparable, matching currency and shop resale ratio'
        : 'Shop-entered resale ratio applied to the identified comparable',
  };
}
