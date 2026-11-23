import { visibleZones } from '../../../packages/core/v4/zone-visibility';
import { layerName, zoneName, type PlacementMap } from '../../../packages/core/v4/zone-report';
import { origin, photoUrl, type DeskRecord, type Photo } from './api';
export type LabelSource = {
  photo: string;
  parent: string;
  crop: string;
  box: number[];
  exact: boolean;
  width: number;
  height: number;
};
export type ViewSource = {
  key: string;
  photo: Photo;
  triggerPhoto: string;
  box: number[] | null;
  crop: string | null;
  cropWidth: number;
  cropHeight: number;
  kind: string;
  location: string;
  finding: string;
  group: 'zone' | 'evidence';
  initialFull: boolean;
  wholeUri?: string;
};
const asset = (id: string, h: string) =>
  origin + '/v4/items/' + encodeURIComponent(id) + '/zone-source/' + h;
const same = (a: number[] | null, b: number[] | null) =>
  !!a && !!b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]!) < 0.0001);
const plain = (s: string) => s.replace(/_/g, ' ');
export function gallery(
  d: DeskRecord['value'],
  placements: PlacementMap,
  labels: Record<string, LabelSource>,
) {
  const entries: ViewSource[] = [],
    byId = new Map(d.images.map((p) => [p.id, p]));
  for (const row of visibleZones(d, placements).rows)
    for (const c of row.cells) {
      const photo = c.photo && byId.get(c.photo);
      if (!photo || !c.box) continue;
      const p = c.placement,
        unplaced = c.quality === 'unplaced' || c.quality === 'unread';
      entries.push({
        key: 'zone:' + c.zone + ':' + c.layer,
        photo,
        triggerPhoto: photo.id,
        box: c.box,
        crop: p?.exact ? asset(d.id, p.region) : null,
        cropWidth: p?.width ?? photo.width,
        cropHeight: p?.height ?? photo.height,
        kind: zoneName(c.zone) + ' · ' + layerName(c.layer),
        location: unplaced ? 'Location not confirmed' : 'Estimated location',
        finding: c.finding,
        group: 'zone',
        initialFull: unplaced || !p?.exact,
      });
    }
  for (const f of d.visible) {
    const photo = byId.get(f.photo);
    if (!photo || entries.some((e) => e.triggerPhoto === photo.id && same(e.box, f.box))) continue;
    const place = f.regionHash ? placements[photo.id + ':' + f.regionHash] : undefined;
    entries.push({
      key: 'finding:' + photo.id + ':' + f.box.join(','),
      photo,
      triggerPhoto: photo.id,
      box: f.box,
      crop: place?.exact ? asset(d.id, place.region) : null,
      cropWidth: place?.width ?? photo.width,
      cropHeight: place?.height ?? photo.height,
      kind: f.zone === 'unknown' ? 'Condition close-up' : zoneName(f.zone) + ' · ' + plain(f.layer),
      location:
        place?.fraction && place.fraction >= 0.6 ? 'Estimated location' : 'Location not confirmed',
      finding:
        {
          hardware_damage: 'Possible broken fitting',
          open_damage: 'Possible opening',
          repair_like: 'Possible repair',
        }[f.state] ?? plain(f.state),
      group: 'evidence',
      initialFull: !place?.exact,
    });
  }
  for (const photo of d.images) {
    const l = labels[photo.id],
      parent = l ? (byId.get(l.parent) ?? photo) : photo;
    const label = photo.role === 'tag',
      rect = l?.box ?? null;
    entries.push({
      key: 'photo:' + photo.id,
      photo: parent,
      triggerPhoto: photo.id,
      box: rect,
      crop: l?.exact ? asset(d.id, l.crop) : null,
      cropWidth: l?.width ?? photo.width,
      cropHeight: l?.height ?? photo.height,
      kind: label ? 'Garment label' : photo.cardCandidate ? 'Item card' : plain(photo.role),
      location: label && rect ? 'Recorded label frame' : 'Source photograph',
      finding: label
        ? 'The photograph used for the label reading.'
        : 'Submitted garment photograph.',
      group: 'evidence',
      initialFull: !l?.exact,
    });
  }
  return entries;
}
export function initialEntry(
  entries: ViewSource[],
  pid: string,
  box: number[] | null,
  zone?: string,
) {
  const match =
    box &&
    entries.find(
      (e) =>
        e.triggerPhoto === pid &&
        same(e.box, box) &&
        (!zone || e.key.startsWith('zone:' + zone + ':')),
    );
  return match ?? entries.find((e) => e.key === 'photo:' + pid) ?? entries[0];
}
export const wholePhotoUri = (id: string, e: ViewSource) =>
  e.wholeUri ?? photoUrl(id, e.photo.hash);
