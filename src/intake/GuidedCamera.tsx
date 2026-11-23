import { useEffect, useRef, useState } from 'react';
import { framingPhoto, labels, type Slot } from '../shared/domain';
import { Icon } from '../components/ui';
const guides: Record<Slot, string> = {
  front: 'Lay it flat. Keep both sides and the hem in the frame.',
  back: 'Turn it over. Include the collar or waistband and both edges.',
  label: 'Place the sewn-in label inside the small box. Keep its stitching visible.',
  inside: 'Open the garment. Show the full inside front and the edges of the lining.',
  detail: 'Centre the mark and include enough fabric to show where it sits.',
};
export function GuidedCamera({
  slot,
  garment,
  busy,
  save,
  switchUpload,
}: {
  slot: Slot;
  garment?: string;
  busy: boolean;
  save: (f: File) => Promise<boolean>;
  switchUpload: () => void;
}) {
  const matte = useRef<HTMLDivElement>(null),
    [bounds, setBounds] = useState({ w: 0, h: 0 });
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    native = useRef<HTMLInputElement>(null),
    version = useRef(0),
    alive = useRef(true);
  const [state, setState] = useState<'starting' | 'ready' | 'unavailable' | 'paused'>('starting'),
    [issue, setIssue] = useState(''),
    [ratio, setRatio] = useState(4 / 3),
    [shot, setShot] = useState<{ file: File; url: string } | null>(null),
    [showGuide, setShowGuide] = useState(false),
    [taking, setTaking] = useState(false);
  useEffect(() => {
    const m = matte.current;
    if (!m) return;
    const measure = () => setBounds({ w: m.clientWidth, h: m.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(m);
    return () => observer.disconnect();
  }, []);
  function stop() {
    version.current++;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }
  async function start() {
    stop();
    const seq = version.current;
    setState('starting');
    setIssue('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Error('device');
      const s = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
        },
        audio: false,
      });
      if (seq !== version.current || !alive.current) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = s;
      const v = video.current;
      if (!v) {
        stop();
        return;
      }
      v.srcObject = s;
      await v.play();
      if (seq === version.current) {
        setRatio((v.videoWidth || 4) / (v.videoHeight || 3));
        setState('ready');
      }
    } catch (e) {
      if (seq !== version.current || !alive.current) return;
      stop();
      setIssue(
        (e as Error).name === 'NotAllowedError'
          ? 'Camera access is off. Allow access in your browser or open your device camera.'
          : 'A live camera is unavailable here. Use your device camera or upload a photo.',
      );
      setState('unavailable');
    }
  }
  useEffect(() => {
    alive.current = true;
    void start();
    const hidden = () => {
      if (document.hidden) {
        stop();
        setState('paused');
      }
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      alive.current = false;
      stop();
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  useEffect(() => {
    setShot(null);
    setShowGuide(false);
  }, [slot]);
  useEffect(
    () => () => {
      if (shot) URL.revokeObjectURL(shot.url);
    },
    [shot],
  );
  function preview(f: File) {
    setShot({ file: f, url: URL.createObjectURL(f) });
    setIssue('');
  }
  async function take() {
    const v = video.current;
    if (!v?.videoWidth || taking) return;
    setTaking(true);
    try {
      const canvas = document.createElement('canvas'),
        scale = Math.min(1, 2560 / Math.max(v.videoWidth, v.videoHeight));
      canvas.width = Math.round(v.videoWidth * scale);
      canvas.height = Math.round(v.videoHeight * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw Error();
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const b = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.95),
      );
      if (!b) throw Error();
      if (alive.current) preview(new File([b], slot + '.jpg', { type: 'image/jpeg' }));
    } catch {
      setIssue('Could not capture that view. Try again or open the device camera.');
    } finally {
      if (alive.current) setTaking(false);
    }
  }
  const pants = garment === 'pants',
    shape = pants
      ? 'M30 9 L70 9 L75 36 L69 91 L53 91 L50 49 L45 91 L29 91 L25 36 Z'
      : 'M39 13 L45 9 L55 9 L61 13 L73 18 L88 62 L77 68 L67 44 L68 88 L32 88 L33 44 L23 68 L12 62 L27 18 Z';
  return (
    <section className="camera-panel" aria-label={'Camera guide for ' + labels[slot]}>
      <div className="camera-top">
        <span>
          <i />
          {shot ? 'Review photo' : state === 'ready' ? 'Live camera' : 'Camera guide'} ·{' '}
          {slot === 'detail'
            ? 'Optional'
            : ['front', 'back', 'label', 'inside'].indexOf(slot) + 1 + ' / 4'}
        </span>
        <button onClick={() => setShowGuide(!showGuide)} aria-pressed={showGuide}>
          {showGuide ? 'Hide example' : 'See example'}
          <Icon name="image" size={15} />
        </button>
      </div>
      <div ref={matte} className="camera-matte">
        <div
          className="camera-frame"
          style={
            bounds.w
              ? {
                  width: Math.min(bounds.w, bounds.h * ratio),
                  height: Math.min(bounds.h, bounds.w / ratio),
                }
              : { aspectRatio: ratio }
          }
        >
          <video
            ref={video}
            onResize={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight);
            }}
            playsInline
            muted
            autoPlay
            aria-label="Live camera view"
            className={shot || state !== 'ready' ? 'invisible-video' : ''}
          />
          {shot ? (
            <img
              className="camera-review-photo"
              src={shot.url}
              alt={'Your ' + labels[slot].toLowerCase() + ' photo'}
            />
          ) : (
            <>
              {state !== 'ready' && (
                <img
                  className="camera-placeholder"
                  src={framingPhoto(slot, garment)}
                  alt="Framing example"
                />
              )}
              <svg
                className="framing-overlay"
                aria-hidden="true"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                {slot === 'label' ? (
                  <rect x="23" y="23" width="54" height="55" rx="1" />
                ) : slot === 'detail' ? (
                  <rect x="25" y="25" width="50" height="50" rx="2" />
                ) : (
                  <>
                    <path d={shape} />
                    {slot === 'inside' && <path d="M43 17 49 46 43 81 M57 17 51 46 57 81" />}
                    {slot === 'back' && !pants && <path d="M30 25 Q50 34 70 25" />}
                  </>
                )}
              </svg>
              <b className="frame-corner tl" />
              <b className="frame-corner tr" />
              <b className="frame-corner bl" />
              <b className="frame-corner br" />
            </>
          )}
        </div>
      </div>
      <div className="camera-instruction">
        <strong>{labels[slot]}</strong>
        <span>{shot ? 'Check the edges and focus before continuing.' : guides[slot]}</span>
      </div>
      {showGuide && (
        <div className="inline-guide">
          <img
            src={framingPhoto(slot, garment)}
            alt={'Example of the ' + labels[slot].toLowerCase() + ' framing'}
          />
        </div>
      )}
      {issue && (
        <p className="camera-feedback" role="status">
          {issue}
        </p>
      )}
      <div className="camera-bar">
        {shot ? (
          <>
            <button className="camera-secondary" disabled={busy} onClick={() => setShot(null)}>
              Retake
            </button>
            <button
              className="button signal"
              disabled={busy}
              onClick={async () => {
                if (await save(shot.file)) setShot(null);
              }}
            >
              Use this photo
              <Icon name="check" size={16} />
            </button>
          </>
        ) : (
          <>
            {state === 'ready' ? (
              <button
                className="shutter"
                disabled={busy || taking}
                aria-label={'Take ' + labels[slot].toLowerCase() + ' photo'}
                onClick={() => void take()}
              >
                <i />
              </button>
            ) : (
              <button
                className="button signal"
                disabled={state === 'starting'}
                onClick={() => (state === 'paused' ? void start() : native.current?.click())}
              >
                {state === 'starting'
                  ? 'Opening camera…'
                  : state === 'paused'
                    ? 'Resume camera'
                    : 'Open device camera'}
              </button>
            )}
            {state === 'unavailable' && (
              <button className="camera-secondary" onClick={() => void start()}>
                Retry live camera
              </button>
            )}
          </>
        )}
      </div>
      <button className="camera-switch" disabled={busy} onClick={switchUpload}>
        Use existing photos instead
      </button>
      <input
        ref={native}
        className="sr"
        tabIndex={-1}
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="Device camera photograph"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) preview(f);
          e.target.value = '';
        }}
      />
    </section>
  );
}
