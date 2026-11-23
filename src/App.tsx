import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { TradeHome } from './trade/TradeHome';

import { Alert, Brand, Empty, Icon, Loading, useRoute } from './components/ui';
import { config, liveCards, unlock, type Config } from './shared/workshop';
import { sampleCards } from './examples/records';
import { getDraft, preference, setPreference } from './shared/storage';
import { type Card, type Mode, type Tab } from './shared/domain';

const CreditWallet = lazy(() =>
  import('./trade/CreditWallet').then((m) => ({ default: m.CreditWallet })),
);
const Notebook = lazy(() => import('./inspection/Notebook').then((m) => ({ default: m.Notebook })));
const Guide = lazy(() => import('./guide/Guide').then((m) => ({ default: m.Guide })));
const RecordScreen = lazy(() =>
  import('./inspection/RecordScreen').then((m) => ({ default: m.RecordScreen })),
);
const Intake = lazy(() => import('./intake/Intake').then((m) => ({ default: m.Intake })));
const allPages = [
  { id: 'trade', label: 'Trade-in', icon: 'tag' },
  { id: 'wallet', label: 'My credit', icon: 'shop' },
  { id: 'notebook', label: 'Notebook', icon: 'book' },
  { id: 'queue', label: 'Review queue', icon: 'queue' },
  { id: 'guide', label: 'Field guide', icon: 'compass' },
];
const initialMode = () => {
  const url = new URLSearchParams(location.search).get('workspace');
  return url === 'workshop' || url === 'rider' || url === 'examples' ? url : null;
};
export default function App() {
  const route = useRoute(),
    routeParts = route.split('?')[0].split('/').filter(Boolean),
    page = routeParts[0] ?? 'trade';
  const needsCards = ['items', 'notebook', 'queue'].includes(page);
  const [settings, setSettings] = useState<Config | null>(null),
    [mode, setMode] = useState<Mode>(
      initialMode() ??
        (preference('workspace', 'examples') === 'workshop' ? 'workshop' : 'examples'),
    );
  const pages = allPages
    .filter((p) => mode !== 'rider' || p.id !== 'queue')
    .map((p) => (mode === 'rider' && p.id === 'notebook' ? { ...p, label: 'My inspections' } : p));
  const [cards, setCards] = useState<Card[]>([]),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [epoch, setEpoch] = useState(0),
    [draft, setDraft] = useState(false);
  const [picker, setPicker] = useState(false),
    [nav, setNav] = useState(false),
    [pass, setPass] = useState(''),
    [authError, setAuthError] = useState(''),
    [signing, setSigning] = useState(false);
  const [staff, setStaff] = useState({ token: '', name: '' });
  const pop = useRef<HTMLDivElement>(null),
    loadedMode = useRef<Mode | null>(null);
  const refresh = useCallback(() => setEpoch((i) => i + 1), []);
  useEffect(() => {
    let live = true;
    void config().then((c) => {
      if (!live) return;
      setSettings(c);
      if (!initialMode()) {
        const preferred = preference(
          'workspace',
          c.riderAccess ? 'rider' : c.connected ? 'workshop' : 'examples',
        );
        const next: Mode =
          preferred === 'rider' && c.riderAccess
            ? 'rider'
            : preferred === 'workshop' && c.connected
              ? 'workshop'
              : 'examples';
        const url = new URL(location.href);
        url.searchParams.set('workspace', next);
        history.replaceState(null, '', url);
        setMode(next);
      }
    });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!settings) return;
    const controller = new AbortController();
    setBusy(true);
    setError('');
    if (loadedMode.current !== mode || (mode === 'workshop' && settings.locked)) {
      setCards([]);
      loadedMode.current = mode;
    }
    if (
      !needsCards ||
      (mode === 'workshop' && (!settings.connected || settings.locked)) ||
      (mode === 'rider' && !settings.riderAccess)
    ) {
      setBusy(false);
      return;
    }
    void (mode === 'examples' ? sampleCards() : liveCards(controller.signal))
      .then((v) => {
        if (!controller.signal.aborted) setCards(v);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message || 'The notebook could not be opened.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [mode, settings, epoch, needsCards]);
  useEffect(() => {
    let alive = true;
    void getDraft(mode)
      .then((d) => {
        if (alive) setDraft(!!d.history || !!d.garment || Object.keys(d.shots).length > 0);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [mode, page, epoch]);
  useEffect(() => {
    setNav(false);
    setPicker(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
    const label =
      page === 'items'
        ? 'Garment record'
        : page === 'queue'
          ? 'Review queue'
          : page === 'intake'
            ? 'New inspection'
            : page === 'guide'
              ? 'Field guide'
              : page === 'trade'
                ? 'Rider trade-in'
                : page === 'wallet'
                  ? 'My store credit'
                  : 'Gear notebook';
    document.title = label + ' · Relay';
  }, [page, routeParts[1], mode]);
  useEffect(() => {
    if (!picker && !nav) return;
    const outside = (e: PointerEvent) => {
      if (!pop.current?.contains(e.target as Node)) {
        setPicker(false);
        setNav(false);
      }
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPicker(false);
        setNav(false);
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', esc);
    };
  }, [picker, nav]);
  function choose(m: Mode) {
    if (m !== mode) setStaff({ token: '', name: '' });
    setMode(m);
    setPreference('workspace', m);
    const u = new URL(location.href);
    u.searchParams.set('workspace', m);
    u.hash = '/trade';
    history.replaceState(null, '', u);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    setPicker(false);
    setNav(false);
    setAuthError('');
  }
  function workspaceMenu() {
    return (
      <div className="workspace-menu">
        <div className="menu-title">Choose workspace</div>
        {(
          (settings?.riderAccess
            ? ['rider', 'examples', 'workshop']
            : ['examples', 'workshop']) as Mode[]
        ).map((m) => (
          <button
            key={m}
            onClick={() => choose(m)}
            disabled={m === 'workshop' && !settings?.connected}
          >
            <Icon name={m === 'examples' ? 'notebook' : 'shop'} />
            <span>
              <strong>
                {m === 'rider'
                  ? 'Personal rider desk'
                  : m === 'examples'
                    ? 'Example notebook'
                    : (settings?.title ?? 'Connected workshop')}
              </strong>
              <small>
                {m === 'examples'
                  ? 'Illustrated records on this device'
                  : m === 'rider'
                    ? 'Only your own inspections and credit'
                    : settings?.connected
                      ? 'Records from the inspection service'
                      : 'Service connection required'}
              </small>
            </span>
            {mode === m && <Icon name="check" size={16} />}
          </button>
        ))}
        {settings?.protected && !settings.locked && (
          <button
            onClick={async () => {
              try {
                const res = await fetch('/relay-session', { method: 'DELETE' });
                if (!res.ok) throw Error('Could not lock the workshop.');
                setStaff({ token: '', name: '' });
                setSettings(await config());
                setPicker(false);
              } catch (e) {
                setAuthError((e as Error).message);
              }
            }}
          >
            <Icon name="lock" />
            <span>Lock workshop</span>
          </button>
        )}
        {authError && picker && <Alert>{authError}</Alert>}
      </div>
    );
  }
  const recordId = routeParts[1] ? decodePart(routeParts[1]) : '',
    tab = (
      ['result', 'overview', 'trade', 'evidence', 'specialist', 'shop'].includes(routeParts[2])
        ? routeParts[2]
        : 'overview'
    ) as Tab;
  const unavailable =
    settings &&
    ((mode === 'workshop' && (!settings.connected || settings.locked)) ||
      (mode === 'rider' && !settings.riderAccess));
  return (
    <>
      <a
        className="skip"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="site-head">
        <div className="mast">
          <a className="home-link" href="#/trade" aria-label="Relay home">
            <Brand />
          </a>
          <span className="mast-divider" />
          <nav className="desktop-nav" aria-label="Main navigation">
            {pages.map((p) => (
              <a
                key={p.id}
                className={
                  p.id === page || (p.id === 'notebook' && page === 'items') ? 'active' : ''
                }
                href={'#/' + p.id}
                aria-current={p.id === page ? 'page' : undefined}
              >
                {p.label}
              </a>
            ))}
          </nav>
          <div className="mast-end" ref={pop}>
            <button
              className="workspace-trigger"
              aria-expanded={picker}
              aria-label={
                (mode === 'examples'
                  ? 'Example workspace'
                  : mode === 'rider'
                    ? 'Rider desk'
                    : 'Workshop') + ', choose workspace'
              }
              onClick={() => {
                setPicker(!picker);
                setNav(false);
              }}
            >
              <span className={'workspace-dot ' + mode} />
              <span>
                {mode === 'examples'
                  ? 'Example workspace'
                  : mode === 'rider'
                    ? 'Rider desk'
                    : 'Workshop'}
              </span>
              <Icon name="down" size={14} />
            </button>
            <button
              className="menu-trigger icon-button"
              onClick={() => {
                setNav(!nav);
                setPicker(false);
              }}
              aria-label="Navigation menu"
              aria-expanded={nav}
            >
              <Icon name={nav ? 'close' : 'menu'} />
            </button>
            {picker && workspaceMenu()}
            {nav && (
              <nav className="mobile-nav" aria-label="Mobile navigation">
                {pages.map((p) => (
                  <a key={p.id} href={'#/' + p.id} onClick={() => setNav(false)}>
                    <Icon name={p.icon} />
                    {p.label}
                  </a>
                ))}
                <a href="#/intake" onClick={() => setNav(false)}>
                  <Icon name="plus" />
                  New inspection
                </a>
              </nav>
            )}
          </div>
        </div>
      </header>
      <main className="shell" id="main-content" tabIndex={-1}>
        <Suspense fallback={<Loading label="Opening your page" />}>
          {page === 'guide' ? (
            <Guide />
          ) : unavailable ? (
            <div className="utility-page">
              <Empty
                title={
                  mode === 'workshop' && settings.locked
                    ? 'Open your workshop'
                    : 'Workshop connection needed'
                }
                action={
                  mode === 'workshop' && settings.locked ? (
                    <form
                      className="stack"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        setSigning(true);
                        setAuthError('');
                        try {
                          await unlock(pass);
                          setPass('');
                          setSettings(await config());
                        } catch (e) {
                          setAuthError((e as Error).message);
                        } finally {
                          setSigning(false);
                        }
                      }}
                    >
                      <label>
                        Workspace password
                        <input
                          type="password"
                          autoComplete="current-password"
                          required
                          value={pass}
                          onChange={(e) => setPass(e.target.value)}
                        />
                      </label>
                      {authError && <Alert>{authError}</Alert>}
                      <button className="button primary" disabled={signing}>
                        Open workshop
                      </button>
                    </form>
                  ) : (
                    <button className="button primary" onClick={() => choose('examples')}>
                      Open example notebook
                    </button>
                  )
                }
              >
                {mode === 'workshop' && settings.locked
                  ? 'Enter the password supplied by your workshop.'
                  : 'This installation currently offers the self-contained example notebook.'}
              </Empty>
            </div>
          ) : page === 'trade' ? (
            <TradeHome mode={mode} draft={draft} retailer={settings?.retailer} />
          ) : page === 'wallet' ? (
            <CreditWallet mode={mode} />
          ) : page === 'intake' ? (
            <Intake key={mode} mode={mode} onFinish={refresh} />
          ) : page === 'items' ? (
            <RecordScreen
              key={mode + ':' + recordId}
              mode={mode}
              id={recordId}
              tab={tab}
              card={cards.find((c) => c.id === recordId)}
              listLoading={busy || !settings}
              listError={error}
              staff={staff}
              setStaff={setStaff}
              onChange={refresh}
            />
          ) : page === 'notebook' || page === 'queue' ? (
            <Notebook
              key={mode + ':' + page}
              mode={mode}
              items={cards}
              loading={busy || !settings}
              error={error}
              retry={refresh}
              queue={page === 'queue' && mode !== 'rider'}
              hasDraft={draft}
            />
          ) : (
            <div className="utility-page">
              <Empty
                title="Page not found"
                action={
                  <a className="button primary" href="#/notebook">
                    Back to notebook
                  </a>
                }
              >
                Open the notebook to find a garment or start an inspection.
              </Empty>
            </div>
          )}
        </Suspense>
      </main>
      <footer className="site-foot">
        <div>
          <Brand />
          <span>Gear trade-in</span>
        </div>
        <a href="#/guide">
          Field guide <Icon name="upRight" size={14} />
        </a>
      </footer>
    </>
  );
}
function decodePart(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
}
