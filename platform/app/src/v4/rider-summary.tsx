import * as React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, C, F } from '../design';
import { photoUrl, type DeskRecord } from './api';
import { StatusPill } from './notebook';
import { RequestedPhoto } from './requested-photo';
type Item = DeskRecord['value'];
export const layerText = (s: string) =>
  ({
    interior: 'lining',
    exterior: 'outer fabric',
    unknown: 'area unclear',
    unspecified: 'area unclear',
    layer_unspecified: 'area unclear',
    detail: 'close-up',
    inner_overview: 'inside view',
    inner_zone: 'inside detail',
    outer_front: 'front view',
    outer_back: 'back view',
    label: 'garment label',
    id_card: 'item card',
  })[s] ?? s.replace(/_/g, ' ');
export const findingText = (s: string) =>
  ({
    open_damage: 'Possible tear or opening',
    hardware_damage: 'Possible broken fitting',
    repair_like: 'Possible repair',
    surface_wear: 'Visible surface wear',
    no_visible_damage: 'No visible damage in this area',
    unresolved: 'This area needs a closer look',
  })[s] ?? s.replace(/_/g, ' ');
export const requestedAction = (d: Item) =>
  /history question|has it been in a crash|choose yes, no/i.test(d.result.next ?? '')
    ? 'history'
    : 'photo';
function humanReason(d: Item) {
  if (d.result.action === 'keep')
    return 'The recorded history and the visible condition meet the shop’s intake criteria.';
  if (d.result.action === 'retire')
    return d.result.reasons[0] ?? 'The garment meets an offer exclusion.';
  if (d.identity.unresolved)
    return 'The submitted labels point to different garments. The maker and protection class are unconfirmed.';
  if (d.result.action === 'specialist')
    return 'A specialist needs to check what the photograph shows before the shop can make an offer.';
  return d.result.next ?? d.result.reasons[0] ?? 'The shop needs one more detail.';
}
export function RiderSummary({
  record: d,
  openPhoto,
  scenario,
  inspection,
  showFollow,
  followOn,
  onDone,
  action,
}: {
  record: Item;
  openPhoto: (photo: string, box?: number[], zone?: string, anchor?: any) => void;
  scenario: string;
  inspection: string;
  showFollow: boolean;
  followOn: boolean;
  onDone: () => void;
  action: () => void;
}) {
  const image =
    d.images.find((p) => p.role === 'outer_front') ?? d.images.find((p) => p.role === 'outer_back');
  const history = requestedAction(d) === 'history';
  const primary =
    d.result.action === 'keep'
      ? 'See offer details'
      : d.result.action === 'retire'
        ? 'Back to garments'
        : d.result.action === 'specialist'
          ? 'See what needs review'
          : history
            ? 'Answer history question'
            : 'Add the requested photo';
  return (
    <View
      style={[
        s.card,
        d.result.action === 'retire' && { backgroundColor: C.dangerWash, borderColor: '#dab7af' },
      ]}
    >
      <View style={s.row}>
        <View style={s.copy}>
          {d.result.action !== 'retire' && <StatusPill action={d.result.action} />}
          <Text accessibilityRole="header" style={s.title}>
            {d.result.title}
          </Text>
        </View>
        {image && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Enlarge garment photograph"
            onPress={(e) => openPhoto(image.id, undefined, undefined, e.currentTarget)}
            style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
          >
            <Image
              accessibilityLabel="Garment in this decision"
              source={{ uri: photoUrl(d.id, image.hash) + '?thumbnail=1' }}
              resizeMode="cover"
              style={s.image}
            />
          </Pressable>
        )}
      </View>
      <Text style={s.body}>{humanReason(d)}</Text>
      {d.result.action === 'keep' && <Text style={s.caption}>{d.guidance.disclosure}</Text>}
      <Button
        label={primary}
        icon={d.result.action === 'request' && !history ? 'camera' : 'arrow'}
        onPress={action}
      />
      {followOn && (
        <RequestedPhoto
          id={d.id}
          scenario={scenario}
          inspection={inspection}
          prompt={d.result.next ?? 'Show the requested area.'}
          done={onDone}
        />
      )}
      {showFollow && !followOn && (
        <Text accessibilityLiveRegion="polite" style={s.caption}>
          Your photo is attached for the specialist to review.
        </Text>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  card: {
    padding: 20,
    backgroundColor: C.white,
    borderColor: '#cdd7cb',
    borderWidth: 1,
    borderRadius: 12,
    gap: 12,
    marginVertical: 24,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  copy: { flex: 1, gap: 7 },
  title: { color: C.ink, fontFamily: F.serif, fontSize: 30, lineHeight: 32 },
  image: {
    width: 88,
    height: 104,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.wash,
  },
  body: { fontFamily: F.body, fontSize: 15, lineHeight: 22, color: C.ink },
  caption: { fontFamily: F.body, fontSize: 13, lineHeight: 18, color: C.muted },
});
