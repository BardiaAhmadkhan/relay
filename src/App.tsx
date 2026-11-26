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
  const [settings, setSettings] = useState<Config | null>(null),
    [mode, setMode] = useState<Mode>(
      initialMode() ??
        (preference('workspace', 'examples') === 'workshop' ? 'workshop' : 'examples'),
    );
  const needsCards =
    page === 'notebook' || page === 'queue' || (page === 'items' && mode === 'workshop');
  const activePage = page === 'intake' ? 'trade' : page === 'items' ? 'notebook' : page;
  const pages = allPages
    .filter((p) => mode !== 'rider' || p.id !== 'queue')
    .map((p) => (mode === 'rider' && p.id === 'notebook' ? { ...p, label: 'My inspections' } : p));
  const [cards, setCards] = useState<Card[]>([]),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [notebookWarning, setNotebookWarning] = useState(''),
    [epoch, setEpoch] = useState(0),
    [draft, setDraft] = useState(false);
  const [picker, setPicker] = useState(false),
    [pass, setPass] = useState(''),
    [authError, setAuthError] = useState(''),
    [signing, setSigning] = useState(false);
  const [staff, setStaff] = useState({ token: '', name: '' });
  const workspaceButton = useRef<HTMLButtonElement>(null),
    previousPage = useRef(page),
    pop = useRef<HTMLDivElement>(null),
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
    setNotebookWarning('');
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
    void (
      mode === 'examples'
        ? sampleCards().then((cards) => ({ cards, warning: '' }))
        : liveCards(controller.signal)
    )
      .then((v) => {
        if (!controller.signal.aborted) {
          setCards(v.cards);
          setNotebookWarning(v.warning);
        }
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
    setPicker(false);
    if (previousPage.current !== page)
      document.getElementById('main-content')?.focus({ preventScroll: true });
    previousPage.current = page;
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
    if (!picker) return;
    const outside = (e: PointerEvent) => {
      if (!pop.current?.contains(e.target as Node)) {
        setPicker(false);
      }
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPicker(false);
        workspaceButton.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', esc);
    };
  }, [picker]);
  function choose(m: Mode) {
    workspaceButton.current?.focus();
    if (m !== mode) setStaff({ token: '', name: '' });
    setMode(m);
    setPreference('workspace', m);
    const u = new URL(location.href);
    u.searchParams.set('workspace', m);
    u.hash = '/trade';
    history.replaceState(null, '', u);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    setPicker(false);
    setAuthError('');
  }
  function workspaceMenu() {
    return (
      <div className="workspace-menu" id="workspace-options">
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
      <button
        type="button"
        className="skip"
        onClick={() => document.getElementById('main-content')?.focus()}
      >
        Skip to content
      </button>
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
                className={p.id === activePage ? 'active' : ''}
                href={'#/' + p.id}
                aria-current={p.id === activePage ? 'page' : undefined}
              >
                {p.label}
              </a>
            ))}
          </nav>
          <div className="mast-end" ref={pop}>
            <button
              className="workspace-trigger"
              ref={workspaceButton}
              aria-controls={picker ? 'workspace-options' : undefined}
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
            {picker && workspaceMenu()}
          </div>
        </div>
        <nav className="pocket-nav" aria-label="Main navigation">
          {pages.map((p) => (
            <a
              key={p.id}
              href={'#/' + p.id}
              aria-current={p.id === activePage ? 'page' : undefined}
            >
              <Icon name={p.icon} size={16} />
              <span>
                {p.id === 'wallet'
                  ? 'Credit'
                  : p.id === 'queue'
                    ? 'Review'
                    : p.id === 'guide'
                      ? 'Guide'
                      : mode === 'rider' && p.id === 'notebook'
                        ? 'Inspections'
                        : p.label}
              </span>
            </a>
          ))}
        </nav>
      </header>
      <main className="shell" id="main-content" tabIndex={-1}>
        <Suspense fallback={<Loading label="Opening your page" />}>
          {page === 'guide' ? (
            <Guide />
          ) : !settings && (mode !== 'examples' || !initialMode()) ? (
            <Loading label="Opening your workspace" />
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
            <CreditWallet key={mode} mode={mode} />
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
              warning={notebookWarning}
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
