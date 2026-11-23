import * as React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { C, F, Icon } from '../design';
import { photoUrl, type DeskRecord } from './api';
import { StatusPill } from './notebook';
type Item = DeskRecord['value'];
export function RoleFold({
  title,
  children,
  plain = false,
}: {
  title: string;
  children: React.ReactNode;
  plain?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  if (plain) return <>{children}</>;
  return (
    <View style={s.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={({ pressed }) => [s.head, pressed && s.pressed]}
      >
        <Text style={s.subhead}>{title}</Text>
        <Icon name={open ? 'close' : 'plus'} size={18} color={C.forest} />
      </Pressable>
      {open && children}
    </View>
  );
}
export function SpecialistIntro({
  record: d,
  source,
}: {
  record: Item;
  source: (id: string, box: number[]) => void;
}) {
  const next = d.nextObservation,
    picture = next && d.images.find((p) => p.id === next.source);
  const detail = d.result.reasons.filter((r) => !r.startsWith('An uncalibrated'));
  const [expanded, setExpanded] = React.useState(false);
  return (
    <View style={s.section}>
      <View style={s.card}>
        <View style={s.head}>
          <Text style={s.eyebrow}>Specialist review</Text>
          <StatusPill action={d.result.action} />
        </View>
        <Text style={s.title}>
          {d.result.action === 'specialist' || d.result.action === 'request'
            ? 'Why it’s open'
            : 'Inspection outcome'}
        </Text>
        <Text style={s.body}>{detail[0] ?? d.result.title}</Text>
        {detail.length > 1 && (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={() => setExpanded(!expanded)}
              style={({ pressed }) => [s.link, pressed && s.pressed]}
            >
              <Text style={s.linkText}>{expanded ? 'Hide details' : 'Why?'}</Text>
            </Pressable>
            {expanded &&
              detail.slice(1).map((t) => (
                <Text key={t} style={s.muted}>
                  {t}
                </Text>
              ))}
          </>
        )}
      </View>
      {next && (
        <>
          <View style={s.sectionHead}>
            <Text style={s.title}>What could explain this?</Text>
            {picture && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open finding source photo"
                onPress={() => source(next.source, next.box)}
                style={({ pressed }) => [s.thumb, pressed && s.pressed]}
              >
                <Image
                  accessibilityLabel="Condition source"
                  resizeMode="contain"
                  source={{ uri: photoUrl(d.id, picture.hash, next.box) }}
                  style={{ width: '100%', height: '100%' }}
                />
              </Pressable>
            )}
          </View>
          {next.explanations.map((e) => {
            const decision = /closes the offer/i.test(e.consequence)
              ? ['Offer closes if confirmed', '#f4e3dd', '#883b30']
              : /no exclusion|other checks|does not itself/i.test(e.consequence)
                ? ['Continue other checks', '#e1ebdf', '#31583e']
                : ['Needs confirmation', '#e3eaec', '#3e525b'];
            return (
              <View key={e.key} style={s.card}>
                <Text style={s.bodyStrong}>{e.text}</Text>
                <View style={[s.outcome, { backgroundColor: decision[1] }]}>
                  <Text style={[s.badge, { color: decision[2] }]}>{decision[0]}</Text>
                </View>
                <Text style={s.muted}>{e.consequence}</Text>
              </View>
            );
          })}
          <View style={s.next}>
            <Text style={s.eyebrow}>One useful observation</Text>
            <Text style={s.subhead}>{next.action.text}</Text>
            <Text style={s.muted}>{next.uninformative}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => source(next.source, next.box)}
              style={({ pressed }) => [s.link, pressed && s.pressed]}
            >
              <Text style={s.linkText}>Inspect the source region</Text>
              <Icon name="scan" size={16} color={C.forest} />
            </Pressable>
          </View>
          <RoleFold title="How this request was chosen">
            <Text style={s.muted}>{next.rateBasis}</Text>
          </RoleFold>
        </>
      )}
    </View>
  );
}
export function ReceiptBanner({ value }: { value: string }) {
  return (
    <View style={s.receipt}>
      <Icon name="file" size={15} color={C.forest} />
      <View style={{ flex: 1 }}>
        <Text style={s.small}>Signed inspection receipt</Text>
        <Text selectable style={s.hash}>
          {value.slice(0, 16)}
        </Text>
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  section: { marginTop: 24, gap: 12 },
  card: {
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.white,
    gap: 12,
  },
  head: {
    minHeight: 32,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontFamily: F.serif, fontSize: 27, lineHeight: 30, color: C.ink },
  subhead: { fontFamily: F.serif, fontSize: 22, lineHeight: 26, color: C.ink, flexShrink: 1 },
  body: { fontFamily: F.body, fontSize: 15, lineHeight: 22, color: C.ink },
  bodyStrong: { fontFamily: F.bold, fontSize: 15, lineHeight: 22, color: C.ink },
  muted: { fontFamily: F.body, fontSize: 13, lineHeight: 18, color: C.muted },
  eyebrow: {
    fontFamily: F.bold,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.7,
    color: C.forest,
  },
  sectionHead: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  thumb: {
    width: 72,
    height: 72,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: C.wash,
  },
  outcome: {
    height: 32,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  badge: { fontFamily: F.bold, fontSize: 12 },
  next: {
    padding: 20,
    borderRadius: 12,
    backgroundColor: '#e5eddc',
    borderColor: '#c7d8ba',
    borderWidth: 1,
    gap: 12,
  },
  link: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 8 },
  linkText: { color: C.forest, fontFamily: F.bold, fontSize: 13, lineHeight: 18 },
  pressed: { opacity: 0.72 },
  receipt: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#eaf0e6',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  small: { fontFamily: F.medium, fontSize: 12, lineHeight: 16, color: C.forest },
  hash: {
    fontFamily: F.bold,
    fontSize: 13,
    lineHeight: 18,
    color: C.ink,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.4,
  },
});
