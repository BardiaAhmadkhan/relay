import {
  kindName,
  outcomes,
  title,
  words,
  type Card,
  type Frame,
  type Market,
  type Outcome,
  type RecordData,
  type Rect,
  type ShopData,
} from './domain';
import { personalChannel, personalBriefs, grantRider } from './rider-access';
import type { Brief, DeskRecord, Shop } from '../engine/contract';
import { layerName, zoneName, type PlacementMap } from '../engine/zone-report';
import { visibleZones } from '../engine/zone-visibility';

export type Config = {
  catalogConnected?: boolean;
  riderAccess?: boolean;
  retailer?: string;
  connected: boolean;
  locked: boolean;
  protected?: boolean;
  title: string;
};
export class WorkshopError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const root = () => (personalChannel() ? '/relay-rider/v4' : '/relay-api/v4');
export async function config(): Promise<Config> {
  try {
    const res = await fetch(
      new URL(import.meta.env.BASE_URL + 'workspace.json', document.baseURI),
      { cache: 'no-store' },
    );
    if (res.ok && res.headers.get('Content-Type')?.includes('application/json'))
      return await res.json();
  } catch {
    /* A static public build can run offline. */
  }
  return { connected: false, locked: false, catalogConnected: false, title: 'Connected workshop' };
}
export async function api<T>(
  path: string,
  body?: unknown,
  staff?: string,
  signal?: AbortSignal,
): Promise<T> {
  const itemId = /^\/(?:intakes|items)\/([\w-]+)/.exec(path)?.[1];
  if (itemId) await grantRider(itemId);
  const perform = () =>
    fetch(root() + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(staff ? { 'x-relay-staff': staff } : {}),
      },
      credentials: 'same-origin',
      cache: 'no-store',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(80000),
    });
  let res = await perform();
  if (
    personalChannel() &&
    itemId &&
    res.status === 403 &&
    (
      await res
        .clone()
        .json()
        .catch(() => null)
    )?.code === 'rider_access'
  ) {
    await grantRider(itemId, undefined, true);
    res = await perform();
  }
  if (!res.ok) {
    const info = await res.json().catch(() => null);
    throw new WorkshopError(
      res.status,
      info?.error || 'The workshop could not complete this request.',
    );
  }
  return res.json();
}
export async function unlock(password: string) {
  const r = await fetch('/relay-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    credentials: 'same-origin',
  });
  if (!r.ok) throw Error((await r.json()).error || 'Sign-in failed.');
}
export const itemPath = (id: string) => '/items/' + encodeURIComponent(id);
export const scenario = (c: Card) => (c.rehearsal ? 'custody_clear' : 'actual');
const picture = (id: string, hash: string) =>
  root() + itemPath(id) + '/photo/' + encodeURIComponent(hash);
const exact = (id: string, hash: string) =>
  root() + itemPath(id) + '/zone-source/' + encodeURIComponent(hash);
const action = (s: string, label?: string): Outcome =>
  label?.toLowerCase() === 'replacement suggested'
    ? 'replace'
    : Object.hasOwn(outcomes, s)
      ? (s as Outcome)
      : 'specialist';
export function makeCard(b: Brief): Card {
  return {
    id: b.id,
    name: b.product || b.names.join(' / ') || 'Garment inspection',
    category: b.category,
    details: b.details || kindName(b.category),
    outcome: action(b.action, b.title),
    decisionTitle: b.title,
    photos: b.count,
    rehearsal: !!b.rehearsal,
    thumbnail: b.thumb ? picture(b.id, b.thumb) + '?thumbnail=1' : null,
  };
}
export async function liveCards(signal?: AbortSignal) {
  const r: { items: Brief[] } = personalChannel()
    ? await personalBriefs(signal)
    : await api<{ items: Brief[] }>('/items?presentation=1', undefined, undefined, signal);
  return r.items.map(makeCard);
}
type LiveValue = DeskRecord['value'] & {
  history?: { crash: string; damage: string; repair: string; combined?: string | null };
};
type Label = {
  crop: string;
  parent: string;
  box: number[];
  exact: boolean;
  width: number;
  height: number;
};
function historyText(h: LiveValue['history']) {
  if (!h) return 'History unconfirmed';
  if (h.combined === 'yes' || [h.crash, h.damage, h.repair].includes('yes'))
    return 'An exclusion was disclosed';
  if (h.combined === 'no' || [h.crash, h.damage, h.repair].every((v) => v === 'no'))
    return 'Rider declared clear';
  if (h.combined === 'unknown') return 'Rider is unsure';
  return 'History unconfirmed';
}
const frameName = (role: string) =>
  ({
    outer_front: 'Front view',
    outer_back: 'Back view',
    inner_overview: 'Inside view',
    inner_zone: 'Lining detail',
    tag: 'Garment label',
    id_card: 'Item card',
    defect_detail: 'Condition detail',
    outer_zone: 'Outer detail',
    pocket: 'Pocket detail',
  })[role] ?? title(role);
