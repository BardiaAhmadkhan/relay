import { useEffect, useRef, useState, type ReactNode } from 'react';
import { outcomes, type Outcome } from '../shared/domain';

const icons: Record<string, string> = {
  book: 'M4 4h6a4 4 0 0 1 3 1.5A4 4 0 0 1 16 4h4v15h-4a4 4 0 0 0-3 1.5A4 4 0 0 0 10 19H4z M13 6v14',
  queue: 'M8 6h12M8 12h12M8 18h9M3.5 6h.1m-.1 6h.1m-.1 6h.1',
  camera: 'M3 7h4l2-3h6l2 3h4v13H3z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  plus: 'M12 5v14M5 12h14',
  arrow: 'M4 12h15m-6-6 6 6-6 6',
  upRight: 'M5 18 18 5M7 5h11v11',
  back: 'M20 12H5m6-6-6 6 6 6',
  down: 'm6 9 6 6 6-6',
  left: 'm14 5-7 7 7 7',
  right: 'm9 5 7 7-7 7',
  search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0zm-1 5 6 6',
  grid: 'M3.5 3.5h7v7h-7zm10 0h7v7h-7zm-10 10h7v7h-7zm10 0h7v7h-7z',
  list: 'M3 5h3v3H3zm6 1.5h12M3 11h3v3H3zm6 1.5h12M3 17h3v3H3zm6 1.5h12',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  check: 'm5 12 4.5 4.5L19 7',
  minus: 'M5 12h14',
  close: 'm6 6 12 12M18 6 6 18',
  aperture: 'M12 3a9 9 0 1 0 .01 0 M12 3l5 8m4 2H11m5 7-5-9m-8 3 5-8m-1 14 5-8 M6 5h9',
  layers: 'm3 8 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5m-18 5 9 5 9-5',
  image: 'M3 4h18v16H3z M3 16l6-6 5 5 3-3 4 4 M15 8h.1',
  menu: 'M3 6h18M3 12h18M3 18h18',
  sort: 'M4 7h10M4 12h7M4 17h4m8-11v12m-3-3 3 3 3-3',
  guide: 'M12 3a9 9 0 1 0 .01 0 M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3h.01',
  expand: 'M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6',
  file: 'M5 3h9l5 5v13H5z M14 3v6h5M8 13h8m-8 4h6',
  clock: 'M12 3a9 9 0 1 0 .01 0 M12 7v6l4 2',
  shield: 'm12 3 8 3v6c0 5-5 8-8 9-3-1-8-4-8-9V6Z',
  lock: 'M5 10h14v11H5z M8 10V7a4 4 0 0 1 8 0v3',
  ruler: 'm3 15 12-12 6 6L9 21z M12 6l3 3m-6 0 2 2m-5 1 3 3',
  tag: 'M3 4h8l10 10-7 7L3 10z M7 7h.1',
  shop: 'M3 9l2-5h14l2 5v3H3z M5 12v8h14v-8m-9 8v-5h4v5',
  flag: 'M5 21V4m0 1c5-4 8 4 14 0v9c-5 4-9-4-14 0',
  upload: 'M12 16V3m-5 5 5-5 5 5 M4 15v6h16v-6',
  refresh: 'M19 8a8 8 0 1 0 1 7m0-12v6h-6',
  zoom: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0zm-1 5 6 6m-11-9v-5m-2.5 2.5h5',
  sliders: 'M3 7h6m4 0h8M3 17h11m4 0h3M9 4v6m5 4v6',
  notebook: 'M5 3h15v18H5z M8 3v18M3 7h4m-4 5h4m-4 5h4',
  compass: 'M12 3a9 9 0 1 0 .01 0m4 5-2.5 5.5L8 16l2.5-5.5Z',
  info: 'M12 3a9 9 0 1 0 .01 0 M12 11v6m0-10h.01',
  dot: 'M12 11.9h.01',
};
export function Icon({ name, size = 19 }: { name: string; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={icons[name] ?? icons.info} />
    </svg>
  );
}
export function Mark({ size = 35 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path
        d="M4 30V10h12c8 0 8 12 0 12H9m11 0 14 8M22 10h14v20"
        stroke="currentColor"
        strokeWidth="2.9"
        strokeLinecap="square"
      />
      <path d="M4 34h8" stroke="#a85b36" strokeWidth="2.9" />
    </svg>
  );
}
export function Brand() {
  return (
    <span className="brand">
      <Mark />
      <span>relay</span>
    </span>
  );
}
export function Status({ outcome }: { outcome: Outcome }) {
  return (
    <span className={'status status-' + outcome}>
      <i />
      {outcomes[outcome].short}
    </span>
  );
}
export function Alert({ children }: { children: ReactNode }) {
  return (
    <div className="alert" role="alert">
      <Icon name="info" />
      <div>{children}</div>
    </div>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name="notebook" size={26} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Loading({ label = 'Opening the notebook' }: { label?: string }) {
  return (
    <div className="skeleton-wrap" aria-busy="true" aria-label={label} role="status">
      <span className="sr">{label}</span>
      {[1, 2, 3].map((n) => (
        <div key={n} className="skeleton" />
      ))}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const el = ref.current!,
      trigger = document.activeElement as HTMLElement | null;
    el.showModal();
    const cancel = (e: Event) => {
      e.preventDefault();
      close.current();
    };
    el.addEventListener('cancel', cancel);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      el.removeEventListener('cancel', cancel);
      el.close();
      document.body.style.overflow = prev;
      trigger?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={'dialog' + (wide ? ' dialog-wide' : '')}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const b = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < b.left ||
            e.clientX > b.right ||
            e.clientY < b.top ||
            e.clientY > b.bottom
          )
            onClose();
        }
      }}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function useRoute() {
  const get = () => window.location.hash.slice(1) || '/trade';
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const changed = () => setRoute(get());
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  return route;
}
export function safeLink(u: string | undefined) {
  if (!u) return undefined;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}
