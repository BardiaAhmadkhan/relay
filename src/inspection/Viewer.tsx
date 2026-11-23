import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../components/ui';
import type { Frame } from '../shared/domain';

type Point = { x: number; y: number };
type Pose = { scale: number; x: number; y: number };
export function Viewer({
  frames,
  start,
  close,
}: {
  frames: Frame[];
  start: string;
  close: () => void;
}) {
  const [index, setIndex] = useState(
    Math.max(
      0,
      frames.findIndex((f) => f.id === start),
    ),
  );
  const f = frames[index] ?? frames[0];
  const [full, setFull] = useState(!f.crop || !!f.startFull),
    [failed, setFailed] = useState(false),
    [ready, setReady] = useState(false);
  const [pose, setPose] = useState<Pose>({ scale: 1, x: 0, y: 0 }),
    livePose = useRef(pose),
    [nativePixel, setNativePixel] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    stage = useRef<HTMLDivElement>(null),
    [size, setSize] = useState({ w: 1, h: 1 });
  const pointers = useRef(new Map<number, Point>()),
    gesture = useRef<{ points: Point[]; pose: Pose; multi: boolean } | null>(null),
    tapTime = useRef(0);
  const closeRef = useRef(close);
  closeRef.current = close;
  useLayoutEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const d = dialog.current!;
    d.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      d.close();
      document.body.style.overflow = old;
      trigger?.focus({ preventScroll: true });
    };
  }, []);
  useLayoutEffect(() => {
    const s = stage.current!;
    const update = () => {
      const b = s.getBoundingClientRect();
      setSize({ w: b.width, h: b.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(s);
    return () => observer.disconnect();
  }, []);
  const src = full || !f.crop ? f.src : f.crop;
  const [decoded, setDecoded] = useState<{ src: string; w: number; h: number } | null>(null);
  const pw = decoded?.src === src ? decoded.w : (!full && f.crop ? f.cropWidth : f.width) || 1,
    ph = decoded?.src === src ? decoded.h : (!full && f.crop ? f.cropHeight : f.height) || 1;
  const fit = Math.min(size.w / pw, size.h / ph),
    fw = fit * pw,
    fh = fit * ph,
    one = 1 / (fit * (window.devicePixelRatio || 1));
  function set(p: Pose) {
    const rx = Math.max(0, (fw * p.scale - size.w) / 2),
      ry = Math.max(0, (fh * p.scale - size.h) / 2);
    const n = {
      scale: p.scale,
      x: Math.max(-rx, Math.min(rx, p.x)),
      y: Math.max(-ry, Math.min(ry, p.y)),
    };
    livePose.current = n;
    setPose(n);
  }
  function reset() {
    livePose.current = { scale: 1, x: 0, y: 0 };
    setPose(livePose.current);
    setNativePixel(false);
    pointers.current.clear();
    gesture.current = null;
  }
  function go(n: number) {
    if (frames.length < 2) return;
    const next = (index + n + frames.length) % frames.length;
    setIndex(next);
    setFull(!frames[next].crop || !!frames[next].startFull);
    setReady(false);
    setFailed(false);
    reset();
  }
  function toggle() {
    setFull(!full);
    setReady(false);
    setFailed(false);
    reset();
  }
  function zoom(native = false, point: Point = { x: 0, y: 0 }) {
    if (nativePixel || Math.abs(livePose.current.scale - 1) > 0.01) {
      reset();
      return;
    }
    const scale = native ? one : Math.max(2, Math.min(6, one));
    setNativePixel(native);
    set({ scale, x: point.x * (1 - scale), y: point.y * (1 - scale) });
  }
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        go(1);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoom(true);
      }
    };
    document.addEventListener('keydown', keys);
    return () => document.removeEventListener('keydown', keys);
  });
  function point(e: React.PointerEvent<HTMLDivElement>) {
    const b = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - b.left - b.width / 2, y: e.clientY - b.top - b.height / 2 };
  }
  function startGesture(multi = false) {
    const pts = [...pointers.current.values()];
    gesture.current = {
      points: pts,
      pose: { ...livePose.current },
      multi: multi || pts.length > 1,
    };
  }
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const middle = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  function move(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, point(e));
    const now = [...pointers.current.values()],
      g = gesture.current;
    if (now.length !== g.points.length) {
      startGesture(g.multi);
      return;
    }
    if (now.length >= 2) {
      const scale = Math.max(
          1,
          Math.min(
            12,
            (g.pose.scale * distance(now[0], now[1])) /
              Math.max(1, distance(g.points[0], g.points[1])),
          ),
        ),
        a = middle(g.points[0], g.points[1]),
        b = middle(now[0], now[1]);
      setNativePixel(false);
      set({
        scale,
        x: ((g.pose.x - a.x) * scale) / g.pose.scale + b.x,
        y: ((g.pose.y - a.y) * scale) / g.pose.scale + b.y,
      });
    } else if (g.pose.scale > 1.01)
      set({
        scale: g.pose.scale,
        x: g.pose.x + now[0].x - g.points[0].x,
        y: g.pose.y + now[0].y - g.points[0].y,
      });
  }
  function up(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || !pointers.current.has(e.pointerId)) return;
    const end = point(e);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size) {
      startGesture(true);
      return;
    }
    gesture.current = null;
    if (g.multi) return;
    const dx = end.x - g.points[0].x,
      dy = end.y - g.points[0].y;
    if (g.pose.scale <= 1.01 && Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      go(dx < 0 ? 1 : -1);
      return;
    }
    if (Math.hypot(dx, dy) < 10) {
      const now = Date.now();
      if (e.pointerType === 'mouse' || now - tapTime.current < 330) {
        zoom(false, end);
        tapTime.current = 0;
      } else tapTime.current = now;
    }
  }
  return (
    <dialog
      className="viewer"
      ref={dialog}
      aria-label="Evidence photo viewer"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header className="viewer-head">
        <span>
          <Icon name="image" />
          Source photograph
        </span>
        <button autoFocus onClick={close} aria-label="Close photo">
          <Icon name="close" size={23} />
        </button>
      </header>
      <div
        ref={stage}
        className={'viewer-stage ' + (pose.scale > 1 ? 'magnified' : '')}
        data-zoom={pose.scale.toFixed(3)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, point(e));
          startGesture();
        }}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          pointers.current.clear();
          gesture.current = null;
        }}
      >
        {!ready && !failed && <span className="viewer-message">Opening photograph…</span>}
        {failed && <span className="viewer-message">This source photograph is unavailable.</span>}
        {!failed && (
          <div
            className="viewer-pixels"
            style={{
              width: fw * pose.scale,
              height: fh * pose.scale,
              left: (size.w - fw * pose.scale) / 2 + pose.x,
              top: (size.h - fh * pose.scale) / 2 + pose.y,
            }}
          >
            <img
              key={src}
              src={src}
              alt={f.name + '. ' + f.caption}
              draggable={false}
              onLoad={(e) => {
                setDecoded({
                  src,
                  w: e.currentTarget.naturalWidth,
                  h: e.currentTarget.naturalHeight,
                });
                setReady(true);
              }}
              onError={() => {
                if (!full && f.crop) {
                  setFull(true);
                  setReady(false);
                  reset();
                } else setFailed(true);
              }}
            />
            {full && f.rect && (
              <div
                className="source-box"
                style={{
                  left: f.rect[0] * 100 + '%',
                  top: f.rect[1] * 100 + '%',
                  width: (f.rect[2] - f.rect[0]) * 100 + '%',
                  height: (f.rect[3] - f.rect[1]) * 100 + '%',
                }}
              />
            )}
          </div>
        )}
      </div>
      <footer className="viewer-foot">
        <div aria-live="polite">
          <h2>{f.name}</h2>
          <p>{f.caption}</p>
          <small>
            {index + 1} / {frames.length} · {pw} × {ph} px ·{' '}
            {full ? 'Full source' : 'Recorded crop'}
          </small>
        </div>
        <div className="viewer-actions">
          <button aria-label="Previous photo" disabled={frames.length < 2} onClick={() => go(-1)}>
            <Icon name="left" />
          </button>
          {f.crop && (
            <button onClick={toggle}>
              <Icon name="expand" />
              {full ? 'Show crop' : 'Full source'}
            </button>
          )}
          <button
            aria-label={
              nativePixel || pose.scale !== 1 ? 'Fit photograph' : '100% · Zoom to native pixels'
            }
            onClick={() => zoom(true)}
          >
            <Icon name="zoom" />
            {nativePixel || pose.scale !== 1 ? 'Fit' : '100%'}
          </button>
          <button aria-label="Next photo" disabled={frames.length < 2} onClick={() => go(1)}>
            <Icon name="right" />
          </button>
        </div>
      </footer>
    </dialog>
  );
}
