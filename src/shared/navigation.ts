import type { Mode } from './domain';
type ReturnTo = { hash: string; id: string; y: number };
const key = (mode: Mode) => 'relay.return.' + mode;
export function rememberList(mode: Mode, id: string) {
  try {
    sessionStorage.setItem(
      key(mode),
      JSON.stringify({ hash: location.hash || '#/notebook', id, y: window.scrollY }),
    );
  } catch {}
}
export function listOrigin(mode: Mode): ReturnTo | undefined {
  try {
    const v = JSON.parse(sessionStorage.getItem(key(mode)) ?? 'null');
    if (
      v &&
      /^#\/(notebook|queue)(?:\?[^#]{0,600})?$/.test(v.hash) &&
      typeof v.id === 'string' &&
      Number.isFinite(v.y)
    )
      return v;
  } catch {}
}
export function restoreList(mode: Mode) {
  const v = listOrigin(mode);
  if (!v || v.hash !== location.hash) return;
  sessionStorage.removeItem(key(mode));
  const target = document.getElementById('item-' + v.id);
  if (!target) return;
  requestAnimationFrame(() => {
    window.scrollTo({ top: v.y, behavior: 'instant' });
    target.focus({ preventScroll: true });
  });
}
