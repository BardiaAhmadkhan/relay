import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import Svg, { Path, Circle, Rect, Line, Ellipse, G } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
export const C = {
  paper: '#F4F1E9',
  ink: '#202822',
  muted: '#62695F',
  line: '#D4D5C9',
  wash: '#E9E7DD',
  orange: '#B94E2B',
  white: '#FFFFFF',
  forest: '#375747',
  ochre: '#7A5A19',
  red: '#8C3C35',
};
export const F = {
  body: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  bold: 'DMSans_600SemiBold',
  serif: 'InstrumentSerif_400Regular',
};
export function Icon({
  name,
  size = 22,
  color = C.ink,
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  const paths: Record<string, string> = {
    arrow: 'M4 12h16m-6-6 6 6-6 6',
    back: 'M20 12H4m6-6-6 6 6 6',
    close: 'm6 6 12 12M18 6 6 18',
    check: 'm5 12 4 4L19 6',
    plus: 'M12 5v14M5 12h14',
    camera: 'M3 7h4l2-3h6l2 3h4v13H3Z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    info: 'M12 11v6m0-10v1',
    settings: 'M4 7h16M4 17h16M9 4v6m6 4v6',
    share: 'M12 16V3m-4 4 4-4 4 4M5 11v10h14V11',
    file: 'M6 3h8l4 4v14H6ZM14 3v5h4M9 12h6m-6 4h6',
  };
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessible={Platform.OS === 'web' ? undefined : false}
      aria-hidden={Platform.OS === 'web' ? true : undefined}
    >
      <Path
        d={paths[name] ?? paths.info}
        fill="none"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {name === 'info' && (
        <Circle cx={12} cy={12} r={10} fill="none" stroke={color} strokeWidth={1.5} />
      )}
    </Svg>
  );
}
export function RelayMark({ size = 32 }: { size?: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      accessible={Platform.OS === 'web' ? undefined : false}
      aria-hidden={Platform.OS === 'web' ? true : undefined}
    >
      <Path
        d="M4 30V10h12c8 0 8 12 0 12H9m11 0 14 8M22 10h14v20"
        fill="none"
        stroke={C.ink}
        strokeWidth={3}
        strokeLinecap="square"
      />
      <Path d="M4 34h9" stroke={C.orange} strokeWidth={3} />
    </Svg>
  );
}
export function JacketArt({ back = false, ghost = false }: { back?: boolean; ghost?: boolean }) {
  const body = ghost ? 'transparent' : '#344138',
    edge = ghost ? '#F4F1E9' : '#202C24',
    panel = ghost ? 'transparent' : '#3D4B40',
    stitch = ghost ? '#F4F1E9' : '#8D9987';
  return (
    <Svg
      width="100%"
      height="100%"
      viewBox="0 0 360 310"
      accessibilityLabel={
        back ? 'Illustrated back view of a jacket' : 'Illustrated front view of a jacket'
      }
      accessible={Platform.OS === 'web' ? undefined : true}
    >
      {!ghost && (
        <>
          <Ellipse cx={180} cy={285} rx={100} ry={9} fill="#202822" opacity={0.07} />
          <Line x1={18} y1={75} x2={65} y2={75} stroke={C.line} />
          <Line x1={295} y1={75} x2={342} y2={75} stroke={C.line} />
          <Line x1={180} y1={12} x2={180} y2={28} stroke={C.line} />
          <Path
            d="M29 115v-13h13m276 0h13v13M29 231v13h13m276 0h13v-13"
            fill="none"
            stroke={C.line}
          />
        </>
      )}
      <Path
        d="m144 39-39 16-32 27-32 145 43 12 30-107-7 132 72 13 74-13-8-132 31 107 43-12-32-145-32-27-39-16Z"
        fill={body}
        stroke={edge}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      <Path
        d="m144 39 14-14h44l14 14-14 35h-44Z"
        fill={ghost ? 'transparent' : '#1C2820'}
        stroke={edge}
        strokeWidth={2}
      />
      <Path d="m150 35 13 21h34l13-21" fill="none" stroke={stitch} strokeWidth={1} opacity={0.7} />
      <Path
        d="m108 59 10 39-20 37-16-6m169-70-10 39 20 37 16-6"
        fill={panel}
        stroke={stitch}
        strokeWidth={1}
        opacity={0.6}
      />
      <Path
        d="m73 174 25 7-11 43-30-8Zm214 0-25 7 11 43 30-8Z"
        fill={panel}
        stroke={stitch}
        strokeWidth={1}
        opacity={0.65}
      />
      <Path
        d="m112 128 13 48-9 78m132-126-13 48 9 78"
        fill="none"
        stroke={stitch}
        strokeWidth={1}
        strokeDasharray="3 3"
        opacity={0.65}
      />
      {back ? (
        <>
          <Path
            d="M136 89q44-17 88 0l-4 115q-40 22-80 0Z"
            fill={panel}
            stroke={stitch}
            strokeWidth={1}
          />
          <Path
            d="M146 102h68m-69 8h70m-69 8h68M144 195q36 13 72 0"
            fill="none"
            stroke={stitch}
            strokeWidth={1}
            opacity={0.5}
          />
        </>
      ) : (
        <>
          <Line x1={180} y1={66} x2={180} y2={271} stroke={stitch} strokeWidth={2} />
          <Line x1={184} y1={72} x2={184} y2={269} stroke={edge} strokeWidth={2} />
          <Path
            d="m123 113 39-6m37 0 39 6m-115 83 30-13m51 0 30 13"
            fill="none"
            stroke={edge}
            strokeWidth={5}
            strokeLinecap="round"
          />
          <Path
            d="m125 111 37-6m37 0 37 6m-113 88 30-13m51 0 30 13"
            fill="none"
            stroke={stitch}
            strokeWidth={1}
            opacity={0.7}
          />
          <Rect x={193} y={90} width={18} height={5} fill={ghost ? 'transparent' : C.orange} />
          <Path d="M177 82h6v13h-6Z" fill={ghost ? 'transparent' : '#BFC6B8'} />
        </>
      )}
      <Path
        d="m44 226 39 11-4 15-39-12m238-3 39-11 4 14-39 12M110 251l69 13 71-13v13l-71 13-72-13Z"
        fill={ghost ? 'transparent' : '#26332B'}
        stroke={edge}
        strokeWidth={1.5}
      />
    </Svg>
  );
}
export function useReducedMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (active) setReduced(v);
    });
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      active = false;
      listener.remove();
    };
  }, []);
  return reduced;
}
export function Fade({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const value = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (!mounted || reduce) return;
      value.setValue(0);
      Animated.timing(value, {
        toValue: 1,
        duration: 180,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    });
    return () => {
      mounted = false;
      value.stopAnimation();
    };
  }, [value]);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: value,
          transform: [
            { translateY: value.interpolate({ inputRange: [0, 1], outputRange: [5, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
export function Button({
  label,
  onPress,
  kind = 'primary',
  icon = 'arrow',
  disabled = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'quiet';
  icon?: string | null;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        onPress();
      }}
      testID={testID}
      style={({ pressed }) => [
        s.button,
        kind === 'primary' ? s.primary : kind === 'secondary' ? s.secondary : s.quiet,
        disabled && { opacity: 0.45 },
        pressed && { opacity: 0.78, transform: [{ scale: 0.99 }] },
      ]}
    >
      <Text style={[s.buttonText, { color: kind === 'primary' ? C.white : C.ink }]}>{label}</Text>
      {icon && <Icon name={icon} color={kind === 'primary' ? C.white : C.ink} />}
    </Pressable>
  );
}
export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={s.label}>{children}</Text>;
}
export function Note({
  children,
  tone = 'normal',
}: {
  children: React.ReactNode;
  tone?: 'normal' | 'error';
}) {
  return (
    <View style={[s.note, tone === 'error' && { backgroundColor: '#F3E5DD' }]}>
      <Icon name="info" size={18} color={tone === 'error' ? C.red : C.muted} />
      <Text style={[s.noteText, tone === 'error' && { color: C.red }]}>{children}</Text>
    </View>
  );
}
export const s = StyleSheet.create({
  label: {
    fontFamily: F.bold,
    fontSize: 11,
    lineHeight: 17,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: C.muted,
  },
  title: { fontFamily: F.serif, fontSize: 46, lineHeight: 48, color: C.ink, letterSpacing: -0.5 },
  heading: { fontFamily: F.serif, fontSize: 34, lineHeight: 38, color: C.ink },
  body: { fontFamily: F.body, fontSize: 16, lineHeight: 24, color: C.muted },
  small: { fontFamily: F.body, fontSize: 13, lineHeight: 20, color: C.muted },
  button: {
    minHeight: 56,
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    borderRadius: 6,
    borderWidth: 1,
  },
  primary: { backgroundColor: C.orange, borderColor: C.orange },
  secondary: { backgroundColor: 'transparent', borderColor: C.line },
  quiet: { backgroundColor: 'transparent', borderColor: 'transparent', paddingHorizontal: 0 },
  buttonText: { fontFamily: F.bold, fontSize: 15, lineHeight: 22 },
  note: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    backgroundColor: C.wash,
    borderRadius: 5,
    alignItems: 'flex-start',
  },
  noteText: { flex: 1, fontFamily: F.body, fontSize: 13, lineHeight: 20, color: C.muted },
});
