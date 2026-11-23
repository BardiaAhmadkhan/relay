/** Monetary terms are explicit shop inputs. Inspection is already decided before this module is called. */
export type Market = 'CA' | 'US' | 'DE' | 'PH' | 'GB';
export const markets = {
  CA: {
    currency: 'CAD',
    language: 'English / français',
    units: 'kg',
    jurisdiction: 'Canada • British Columbia',
    wording:
      'Record the printed country of manufacture. For imported leather apparel, check tariff classification and origin before applying a rate.',
    source: 'https://www.cbsa-asfc.gc.ca/trade-commerce/tariff-tarif/2026/html/02/ch42-eng.html',
  },
  US: {
    currency: 'USD',
    language: 'English',
    units: 'lb',
    jurisdiction: 'United States',
    wording:
      'Record fibre content, the named manufacturer or dealer, and country of origin as separate label facts. The displayed postal route uses the USPS retail lane to Canada.',
    source:
      'https://www.ftc.gov/business-guidance/resources/threading-your-way-through-labeling-requirements-under-textile-wool-acts',
  },
  DE: {
    currency: 'EUR',
    language: 'Deutsch',
    units: 'kg',
    jurisdiction: 'Germany • EU',
    wording:
      'Keep the standard part and garment class as printed. EN 17092 part 1 describes test methods. The remaining parts distinguish garment classes.',
    source: 'https://eur-lex.europa.eu/eli/dec_impl/2021/395/oj/eng',
  },
  PH: {
    currency: 'PHP',
    language: 'Filipino / English',
    units: 'kg',
    jurisdiction: 'Philippines',
    wording:
      'Quote each parcel at its packed weight and confirm counter acceptance and dimensions. The IEMS merchandise rate to Canada is a postage floor.',
    source:
      'https://phlpost.gov.ph/wp-content/uploads/2026/11/AO-2026-025-re-Revised-Rates-of-the-Philippine-Postal-Corporation-for-Domestic-and-International-Mail-Tracked-Registered-Parcel-EMS-1.pdf',
  },
  GB: {
    currency: 'GBP',
    language: 'English',
    units: 'kg',
    jurisdiction: 'Great Britain',
    wording:
      'Record the actual CE or UKCA marking and its scope. Official GB guidance covers placing PPE on the Great Britain market. The carrier lane needs a current quote.',
    source:
      'https://www.gov.uk/government/publications/personal-protective-equipment-enforcement-regulations-2018/regulation-2016425-and-the-personal-protective-equipment-enforcement-regulations-2018-great-britain',
  },
} as const;
const CA =
  'https://www.canadapost-postescanada.ca/cpc/en/personal/stamps-and-packaging/flat-rate-box.page';
const US = 'https://pe.usps.com/text/dmm300/Notice123.htm';
const DE =
  'https://www.dhl.de/de/privatkunden/pakete-versenden/weltweit-versenden/preise-international.html';
const PH =
  'https://phlpost.gov.ph/wp-content/uploads/2026/11/AO-2026-025-re-Revised-Rates-of-the-Philippine-Postal-Corporation-for-Domestic-and-International-Mail-Tracked-Registered-Parcel-EMS-1.pdf';
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
export function laneQuote(
  market: Market,
  packedGrams: number,
  box?: 'xs' | 'small' | 'medium' | 'large',
) {
  if (!Number.isSafeInteger(packedGrams) || packedGrams <= 0)
    throw Error('Packed weight in grams is required');
  const currency = markets[market].currency;
  let minor: number | null = null,
    source = '',
    basis = '';
  if (market === 'PH') {
    source = PH;
    basis =
      'Published IEMS merchandise, counter acceptance and package dimensions require confirmation';
    if (packedGrams <= 30000)
      minor = (2378 + 702 * Math.ceil(Math.max(0, packedGrams - 1000) / 500)) * 100;
  } else if (market === 'CA') {
    source = CA;
    basis = 'Flat-rate box, verified fit and a maximum packed weight of 5 kg required';
    if (box && packedGrams <= 5000)
      minor = { xs: 1899, small: 2199, medium: 2499, large: 3299 }[box];
  } else if (market === 'DE') {
    source = DE;
    basis = 'DHL online tracked Paket; size restrictions apply';
    minor =
      packedGrams <= 2000 ? 2649 : packedGrams <= 5000 ? 4799 : packedGrams <= 10000 ? 7799 : null;
  } else if (market === 'US') {
    source = US;
    basis = 'October 4, 2026 retail tariff, Canada group 1; rounded up to a whole pound';
    const lbs = Math.ceil(packedGrams / 453.59237);
    const us = [4355, 4705, 5045, 5385, 5905, 6435, 6970, 7530, 8060, 8625, 9160, 9710];
    minor = us[lbs - 1] ?? null;
  } else {
    basis = 'A current origin-specific carrier quote is required';
  }
  return { currency, minor, basis, source: source || null, asOf: '2026-11-21', packedGrams };
}
export function lotQuote(
  market: Market,
  items: number,
  packedGramsEach: number,
  box?: 'xs' | 'small' | 'medium' | 'large',
) {
  if (!Number.isSafeInteger(items) || items < 1 || items > 10000)
    throw Error('Invalid lot quantity');
  const each = laneQuote(market, packedGramsEach, box);
  return { ...each, items, totalMinor: each.minor === null ? null : each.minor * items };
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
