import { Platform } from 'react-native';

export type Market = 'CA' | 'DE' | 'PH' | 'US' | 'GB';
export type Scenario = 'actual' | 'clear' | 'custody_clear' | 'crash';
export type Photo = {
  id: string;
  hash: string;
  role: string;
  cardCandidate?: boolean;
  attachment: string;
  width: number;
  height: number;
  regions: { zone: string; layer: string; box: number[]; status: string }[];
};
export type DeskRecord = {
  sha256: string;
  value: {
    id: string;
    category: string;
    names: string[];
    sourceCount: number;
    custodyAttested: boolean;
    baseline: { outcome: string; grade: string | null; why: string };
    result: {
      action: string;
      title: string;
      next: string | null;
      reasons: string[];
      limitation: string;
      resolvingSets: string[][];
      robust: boolean;
      offerEligible: boolean;
    };
    identity: { conflicted: boolean; unresolved: boolean; photos: string[]; makers: string[] };
    images: Photo[];
    guidance: {
      compact?: { headline: string | null; composition: string | null; source: string | null };
      lines: { text: string; photo: string; kind: string }[];
      flags: string[];
      suggestions: {
        primary: boolean;
        scope: string;
        reason: string;
        photos: string[];
        authority: string | null;
      }[];
      disclosure: string;
    };
    fields: {
      field: string;
      value: string;
      line: string;
      component: string;
      photo: string;
      attachment: string;
      requiresConfirmation?: boolean;
    }[];
    visible: {
      photo: string;
      sourceHash: string;
      regionHash?: string;
      state: string;
      zone: string;
      layer: string;
      box: number[];
    }[];
    coverage?: { nativeReads: number; distinctAreas: number; areas: string[] };
    areaChecks?: {
      photo: string;
      zone: string;
      layer: string;
      state: string;
      box: number[];
      regionHash?: string;
      decisionUse?: string;
      context?: string | null;
    }[];
    appearance?: {
      grade: string | null;
      basis: string;
      surfaceChanges: { photo: string; zone: string; layer: string }[];
      pricingUse: string;
    };
    sidePatterns?: {
      side: string;
      areas: string[];
      photos: string[];
      text: string;
      requiresSpecialist: boolean;
    }[];
    nextObservation?: {
      source: string;
      box: number[];
      explanations: { key: string; text: string; consequence: string }[];
      action: { text: string };
      uninformative: string;
      rateBasis: string;
    } | null;
    dating: {
      production: { text: string; photo: string }[];
      edition: { text: string; photo: string }[];
    };
    scopedNotes: string[];
    serviceCandidate: boolean;
    specialistNote: string | null;
  };
};
export type Brief = {
  id: string;
  category: string;
  names: string[];
  title: string;
  action: string;
  count: number;
  product?: string;
  details?: string;
  thumb?: string | null;
  rehearsal?: boolean;
};
export type Terms = {
  buyRate: number | null;
  resaleRatio: number | null;
  handlingMinor: number | null;
  creditPremium: number | null;
};
export type Shop = {
  inspection: string;
  market: {
    currency: string;
    language: string;
    units: string;
    jurisdiction: string;
    wording: string;
    source: string;
  };
  terms: { terms: Terms; at: string | null; actor: string | null; receipt: string | null };
  eligible: boolean;
  route: { currency: string; minor: number | null; basis: string };
  margin: {
    knownCostFloorMinor: number;
    breakEvenMinor: number | null;
    expectedContributionMinor: number | null;
    missing: string[];
    cashMinor: number | null;
    creditMinor: number | null;
  };
  comparable: {
    model: string;
    maker: string;
    minor: number;
    currency: string;
    availability: string;
    basis: string;
    source: string;
    attribution: string;
  }[];
  matches: { item: string; size: string; category: string; receipt: string }[];
  freshness?: {
    route: { status: string } | null;
    component: { status: string } | null;
    tariff: { status: string } | null;
  };
  componentResolvingSet: string[];
  lifecycle: { due: string; kind: string; receipt: string; source: string }[];
  service: string | null;
  philippines: {
    exact: { totalMinor: number };
    withPackaging: { totalMinor: number };
    action: string;
  };
};
const compiled = process.env.EXPO_PUBLIC_RELAY_V4_API_URL;
// The two laptop presenters serve identical application assets with separate local rehearsal stores.
const publicRuntime=(globalThis as {__RELAY_EVENT_API_PORT__?:unknown}).__RELAY_EVENT_API_PORT__;
const presenterOverride=Platform.OS==='web'&&typeof location!=='undefined'&&['localhost','127.0.0.1'].includes(location.hostname)&&
  [8794,8804,8806].includes(Number(publicRuntime)) ? 'http://127.0.0.1:'+Number(publicRuntime) : undefined;
const known=presenterOverride??compiled;
export const origin = (
  known ?? (Platform.OS === 'android' ? 'http://10.0.2.2:8794' : 'http://127.0.0.1:8794')
).replace(/\/+$/, '');
export function photoUrl(id: string, hash: string, rect?: number[]) {
  return (
    origin +
    '/v4/items/' +
    encodeURIComponent(id) +
    '/photo/' +
    encodeURIComponent(hash) +
    (rect ? '?rect=' + rect.join(',') : '')
  );
}
export async function desk<T>(url: string, body?: unknown, staff?: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), body === undefined ? 15000 : 60000);
  try {
    const r = await fetch(origin + url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(staff ? { 'x-relay-staff': staff } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    if (!r.ok) {
      const err = await r.json().catch(() => null);
      throw Error(err?.error ?? 'The field desk is unavailable.');
    }
    return (await r.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
export const inspectionLabel = (id: string) => id.startsWith('capture-') ? 'Intake · ' + id.slice(8).toUpperCase() : id;
export const words = (s: string) => s.replace(/_/g, ' ');
export const money = (n: number | null | undefined, c: string) =>
  n == null
    ? 'Not set'
    : c +
      ' ' +
      (n / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
