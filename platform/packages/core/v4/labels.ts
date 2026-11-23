/** The V4 reader preserves what was printed; it never autocorrects an EN number into a safety class. */
export type LabelField = {
  field: string;
  value: string;
  line: string;
  printed?: string;
  agreement: 'two_reads' | 'one_read';
  component: string;
};
const makerAliases: ReadonlyArray<[string, RegExp]> = [
  ['ROKKER', /\b(?:rokker|roxker|roker)\b|rokkertech/i],
  ['FUEL', /\bfuel\b|fuelmotorcycles/i],
  ['SAINT', /\bsa[1i]nt\b|saint\.cc/i],
  ['PANDO MOTO', /\bpando\b|pandomoto/i],
  ['BELSTAFF', /belstaff/i],
  ['JOE ROCKET', /\bjoe\s*rocket\b|joerocket/i],
  ['OLYMPIA', /olympia/i],
];
const suppliers = /\b(knox|d3o|schoeller|dynatec|millerain|dyneema)\b/gi;
const partClass: Record<string, string> = { '2': 'AAA', '3': 'AA', '4': 'A', '5': 'B', '6': 'C' };
const tidy = (s: string) =>
  s
    .normalize('NFKC')
    .replace(/[‐‑–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
const idKey = (s: string) =>
  tidy(s)
    .toUpperCase()
    .replace(/[^A-Z0-9%]+/g, '');
const componentWord =
  /(OUTSHELL|OUTER SHELL|OUTSIDE FABRIC|OUTSIDE|SLEEVES? LINING|MESH LINING|INSIDE MESH|REINFORCED LINE[R]?|PADDING|INNER MEMBRANE|POCKET BAGS?|LINING|INSIDE|EXTERIOR|SHELL|PANT|JACKET)/i;
function one(text: string) {
  const out: Array<Omit<LabelField, 'agreement'>> = [],
    lines = text.split(/\r?\n/).map(tidy).filter(Boolean);
  const add = (
    field: string,
    value: string,
    line: string,
    component = 'garment',
    printed?: string,
  ) => {
    if (
      value &&
      !out.some(
        (f) => f.field === field && idKey(f.value) === idKey(value) && f.component === component,
      )
    )
      out.push({ field, value, line, component, ...(printed ? { printed } : {}) });
  };
  let section = 'unspecified',
    lastPureSection: string | null = null,
    lastPureFibre: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!,
      surrounding = lines.slice(Math.max(0, i - 2), i + 3).join(' ');
    for (const [maker, pattern] of makerAliases) if (pattern.test(line)) add('brand', maker, line);
    for (const m of line.matchAll(suppliers))
      add('component_brand', m[0].toUpperCase(), line, 'component');
    for (const m of line.matchAll(
      /\b((?:F?PR\s*)?EN)\s*(17092|1621|13595)\s*[-–]\s*([1-6])(?:\s*:\s*((?:19|20)\d{2}))?/gi,
    )) {
      const [, prefix, family, part, year] = m;
      const scope = family === '1621' ? 'protector' : 'garment';
      const normalized =
        prefix!.replace(/\s/g, '').toUpperCase() +
        ' ' +
        family +
        '-' +
        part +
        (year ? ':' + year : '');
      add('standard', normalized, line, scope, m[0]);
      if (year) add('standard_year', year, line, scope);
      if (
        family === '17092' &&
        partClass[part!] &&
        new RegExp('\\b' + partClass[part!] + '\\b', 'i').test(surrounding)
      )
        add('garment_class', partClass[part!]!, line);
      if (scope === 'protector') add('component_mark', 'impact protector', line, scope);
    }
    // A garment can print AA alongside the part-1 test method. Transcribe the visible class independently
    // and preserve an unpaired or contradictory number for specialist confirmation.
    const explicitClass = line.toUpperCase().match(/^(?:CLASS\s*[:\-]?\s*)?(AAA|AA|A|B|C)[\s.,]*$/);
    if (explicitClass && /(?:PR|FPR)?EN\s*17092\b/i.test(surrounding))
      add('garment_class', explicitClass[1]!, line);
    const dated = line.match(
      /\b(?:PROD(?:UCTION)?|MFG|MANUFACTURED)\s*(?:DATE)?\s*[-: ]\s*((?:19|20)\d{2})[-/](0[1-9]|1[0-2])\b/i,
    );
    if (dated) add('production_date', dated[1] + '-' + dated[2], line);
    const origin = line.match(
      /\bMADE\s+IN\s+(CHINA|ITALY|PORTUGAL|EUROPE|IRP|VIETNAM|PAKISTAN|INDIA|INDONESIA|BANGLADESH|CANADA|USA|MEXICO|FRANCE|GERMANY|SPAIN|ENGLAND|TURKEY|THAILAND|CAMBODIA)\b/i,
    );
    if (origin) add('origin', origin[1]!.toUpperCase(), line);
    for (const m of line.matchAll(
      /\b(?:US|UK|EU)\s*[: ]?\s*(?:W\s*)?\d{1,3}(?:\s*\/\s*L\s*\d{1,3})?\b|\b\d{1,2}W\s*\/\s*\d{1,2}L\b/gi,
    ))
      add('size', m[0].toUpperCase(), line);
    const short = line.match(/^\(?\s*(XXS|XS|S|M|L|XL|XXL|XXXL|\d{1,2})\s*\)?$/i);
    if (short) add('size', short[1]!.toUpperCase(), line);
    const heading = line.match(componentWord);
    if (heading && !/do not|do not separate|remove|instructions|washing/i.test(line)) {
      section = heading[1]!.toLowerCase();
      lastPureSection = null;
      lastPureFibre = null;
    }
    for (const m of line.matchAll(
      /(\d{1,3}(?:[.,]\d+)?)\s*%\s*([A-Za-zÀ-ÿ®-]+(?:\s+DYNATEC)?)/gi,
    )) {
      const value = Number(m[1]!.replace(',', '.'));
      if (value <= 100) {
        const word = m[2]!.toUpperCase();
        const multi = word.match(
          /^(COTTON|VISCOSE|POLYESTER|ACETATE|CUPRO|NYLON|ELASTANE|LEATHER|LYOCELL|POLYAMIDE|ARAMID|POLYETHYLENE|ELASTOMULTIESTER)(?:[-/].*)?$/,
        );
        const fibre =
          word.startsWith('SCHOELLER') && /SCHOELLER[®\s·.\-]*DYNATEC/i.test(line)
            ? 'SCHOELLER-DYNATEC'
            : (multi?.[1] ?? word);
        // Two different 100% materials cannot both define the same unqualified component. Preserve the
        // second printed percentage as unscoped until its own garment/component heading can be read.
        const actual =
          value === 100 && lastPureSection === section && lastPureFibre !== fibre
            ? 'unspecified'
            : section;
        const literal =
          fibre === 'SCHOELLER-DYNATEC'
            ? line
                .slice(m.index)
                .match(/^\d{1,3}(?:[.,]\d+)?\s*%\s*SCHOELLER[®\s·.\-]*DYNATEC/i)?.[0]
            : undefined;
        add('composition', m[1] + '% ' + fibre, line, actual, literal ?? m[0]);
        if (value === 100) {
          lastPureSection = section;
          lastPureFibre = fibre;
        }
      }
    }
    const code = line.match(
      /(?:ART(?:ICLE)?\.?\s*(?:NO\.?|NR\.?)|MODEL|STYLE)\s*[:#.]?\s*([A-Z0-9][A-Z0-9/ -]{0,32})/i,
    );
    if (code) add('model_code', code[1]!.trim().toUpperCase(), line);
    if (
      /(?:\b(?:pants|jacket|jean|division|chino|lady|donna|diva|rokk?star|collection)\b)/i.test(
        line,
      ) &&
      line.length < 80 &&
      !/%|wash|guarantee|pocket|[a-z]\.(com|eu)|^\W*(pant|jacket|pants)\W*$/i.test(line)
    )
      add('model_line', line.replace(/^[^\w]+/, '').toUpperCase(), line);
    const purchaseScope =
      /\b(?:DO NOT|WASH|BLEACH|TUMBLE|LEATHER SPECIALIST|DRY CLEAN|REPROOF|HAND TREATED)\b/i.test(
        line,
      );
    if (purchaseScope) add('care', line, line);
  }
  return out;
}
export function extractLabel(first: string, second = ''): LabelField[] {
  const a = one(first),
    b = one(second);
  const match = (x: (typeof a)[number], y: (typeof a)[number]) =>
    x.field === y.field && idKey(x.value) === idKey(y.value) && x.component === y.component;
  return [...a, ...b.filter((x) => !a.some((y) => match(x, y)))].map((x) => ({
    ...x,
    agreement: a.some((y) => match(x, y)) && b.some((y) => match(x, y)) ? 'two_reads' : 'one_read',
  }));
}
export function routedGarmentMaker(text: string): LabelField | null {
  const printed = text.trim();
  if (!printed || printed.length > 100 || /[\r\n%\d]{3,}/.test(printed) || /[\r\n]/.test(printed))
    return null;
  const known = extractLabel(printed).filter((f) => f.field === 'brand');
  if (known.length === 1) return known[0]!;
  if (
    known.length > 1 ||
    /^(?:unknown|none|illegible|unreadable|not visible|no (?:legible )?(?:maker|brand))\b/i.test(
      printed,
    ) ||
    /\b(?:knox|d3o|schoeller|dynatec|millerain|dyneema|aramid|polyester|cotton|EN\s*\d+)\b/i.test(
      printed,
    )
  )
    return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '&’.,\-®™]{1,74}$/u.test(printed)) return null;
  return {
    field: 'brand',
    value: printed.toUpperCase().replace(/[®™]/g, '').trim(),
    line: printed,
    component: 'garment',
    agreement: 'one_read',
  };
}
export const makerValues = (fields: readonly LabelField[]) =>
  new Set(fields.filter((x) => x.field === 'brand').map((x) => x.value));
export function identityConflict(
  groups: { photo: string; root?: string; fields: readonly LabelField[]; component?: boolean }[],
) {
  const beliefs = new Map<string, Set<string>>();
  const modelsByMaker = new Map<string, Map<string, Set<string>>>();
  for (const group of groups) {
    if (group.component) continue;
    const makers = makerValues(group.fields);
    for (const maker of makers) {
      if (!beliefs.has(maker)) beliefs.set(maker, new Set());
      beliefs.get(maker)!.add(group.photo);
      const modelCodes = group.fields.filter(
        (f) => f.field === 'model_code' && f.agreement === 'two_reads',
      );
      if (!modelsByMaker.has(maker)) modelsByMaker.set(maker, new Map());
      for (const f of modelCodes) {
        const key = idKey(f.value);
        if (!key || key.length < 3) continue;
        const modelMap = modelsByMaker.get(maker)!;
        if (!modelMap.has(key)) modelMap.set(key, new Set());
        modelMap.get(key)!.add(group.root ?? group.photo);
      }
    }
  }
  // Overlapping variants read from a single tag are not independent competing identities.
  const incompatible = [...modelsByMaker.entries()].some(([, map]) => {
    const rows = [...map];
    return rows.some(([a, as], i) =>
      rows
        .slice(i + 1)
        .some(([b, bs]) => !a.includes(b) && !b.includes(a) && ![...as].some((p) => bs.has(p))),
    );
  });
  const conflicted = beliefs.size > 1 || incompatible;
  return {
    conflicted,
    makers: [...beliefs.keys()].sort(),
    photos: conflicted ? [...new Set([...beliefs.values()].flatMap((x) => [...x]))].sort() : [],
  };
}
