import * as React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';
import * as Picker from 'expo-image-picker';
import { Button, C, F, Icon, JacketArt, RelayMark } from '../design';
import {
  intakeViews,
  requiredViews,
  viewInstructions,
  type IntakeView,
} from '../../../packages/core/v4/capture-views';
import { prepareRegion } from './prepare-region';
import { desk } from './api';

type Shot = { uri: string; parent: string; region?: string };
const tagRect: [number, number, number, number] = [0.23, 0.23, 0.77, 0.78];
function Frame({ view }: { view: IntakeView }) {
  return (
    <View style={s.stage}>
      {view === 'front' || view === 'back' ? (
        <View
          style={{
            width: '100%',
            height: '100%',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View style={{ width: '52%', height: '90%' }}>
            <JacketArt back={view === 'back'} />
          </View>
          <Svg
            width="33%"
            height="84%"
            viewBox="0 0 86 130"
            accessibilityLabel={view + ' of riding trousers'}
          >
            <Path
              d="m18 9 49 1 5 109-21 2-9-69-7 69-21-2Z"
              fill="#46584c"
              stroke="#25382b"
              strokeWidth={2}
            />
            <Path
              d={
                view === 'back'
                  ? 'M19 22q24 8 47 0m-44 6 13 1-2 16-11-3Zm29 1 12-1v14l-10 3Z'
                  : 'M19 21h46M40 23v18l4 6m-21-23q1 12-6 14m46-14q0 10 7 12'
              }
              fill="none"
              stroke="#a5b49f"
              strokeWidth={1.6}
            />
            <Path d="M20 114h13m20 0h13" stroke="#a5b49f" strokeWidth={1.5} />
          </Svg>
        </View>
      ) : (
        <Svg
          width="100%"
          height="100%"
          viewBox="0 0 300 145"
          accessibilityLabel={viewInstructions[view].short + ' framing guide'}
        >
          <Path
            d="M30 42V21h24m192 0h24v21M30 103v22h24m192 0h24v-22"
            stroke="#889789"
            strokeWidth={2}
            fill="none"
          />
          {view === 'label' ? (
            <>
              <Path d="M58 103c26-41 28-59 58-82 32 19 78 13 123 31l-19 79H89Z" fill="#405947" />
              <Rect x="119" y="42" width="75" height="62" fill="#fff9e8" rx="3" />
              <Rect
                x="124"
                y="47"
                width="65"
                height="52"
                fill="none"
                stroke="#9e9c7c"
                strokeDasharray="3 3"
              />
              <Path d="M135 60h40m-40 8h29m-29 13h37m-37 6h22" stroke="#485748" strokeWidth={2} />
            </>
          ) : view === 'inside' ? (
            <>
              <Path
                d="m114 22-31 11-25 72 20 8 19-41-4 55 52 5V41l-15-21Zm72 0 31 11 25 72-20 8-19-41 4 55-52 5V41l15-21Z"
                fill="#435b49"
                stroke="#263e2d"
                strokeWidth={2}
              />
              <Path
                d="m130 20-14 14 15 28-9 61 21 5V42Zm40 0 14 14-15 28 9 61-21 5V42Z"
                fill="#b6c4b0"
              />
              <Path d="M108 90h18m48 0h18m-76 12 8 3m51-3 9 3" stroke="#dbe3d2" strokeWidth={2} />
            </>
          ) : (
            <>
              <Path d="m79 35 132-8 15 82-133 10Z" fill="#4c6051" />
              <Path d="m91 49 115-7m-109 63 116-8" stroke="#adbb9e" strokeDasharray="4 4" />
              <Path
                d="m131 65 11 4 7-10 5 18 8-11 11 6"
                stroke="#e2c9a5"
                strokeWidth={3}
                fill="none"
              />
            </>
          )}
        </Svg>
      )}
    </View>
  );
}
export function NativeIntake({
  close,
  opened,
}: {
  close: () => void;
  opened: (id: string) => void;
}) {
  const [history, setHistory] = React.useState<'yes' | 'no' | 'unknown' | null>(null);
  const [shots, setShots] = React.useState<Partial<Record<IntakeView, Shot>>>({});
  const [step, setStep] = React.useState<IntakeView>('front'),
    [phase, setPhase] = React.useState<'ready' | 'preparing' | 'sending' | 'waiting'>('ready');
  const [err, setErr] = React.useState(''),
    [status, setStatus] = React.useState(''),
    [id, setId] = React.useState('');
  const lock = React.useRef(false),
    active = React.useRef(true),
    uploaded = React.useRef(new Set<IntakeView>());
  React.useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  React.useEffect(() => {
    if (phase !== 'waiting' || !id) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await desk<{ state: string; message?: string }>('/v4/intakes/' + id);
        if (!live) return;
        if (result.state === 'complete') {
          opened(id);
          return;
        }
        if (result.state === 'retry') {
          setErr(result.message ?? 'The inspection paused. Try again with these photos.');
          setStatus('');
          setPhase('ready');
          return;
        }
        setErr('');
        setStatus(
          result.state === 'queued'
            ? 'Waiting for the checker…'
            : 'Checking your garment. Your photos are saved.',
        );
      } catch {
        if (live) setErr('Reconnecting to your saved inspection…');
      }
      if (live) timer = setTimeout(() => void poll(), 2200);
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [phase, id, opened]);
  const completed = requiredViews.filter((k) => !!shots[k]).length,
    ready = history === 'yes' || completed === requiredViews.length,
    busy = phase !== 'ready';
  const choose = async (camera: boolean) => {
    if (lock.current || busy) return;
    lock.current = true;
    setPhase('preparing');
    setErr('');
    try {
      if (camera && !(await Picker.requestCameraPermissionsAsync()).granted)
        throw Error('Allow camera access or choose a saved photo.');
      const op = camera ? Picker.launchCameraAsync : Picker.launchImageLibraryAsync;
      const selected = await op({
        mediaTypes: ['images'],
        quality: 1,
        allowsEditing: false,
        exif: false,
        allowsMultipleSelection: false,
      });
      if (selected.canceled) return;
      const file = selected.assets[0];
      if (!file || file.width * file.height > 50000000)
        throw Error('Choose a photograph under 50 megapixels.');
      const parent = (await prepareRegion(file.uri, [0, 0, 1, 1])).base64;
      if (Object.entries(shots).some(([slot, item]) => slot !== step && item?.parent === parent))
        throw Error('That photo is already in another view. Choose a different photograph.');
      const region = step === 'label' ? (await prepareRegion(file.uri, tagRect)).base64 : undefined;
      if (!active.current) return;
      const next = { ...shots, [step]: { uri: file.uri, parent, region } };
      setShots(next);
      if (id) {
        setId('');
        uploaded.current.clear();
      }
      const missing = requiredViews.find((k) => !next[k]);
      setStep(missing ?? 'detail');
      setStatus(viewInstructions[step].short + ' saved');
    } catch (e) {
      if (active.current)
        setErr(e instanceof Error ? e.message : 'That photograph could not be opened.');
    } finally {
      lock.current = false;
      if (active.current) setPhase('ready');
    }
  };
  const finish = async () => {
    if (!history || !ready || lock.current || busy) return;
    lock.current = true;
    setErr('');
    setPhase('sending');
    try {
      let who = id;
      if (!who) {
        who = (
          await desk<{ id: string }>('/v4/intakes', {
            exclusionHistory: history,
            captureMode: 'guided',
          })
        ).id;
        setId(who);
      }
      if (history !== 'yes')
        for (const view of intakeViews) {
          const f = shots[view];
          if (!f || uploaded.current.has(view)) continue;
          setStatus('Sending ' + viewInstructions[view].short.toLowerCase() + '…');
          await desk('/v4/intakes/' + who + '/photos', {
            view,
            base64: f.parent,
            purpose: view === 'label' ? 'attached_label' : 'overview',
            ...(view === 'label' ? { rect: tagRect, nativeRegion: f.region } : {}),
          });
          uploaded.current.add(view);
        }
      const r = await desk<{ state: string }>('/v4/intakes/' + who + '/finish', {});
      if (!active.current) return;
      if (r.state === 'complete') {
        opened(who);
        return;
      }
      setStatus(
        r.state === 'queued'
          ? 'Waiting for the checker…'
          : 'Checking your garment. Your photos are saved.',
      );
      setPhase('waiting');
    } catch (e) {
      if (active.current) {
        setErr(
          e instanceof Error ? e.message : 'The upload paused. Try again with the same photos.',
        );
        setPhase('ready');
      }
    } finally {
      lock.current = false;
    }
  };
  return (
    <SafeAreaView style={s.page}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.nav}>
          <View style={s.brand}>
            <RelayMark size={23} />
            <Text style={s.brandWord}>relay</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="All items"
            disabled={busy}
            style={({ pressed }) => [s.navButton, pressed && s.pressed]}
            onPress={close}
          >
            <Icon name="close" size={19} />
          </Pressable>
        </View>
        <Text style={s.kicker}>Garment intake</Text>
        <Text style={s.title}>
          {history && history !== 'yes' ? 'Photograph the garment' : 'Inspect a garment'}
        </Text>
        {!history || history === 'yes' ? (
          <View style={s.card}>
            <Text style={s.subhead}>
              Has it been in a crash, or damaged or repaired in an impact area?
            </Text>
            <View style={s.row}>
              {(
                [
                  ['no', 'No'],
                  ['yes', 'Yes'],
                  ['unknown', 'Not sure'],
                ] as const
              ).map(([v, t]) => (
                <Pressable
                  key={v}
                  accessibilityRole="button"
                  accessibilityState={{ selected: history === v }}
                  disabled={busy}
                  style={({ pressed }) => [
                    s.choice,
                    history === v && s.choiceOn,
                    pressed && s.pressed,
                  ]}
                  onPress={() => {
                    setHistory(v);
                    setId('');
                    uploaded.current.clear();
                    setErr('');
                  }}
                >
                  <Text style={[s.choiceText, history === v && s.white]}>{t}</Text>
                </Pressable>
              ))}
            </View>
            {history === 'yes' && (
              <Text style={s.body}>
                Your answer is enough for this decision. No photographs are needed.
              </Text>
            )}
          </View>
        ) : (
          <>
            <View style={s.progress}>
              <Text style={s.progressLabel}>
                {completed === 4
                  ? '4 of 4 views ready'
                  : 'View ' +
                    (requiredViews.indexOf(step as (typeof requiredViews)[number]) + 1 || 4) +
                    ' of 4'}
              </Text>
              <Text style={s.muted}>{completed} saved</Text>
            </View>
            <View style={s.segments}>
              {requiredViews.map((k) => (
                <View
                  key={k}
                  style={[s.segment, shots[k] ? s.done : k === step ? s.current : null]}
                />
              ))}
            </View>
            <View style={s.card}>
              <Text style={s.kicker}>
                {step === 'detail' ? 'Optional close-up' : viewInstructions[step].short}
              </Text>
              <Text style={s.subhead}>{viewInstructions[step].title}</Text>
              <Text style={s.body}>{viewInstructions[step].instruction}</Text>
              {shots[step] ? (
                <Image
                  source={{ uri: shots[step]!.uri }}
                  style={s.stage}
                  resizeMode="contain"
                  accessibilityLabel={viewInstructions[step].short + ' captured'}
                />
              ) : (
                <Frame view={step} />
              )}
              <Button
                label={
                  shots[step]
                    ? 'Retake this photo'
                    : step === 'detail'
                      ? 'Photograph a detail'
                      : 'Take a photo'
                }
                icon="camera"
                disabled={busy}
                onPress={() => void choose(true)}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Choose an existing photo"
                disabled={busy}
                style={({ pressed }) => [s.library, pressed && s.pressed]}
                onPress={() => void choose(false)}
              >
                <Icon name="image" size={17} color={C.forest} />
                <Text style={s.link}>Choose from photos</Text>
              </Pressable>
            </View>
            <View style={s.thumbs}>
              {intakeViews.map((k) => (
                <Pressable
                  key={k}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={(shots[k] ? 'Retake ' : 'Show ') + viewInstructions[k].short}
                  accessibilityState={{ selected: k === step }}
                  style={({ pressed }) => [s.slot, pressed && s.pressed]}
                  onPress={() => {
                    setStep(k);
                    setErr('');
                  }}
                >
                  <View style={[s.mini, k === step && s.miniOn]}>
                    {shots[k] ? (
                      <Image source={{ uri: shots[k]!.uri }} style={s.miniImg} />
                    ) : (
                      <Icon name={k === 'detail' ? 'plus' : 'image'} size={17} color={C.muted} />
                    )}
                  </View>
                  <Text style={s.slotText}>{viewInstructions[k].short}</Text>
                </Pressable>
              ))}
            </View>
            {!id && (
              <Pressable
                disabled={busy}
                accessibilityRole="button"
                style={({ pressed }) => [s.library, pressed && s.pressed]}
                onPress={() => {
                  setHistory(null);
                  setErr('');
                }}
              >
                <Text style={s.muted}>Edit garment history</Text>
              </Pressable>
            )}
          </>
        )}
        {err ? (
          <Text accessibilityLiveRegion="polite" style={s.error}>
            {err}
          </Text>
        ) : null}
        {history && (
          <>
            <Button
              label="Open inspection"
              disabled={!ready || busy}
              onPress={() => void finish()}
            />
            {history !== 'yes' && !ready && (
              <Text style={s.footnote}>Add the four views above to open your inspection.</Text>
            )}
          </>
        )}
        {!!status && (
          <Text accessibilityLiveRegion="polite" style={s.footnote}>
            {status}
          </Text>
        )}
        {busy && <ActivityIndicator color={C.forest} />}
      </ScrollView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.paper },
  content: {
    width: '100%',
    maxWidth: 490,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 12,
  },
  nav: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  brandWord: { fontFamily: F.bold, fontSize: 22, color: C.ink },
  navButton: { height: 42, width: 42, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: F.serif, color: C.ink, fontSize: 34, lineHeight: 38 },
  kicker: { fontFamily: F.bold, color: C.muted, letterSpacing: 1.2, fontSize: 11 },
  subhead: { fontFamily: F.serif, color: C.ink, fontSize: 22, lineHeight: 26 },
  body: { fontFamily: F.body, color: C.ink, fontSize: 15, lineHeight: 22 },
  muted: { fontFamily: F.body, color: C.muted, fontSize: 13, lineHeight: 18 },
  card: {
    padding: 20,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    gap: 12,
  },
  row: { flexDirection: 'row', gap: 8 },
  choice: {
    minHeight: 44,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    justifyContent: 'center',
  },
  choiceOn: { backgroundColor: C.forest },
  choiceText: { color: C.ink, fontFamily: F.medium },
  white: { color: C.white },
  stage: {
    height: 144,
    width: '100%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: '#e9ede4',
    overflow: 'hidden',
  },
  library: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  link: { fontFamily: F.bold, fontSize: 14, color: C.forest },
  progress: { marginTop: 8, flexDirection: 'row', justifyContent: 'space-between' },
  progressLabel: {
    fontFamily: F.bold,
    fontSize: 13,
    lineHeight: 18,
    fontVariant: ['tabular-nums'],
    color: C.forest,
  },
  segments: { flexDirection: 'row', gap: 4, marginBottom: 3 },
  segment: { height: 4, borderRadius: 3, backgroundColor: C.line, flex: 1 },
  done: { backgroundColor: C.forest },
  current: { backgroundColor: '#a6b68e' },
  thumbs: { flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  slot: { flex: 1, alignItems: 'center', gap: 4 },
  mini: {
    height: 40,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e9ece4',
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 8,
    overflow: 'hidden',
  },
  miniOn: { borderColor: C.forest, borderWidth: 2 },
  miniImg: { height: '100%', width: '100%' },
  slotText: { fontFamily: F.medium, color: C.muted, fontSize: 10 },
  pressed: { opacity: 0.7 },
  footnote: { textAlign: 'center', fontSize: 12, color: C.muted, fontFamily: F.body },
  error: { fontFamily: F.medium, color: C.red },
});
