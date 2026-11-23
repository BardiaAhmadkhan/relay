import * as React from 'react';
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { C, F, Icon, RelayMark } from '../design';
import { photoUrl, type Brief } from './api';
import { performanceDisclosure } from '../../../packages/core/v4/disclosure';
const states = {
  keep: { name: 'Eligible', fg: '#28543d', bg: '#dcebdd' },
  request: { name: 'Needs a photo', fg: '#705014', bg: '#f6e9c9' },
  specialist: { name: 'Specialist', fg: '#344c59', bg: '#e1e8e9' },
  retire: { name: 'No offer', fg: '#8c392d', bg: '#f5e1da' },
  replace: { name: 'Replacement', fg: '#71531f', bg: '#eee7d6' },
};
const stateFor = (s: string) =>
  states[s as keyof typeof states] ?? { name: 'In review', fg: '#394b41', bg: '#e3e8e1' };
export function StatusPill({ action }: { action: string }) {
  const v = stateFor(action);
  return (
    <View style={[s.status, { backgroundColor: v.bg }]}>
      <View style={[s.dot, { backgroundColor: v.fg }]} />
      <Text style={[s.statusText, { color: v.fg }]}>{v.name}</Text>
    </View>
  );
}
export function PhoneStage({ children }: { children: React.ReactNode }) {
  const { width, height } = useWindowDimensions(),
    wide = Platform.OS === 'web' && width >= 900;
  if (!wide) return <View style={{ flex: 1, minHeight: 0 }}>{children}</View>;
  return (
    <View style={s.stage}>
      <View
        style={{
          width: 426,
          height: Math.max(330, Math.min(866, height - 34)),
          borderRadius: 34,
          backgroundColor: '#233c30',
          padding: 5,
          boxShadow: '0px 14px 46px rgba(31,58,42,0.20)',
        }}
      >
        <View style={s.screen}>{children}</View>
      </View>
    </View>
  );
}
function SearchGlass() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" aria-hidden>
      <Circle cx={10} cy={10} r={6} stroke={C.muted} strokeWidth={1.8} fill="none" />
      <Path d="m15 15 5 5" stroke={C.muted} strokeWidth={1.8} />
    </Svg>
  );
}
function MenuDots() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" aria-hidden>
      {[5, 12, 19].map((x) => (
        <Circle key={x} cx={x} cy={12} r={1.6} fill={C.ink} />
      ))}
    </Svg>
  );
}
export function Notebook({
  items,
  loaded,
  error,
  retry,
  open,
  inspect,
  vision,
  back,
}: {
  items: Brief[];
  loaded: boolean;
  error: string;
  retry: () => void;
  open: (id: string, rehearsal?: boolean) => void;
  inspect: () => void;
  vision: () => void;
  back?: () => void;
}) {
  const [query, setQuery] = React.useState(''),
    [filter, setFilter] = React.useState('all'),
    [menu, setMenu] = React.useState(false);
  const source = items.filter((x) =>
    [x.id, x.product, x.details, x.names.join(' '), x.category]
      .join(' ')
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const visible = source.filter((x) => filter === 'all' || x.action === filter);
  const filters = [
    ['all', 'All'],
    ['keep', 'Eligible'],
    ['request', 'Needs a photo'],
    ['specialist', 'Specialist'],
    ...(items.some((x) => x.action === 'retire') ? [['retire', 'No offer']] : []),
  ];
  return (
    <View style={s.page}>
      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={s.nav}>
          <View style={s.wordmark}>
            <RelayMark size={30} />
            <Text style={s.word}>relay</Text>
            <View style={s.divider} />
            <Text style={s.shop}>Moto Reloaded</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Notebook menu"
            accessibilityState={{ expanded: menu }}
            onPress={() => setMenu(!menu)}
            style={({ pressed }) => [s.menu, pressed && s.pressed]}
          >
            <MenuDots />
          </Pressable>
        </View>
        {menu && (
          <View style={s.dropdown}>
            <Pressable
              accessibilityRole="button"
              onPress={vision}
              style={({ pressed }) => [s.menuItem, pressed && s.pressed]}
            >
              <Text style={s.menuText}>Complete vision</Text>
              <Icon name="file" size={17} />
            </Pressable>
            {back && (
              <Pressable
                accessibilityRole="button"
                onPress={back}
                style={({ pressed }) => [s.menuItem, pressed && s.pressed]}
              >
                <Text style={s.menuText}>Back to notebook</Text>
                <Icon name="back" size={17} />
              </Pressable>
            )}
          </View>
        )}
        <View style={s.headingLine}>
          <Text style={s.heading}>Garments</Text>
        </View>
        <View style={s.search}>
          <SearchGlass />
          <TextInput
            accessibilityLabel="Find a garment"
            placeholder="Search by garment, maker or item"
            placeholderTextColor="#697168"
            value={query}
            onChangeText={setQuery}
            style={s.input}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {!!query && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              style={({ pressed }) => [s.clear, pressed && s.pressed]}
              onPress={() => setQuery('')}
            >
              <Icon name="close" size={15} />
            </Pressable>
          )}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ height: 64, flexGrow: 0, flexShrink: 0 }}
          contentContainerStyle={s.filters}
          keyboardShouldPersistTaps="handled"
        >
          {filters.map(([k, t]) => {
            const count = k === 'all' ? source.length : source.filter((v) => v.action === k).length;
            return (
              <Pressable
                accessibilityRole="button"
                hitSlop={{ top: 6, bottom: 6 }}
                accessibilityLabel={t + ' filter, ' + count}
                accessibilityState={{ selected: filter === k }}
                key={k}
                onPress={() => setFilter(k!)}
                style={({ pressed }) => [
                  s.filter,
                  filter === k && s.filterOn,
                  pressed && s.pressed,
                ]}
              >
                <Text style={[s.filterText, filter === k && s.filterTextOn]}>
                  {t} <Text style={s.count}>{count}</Text>
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {!loaded &&
          !error &&
          [0, 1, 2].map((k) => (
            <View accessibilityLabel="Loading garment" key={k} style={s.card}>
              <View style={[s.photo, s.skeleton]} />
              <View style={[s.cardBody, { gap: 13 }]}>
                <View style={[s.skeleton, { width: '85%', height: 19 }]} />
                <View style={[s.skeleton, { width: '58%', height: 13 }]} />
              </View>
            </View>
          ))}
        {error ? (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>The notebook couldn’t open.</Text>
            <Text style={s.meta}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [s.menuItem, pressed && s.pressed]}
              onPress={retry}
            >
              <Text style={s.menuText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}
        {loaded && !visible.length && !error && (
          <View style={s.empty}>
            <SearchGlass />
            <Text style={s.emptyTitle}>
              {query ? 'No matching garments' : 'No garments here yet'}
            </Text>
            <Text style={s.meta}>
              {query ? 'Try a maker or item number.' : 'Items with this outcome appear here.'}
            </Text>
            {(query || filter !== 'all') && (
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [s.menuItem, pressed && s.pressed]}
                onPress={() => {
                  setQuery('');
                  setFilter('all');
                }}
              >
                <Text style={s.menuText}>Show all garments</Text>
              </Pressable>
            )}
          </View>
        )}
        {visible.map((x) => (
          <Pressable
            key={x.id}
            accessibilityRole="button"
            accessibilityLabel={'Open ' + x.id}
            onPress={() => open(x.id, x.rehearsal)}
            style={({ pressed }) => [s.card, pressed && s.pressed]}
          >
            <View style={s.photo}>
              {x.thumb ? (
                <Image
                  accessibilityLabel={'Front or back view of ' + x.product}
                  style={{ width: '100%', height: '100%' }}
                  source={{ uri: photoUrl(x.id, x.thumb) + '?thumbnail=1' }}
                  resizeMode="cover"
                />
              ) : (
                <Icon name="image" size={29} color="#6f806f" />
              )}
            </View>
            <View style={s.cardBody}>
              <Text style={s.product} numberOfLines={2}>
                {x.product ?? x.names.join(' ') ?? 'Garment'}
              </Text>
              <Text style={s.meta} numberOfLines={2}>
                {x.details ?? x.category}
              </Text>
              <View style={s.statusLine}>
                <StatusPill action={x.action} />
                {x.rehearsal && <Text style={s.rehearsal}>Rehearsal</Text>}
              </View>
              <Text style={s.id} numberOfLines={1}>
                {x.id.startsWith('RL') ? x.id : 'Rider intake'}
              </Text>
            </View>
          </Pressable>
        ))}
        {visible.some((x) => x.action === 'keep' || x.action === 'replace') && (
          <Text style={s.disclosure}>{performanceDisclosure}</Text>
        )}
      </ScrollView>
      <View style={s.dock}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Inspect a garment"
          style={({ pressed }) => [s.cta, pressed && s.pressed]}
          onPress={inspect}
        >
          <Icon name="camera" size={20} color="#e5efc9" />
          <Text style={s.ctaText}>Inspect a garment</Text>
        </Pressable>
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  page: { flex: 1, minHeight: 0, backgroundColor: C.paper },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#dfe6dc' },
  screen: { flex: 1, borderRadius: 29, overflow: 'hidden', backgroundColor: C.paper },
  content: { paddingHorizontal: 20, paddingTop: 0, paddingBottom: 24 },
  nav: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  word: { fontFamily: F.bold, fontSize: 25, color: C.ink, letterSpacing: -1.2 },
  divider: { height: 15, width: 1, backgroundColor: '#bbc4b8', marginHorizontal: 3 },
  shop: { fontFamily: F.medium, fontSize: 13, color: '#4b5c4e' },
  menu: { height: 44, width: 44, alignItems: 'center', justifyContent: 'center' },
  dropdown: {
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    backgroundColor: 'white',
    marginBottom: 8,
  },
  menuItem: {
    minHeight: 44,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  menuText: { fontFamily: F.bold, fontSize: 14, color: C.forest },
  headingLine: { marginTop: 8, marginBottom: 16 },
  heading: { fontFamily: F.serif, fontSize: 34, lineHeight: 38, color: C.ink, letterSpacing: -0.6 },
  search: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    borderColor: '#ced4c9',
    borderWidth: 1,
    borderRadius: 12,
  },
  input: { flex: 1, fontFamily: F.body, fontSize: 15, color: C.ink, height: 44 },
  clear: { justifyContent: 'center', alignItems: 'center', width: 30, height: 40 },
  filters: { flexDirection: 'row', gap: 8, paddingVertical: 16 },
  filter: {
    height: 32,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d4d9cf',
  },
  filterOn: { backgroundColor: '#2d4a37', borderColor: '#2d4a37' },
  filterText: { fontFamily: F.medium, fontSize: 12, color: '#455345' },
  filterTextOn: { color: '#fff' },
  count: { fontSize: 11, fontVariant: ['tabular-nums'] },
  card: {
    flexDirection: 'row',
    gap: 16,
    backgroundColor: '#fff',
    borderColor: '#d6dbd1',
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
    padding: 20,
    marginBottom: 16,
    minHeight: 136,
  },
  photo: {
    width: 98,
    height: 116,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e5e9df',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
  },
  cardBody: { flex: 1, justifyContent: 'center', gap: 4 },
  product: { fontFamily: F.serif, color: C.ink, fontSize: 22, lineHeight: 25 },
  meta: { color: '#556152', fontFamily: F.body, fontSize: 13, lineHeight: 18 },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 3,
  },
  status: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 32,
  },
  dot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontFamily: F.bold, fontSize: 12 },
  rehearsal: { fontFamily: F.medium, color: '#687366', fontSize: 10 },
  id: { fontFamily: F.medium, color: '#667164', fontSize: 9, letterSpacing: 0.8, marginTop: 2 },
  empty: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    alignItems: 'center',
    gap: 9,
    padding: 20,
  },
  emptyTitle: { fontFamily: F.serif, fontSize: 25, color: C.ink },
  skeleton: { backgroundColor: '#e6eae1', borderRadius: 7 },
  pressed: { opacity: 0.76 },
  dock: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderColor: '#d9dfd3',
    backgroundColor: C.paper,
  },
  cta: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#2d4937',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  ctaText: { color: '#f1f6e7', fontFamily: F.bold, fontSize: 16 },
  disclosure: { fontFamily: F.body, color: C.muted, fontSize: 13, lineHeight: 18, padding: 10 },
});
