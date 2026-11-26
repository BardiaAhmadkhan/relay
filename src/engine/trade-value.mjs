const fold = (s) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const common = new Set(
  'protective motorcycle motorbike riding gear mens men women womens ladies motorcycle jacket jackets pant pants jean jeans trouser trousers leather textile cotton waxed denim black regular size model the with edition fit touring adventure classic pro waterproof mesh sport slim straight moto'.split(
    ' ',
  ),
);
const identityWords = (s) =>
  fold(s)
    .split(' ')
    .filter((w) => w && !common.has(w));
const median = (values) => {
  const a = [...values].sort((a, b) => a - b),
    m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
};
export function garmentSize(s) {
  const raw = String(s ?? '')
    .normalize('NFKC')
    .trim()
    .toUpperCase();
  // Parse the two dimensions before folding punctuation. A slash or multiplication sign
  // is meaningful in a trouser size; a range such as "32–34" is a different claim.
  const pair =
    /^(?:W(?:AIST)?\s*)?(\d{2,3})\s*W?\s*(?:[X×/]\s*(?:L(?:ENGTH)?\s*)?|L(?:ENGTH)?\s*|\s+(?=\d{2,3}\s*L$))(\d{2,3})\s*L?$/.exec(
      raw,
    );
  if (pair) return pair[1] + '/' + pair[2];
  const region = /^(EU|UK|US)\s*(\d{1,3}(?:\.5)?)$/.exec(raw);
  if (region) return region[1] + ' ' + region[2];
  return fold(raw)
    .toUpperCase()
    .replace(/\b2XL\b/g, 'XXL')
    .replace(/\b3XL\b/g, 'XXXL')
    .replace(/^(?:W(?:AIST)?\s*(\d+)|(\d+)W)$/, (_, first, last) => first || last);
}
function sizeMatches(v, requested) {
  const target = garmentSize(requested),
    key = garmentSize(v.size),
    leg = garmentSize(v.length).replace(/^(?:L(?:ENGTH)?|INSEAM)\s*(\d+)$/, '$1');
  return (
    !!key &&
    (key === target ||
      (leg && key + '/' + leg === target) ||
      (!target.includes('/') && key.split('/')[0] === target))
  );
}
export function categoryKey(s) {
  const v = fold(s);
  if (/\b(pants?|trousers?|jeans?)\b/.test(v)) return 'pants';
  if (/jacket|overshirt/.test(v)) return 'jacket';
  if (/gloves?/.test(v)) return 'gloves';
  if (/boots?/.test(v)) return 'boots';
  if (/suits?/.test(v)) return 'suit';
  if (/vest/.test(v)) return 'vest';
  if (/helmet/.test(v)) return 'helmet';
  if (/armour|armor|protector/.test(v)) return 'armour';
  return v || 'unknown';
}
const usable = (v) => v.available && Number.isSafeInteger(v.price) && v.price > 0;
const makerKey = (s) =>
  fold(s)
    .split(' ')
    .filter((w) => !['gear', 'inc', 'ltd', 'apparel'].includes(w))
    .join(' ');