export async function liveRecord(
  card: Card,
  selectedScenario: string,
  signal?: AbortSignal,
): Promise<RecordData> {
  const route = itemPath(card.id),
    read = <T>(p: string) => api<T>(p, undefined, undefined, signal);
  const [raw, placement, labelData] = await Promise.all([
    read<{ sha256: string; value: LiveValue }>(
      route + '?scenario=' + encodeURIComponent(selectedScenario),
    ),
    read<{ entries: PlacementMap }>(route + '/zone-display').catch(() => ({ entries: {} })),
    read<{ labels: Record<string, Label> }>(route + '/viewer-labels').catch(() => ({ labels: {} })),
  ]);
  const d = raw.value,
    places: PlacementMap = placement.entries,
    boundLabels: Record<string, Label> = labelData.labels;
  const frames: Frame[] = d.images.map((p) => {
    const label = boundLabels[p.id],
      parent = label ? (d.images.find((x) => x.id === label.parent) ?? p) : p;
    return {
      id: p.id,
      photo: p.id,
      hash: p.hash,
      name: p.cardCandidate ? 'Item card' : frameName(p.role),
      caption: label
        ? 'The label and its recorded source photograph.'
        : frameName(p.role) + ' from this inspection.',
      src: picture(d.id, parent.hash),
      width: parent.width,
      height: parent.height,
      role: p.role,
      card: !!p.cardCandidate,
      ...(label
        ? {
            rect: label.box as Rect,
            crop: label.exact ? exact(d.id, label.crop) : undefined,
            cropWidth: label.width,
            cropHeight: label.height,
          }
        : {}),
    };
  });
  frames.sort((a, b) => (a.role === 'outer_front' ? -1 : b.role === 'outer_front' ? 1 : 0));
  const display = visibleZones(d, places);
  const zones = display.rows.map((row) => ({
    name: zoneName(row.zone),
    cells: row.cells.map((c) => {
      const p = d.images.find((i) => i.id === c.photo);
      let source: string | undefined;
      if (p && c.box) {
        source = 'zone:' + c.zone + ':' + c.layer;
        frames.push({
          id: source,
          photo: p.id,
          hash: p.hash,
          name: zoneName(c.zone) + ' · ' + layerName(c.layer),
          caption:
            c.finding +
            ' ' +
            (c.quality === 'unplaced' || c.quality === 'unread'
              ? 'Location not confirmed.'
              : 'Estimated location.'),
          src: picture(d.id, p.hash),
          width: p.width,
          height: p.height,
          rect: c.box as Rect,
          crop: c.placement?.exact ? exact(d.id, c.placement.region) : undefined,
          cropWidth: c.placement?.width,
          cropHeight: c.placement?.height,
          startFull: c.quality === 'unplaced' || c.quality === 'unread',
          zone: c.zone,
          layer: c.layer,
        });
      }
      return {
        layer: layerName(c.layer),
        quality: c.quality,
        finding: c.finding,
        source,
        adverse: ['opening', 'repair', 'hardware'].includes(c.status),
      };
    }),
  }));
  for (const [index, f] of d.visible.entries()) {
    const p = d.images.find((i) => i.id === f.photo);
    if (!p) continue;
    const placement = f.regionHash ? places[p.id + ':' + f.regionHash] : undefined;
    frames.push({
      id: 'finding:' + index,
      photo: p.id,
      hash: p.hash,
      name:
        {
          open_damage: 'Possible opening',
          hardware_damage: 'Possible broken fitting',
          repair_like: 'Possible repair',
          surface_change: 'Surface change',
        }[f.state] ?? frameName(f.state),
      caption: 'Condition observation from the ' + words(f.layer) + ' photograph.',
      src: picture(d.id, p.hash),
      width: p.width,
      height: p.height,
      rect: f.box as Rect,
      crop: placement?.exact ? exact(d.id, placement.region) : undefined,
      cropWidth: placement?.width,
      cropHeight: placement?.height,
      role: 'finding',
    });
  }
  const facts = d.guidance.lines.map((f) => ({
    name: title(f.kind),
    value: f.text.replace(/layer unspecified/gi, 'component not stated'),
    source: f.photo,
  }));
  const history = historyText(d.history);
  const sameScenario = selectedScenario === scenario(card);
  const scenarioName = d.identity.unresolved
    ? 'Garment with mixed labels'
    : d.names.length === 1
      ? title(d.names[0]) + ' ' + kindName(d.category).toLowerCase()
      : kindName(d.category);
  return {
    card: {
      ...card,
      name: sameScenario ? card.name : scenarioName,
      outcome: action(d.result.action, d.result.title),
      decisionTitle: d.result.title,
      photos: d.sourceCount,
    },
    receipt: raw.sha256,
    needs: d.result.resolvingSets,
    identitySources: d.identity.photos,
    observationSource:
      frames.find(
        (f) =>
          f.id.startsWith('finding:') &&
          f.photo === d.nextObservation?.source &&
          f.rect?.every((v, i) => Math.abs(v - (d.nextObservation?.box[i] ?? -5)) < 0.00001),
      )?.id ?? d.nextObservation?.source,
    observationKind: d.visible.find(
      (f) =>
        f.photo === d.nextObservation?.source &&
        f.box.every((v, i) => Math.abs(v - (d.nextObservation?.box[i] ?? -5)) < 0.00001),
    )?.state,
    historyDetails:
      d.history && d.history.combined !== 'yes'
        ? [
            { label: 'a crash', answer: d.history.crash },
            { label: 'damage in a protective area', answer: d.history.damage },
            { label: 'a repair in a protective area', answer: d.history.repair },
          ]
        : [],
    reason: d.result.reasons[0] ?? d.result.title,
    reasons: d.result.reasons,
    next: d.result.next,
    eligible: d.result.offerEligible,
    history,
    limitation: d.result.limitation,
    frames,
    zones,
    coverage: display.total
      ? display.checked + ' of ' + display.total + ' inside/outside checks complete'
      : 'No areas have been assessed',
    zoneSummary: display.summary,
    facts,
    explanations:
      d.nextObservation?.explanations.map((e) => ({ name: e.text, consequence: e.consequence })) ??
      [],
    observation: d.nextObservation?.action.text ?? null,
    note: d.specialistNote,
    notes: [],
    guidance: d.guidance.suggestions.map((g) => ({
      title: g.primary
        ? 'Verified wear'
        : g.scope === 'component'
          ? 'Maker service guidance'
          : 'Newer marking available',
      text: g.reason,
      url: g.authority ?? undefined,
    })),
    identityConflict: d.identity.unresolved,
    conflictingMakers: d.identity.makers,
    custody: d.custodyAttested,
    demonstration: selectedScenario !== 'actual',
    grade: d.appearance?.grade,
    stockSize: d.fields.find(
      (f) =>
        f.field === 'size' &&
        ['same_frame', 'custodial', 'continuity'].includes(f.attachment) &&
        !f.requiresConfirmation,
    )?.value,
    componentSource: d.images.find((p) =>
      d.fields.some(
        (f) =>
          f.photo === p.id &&
          f.field === 'component_brand' &&
          f.value === 'KNOX' &&
          ['custodial', 'same_frame'].includes(f.attachment),
      ),
    )?.hash,
    labelReadings: d.fields.map((f) => ({
      name: title(f.field),
      value: f.value,
      source: f.photo,
      attachment: f.attachment,
    })),
  };
}
export async function liveShop(
  c: Card,
  s: string,
  market: Market,
  size = '',
  signal?: AbortSignal,
): Promise<ShopData> {
  const v = await api<Shop>(
    '/shop/' +
      encodeURIComponent(c.id) +
      '?' +
      new URLSearchParams({ market, scenario: s, ...(size ? { size } : {}) }),
    undefined,
    undefined,
    signal,
  );
  return {
    currency: v.market.currency,
    jurisdiction: v.market.jurisdiction,
    wording: v.market.wording,
    inspection: v.inspection,
    eligible: v.eligible,
    terms: v.terms.terms,
    knownCost: v.margin.knownCostFloorMinor,
    breakEven: v.margin.breakEvenMinor,
    contribution: v.margin.expectedContributionMinor,
    cash: v.margin.cashMinor,
    credit: v.margin.creditMinor,
    route: v.route.basis,
    grade: null,
    comparables: v.comparable,
    matches: v.matches,
    service: v.service,
    componentResolvingSet: v.componentResolvingSet ?? [],
  };
}
export async function staffSession(name: string, credential: string, demo: boolean) {
  const r = await api<{ token: string }>('/staff/session', {
    name,
    purpose: demo ? 'demo' : 'staff',
    ...(demo ? {} : { credential }),
  });
  return r.token;
}
export type IntakeState = {
  id: string;
  state: 'capture' | 'queued' | 'analyzing' | 'retry' | 'complete';
  message?: string;
};
export const intakePath = (id: string) => '/intakes/' + encodeURIComponent(id);
export const labelRect: Rect = [0.23, 0.23, 0.77, 0.78];
