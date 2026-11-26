export type Mode = 'examples' | 'workshop' | 'rider';
export type Outcome = 'keep' | 'request' | 'specialist' | 'retire' | 'replace';
export type Tab = 'result' | 'overview' | 'trade' | 'evidence' | 'specialist' | 'shop';
export type Market = 'CA' | 'US' | 'DE' | 'GB' | 'PH';
export type History = 'yes' | 'no' | 'unknown';
export type Slot = 'front' | 'back' | 'label' | 'inside' | 'detail';
export type Rect = [number, number, number, number];
export const outcomes: Record<Outcome, { short: string; title: string; icon: string }> = {
  keep: { short: 'Eligible', title: 'Eligible for an offer', icon: 'check' },
  request: { short: 'Needs evidence', title: 'One more piece of evidence', icon: 'aperture' },
  specialist: { short: 'Specialist review', title: 'A specialist will review it', icon: 'eye' },
  retire: { short: 'No offer', title: 'No offer', icon: 'minus' },
  replace: { short: 'Replacement', title: 'Replacement suggested', icon: 'refresh' },
};
export const markets: Record<Market, string> = {
  CA: 'Canada',
  US: 'United States',
  DE: 'Germany',
  GB: 'United Kingdom',
  PH: 'Philippines',
};
export const labels: Record<Slot, string> = {
  front: 'Front',
  back: 'Back',
  label: 'Attached label',
  inside: 'Inside front',
  detail: 'Detail',
};
export const disclosure =
  'Based on what is visible and what the label and maker state. Photographs cannot test or guarantee protective performance.';
export function asset(file: string) {
  return new URL(import.meta.env.BASE_URL + 'media/' + file + '.webp', document.baseURI).href;
}
const framingFiles: Record<'jacket' | 'pants', Record<Slot, string>> = {
  jacket: {
    front: 'meridian',
    back: 'meridian-back',
    label: 'meridian-label',
    inside: 'meridian-inside',
    detail: 'meridian-shoulder',
  },
  pants: {
    front: 'selvedge',
    back: 'selvedge-back',
    label: 'selvedge-label',
    inside: 'selvedge-inside',
    detail: 'selvedge-seam',
  },
};
export function framingPhoto(slot: Slot, garment?: string) {
  return asset(framingFiles[garment === 'pants' ? 'pants' : 'jacket'][slot]);
}
export function words(s: string) {
  return s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}
export function title(s: string) {
  return words(s).replace(/^./, (c) => c.toUpperCase());
}
export type Card = {
  id: string;
  name: string;
  category: string;
  details: string;
  outcome: Outcome;
  decisionTitle?: string;
  thumbnail: string | null;
  cardThumbnail?: string;
  photos: number;
  rehearsal: boolean;
  example?: boolean;
};
export type Frame = {
  id: string;
  photo: string;
  name: string;
  caption: string;
  src: string;
  width: number;
  height: number;
  hash?: string;
  crop?: string;
  cropWidth?: number;
  cropHeight?: number;
  rect?: Rect;
  startFull?: boolean;
  zone?: string;
  layer?: string;
  card?: boolean;
  role?: string;
};
export type ZoneCell = {
  layer: string;
  finding: string;
  quality: string;
  source?: string;
  adverse: boolean;
};
export type RecordData = {
  card: Card;
  receipt: string;
  needs?: string[][];
  observationSource?: string;
  observationKind?: string;
  identitySources?: string[];
  historyDetails?: { label: string; answer: string }[];
  reason: string;
  reasons: string[];
  next: string | null;
  eligible: boolean;
  history: string;
  limitation: string;
  frames: Frame[];
  zones: { name: string; cells: ZoneCell[] }[];
  coverage: string;
  zoneSummary: string;
  facts: { name: string; value: string; source?: string }[];
  explanations: { name: string; consequence: string }[];
  observation: string | null;
  note: string | null;
  notes: { text: string; source: string }[];
  guidance: { title: string; text: string; url?: string }[];
  identityConflict: boolean;
  conflictingMakers?: string[];
  custody: boolean;
  demonstration: boolean;
  grade?: string | null;
  stockSize?: string;
  componentSource?: string;
  labelReadings?: { name: string; value: string; source: string; attachment: string }[];
};
export type Terms = {
  buyRate: number | null;
  resaleRatio: number | null;
  creditPremium: number | null;
  handlingMinor: number | null;
};
export type ShopData = {
  currency: string;
  jurisdiction: string;
  wording: string;
  inspection: string;
  eligible: boolean;
  terms: Terms;
  knownCost: number | null;
  breakEven: number | null;
  contribution: number | null;
  cash: number | null;
  credit: number | null;
  route: string;
  grade: string | null;
  comparables: {
    model: string;
    source: string;
    availability: string;
    minor: number;
    currency: string;
  }[];
  matches: { item: string; size: string }[];
  service: string | null;
  componentResolvingSet: string[];
};
export type Prepared = { uri: string; hash: string; width: number; height: number; crop?: string };
export type Draft = {
  riderStep?: 'garment' | 'history' | 'fit' | 'method' | 'capture';
  method?: 'upload' | 'camera';
  garment?: 'jacket' | 'pants' | 'unknown';
  preferences?: import('../engine/trade-value.mjs').Preferences;
  claim?: string;
  name: string;
  history: History | null;
  shots: Partial<Record<Slot, Prepared>>;
  job?: string;
  uploaded: Slot[];
  state?: 'queued' | 'analyzing' | 'retry';
  updated: number;
};
export function blankDraft(): Draft {
  return { name: '', history: null, shots: {}, uploaded: [], updated: Date.now() };
}
export const noTerms: Terms = {
  buyRate: null,
  resaleRatio: null,
  creditPremium: null,
  handlingMinor: null,
};
export function money(n: number | null | undefined, currency: string) {
  return n == null
    ? 'Awaiting inputs'
    : new Intl.NumberFormat('en-CA', {
        style: 'currency',
        currency,
        currencyDisplay: 'code',
      }).format(n / 100);
}
export const recordHref = (id: string, tab: Tab = 'overview') =>
  '#/items/' + encodeURIComponent(id) + (tab === 'overview' ? '' : '/' + tab);
export const recordCode = (id: string) =>
  id.startsWith('capture-')
    ? 'Intake · ' + id.slice(8).toUpperCase()
    : id.startsWith('LOCAL-')
      ? 'Local · ' + id.slice(6, 14)
      : id;
export const kindName = (s: string) =>
  s === 'pants'
    ? 'Riding trousers'
    : s === 'jacket'
      ? 'Motorcycle jacket'
      : s === 'unknown'
        ? 'Garment'
        : title(s);