function modelMatch(product, p) {
  const words = identityWords(p.model);
  return (
    !!p.brand &&
    makerKey(product.brand) === makerKey(p.brand) &&
    words.length > 0 &&
    words.every((w) => fold(product.title).split(' ').includes(w))
  );
}
function intersection(a, b) {
  return (a ?? []).filter((x) => (b ?? []).includes(x));
}
export function tradeOffer(p, catalog, terms, prefs = {}) {
  const empty = {
    kind: 'ineligible',
    retail: null,
    used: null,
    credit: null,
    reason: 'The inspection has not cleared this garment for a trade-in.',
    basis: null,
    comparables: [],
    recommendations: [],
  };
  if (p.eligible !== true) return empty;
  p = { ...p, category: categoryKey(p.category) };
  if (['unknown', 'other', ''].includes(p.category))
    return {
      ...empty,
      kind: 'eligible',
      reason: 'The inspection cleared the garment. The shop needs its type to find a fair price.',
    };
  const inferred = (p.styles ?? []).filter(Boolean);
  const pool = catalog.products.filter(
    (x) => x.category === p.category && x.currency === catalog.currency && x.variants.some(usable),
  );
  const recs = pool
    .flatMap((x) => {
      if (prefs.fit && prefs.fit !== 'any' && x.cut !== 'unspecified' && x.cut !== prefs.fit)
        return [];
      const size = String(prefs.size ?? '').trim(),
        variants = x.variants
          .filter(usable)
          .filter((v) => !size || sizeMatches(v, size))
          .sort((a, b) => a.price - b.price || String(a.id).localeCompare(String(b.id)));
      if (!variants.length) return [];
      const v = variants[0],
        isModel = modelMatch(x, p),
        material = intersection(x.fabric, p.fabric),
        ride = !!prefs.riding && x.styles.includes(prefs.riding),
        sameUse = intersection(x.styles, inferred).length > 0,
        sameMaker = !!p.brand && makerKey(p.brand) === makerKey(x.brand);
      const reasons = [
        ...(isModel ? ['Matches the identified model'] : []),
        ...(material.length ? ['Both descriptions mention ' + material[0]] : []),
        ...(ride ? ['Listed for ' + prefs.riding] : sameUse ? ['Similar riding use'] : []),
        ...(sameMaker && !isModel ? ['Same maker'] : []),
        ...(size ? ['Listed in ' + [v.size, v.length].filter(Boolean).join(' / ')] : []),
        ...(prefs.fit && prefs.fit !== 'any' && x.cut === prefs.fit
          ? ['Matches your fit preference']
          : prefs.fit && prefs.fit !== 'any' && x.cut === 'unspecified'
            ? ['Check the cut with the shop']
            : []),
      ];
      if (!reasons.length)
        reasons.push(
          p.category === 'jacket'
            ? 'Another riding jacket'
            : p.category === 'pants'
              ? 'Another pair of riding trousers'
              : 'Same kind of riding gear',
        );
      return [
        {
          handle: x.handle,
          title: x.title,
          url: x.url
            ? x.url + (x.url.includes('?') ? '&' : '?') + 'variant=' + encodeURIComponent(v.id)
            : null,
          image: x.image,
          price: v.price,
          variant: v.id,
          size: [v.size, v.length].filter(Boolean).join(' / '),
          reasons,
          score:
            100 * Number(isModel) +
            16 * material.length +
            10 * Number(ride) +
            6 * Number(sameUse) +
            8 * Number(sameMaker) +
            7 * Number(prefs.fit === x.cut) +
            2 * Number(!prefs.fit && x.cut === 'unspecified'),
        },
      ];
    })
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  const matches = pool.filter((x) => modelMatch(x, p)),
    materialPool = pool.filter((x) => intersection(x.fabric, p.fabric).length > 0);
  const selected = matches.length === 1 ? matches : materialPool.length >= 3 ? materialPool : pool;
  const exact = matches.length === 1,
    retailBasis = exact
      ? 'same-model'
      : materialPool.length >= 3
        ? 'similar-material'
        : 'same-category';
  const sources = selected
    .map((x) => ({
      title: x.title,
      url: x.url,
      price: median(x.variants.filter(usable).map((v) => v.price)),
    }))
    .sort((a, b) => a.price - b.price);
  const answer = {
    ...empty,
    kind: 'eligible',
    reason: '',
    recommendations: recs.slice(0, 3),
    basis: retailBasis,
    comparables: sources,
  };
  if (!sources.length || (!exact && sources.length < 3))
    return {
      ...answer,
      reason:
        'There are too few comparable products with current prices. The shop will price this garment.',
    };
  const values = sources.map((s) => s.price),
    price = median(values),
    range = exact
      ? {
          low: Math.min(...matches[0].variants.filter(usable).map((v) => v.price)),
          high: Math.max(...matches[0].variants.filter(usable).map((v) => v.price)),
        }
      : {
          low: values[Math.floor((values.length - 1) * 0.25)],
          high: values[Math.ceil((values.length - 1) * 0.75)],
        };
  answer.retail = { ...range, mid: price };
  answer.recommendations = recs
    .sort(
      (a, b) =>
        b.score - a.score ||
        Math.abs(a.price - price) - Math.abs(b.price - price) ||
        a.title.localeCompare(b.title),
    )
    .slice(0, 3);
  const valid = (v, max) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
  if (!terms || !valid(terms.resaleRatio, 1))
    return { ...answer, reason: 'The shop will set its resale rate before quoting credit.' };
  const used = Math.round(price * terms.resaleRatio);
  answer.used = used;
  if (!valid(terms.buyRate, 1) || !valid(terms.creditPremium, 2))
    return { ...answer, reason: 'The shop still needs to set its trade-in rates.' };
  const cash = Math.round(used * terms.buyRate);
  answer.credit = Math.round(cash * (1 + terms.creditPremium));
  if (answer.credit <= 0) {
    answer.credit = null;
    answer.reason = 'The current shop terms do not produce a credit offer.';
  }
  return answer;
}
export function signedProfile(d) {
  const bound = (d.fields ?? []).filter(
    (f) =>
      ['same_frame', 'custodial', 'continuity'].includes(f.attachment) && !f.requiresConfirmation,
  );
  const get = (k) => bound.find((f) => k.includes(f.field))?.value ?? '';
  const material = bound
    .filter((f) => /material|composition|fabric/.test(f.field))
    .map((f) => fold(f.value))
    .join(' ');
  return {
    eligible:
      d.result?.offerEligible === true &&
      d.result?.action === 'keep' &&
      !d.identity?.unresolved &&
      ![d.history?.crash, d.history?.damage, d.history?.repair, d.history?.combined].includes(
        'yes',
      ),
    category: d.category,
    brand:
      get(['garment_brand', 'brand', 'maker']) ||
      (d.identity?.unresolved ? '' : (d.identity?.resolvedMaker ?? '')),
    model: get(['model_line', 'model', 'model_name', 'model_code']),
    size: get(['size']),
    styles: ['touring', 'adventure', 'commuting', 'classic', 'sport'].filter((s) =>
      fold(get(['model_line', 'model_name', 'model'])).includes(s),
    ),
    fabric: ['leather', 'denim', 'textile', 'waxed cotton', 'mesh', 'aramid'].filter((x) =>
      material.includes(x),
    ),
  };
}
