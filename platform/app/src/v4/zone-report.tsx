import * as React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { C, F, Icon, Button } from '../design';
import {
  adverse,
  layerName,
  zoneName,
  type Cell,
  type ZoneStatus,
  type PlacementMap,
} from '../../../packages/core/v4/zone-report';
import { visibleZones, type DisplayCell } from '../../../packages/core/v4/zone-visibility';
import { desk, type DeskRecord } from './api';
import { ZonePicture } from './zone-picture';
const tones: Record<ZoneStatus, { icon: string; fg: string; bg: string }> = {
  clear: { icon: 'check', fg: '#2e593e', bg: '#e0ebdf' },
  wear: { icon: 'eye', fg: '#78541c', bg: '#f7ecd3' },
  opening: { icon: 'info', fg: '#834537', bg: '#f4e3dd' },
  hardware: { icon: 'info', fg: '#834537', bg: '#f4e3dd' },
  repair: { icon: 'info', fg: '#834537', bg: '#f4e3dd' },
  unclear: { icon: 'eye', fg: '#526372', bg: '#e6eaeb' },
  unread: { icon: 'clock', fg: '#526372', bg: '#e6eaeb' },
  missing: { icon: 'image', fg: '#697468', bg: '#e7eae2' },
};

export function ZoneEvidence({
  item,
  open,
  add,
  selectSource,
}: {
  item: DeskRecord['value'];
  open: (photo: string, box?: number[], zone?: string, trigger?: any) => void;
  add: () => void;
  selectSource?: (photo: string, box: number[], zone: string) => void;
}) {
  const [placements, setPlacements] = React.useState<{ id: string; entries: PlacementMap } | null>(
      null,
    ),
    [why, setWhy] = React.useState(false);

  React.useEffect(() => {
    let live = true;

    if (item.images.length)
      void desk<{ entries: PlacementMap }>('/v4/items/' + item.id + '/zone-display')
        .then((v) => {
          if (live) setPlacements({ id: item.id, entries: v.entries });
        })
        .catch(() => {
          if (live) setPlacements({ id: item.id, entries: {} });
        });
    return () => {
      live = false;
    };
  }, [item.id, item.images.length]);
  if (!item.images.length) return null;
  if (!placements || placements.id !== item.id)
    return (
      <View style={s.section}>
        <Text style={s.title}>Impact zones, outside and inside</Text>
        <Text style={s.muted}>Opening source photographs…</Text>
      </View>
    );
  const report = visibleZones(item, placements.entries);
  const candidate = (c: Cell) => {
    const next = (item.result.next ?? '').toLowerCase();
    if (item.result.action !== 'request' || !next || /crash|label|identification tag/.test(next))
      return false;
    return (
      next.includes(c.zone.replace(/_/g, ' ')) &&
      next.includes(c.layer === 'exterior' ? 'outside' : 'inside')
    );
  };
  const card = (c: DisplayCell) => {
    const photo = item.images.find((p) => p.id === c.photo),
      uncertain = c.quality === 'unplaced' || c.quality === 'unread',
      tone = tones[uncertain && !adverse(c.status) ? 'unclear' : c.status],
      label = zoneName(c.zone) + ' · ' + layerName(c.layer);
    return (
      <View key={c.layer} style={s.cell}>
        <Text style={s.layer}>{layerName(c.layer)}</Text>
        {photo && c.box ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={'Open ' + label + ' photo'}
            onPress={(e) => {
              selectSource?.(photo.id, c.box!, c.zone);
              open(photo.id, c.box!, c.zone, e.currentTarget);
            }}
            style={({ pressed }) => [s.thumb, pressed && s.pressed]}
          >
            <ZonePicture
              id={item.id}
              photo={photo}
              placement={c.placement}
              box={c.box}
              full={uncertain}
              partial={c.quality === 'partial'}
            />
            <View style={s.expand}>
              <Icon name="scan" size={14} color="#fff" />
            </View>
          </Pressable>
        ) : (
          <View style={[s.thumb, s.empty]}>
            <Icon name="image" size={18} color="#798478" />
            <Text style={s.muted}>No source photo</Text>
          </View>
        )}
        {(uncertain || c.quality === 'partial') && (
          <Text style={s.placement}>
            {uncertain ? 'Location not confirmed' : 'Estimated location · includes background'}
          </Text>
        )}
        <View style={s.note}>
          <View style={[s.symbol, { backgroundColor: tone.bg }]}>
            <Icon name={tone.icon} size={14} color={tone.fg} />
          </View>
          <Text style={s.finding}>{c.finding}</Text>
        </View>
        {!c.displayChecked && candidate(c) && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={'Add requested photo of ' + label}
            onPress={add}
            style={({ pressed }) => [s.link, pressed && s.pressed]}
          >
            <Text style={s.linkText}>Add photo</Text>
          </Pressable>
        )}
      </View>
    );
  };
  const counts = [
    report.checked + ' of ' + report.total + ' zone views checked',
    ...(report.partial ? [report.partial + ' partly visible'] : []),
    ...(report.unusable ? [report.unusable + ' not usable'] : []),
    ...(report.unread ? [report.unread + ' awaiting a reading'] : []),
    ...(report.missing ? [report.missing + ' not photographed'] : []),
  ];
  return (
    <View style={s.section}>
      <Text accessibilityRole="header" style={s.title}>
        Impact zones, outside and inside
      </Text>
      {!!report.total && <Text style={s.count}>{counts.join(' · ')}</Text>}
      <Text style={s.body}>{report.summary}</Text>
      {report.rows.map((row) => (
        <View key={row.zone} style={s.group}>
          <Text style={s.zone}>{zoneName(row.zone)}</Text>
          <View style={s.pair}>{row.cells.map(card)}</View>
        </View>
      ))}
      {(report.adverse > 0 || report.other.length > 0) && item.nextObservation && (
        <View style={s.request}>
          <Text style={s.zone}>The most useful next photo</Text>
          <Text style={s.body}>{item.nextObservation.action.text}</Text>
        </View>
      )}
      {report.other.map((r, i) => (
        <Pressable
          key={r.photo + '-' + i}
          accessibilityRole="button"
          onPress={() => open(r.photo, r.box)}
          style={({ pressed }) => [s.other, pressed && s.pressed]}
        >
          <Icon name="eye" size={16} color={C.forest} />
          <Text style={s.linkText}>
            Open {r.state === 'hardware_damage' ? 'fitting' : 'condition'} close-up {i + 1}
          </Text>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: why }}
        onPress={() => setWhy(!why)}
        style={({ pressed }) => [s.link, pressed && s.pressed]}
      >
        <Text style={s.linkText}>
          {why ? 'Hide how the zones were checked' : 'How were the zones checked?'}
        </Text>
      </Pressable>
      {why && (
        <Text style={s.muted}>
          Relay estimates each zone’s location. Two different checks compare the garment with its
          background. When they disagree, that view stays out of the coverage count. A possible
          defect still goes to the specialist.
        </Text>
      )}
      <Text style={s.muted}>{item.result.limitation}</Text>
    </View>
  );
}
const s = StyleSheet.create({
  modal: {
    flex: 1,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,33,24,.91)',
  },
  sheet: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: C.paper,
    borderRadius: 12,
    padding: 20,
    gap: 12,
  },
  placement: { fontFamily: F.bold, fontSize: 11, lineHeight: 16, color: '#64511f' },
  section: { gap: 12, marginTop: 32, marginBottom: 8 },
  title: { fontFamily: F.serif, fontSize: 22, lineHeight: 26, color: C.ink },
  count: {
    fontFamily: F.bold,
    fontSize: 13,
    lineHeight: 18,
    color: C.forest,
    fontVariant: ['tabular-nums'],
  },
  body: { fontFamily: F.body, fontSize: 15, lineHeight: 22, color: C.ink },
  group: { paddingTop: 16, paddingBottom: 12, borderTopWidth: 1, borderColor: C.line, gap: 8 },
  zone: { fontFamily: F.bold, fontSize: 15, lineHeight: 22, color: C.ink },
  pair: { flexDirection: 'row', gap: 16 },
  cell: { flex: 1, minWidth: 0, gap: 8 },
  layer: { fontFamily: F.medium, fontSize: 13, lineHeight: 18, color: C.muted },
  thumb: {
    width: '100%',
    aspectRatio: 1.85,
    backgroundColor: '#e6e9e0',
    borderWidth: 1,
    borderColor: '#cfd5ca',
    borderRadius: 12,
    overflow: 'hidden',
  },
  photo: { width: '100%', height: '100%' },
  empty: { alignItems: 'center', justifyContent: 'center' },
  expand: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    backgroundColor: '#263b30b8',
    width: 22,
    height: 22,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  symbol: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  finding: { flex: 1, fontFamily: F.body, fontSize: 13, lineHeight: 18, color: C.ink },
  request: { backgroundColor: '#eaf0e7', padding: 16, borderRadius: 12, gap: 8 },
  link: { minHeight: 40, justifyContent: 'center', alignSelf: 'flex-start' },
  linkText: { fontFamily: F.bold, color: C.forest, fontSize: 13, lineHeight: 18 },
  other: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 },
  muted: { fontFamily: F.body, fontSize: 13, lineHeight: 18, color: C.muted },
  pressed: { opacity: 0.72 },
});
