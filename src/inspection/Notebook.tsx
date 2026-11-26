import { useEffect, useState } from 'react';
import {
  kindName,
  outcomes,
  recordCode,
  recordHref,
  type Card,
  type Mode,
  type Outcome,
} from '../shared/domain';
import { Alert, Empty, Icon, Loading, Status } from '../components/ui';
import { preference, setPreference } from '../shared/storage';
import { rememberList, restoreList } from '../shared/navigation';

type Filter = Outcome | 'all';
const filters: Filter[] = ['all', 'request', 'specialist', 'keep', 'retire'];
const filterText: Record<Filter, string> = {
  all: 'All garments',
  request: 'Needs evidence',
  specialist: 'Specialist review',
  keep: 'Eligible',
  retire: 'No offer',
  replace: 'Replacement',
};
export function Notebook({
  items,
  mode,
  loading,
  error,
  retry,
  queue = false,
  hasDraft = false,
  warning = '',
}: {
  items: Card[];
  mode: Mode;
  loading: boolean;
  error: string;
  retry: () => void;
  queue?: boolean;
  hasDraft?: boolean;
  warning?: string;
}) {
  const raw = window.location.hash.split('?')[1] ?? '',
    params = new URLSearchParams(raw);
  const initial = params.get('status') as Filter | null;
  const [filter, setFilter] = useState<Filter>(
      initial && filters.includes(initial) ? initial : 'all',
    ),
    [query, setQuery] = useState(params.get('q') ?? '');
  const [order, setOrder] = useState(preference('order', 'notebook')),
    [layout, setLayout] = useState(preference('layout', 'grid'));
  useEffect(() => {
    const u = new URLSearchParams();
    if (filter !== 'all') u.set('status', filter);
    if (query.trim()) u.set('q', query);
    const base = queue ? '/queue' : '/notebook';
    history.replaceState(
      null,
      '',
      location.pathname + location.search + '#' + base + (u.size ? '?' + u : ''),
    );
  }, [filter, query, queue]);
  const base = queue ? items.filter((i) => ['request', 'specialist'].includes(i.outcome)) : items;
  let visible = base.filter(
    (i) =>
      (filter === 'all' || i.outcome === filter) &&
      [i.name, i.id, i.details, i.category, kindName(i.category), outcomes[i.outcome].short]
        .join(' ')
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  if (order === 'name') visible = visible.sort((a, b) => a.name.localeCompare(b.name));
  if (order === 'photos')
    visible = visible.sort((a, b) => b.photos - a.photos || a.id.localeCompare(b.id));
  useEffect(() => {
    if (!loading && !error) restoreList(mode);
  }, [loading, error, mode]);
  useEffect(() => {
    const sync = () => {
      const [path, search] = window.location.hash.slice(1).split('?');
      if (path !== (queue ? '/queue' : '/notebook')) return;
      const p = new URLSearchParams(search);
      const k = p.get('status') as Filter | null;
      setFilter(k && filters.includes(k) ? k : 'all');
      setQuery(p.get('q') ?? '');
    };
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, [queue]);
  const options = queue
    ? filters.filter((f) => ['all', 'request', 'specialist'].includes(f))
    : filters.concat(items.some((i) => i.outcome === 'replace') ? ['replace'] : []);
  return (
    <>
      {queue ? (
        <header className="page-intro">
          <div className="kicker">
            <Icon name="queue" size={16} /> Workshop
          </div>
          <h1>
            Review queue<span>.</span>
          </h1>
          <p>Garments waiting for one more piece of evidence or a specialist’s decision.</p>
        </header>
      ) : (
        <header className="archive-banner">
          <div>
            <div className="section-overline">
              <Icon name="notebook" size={15} />
              Inspection records
            </div>
            <h1>{mode === 'rider' ? 'My inspections' : 'Gear notebook'}</h1>
            <p>
              {mode === 'rider'
                ? 'Reopen your result, check a photo or see your trade-in credit.'
                : 'Find a garment, review its photographs and follow the shop’s decision.'}
            </p>
          </div>
          <a className="button signal" href="#/intake">
            {hasDraft ? 'Continue your trade-in' : 'New inspection'}
            <Icon name="arrow" size={17} />
          </a>
        </header>
      )}
      <section
        className="collection"
        aria-label={queue ? 'Review queue records' : 'Garment records'}
      >
        <div className="collection-head">
          <div className="section-title">
            <h2>{queue ? 'Awaiting review' : 'Garment records'}</h2>
            {!loading && <span className="count">{base.length}</span>}
          </div>
          <div className="collection-tools">
            <label className="search">
              <Icon name="search" size={17} />
              <input
                type="search"
                aria-label="Search garments"
                placeholder="Search garments"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="layout-toggle" aria-label="Record layout">
              {['grid', 'list'].map((v) => (
                <button
                  key={v}
                  aria-label={v === 'grid' ? 'Grid view' : 'List view'}
                  aria-pressed={layout === v}
                  onClick={() => {
                    setLayout(v);
                    setPreference('layout', v);
                  }}
                >
                  <Icon name={v} size={16} />
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="filter-row">
          <label className="mobile-filter">
            <Icon name="sliders" size={15} />
            <span>{filter === 'all' ? 'All decisions' : filterText[filter]}</span>
            <Icon name="down" size={13} />
            <select
              aria-label="Filter garments by decision"
              value={filter}
              onChange={(e) => setFilter(e.target.value as Filter)}
            >
              {options.map((f) => (
                <option key={f} value={f}>
                  {f === 'all' ? 'All decisions' : filterText[f]} ·{' '}
                  {f === 'all' ? base.length : base.filter((c) => c.outcome === f).length}
                </option>
              ))}
            </select>
          </label>
          <div className="filter-scroll" aria-label="Filter by decision">
            {options.map((f) => (
              <button
                key={f}
                className={'filter ' + (filter === f ? 'selected' : '')}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {queue && f === 'all' ? 'All in queue' : filterText[f]}
              </button>
            ))}
          </div>
          <label className="sort-control">
            <Icon name="sort" size={16} />
            <span>
              {order === 'name'
                ? 'Name A–Z'
                : order === 'photos'
                  ? 'Most photos'
                  : 'Notebook order'}
            </span>
            <Icon name="down" size={13} />
            <select
              aria-label="Sort records"
              value={order}
              onChange={(e) => {
                setOrder(e.target.value);
                setPreference('order', e.target.value);
              }}
            >
              <option value="notebook">Notebook order</option>
              <option value="name">Name A–Z</option>
              <option value="photos">Most photos</option>
            </select>
          </label>
        </div>
        {warning && (
          <Alert>
            {warning}{' '}
            <button className="text-button" onClick={retry}>
              Try again
            </button>
          </Alert>
        )}
        {error ? (
          <Alert>
            {error}{' '}
            <button className="text-button" onClick={retry}>
              Try again
            </button>
          </Alert>
        ) : loading ? (
          <Loading />
        ) : visible.length ? (
          <div className={'records records-' + (layout === 'list' ? 'list' : 'grid')}>
            {visible.map((i, index) => (
              <a
                key={i.id}
                id={'item-' + i.id}
                className="garment-card"
                onClick={() => rememberList(mode, i.id)}
                href={recordHref(i.id)}
                title={'Open ' + i.name}
              >
                <div className={'card-art ' + (!i.thumbnail ? 'no-art' : '')}>
                  {i.thumbnail ? (
                    <img
                      src={i.cardThumbnail ?? i.thumbnail}
                      alt=""
                      loading={index < 3 ? 'eager' : 'lazy'}
                    />
                  ) : (
                    <Icon name="image" size={35} />
                  )}
                  <span className="card-id">{recordCode(i.id)}</span>
                </div>
                <div className="card-body">
                  <div className="card-type">
                    {kindName(i.category)}
                    {i.rehearsal && <span> · Rehearsal</span>}
                  </div>
                  <h3>{i.name}</h3>
                  <div className="card-foot">
                    <Status outcome={i.outcome} />
                    <span className="photo-count">
                      <Icon name="image" size={15} />
                      {i.photos} <span>photo{i.photos === 1 ? '' : 's'}</span>
                    </span>
                    <Icon name="upRight" size={17} />
                  </div>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <Empty
            title={
              base.length
                ? 'No matching garments'
                : queue
                  ? 'The queue is clear'
                  : 'Start your notebook'
            }
            action={
              base.length ? (
                <button
                  className="button soft"
                  onClick={() => {
                    setFilter('all');
                    setQuery('');
                  }}
                >
                  Clear filters
                </button>
              ) : (
                <a className="button primary" href="#/intake">
                  Inspect a garment
                </a>
              )
            }
          >
            {base.length
              ? 'Try another name, item code, or decision.'
              : queue
                ? 'Items appear here when another photo or a specialist is needed.'
                : 'Create an inspection to add the first garment.'}
          </Empty>
        )}
        {!loading && !error && (
          <p className="result-count" aria-live="polite">
            {visible.length} of {base.length} garment{base.length === 1 ? '' : 's'}
            {query ? ' matching “' + query + '”' : ''}
          </p>
        )}
      </section>
    </>
  );
}
