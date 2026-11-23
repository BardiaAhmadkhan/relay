import {
  adverse,
  layerName,
  zoneFinding,
  zoneName,
  zoneReport,
  type Cell,
  type PlacementMap,
  type PixelPlacement,
} from './zone-report';
type ZoneInput = Parameters<typeof zoneReport>[0];
export type DisplayCell = Cell & {
  placement: PixelPlacement | null;
  quality: 'full' | 'partial' | 'unplaced' | 'unread' | 'missing';
  finding: string;
  displayChecked: boolean;
};
export function visibleZones(item: ZoneInput, map: PlacementMap) {
  const read = zoneReport(item);
  const rows = read.rows.map((row) => ({
    zone: row.zone,
    cells: row.cells.map((c): DisplayCell => {
      const candidate = c.photo && c.region ? map[c.photo + ':' + c.region] : null;
      const p =
        candidate &&
        item.images.some((im) => im.id === c.photo && im.hash === candidate.source) &&
        candidate.region === c.region &&
        c.box &&
        c.box.every((v, i) => Math.abs(v - candidate.box[i]!) < 0.00001)
          ? candidate
          : null;
      const quality = !c.photo
        ? 'missing'
        : !p
          ? 'unread'
          : p.fraction >= 0.6
            ? 'full'
            : p.fraction >= 0.25
              ? 'partial'
              : 'unplaced';
      let finding = zoneFinding[c.status];
      if (quality === 'unplaced' || (quality === 'unread' && c.region))
        finding = adverse(c.status)
          ? 'Screening cue on an estimated location. A specialist will check.'
          : 'Not usable. A specialist needs to locate this zone.';
      else if (quality === 'partial' && c.status === 'clear')
        finding = 'Partly visible. No hole, tear or repair seen in the visible part.';
      else if (quality === 'partial' && c.status === 'wear')
        finding = 'Surface wear or colour change in the visible part.';
      else if (c.nativeCue && adverse(c.status))
        finding =
          'Possible ' +
          (c.status === 'opening'
            ? 'opening'
            : c.status === 'hardware'
              ? 'broken fitting'
              : 'repair') +
          '. A specialist will check.';
      return {
        ...c,
        placement: p,
        quality,
        finding,
        displayChecked: c.checked && (quality === 'full' || quality === 'partial'),
      };
    }),
  }));
  const cells = rows.flatMap((r) => r.cells),
    checked = cells.filter((c) => c.displayChecked).length,
    partial = cells.filter((c) => c.quality === 'partial' && c.displayChecked).length;
  const unusable = cells.filter(
    (c) => c.quality === 'unplaced' || (c.quality === 'unread' && c.region),
  ).length;
  const unread = cells.filter((c) => c.quality === 'unread' && !c.region).length,
    missing = cells.filter((c) => c.quality === 'missing').length;
  const adverseCells = cells.filter((c) => adverse(c.status)),
    wear = cells.filter((c) => c.status === 'wear' && c.displayChecked).length;
  const grouped = rows
    .map((row) => ({ zone: row.zone, flags: row.cells.filter((c) => adverse(c.status)) }))
    .filter((row) => row.flags.length);
  const names = grouped.map(
    (r) =>
      zoneName(r.zone).toLowerCase() +
      ' (' +
      r.flags.map((f) => layerName(f.layer).toLowerCase()).join(' and ') +
      ')',
  );
  let summary = adverseCells.length
    ? (adverseCells.length === 1
        ? 'One zone view needs'
        : 'These ' + adverseCells.length + ' zone views need') +
      ' a specialist: ' +
      names.join(', ') +
      '.'
    : read.other.length
      ? 'A separate close-up needs a specialist.'
      : !checked
        ? 'There are no usable zone readings yet.'
        : read.unclear || unread
          ? 'Some photographed areas still need a clear reading.'
          : 'No hole, tear or repair was seen in the usable zone photos.';
  if (wear)
    summary +=
      ' ' +
      (wear === 1 ? 'One view shows' : wear + ' views show') +
      ' surface wear or colour change.';
  return {
    rows,
    total: cells.length,
    read: read.checked,
    checked,
    partial,
    unusable,
    missing,
    unread,
    adverse: adverseCells.length,
    other: read.other,
    summary,
  };
}
