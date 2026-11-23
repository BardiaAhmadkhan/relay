import * as React from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Rect } from 'react-native-svg';
import { C, F, Icon } from '../design';
import { desk, type DeskRecord } from './api';
import { type PlacementMap } from '../../../packages/core/v4/zone-report';
import {
  gallery,
  initialEntry,
  wholePhotoUri,
  type LabelSource,
  type ViewSource,
} from './viewer-entries';
import { PhotoViewport, type ZoomControl } from './photo-viewport';
type Item = DeskRecord['value'];
export function EvidenceViewer({
  item,
  photo,
  box,
  zone,
  close,
  additional,
}: {
  item: Item;
  additional?: ViewSource[];
  photo: string;
  box?: number[];
  zone?: string;
  close: () => void;
}) {
  const [all, setAll] = React.useState<ViewSource[]>([]),
    [active, setActive] = React.useState(''),
    [full, setFull] = React.useState(true),
    [zoom, setZoom] = React.useState(false),
    [failed, setFailed] = React.useState(false);
  const ctrl = React.useRef<ZoomControl>(null),
    closeEl = React.useRef<any>(null),
    opener = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (Platform.OS === 'web') opener.current = document.activeElement as HTMLElement;
  }, []);
  React.useEffect(() => {
    let live = true;
    async function load() {
      if (additional) {
        setAll(additional);
        setActive(
          additional.find((e) => e.triggerPhoto === photo)?.key ?? additional[0]?.key ?? '',
        );
        setFull(true);
        return;
      }
      const [p, l] = await Promise.all([
        desk<{ entries: PlacementMap }>('/v4/items/' + item.id + '/zone-display').catch(() => ({
          entries: {},
        })),
        desk<{ labels: Record<string, LabelSource> }>(
          '/v4/items/' + item.id + '/viewer-labels',
        ).catch(() => ({ labels: {} })),
      ]);
      if (!live) return;
      const every = gallery(item, p.entries, l.labels);
      let pick = initialEntry(every, photo, box ?? null, zone);
      if (
        box &&
        pick &&
        !every.some(
          (v) =>
            v.triggerPhoto === photo &&
            v.box &&
            v.box.every((x, i) => Math.abs(x - box[i]!) < 0.0001),
        )
      ) {
        pick = {
          ...pick,
          key: 'selected:' + photo,
          box,
          location: 'Estimated location',
          crop: null,
          initialFull: true,
        };
        every.unshift(pick);
      }
      setAll(every);
      if (pick) {
        setActive(pick.key);
        setFull(pick.initialFull);
      }
    }
    void load();
    return () => {
      live = false;
    };
  }, [item.id, photo, box, zone, additional]);
  const entry = all.find((e) => e.key === active),
    group = entry ? all.filter((e) => e.group === entry.group) : [],
    index = group.findIndex((e) => e.key === active);
  const navigate = (delta: number) => {
    if (!group.length) return;
    const next = group[(index + delta + group.length) % group.length]!;
    setActive(next.key);
    setFull(next.initialFull);
    setFailed(false);
    setZoom(false);
  };
  const dismiss = () => {
    const target = opener.current;
    close();
    if (Platform.OS === 'web' && target?.isConnected)
      setTimeout(() => target.focus({ preventScroll: true }), 30);
  };
  React.useEffect(() => {
    if (Platform.OS !== 'web') return;
    const key = (e: KeyboardEvent) => {
      if (['Escape', 'ArrowLeft', 'ArrowRight', '+', '='].includes(e.key)) {
        e.preventDefault();
        if (e.key === 'Escape') dismiss();
        else if (e.key === 'ArrowLeft') navigate(-1);
        else if (e.key === 'ArrowRight') navigate(1);
        else ctrl.current?.toggle();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const number = entry
    ? additional
      ? additional.findIndex((e) => e.key === entry.key) + 1
      : item.images.findIndex((p) => p.id === entry.photo.id) + 1
    : 0;
  const caption = entry
    ? [
        entry.kind,
        entry.finding,
        entry.location,
        'Photo ' + number + ' of ' + (additional?.length ?? item.images.length),
      ].join(' · ')
    : 'Source photograph';
  const uri = entry ? (full || !entry.crop ? wholePhotoUri(item.id, entry) : entry.crop) : null,
    pw = entry ? (full ? entry.photo.width : entry.cropWidth) : 1,
    ph = entry ? (full ? entry.photo.height : entry.cropHeight) : 1;
  const action = (name: string, icon: string, hit: () => void, disabled = false, text?: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      disabled={disabled}
      accessibilityState={{ disabled }}
      onPress={hit}
      style={({ pressed }) => [s.button, pressed && s.pressed, disabled && s.disabled]}
    >
      <Icon name={icon} color="#eff4e8" size={18} />
      {text && <Text style={s.buttonText}>{text}</Text>}
    </Pressable>
  );
  return (
    <Modal
      visible
      transparent={false}
      animationType="none"
      presentationStyle="fullScreen"
      onRequestClose={dismiss}
      onShow={() => {
        closeEl.current?.focus?.();
      }}
    >
      <SafeAreaView style={s.screen}>
        <View style={s.header}>
          <Text accessibilityRole="header" style={s.heading}>
            Source photograph
          </Text>
          <Pressable
            ref={closeEl}
            accessibilityRole="button"
            accessibilityLabel="Close photo"
            onPress={dismiss}
            style={({ pressed }) => [s.button, pressed && s.pressed]}
          >
            <Icon name="close" size={23} color="#fff" />
          </Pressable>
        </View>
        <View style={s.canvas}>
          {entry && uri ? (
            <PhotoViewport
              key={entry.key + '-' + full}
              ref={ctrl}
              pw={pw}
              ph={ph}
              caption={caption}
              next={navigate}
              zoomed={setZoom}
            >
              {failed ? (
                <View style={s.loading}>
                  <Text style={s.caption}>This source photograph is unavailable.</Text>
                </View>
              ) : (
                <Image
                  source={{ uri }}
                  accessibilityLabel={caption}
                  resizeMode="contain"
                  onError={() => {
                    if (!full && entry.crop) {
                      setFull(true);
                      setZoom(false);
                    } else setFailed(true);
                  }}
                  style={s.image}
                />
              )}
              {full && entry.box && (
                <Svg
                  width="100%"
                  height="100%"
                  viewBox={'0 0 ' + pw + ' ' + ph}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                >
                  <Rect
                    x={entry.box[0]! * pw}
                    y={entry.box[1]! * ph}
                    width={(entry.box[2]! - entry.box[0]!) * pw}
                    height={(entry.box[3]! - entry.box[1]!) * ph}
                    fill="transparent"
                    stroke="#182b1b"
                    strokeWidth={Math.max(pw, ph) * 0.009}
                  />
                  <Rect
                    x={entry.box[0]! * pw}
                    y={entry.box[1]! * ph}
                    width={(entry.box[2]! - entry.box[0]!) * pw}
                    height={(entry.box[3]! - entry.box[1]!) * ph}
                    fill="transparent"
                    stroke="#e5f09a"
                    strokeWidth={Math.max(pw, ph) * 0.0045}
                  />
                </Svg>
              )}
            </PhotoViewport>
          ) : (
            <View style={s.loading}>
              <ActivityIndicator color="#def09f" />
              <Text style={s.caption}>Opening source…</Text>
            </View>
          )}
        </View>
        {entry && (
          <View style={s.controls}>
            <View style={s.line}>
              <Text style={s.caption} numberOfLines={3} accessibilityLiveRegion="polite">
                {caption}
              </Text>
              <Text style={s.dim}>
                {pw} × {ph} px · {full ? 'full photograph' : 'selected region'}
              </Text>
            </View>
            <View style={s.toolbar}>
              {action('Previous photo', 'back', () => navigate(-1), group.length < 2)}
              {entry.crop &&
                action(
                  full ? 'See inspected crop' : 'See full source',
                  'scan',
                  () => {
                    setFull(!full);
                    setFailed(false);
                    setZoom(false);
                  },
                  false,
                  full ? 'Crop' : 'Full photo',
                )}
              {action(
                zoom ? 'Fit photograph' : 'Zoom to native pixels',
                'eye',
                () => ctrl.current?.toggle(),
                false,
                zoom ? 'Fit' : '100%',
              )}
              {action('Next photo', 'arrow', () => navigate(1), group.length < 2)}
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#101612' },
  header: {
    position: 'absolute',
    zIndex: 3,
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 8,
    paddingHorizontal: 16,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(16,22,18,.77)',
  },
  heading: { fontFamily: F.serif, fontSize: 24, lineHeight: 28, color: '#fff' },
  canvas: { flex: 1, width: '100%', height: '100%', backgroundColor: '#101612' },
  image: { width: '100%', height: '100%' },
  loading: {
    flex: 1,
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#222d25',
  },
  controls: {
    position: 'absolute',
    zIndex: 3,
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 8,
    paddingBottom: 12,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(16,22,18,.90)',
    gap: 6,
  },
  line: { alignSelf: 'center', width: '100%', maxWidth: 900, gap: 4 },
  caption: { fontFamily: F.medium, fontSize: 14, lineHeight: 19, color: '#f0f5eb' },
  dim: {
    fontFamily: F.body,
    fontSize: 12,
    lineHeight: 16,
    color: '#b8c5b6',
    fontVariant: ['tabular-nums'],
  },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  button: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 9,
    flexDirection: 'row',
    gap: 6,
    backgroundColor: '#2c392f',
  },
  buttonText: { fontFamily: F.medium, fontSize: 13, color: '#f2f6eb' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.35 },
});
