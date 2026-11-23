import * as React from 'react';
import { PanResponder, PixelRatio, Platform, StyleSheet, View } from 'react-native';
type Pt = { x: number; y: number };
type Pose = { s: number; x: number; y: number };
export type ZoomControl = { toggle: () => void; reset: () => void };
export function fitImage(w: number, h: number, pw: number, ph: number) {
  const v = Math.min(w / Math.max(1, pw), h / Math.max(1, ph));
  return { w: Math.max(1, pw * v), h: Math.max(1, ph * v) };
}
export const PhotoViewport = React.forwardRef<
  ZoomControl,
  {
    pw: number;
    ph: number;
    caption: string;
    next: (step: number) => void;
    zoomed: (v: boolean) => void;
    children: React.ReactNode;
  }
>(function PhotoViewport({ pw, ph, caption, next, zoomed, children }, ref) {
  const [frame, setFrame] = React.useState({ w: 1, h: 1 }),
    [pose, setPose] = React.useState<Pose>({ s: 1, x: 0, y: 0 });
  const current = React.useRef(pose),
    points = React.useRef(new Map<number, Pt>()),
    last = React.useRef(0);
  const g = React.useRef<{ pts: Pt[]; base: Pose; time: number; multi: boolean }>({
    pts: [],
    base: pose,
    time: 0,
    multi: false,
  });
  const fit = fitImage(frame.w, frame.h, pw, ph);
  const native =
    pw / (fit.w * (Platform.OS === 'web' ? globalThis.devicePixelRatio || 1 : PixelRatio.get()));
  const nativeMode = React.useRef(false);
  function put(p: Pose) {
    const s = Math.min(Math.max(16, native), Math.max(Math.min(1, native), p.s)),
      rx = Math.max(0, (fit.w * s - frame.w) / 2),
      ry = Math.max(0, (fit.h * s - frame.h) / 2),
      v = { s, x: Math.max(-rx, Math.min(rx, p.x)), y: Math.max(-ry, Math.min(ry, p.y)) };
    current.current = v;
    setPose(v);
    zoomed(nativeMode.current || Math.abs(s - 1) > 0.015);
  }
  const center = (p: Pt[]) =>
    p.length > 1 ? { x: (p[0]!.x + p[1]!.x) / 2, y: (p[0]!.y + p[1]!.y) / 2 } : p[0]!;
  const distance = (p: Pt[]) => Math.hypot(p[0]!.x - p[1]!.x, p[0]!.y - p[1]!.y);
  const scaleAt = (base: Pose, to: number, from: Pt, dest: Pt) => {
    const s = Math.max(1, Math.min(16, to)),
      ratio = s / base.s;
    put({ s, x: (base.x - from.x) * ratio + dest.x, y: (base.y - from.y) * ratio + dest.y });
  };
  const zoom = (pos: Pt = { x: 0, y: 0 }, forceNative = false) => {
    if (nativeMode.current || Math.abs(current.current.s - 1) > 0.015) {
      nativeMode.current = false;
      put({ s: 1, x: 0, y: 0 });
    } else if (forceNative) {
      nativeMode.current = true;
      put({ s: native, x: 0, y: 0 });
    } else scaleAt(current.current, Math.max(2, native), pos, pos);
  };
  React.useImperativeHandle(ref, () => ({
    toggle: () => zoom({ x: 0, y: 0 }, true),
    reset: () => {
      nativeMode.current = false;
      put({ s: 1, x: 0, y: 0 });
    },
  }));
  function start(pts: Pt[], multi = false) {
    g.current = {
      pts,
      base: { ...current.current },
      time: Date.now(),
      multi: multi || pts.length > 1,
    };
  }
  function move(pts: Pt[]) {
    const g0 = g.current;
    if (!pts.length || !g0.pts.length) return;
    if (pts.length !== g0.pts.length) {
      start(pts, g0.multi);
      return;
    }
    if (pts.length >= 2)
      scaleAt(
        g0.base,
        (g0.base.s * distance(pts)) / Math.max(1, distance(g0.pts)),
        center(g0.pts),
        center(pts),
      );
    else if (g0.base.s > 1.015)
      put({
        s: g0.base.s,
        x: g0.base.x + pts[0]!.x - g0.pts[0]!.x,
        y: g0.base.y + pts[0]!.y - g0.pts[0]!.y,
      });
  }
  function end(p: Pt, remaining: Pt[], kind: string) {
    const hold = g.current;
    if (remaining.length) {
      start(remaining, true);
      return;
    }
    if (!hold.pts.length || hold.multi) {
      g.current.pts = [];
      return;
    }
    const dx = p.x - hold.pts[0]!.x,
      dy = p.y - hold.pts[0]!.y,
      t = Date.now();
    if (hold.base.s <= 1.015 && Math.abs(dx) > 55 && Math.abs(dx) > 1.4 * Math.abs(dy)) {
      next(dx < 0 ? 1 : -1);
    } else if (Math.hypot(dx, dy) < 12 && t - hold.time < 500) {
      if (kind === 'mouse') zoom(p);
      else if (t - last.current < 330) {
        last.current = 0;
        zoom(p);
      } else last.current = t;
    }
    g.current.pts = [];
  }
  const touch = (e: any): Pt[] =>
    Array.from(e.nativeEvent.touches ?? [], (t: any) => ({
      x: t.locationX - frame.w / 2,
      y: t.locationY - frame.h / 2,
    }));
  const pan = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => start(touch(e)),
    onPanResponderMove: (e) => move(touch(e)),
    onPanResponderRelease: (e) => {
      const t = e.nativeEvent.changedTouches?.[0] ?? e.nativeEvent;
      end({ x: t.locationX - frame.w / 2, y: t.locationY - frame.h / 2 }, touch(e), 'touch');
    },
    onPanResponderTerminate: () => {
      g.current.pts = [];
    },
  });
  const ptr = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
  };
  return (
    <View
      style={s.viewport}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setFrame((old) => (old.w === width && old.h === height ? old : { w: width, h: height }));
      }}
    >
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: (frame.w - fit.w * pose.s) / 2 + pose.x,
          top: (frame.h - fit.h * pose.s) / 2 + pose.y,
          width: fit.w * pose.s,
          height: fit.h * pose.s,
        }}
      >
        {children}
      </View>
      {Platform.OS === 'web' ? (
        React.createElement('div', {
          role: 'img',
          'aria-label': caption,
          'data-testid': 'evidence-viewport',
          'data-zoom': pose.s.toFixed(3),
          'data-pan-x': pose.x.toFixed(1),
          'data-pan-y': pose.y.toFixed(1),
          style: {
            position: 'absolute',
            inset: 0,
            touchAction: 'none',
            cursor: pose.s > 1 ? 'grab' : 'zoom-in',
            userSelect: 'none',
          },
          onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            points.current.set(e.pointerId, ptr(e));
            start([...points.current.values()]);
          },
          onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
            if (points.current.has(e.pointerId)) {
              points.current.set(e.pointerId, ptr(e));
              move([...points.current.values()]);
            }
          },
          onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
            if (!points.current.has(e.pointerId)) return;
            const pos = ptr(e);
            points.current.delete(e.pointerId);
            end(pos, [...points.current.values()], e.pointerType);
          },
          onPointerCancel: () => {
            points.current.clear();
            g.current.pts = [];
          },
        })
      ) : (
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={caption}
          style={StyleSheet.absoluteFill}
          {...pan.panHandlers}
        />
      )}
    </View>
  );
});
const s = StyleSheet.create({
  viewport: {
    flex: 1,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: '#101612',
  },
});
