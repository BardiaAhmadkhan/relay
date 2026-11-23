import { createHash } from 'node:crypto';
import { z } from 'zod';

const fact = z.strictObject({
  key: z.string(),
  subject: z.string(),
  predicate: z.string(),
  value: z.string(),
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
  source: z.string().url(),
  accessed: z.literal('2026-11-21'),
  reviewer: z.string(),
  confidence: z.enum(['high', 'moderate']),
  scope: z.string(),
});
type KnowledgeFact = z.infer<typeof fact>;
const official = 'https://eur-lex.europa.eu/eli/dec_impl/2021/395/oj/eng/pdf';
const body =
  'https://www.motocap.com.au/sites/default/files/2023-02/A%20guide%20to%20designing%20and%20manufacturing%20motorcycle%20protective%20clothing_0.pdf';
function row(
  key: string,
  subject: string,
  predicate: string,
  value: string,
  source: string,
  scope: string,
  validFrom: string | null = null,
): KnowledgeFact {
  return fact.parse({
    key,
    subject,
    predicate,
    value,
    source,
    scope,
    validFrom,
    validTo: null,
    accessed: '2026-11-21',
    reviewer: 'Relay research desk',
    confidence: 'high',
  });
}
export const materialFacts: KnowledgeFact[] = [
  row(
    'aramid-uv',
    'exposed aramid fibre',
    'susceptibility',
    'Prolonged UV exposure can weaken exposed fibre. Cover and weave affect the result.',
    'https://www.dupont.com/content/dam/dupont/amer/us/en/safety/public/documents/en/Kevlar_Technical_Guide_0319.pdf',
    'fibre samples; no specimen lifetime',
  ),
  row(
    'pe-heat',
    'high-modulus polyethylene',
    'melting-range',
    '144–152 °C in the producer fibre specification.',
    'https://pelicanrope.com/content/PDFs/Dyneema-Comprehensive-factsheet-UHMWPE.pdf',
    'fibre only; unknown in-use heat history',
  ),
  row(
    'rokker-dynatec-layer',
    'ROKKER riding trousers',
    'documented construction',
    'ROKKER documents a Dynatec inside layer in its double-layer motorcycle jeans. The printed layer and maker together support garment identification.',
    'https://www.therokkercompany.com/en/products/original-rokker-raw',
    'identity only; no class or performance transferred from a different model',
  ),
  row(
    'denim-layer',
    'cotton denim',
    'laboratory comparison',
    'One, two and three 400 g/m² layers had different laboratory abrasion times in the published example.',
    body,
    'test samples and specific method',
  ),
  row(
    'leather-seams',
    'leather and stitching',
    'construction',
    'Hide structure, construction and stitching influence performance.',
    body,
    'construction; no photo-based strength estimate',
  ),
  row(
    'wax-care',
    'waxed cotton',
    'weatherproofing',
    'Wax care is relevant to weather resistance; a wax-age finding alone cannot establish crash performance.',
    body,
    'weather finish',
  ),
  row(
    'knox-purchase',
    'Knox eligible motorcycle protector',
    'replacement interval',
    '5 years from purchase when the specific protector and applicable guide are verified.',
    'https://www.planet-knox.com/maintain-motorcycle-body-armour-upgrades/',
    'component only; purchase date required',
  ),
  row(
    'helite-service',
    'Helite motorcycle airbag systems',
    'inspection interval',
    'Manufacturer recommends an annual system and cartridge check. Warranty duration is a separate field.',
    'https://www.helite.com/airbag-systems-faqs/airbag-motorcycle/',
    'only applicable systems; never automatic jacket retirement',
  ),
];
export const standardFacts: KnowledgeFact[] = [
  ...[
    ['1', 'method', 'test methods'],
    ['2', 'AAA', 'garment requirements'],
    ['3', 'AA', 'garment requirements'],
    ['4', 'A', 'garment requirements'],
    ['5', 'B', 'abrasion garment without included impact coverage'],
    ['6', 'C', 'impact protector holder; no minimum garment abrasion coverage'],
  ].map(([part, cl, meaning]) =>
    row(
      '17092-' + part,
      'EN 17092-' + part + ':2020',
      cl!,
      meaning!,
      official,
      'garment type as new',
    ),
  ),
  row(
    '13595',
    'EN 13595',
    'scope',
    'Legacy professional motorcycle clothing standards; cannot translate to an EN 17092 class.',
    'https://road-safety.transport.ec.europa.eu/eu-road-safety-policy/priorities/safe-vehicles/archive/safety-design-needs/motorcycles_en',
    'type as new',
  ),
  ...[
    ['1', 'limb joints', '2012'],
    ['2', 'back', '2014'],
    ['3', 'chest', '2018'],
    ['4', 'mechanically triggered inflatable', '2013'],
  ].map(([part, area, year]) =>
    row(
      '1621-' + part,
      'EN 1621-' + part + ':' + year,
      'component',
      area! + ' impact protector',
      part === '3'
        ? 'https://www.dinmedia.de/en/standard/din-en-1621-3/274136444'
        : 'https://www.bsigroup.com/globalassets/localfiles/en-gb/product-certification/personal-safety/bsi-motorocycle-ppe-standards-en-gb.pdf',
      'protector only; record actual printed edition',
    ),
  ),
];
export const retailComparables = [
  {
    article: '2411',
    maker: 'ROKKER',
    model: 'ROKKERTECH LADY BLACK',
    minor: 19950,
    currency: 'EUR',
    availability: 'verify stock',
    basis: 'Exact article; German advertised sale price',
    source: 'https://www.24helmets.de/en/ROKKER-Women-s-Jeans-Rokkertech-Lady-black',
  },
  {
    article: null,
    maker: 'ROKKER',
    model: 'CHINO SAND',
    minor: 19900,
    currency: 'CHF',
    availability: 'shown sold out',
    basis: 'Same model name; edition unresolved',
    source: 'https://www.therokkercompany.com/en/products/chino-sand',
  },
  {
    article: null,
    maker: 'FUEL',
    model: 'SAFARI JACKET',
    minor: 43900,
    currency: 'GBP',
    availability: 'shown sold out',
    basis: 'Same named black model; verify generation',
    source: 'https://www.mile13.co.uk/products/fuel-safari-jacket-black',
  },
] as const;
export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export const packHashes = {
  standards: digest(standardFacts),
  materials: digest(materialFacts),
  retail: digest({ accessed: '2026-11-21', list: retailComparables }),
};
