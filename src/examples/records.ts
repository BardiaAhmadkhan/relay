import {
  asset,
  disclosure,
  kindName,
  noTerms,
  type Card,
  type Frame,
  type Outcome,
  type RecordData,
  type ShopData,
  type Market,
} from '../shared/domain';
import { amend, examples, read, write } from '../shared/storage';
import media from './media-dimensions.json';
import type { Rect } from '../shared/domain';
const dimensions: Record<string, { width: number; height: number; box?: number[]; crop?: string }> =
  media;
const inventory = [
  ['RW-001', 'Meridian Café Jacket', 'jacket', 'Tobacco leather', 'meridian', 'specialist'],
  ['RW-002', 'Switchback Riding Jeans', 'pants', 'Graphite denim', 'switchback', 'request'],
  ['RW-003', 'Fieldway Touring Jacket', 'jacket', 'Olive waxed cotton', 'fieldway', 'keep'],
  ['RW-004', 'Vector Textile Jacket', 'jacket', 'Bone & black textile', 'vector', 'retire'],
  ['RW-005', 'Selvedge Road Jeans', 'pants', 'Washed indigo denim', 'selvedge', 'keep'],
  ['RW-006', 'Monza Leather Jacket', 'jacket', 'Oxblood leather', 'monza', 'request'],
] as const;
const reason: Record<Outcome, string> = {
  keep: 'In this example, the recorded history and shop review meet the workshop’s intake criteria.',
  request: 'The workshop needs another view before it can complete this example inspection.',
  specialist: 'The shoulder seam needs a closer look to distinguish surface wear from an opening.',
  retire: 'The rider reported a crash, damage or repair in an impact area. This closes the offer.',
  replace: 'The shop has recorded a replacement suggestion.',
};
function frame(id: string, name: string, caption: string, file: string): Frame {
  const meta = dimensions[file],
    crop = meta.crop ? dimensions[meta.crop] : undefined;
  return {
    id,
    photo: id,
    name,
    caption,
    src: asset(file),
    width: meta.width,
    height: meta.height,
    role: id,
    ...(meta.crop && crop && meta.box
      ? {
          crop: asset(meta.crop),
          cropWidth: crop.width,
          cropHeight: crop.height,
          rect: meta.box as Rect,
          startFull: true,
        }
      : {}),
  };
}
function sample(row: (typeof inventory)[number]): RecordData {
  const [id, name, category, details, image, outcome] = row,
    feature = id === 'RW-001';
  const frames = [frame('front', 'Front view', 'Full front of the garment.', image)];
  if (feature)
    frames.push(
      frame('back', 'Back view', 'Rear panels and shoulder quilting.', 'meridian-back'),
      frame(
        'label',
        'Attached label',
        'The sewn label and the material around it. No readable protection class is shown.',
        'meridian-label',
      ),
      frame('inside', 'Inside front', 'The open jacket and quilted lining.', 'meridian-inside'),
      frame(
        'detail',
        'Shoulder seam',
        'Surface patina along the quilted shoulder seam.',
        'meridian-shoulder',
      ),
    );
  if (image === 'fieldway' || image === 'selvedge')
    frames.push(
      frame('back', 'Back view', 'The full back of the garment.', image + '-back'),
      frame(
        'label',
        'Attached label',
        'Illustrated sewn label with the surrounding material visible.',
        image + '-label',
      ),
      frame(
        'inside',
        'Inside front',
        'Both sides of the unfolded inside front.',
        image + '-inside',
      ),
      frame(
        'detail',
        'Construction detail',
        'A close view of the material and stitching.',
        image + '-seam',
      ),
    );
  const card: Card = {
    id,
    name,
    category,
    details,
    thumbnail: frames[0].src,
    cardThumbnail: asset(image + '-card'),
    photos: frames.length,
    outcome,
    rehearsal: false,
    example: true,
  };
  const next =
    outcome === 'request'
      ? category === 'pants'
        ? 'Photograph the attached label with the surrounding waistband in the frame.'
        : 'Photograph the entire inside front, including the lining and edges.'
      : outcome === 'specialist'
        ? 'Show the edge of the shoulder seam at a slight angle with the surrounding leather in focus.'
        : null;
  return {
    card,
    receipt: '',
    reason: reason[outcome],
    reasons: [reason[outcome]],
    next,
    eligible: outcome === 'keep',
    history:
      outcome === 'retire'
        ? 'An exclusion was disclosed'
        : outcome === 'request'
          ? 'History unconfirmed'
          : 'Clear history in this example',
    limitation: disclosure,
    frames,
    zones: feature
      ? [
          {
            name: 'Jacket construction',
            cells: [
              {
                layer: 'Outside',
                quality: 'illustrated',
                finding: 'Illustrated shoulder seam with visible patina.',
                source: 'detail',
                adverse: false,
              },
              {
                layer: 'Inside',
                quality: 'illustrated',
                finding: 'Illustrated sewn label and surrounding fabric.',
                source: 'label',
                adverse: false,
              },
            ],
          },
        ]
      : [],
    coverage: feature ? '2 illustrated details' : 'Illustrative source photographs',
    zoneSummary: feature
      ? 'The marked source details are hand-authored for this example. Open a photo to inspect the original framing.'
      : 'The example photographs have no machine-generated zone readings.',
    facts: [
      { name: 'Garment', value: kindName(category), source: 'front' },
      { name: 'Material description', value: details, source: 'front' },
      ...(feature
        ? [{ name: 'Label marking', value: 'No readable class shown', source: 'label' }]
        : []),
    ],
    explanations: feature
      ? [
          {
            name: 'Surface wear',
            consequence: 'The shop can evaluate cosmetic condition separately.',
          },
          {
            name: 'An opening in the seam',
            consequence: 'Confirmed damage in a protective area closes the offer.',
          },
        ]
      : [],
    observation: next,
    observationSource: feature ? 'detail' : undefined,
    note: null,
    notes: [],
    guidance: [],
    identityConflict: false,
    custody: false,
    demonstration: true,
  };
}
export async function sampleCards() {
  const records = new Map(inventory.map((r) => [String(r[0]), sample(r)]));
  for (const r of await examples().catch(() => [])) records.set(r.card.id, r);
  return [...records.values()]
    .sort(
      (a, b) =>
        Number(b.card.id.startsWith('LOCAL-')) - Number(a.card.id.startsWith('LOCAL-')) ||
        a.card.id.localeCompare(b.card.id),
    )
    .map((r) => r.card);
}
export async function sampleRecord(id: string) {
  const row = inventory.find((i) => i[0] === id);
  let stored: RecordData | undefined;
  try {
    stored = await read<RecordData>('item:' + id);
  } catch (e) {
    if (!row) throw e;
  }
  if (stored) return stored;
  if (!row) throw Error('This garment could not be found.');
  return sample(row);
}
export function amendSample(r: RecordData, update: (record: RecordData) => RecordData) {
  return amend('item:' + r.card.id, r, update);
}
export async function saveSample(r: RecordData) {
  await write('item:' + r.card.id, r);
}
export async function exampleShop(r: RecordData, market: Market): Promise<ShopData> {
  const currency = { CA: 'CAD', US: 'USD', GB: 'GBP', DE: 'EUR', PH: 'PHP' }[market];
  const jurisdiction = {
    CA: 'Canada',
    US: 'United States',
    GB: 'United Kingdom',
    DE: 'Germany',
    PH: 'Philippines',
  }[market];
  const terms = (await read<ShopData['terms']>('terms:' + market)) ?? { ...noTerms };
  return {
    currency,
    jurisdiction,
    wording: 'Enter the workshop’s own costs and terms to explore a quote.',
    inspection: '',
    eligible: r.eligible,
    terms,
    knownCost: null,
    breakEven: null,
    contribution: null,
    cash: null,
    credit: null,
    route: 'Workshop inputs',
    grade: null,
    comparables: [],
    matches: [],
    service: null,
    componentResolvingSet: [],
  };
}
export function createLocalRecord(
  name: string,
  history: 'yes' | 'no' | 'unknown',
  frames: Frame[],
): RecordData {
  const outcome = history === 'yes' ? 'retire' : 'specialist',
    id = 'LOCAL-' + crypto.randomUUID().toUpperCase();
  const text =
    history === 'yes'
      ? reason.retire
      : 'Your photographs are saved on this device for a human review. No visual assessment has been run.';
  return {
    card: {
      id,
      name: name.trim() || 'Untitled garment',
      category: 'unknown',
      details: 'Personal intake',
      outcome,
      thumbnail: frames[0]?.src ?? null,
      photos: frames.length,
      rehearsal: false,
    },
    receipt: '',
    reason: text,
    reasons: [text],
    next: null,
    eligible: false,
    history:
      history === 'yes'
        ? 'An exclusion was disclosed'
        : history === 'no'
          ? 'Rider declared clear'
          : 'Rider is unsure',
    limitation: disclosure,
    frames,
    zones: [],
    coverage: 'No assessed zone views',
    zoneSummary: 'This local record is waiting for a review.',
    facts: [],
    explanations: [],
    observation: null,
    note: null,
    notes: [],
    guidance: [],
    identityConflict: false,
    custody: false,
    demonstration: false,
  };
}
