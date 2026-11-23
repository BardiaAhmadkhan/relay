const groups = {
  pants: ['left_hip', 'right_hip', 'left_knee', 'right_knee', 'seat'],
  jacket: ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'upper_back'],
} as const;
export const zoneLayers = ['exterior', 'interior'] as const;
export type ZoneLayer = (typeof zoneLayers)[number];
export type ZoneStatus =
  'clear' | 'wear' | 'opening' | 'hardware' | 'repair' | 'unclear' | 'unread' | 'missing';
export type PixelPlacement = {
  photo: string;
  source: string;
  region: string;
  box: number[];
  width: number;
  height: number;
  fraction: number;
  outlines: number[][][];
  exact: boolean;
};
export type PlacementMap = Record<string, PixelPlacement>;
type Read = {
  photo: string;
  box: number[];
  zone: string;
  layer: string;
  state: string;
  regionHash?: string;
  decisionUse?: string;
};
type Picture = {
  id: string;
  hash: string;
  regions: { zone: string; layer: string; box: number[] }[];
};
type Input = { category: string; images: Picture[]; visible: Read[]; areaChecks?: Read[] };
export type Cell = {
  zone: string;
  layer: ZoneLayer;
  status: ZoneStatus;
  checked: boolean;
  photo: string | null;
  box: number[] | null;
  region?: string;
  nativeCue?: boolean;
};
export const zoneName = (zone: string) =>
  zone.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
export const layerName = (layer: ZoneLayer) => (layer === 'exterior' ? 'Outside' : 'Inside');
const statusOf = (s: string): ZoneStatus =>
  (({
    surface: 'clear',
    surface_change: 'wear',
    open_damage: 'opening',
    hardware_damage: 'hardware',
    repair_like: 'repair',
    unresolved: 'unclear',
  })[s] as ZoneStatus) ?? 'unclear';
const rank: Record<ZoneStatus, number> = {
  opening: 8,
  hardware: 8,
  repair: 8,
  unclear: 6,
  wear: 5,
  clear: 4,
  unread: 2,
  missing: 1,
};
export const adverse = (s: ZoneStatus) => s === 'opening' || s === 'hardware' || s === 'repair';
const validBox = (b: number[]) =>
  Array.isArray(b) &&
  b.length === 4 &&
  b.every((x) => Number.isFinite(x) && x >= 0 && x <= 1) &&
  b[0]! < b[2]! &&
  b[1]! < b[3]!;
export const zoneFinding: Record<ZoneStatus, string> = {
  clear: 'No hole, tear or repair seen',
  wear: 'Surface wear or colour change seen',
  opening: 'Possible opening. A specialist will check.',
  hardware: 'Possible broken fitting. A specialist will check.',
  repair: 'Possible repair. A specialist will check.',
  unclear: 'Photo too unclear to judge',
  unread: 'Photographed, awaiting a reading',
  missing: 'Not photographed',
};
/** A geometric proposal can supply a photographed location, but cannot supply a condition reading. */
export function zoneReport(item: Input) {
  const photos = new Map(item.images.map((p) => [p.id, p]));
  const order: readonly string[] = groups[item.category as keyof typeof groups] ?? [];
  const checkedReads = (item.areaChecks ?? []).filter(
    (r) => photos.has(r.photo) && validBox(r.box) && r.decisionUse !== 'unplaced' && !!r.regionHash,
  );
  const original = item.visible.filter((r) => photos.has(r.photo) && validBox(r.box));
  const rows = order.map((zone) => ({
    zone,
    cells: zoneLayers.map((layer): Cell => {
      const native = checkedReads.filter((r) => r.zone === zone && r.layer === layer),
        legacy = original.filter((r) => r.zone === zone && r.layer === layer);
      // Older adverse findings remain visible even when no native-region digest was recorded.
      const readings = [
        ...legacy.filter((r) => adverse(statusOf(r.state))),
        ...native,
        ...legacy.filter((r) => !adverse(statusOf(r.state))),
      ];
      const chosen = readings.reduce<Read | null>(
        (a, b) => (!a || rank[statusOf(b.state)] > rank[statusOf(a.state)] ? b : a),
        null,
      );
      if (chosen)
        return {
          zone,
          layer,
          status: statusOf(chosen.state),
          checked: native.length > 0,
          photo: chosen.photo,
          box: chosen.box,
          region: chosen.regionHash,
          nativeCue: chosen.decisionUse === 'screening_cue',
        };
      for (const im of item.images) {
        const r = im.regions.find((r) => r.zone === zone && r.layer === layer && validBox(r.box));
        if (r) return { zone, layer, status: 'unread', checked: false, photo: im.id, box: r.box };
      }
      return { zone, layer, status: 'missing', checked: false, photo: null, box: null };
    }),
  }));
  const other = original.filter(
    (r) =>
      adverse(statusOf(r.state)) &&
      (!order.includes(r.zone) || !zoneLayers.includes(r.layer as ZoneLayer)),
  );
  const cells = rows.flatMap((r) => r.cells),
    checked = cells.filter((c) => c.checked).length,
    missing = cells.filter((c) => c.status === 'missing').length;
  const unread = cells.filter((c) => !c.checked && c.status !== 'missing').length,
    unclear = cells.filter((c) => c.status === 'unclear').length,
    wear = cells.filter((c) => c.status === 'wear').length;
  const review = cells.filter((c) => adverse(c.status));
  let summary: string;
  if (review.length) {
    const names = review.map(
      (c) => zoneName(c.zone).toLowerCase() + ', ' + layerName(c.layer).toLowerCase(),
    );
    summary =
      review.length === 1
        ? 'One zone view needs a specialist: ' + names[0] + '.'
        : review.length +
          ' zone views need a specialist, including ' +
          names.slice(0, 2).join(' and ') +
          '.';
  } else if (other.length) summary = 'A close-up outside these zone views needs a specialist.';
  else if (unclear || unread) summary = 'Some photographed areas still need a clear reading.';
  else if (checked) summary = 'No hole, tear or repair was seen in the checked zone photos.';
  else
    summary = order.length
      ? 'There are no checked zone photos yet.'
      : 'The garment type and its impact zones could not be established from these photos.';
  if (wear)
    summary +=
      ' ' + wear + (wear === 1 ? ' view shows' : ' views show') + ' surface wear or colour change.';
  return {
    rows,
    total: cells.length,
    checked,
    missing,
    unread,
    unclear,
    wear,
    review: review.length,
    other,
    summary,
  };
}
