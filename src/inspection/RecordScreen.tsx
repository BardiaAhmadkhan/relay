import { useCallback, useEffect, useState } from 'react';
import {
  disclosure,
  kindName,
  recordCode,
  recordHref,
  type Card,
  type Mode,
  type RecordData,
  type Tab,
} from '../shared/domain';
import { sampleRecord, amendSample } from '../examples/records';
import { api, itemPath, liveRecord } from '../shared/workshop';
import { Alert, Empty, Icon, Loading, Modal, Status, safeLink } from '../components/ui';
import { Viewer } from './Viewer';
import { removePersonalRecord } from '../shared/storage';
import { listOrigin } from '../shared/navigation';
import { Specialist, StaffAccess } from './Specialist';
import { ShopPanel } from '../trade/ShopPanel';
import { readImage, b64 } from '../intake/images';
import { TradePanel } from '../trade/TradePanel';
import { explainDecision, riderFinding } from './decision';
import { DecisionStory } from './DecisionStory';
const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: 'notebook' },
  { id: 'trade', label: 'Trade-in', icon: 'tag' },
  { id: 'evidence', label: 'Evidence', icon: 'image' },
  { id: 'specialist', label: 'Specialist', icon: 'eye' },
  { id: 'shop', label: 'Shop', icon: 'shop' },
];
export function RecordScreen({
  mode,
  id,
  tab: requestedTab,
  card,
  listLoading,
  listError,
  staff,
  setStaff,
  onChange,
}: {
  mode: Mode;
  id: string;
  tab: Tab;
  card?: Card;
  listLoading: boolean;
  listError: string;
  staff: { token: string; name: string };
  setStaff: (s: { token: string; name: string }) => void;
  onChange: () => void;
}) {
  const [data, setData] = useState<RecordData | null>(null),
    [err, setErr] = useState(''),
    [epoch, setEpoch] = useState(0),
    [manual, setManual] = useState<string | null>(null),
    [select, setSelect] = useState(''),
    [viewer, setViewer] = useState(''),
    [follow, setFollow] = useState(false),
    [notice, setNotice] = useState(''),
    [demo, setDemo] = useState(false);
  const [remove, setRemove] = useState(false),
    [removing, setRemoving] = useState(false);
  const { token, name: staffName } = staff;
  const pick = manual ?? (card?.rehearsal ? 'custody_clear' : 'actual'),
    waitingForCard = mode === 'workshop' && listLoading && !card,
    stableId = card?.id,
    changed = useCallback(() => {
      setEpoch((n) => n + 1);
      onChange();
    }, [onChange]);
  useEffect(() => setNotice(''), [requestedTab]);
  useEffect(() => {
    if (mode !== 'workshop') return;
    let live = true;
    api<{ demo: boolean }>('/health')
      .then((v) => {
        if (live) setDemo(v.demo);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [mode]);
  useEffect(() => {
    if (waitingForCard) return;
    const ac = new AbortController();
    setErr('');
    const placeholder: Card = card ?? {
      id,
      name: 'Garment inspection',
      category: 'unknown',
      outcome: 'specialist',
      details: '',
      photos: 0,
      thumbnail: null,
      rehearsal: false,
    };
    (mode === 'examples' ? sampleRecord(id) : liveRecord(placeholder, pick, ac.signal))
      .then((x) => {
        if (ac.signal.aborted) return;
        setData(x);
        setSelect((old) => (x.frames.some((f) => f.id === old) ? old : (x.frames[0]?.id ?? '')));
        document.title = x.card.name + ' · Relay';
      })
      .catch((e) => {
        if (!ac.signal.aborted) setErr(e.message);
      });
    return () => ac.abort();
  }, [mode, id, pick, epoch, stableId, waitingForCard, card?.name, card?.outcome]);
  const frame = data?.frames.find((f) => f.id === select) ?? data?.frames[0];
  function open(f: string) {
    setSelect(f);
    setViewer(f);
  }
  if (!data && err)
    return (
      <div className="utility-page">
        <Empty
          title="Record unavailable"
          action={
            <a className="button primary" href="#/notebook">
              Back to notebook
            </a>
          }
        >
          {err}
        </Empty>
      </div>
    );
  if (!data && mode === 'workshop' && listError)
    return (
      <div className="utility-page">
        <Alert>{listError}</Alert>
      </div>
    );
  if (!data)
    return (
      <div className="utility-page">
        <Loading label="Opening the garment record" />
      </div>
    );
  const r = data,
    whole = r.frames.filter((f) => !f.id.startsWith('zone:') && !f.id.startsWith('finding:')),
    story = explainDecision(r),
    tradeEligible = r.eligible && r.card.outcome === 'keep';
  const tab =
    mode === 'rider' && ['shop', 'specialist'].includes(requestedTab)
      ? 'overview'
      : requestedTab === 'result' || (requestedTab === 'trade' && !tradeEligible)
        ? tradeEligible
          ? 'trade'
          : 'overview'
        : requestedTab;
  const firstSource = story.lines.find((l) => l.sources.length)?.sources[0];
  const decisionFrame = r.frames.find((f) => f.id === firstSource);
  const historyNext = /has it been in a crash|choose yes, no|history question/i.test(r.next ?? ''),
    canUpload = !!r.next && !historyNext && ['specialist', 'request'].includes(r.card.outcome);
  const viewGroup = viewer.startsWith('zone:')
    ? r.frames.filter((f) => f.id.startsWith('zone:'))
    : viewer.startsWith('finding:')
      ? r.frames.filter((f) => f.id.startsWith('finding:'))
      : whole;
  const origin = listOrigin(mode),
    backHref = origin?.hash ?? '#/notebook';
  const goPrimary = () => {
    if (tradeEligible) location.hash = recordHref(id, 'trade');
    else if (r.card.outcome === 'replace')
      location.hash = recordHref(id, mode === 'rider' ? 'evidence' : 'shop');
    else if (r.card.outcome === 'retire') location.hash = backHref;
    else if (mode === 'rider' && r.card.outcome === 'specialist') {
      if (canUpload) setFollow(true);
      else document.querySelector('.reason-sheet')?.scrollIntoView({ block: 'center' });
    } else if (r.card.outcome === 'specialist') location.hash = recordHref(id, 'specialist');
    else if (canUpload) setFollow(true);
    else
      document
        .getElementById('record-history')
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  return (
    <article className="record-page">
      <header className="record-head">
        <div className="crumb">
          <a href={backHref}>{backHref.startsWith('#/queue') ? 'Review queue' : 'Notebook'}</a>
          <Icon name="right" size={13} />
          <span>{recordCode(id)}</span>
        </div>
        <div className="record-title-row">
          <div>
            <div className="kicker">
              {kindName(r.card.category)}
              {r.demonstration && mode === 'workshop' ? ' · Rehearsal' : ''}
            </div>
            <h1>{r.card.name}</h1>
          </div>
          <Status outcome={r.card.outcome} />
        </div>
        <div className="record-meta">
          <span>
            <Icon name="image" size={15} />
            {r.card.photos} source photo{r.card.photos === 1 ? '' : 's'}
          </span>
          <i />{' '}
          <span>
            {mode === 'examples'
              ? r.card.example
                ? 'Illustrated example'
                : 'Personal intake'
              : mode === 'rider'
                ? 'Your inspection'
                : 'Workshop record'}
          </span>
        </div>
      </header>
      <nav className="record-tabs" aria-label="Record sections">
        {tabs
          .filter(
            (t) =>
              (t.id !== 'trade' || tradeEligible) &&
              (mode !== 'rider' || !['shop', 'specialist'].includes(t.id)),
          )
          .map((t) => (
            <a
              key={t.id}
              href={recordHref(id, t.id)}
              aria-current={t.id === tab ? 'page' : undefined}
              className={t.id === tab ? 'on' : ''}
            >
              <Icon name={t.icon} size={16} />
              {t.label}
            </a>
          ))}
      </nav>
      {err && (
        <Alert>
          {err} <button onClick={() => setEpoch((n) => n + 1)}>Try again</button>
        </Alert>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {(tab === 'overview' || (tab === 'trade' && !tradeEligible)) && (
        <>
          <div className="overview-layout">
            <section className="photo-sheet">
              {frame ? (
                <>
                  <button
                    className="source-stage"
                    onClick={() => open(frame.id)}
                    aria-label={'Enlarge ' + frame.name}
                  >
                    <img
                      src={frame.startFull || !frame.crop ? frame.src : frame.crop}
                      alt={frame.name}
                    />
                    <span className="stage-expand">
                      <Icon name="expand" size={17} />
                    </span>
                  </button>
                  <div className="source-caption">
                    <div>
                      <span className="micro">Source photograph</span>
                      <h2>{frame.name}</h2>
                    </div>
                    <button className="text-button" onClick={() => open(frame.id)}>
                      Inspect photo <Icon name="upRight" size={14} />
                    </button>
                  </div>
                  {whole.length > 1 && (
                    <div className="thumb-strip" aria-label="Source photographs">
                      {whole.map((f) => (
                        <button
                          key={f.id}
                          onClick={() => setSelect(f.id)}
                          aria-pressed={select === f.id}
                          aria-label={'Select ' + f.name + ' ' + (whole.indexOf(f) + 1)}
                        >
                          <img src={f.src} alt="" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <Empty title="History-only record">
                  This decision did not require a photograph.
                </Empty>
              )}
            </section>
            <aside className="decision-stack">
              <section className={'decision-card decision-' + r.card.outcome}>
                <div className="kicker">
                  <Icon name="compass" size={16} />
                  Inspection decision
                </div>
                <h2>{story.heading}</h2>
                <p>{story.lead}</p>
                {decisionFrame && (
                  <button className="decision-source" onClick={() => open(decisionFrame.id)}>
                    <img src={decisionFrame.crop || decisionFrame.src} alt="" />
                    <span>
                      <small>See the photo behind this decision</small>
                      <strong>{decisionFrame.name}</strong>
                    </span>
                    <Icon name="expand" size={17} />
                  </button>
                )}
                {story.next && (
                  <div className="next-line">
                    <strong>Next step</strong>
                    <span>{story.next}</span>
                  </div>
                )}
                <button className="button primary" onClick={goPrimary}>
                  {tradeEligible
                    ? 'See my trade-in value'
                    : r.card.outcome === 'replace'
                      ? mode === 'rider'
                        ? 'Review the evidence'
                        : 'See shop details'
                      : r.card.outcome === 'retire'
                        ? 'Back to notebook'
                        : r.card.outcome === 'specialist'
                          ? mode === 'rider' && canUpload
                            ? 'Add requested photo'
                            : 'See what needs review'
                          : canUpload
                            ? 'Add requested photo'
                            : 'Review history'}
                  <Icon name="arrow" />
                </button>
              </section>
              <DecisionStory record={r} open={open} />
              <section className="history-fact" id="record-history">
                <Icon name="file" />
                <div>
                  <span className="micro">Garment history</span>
                  <h3>{r.history}</h3>
                  {mode === 'workshop' && demo && (
                    <label className="scenario-label">
                      View history scenario
                      <select
                        value={pick}
                        onChange={(e) => {
                          setManual(e.target.value);
                          setData(null);
                          setNotice('');
                        }}
                      >
                        <option value="actual">As submitted</option>
                        <option value="clear">Clear history · rehearsal</option>
                        <option value="custody_clear">Staff intake + clear · rehearsal</option>
                        <option value="crash">Declared crash · rehearsal</option>
                      </select>
                    </label>
                  )}
                  {historyNext && mode !== 'examples' && !demo && (
                    <p>
                      Give the shop this inspection number if you can now confirm the garment’s
                      history.
                    </p>
                  )}
                </div>
              </section>
            </aside>
          </div>
          <div className="overview-lower">
            <section className="paper-panel">
              <div className="panel-heading">
                <Icon name="tag" />
                <h2>What the label says</h2>
              </div>
              {r.identityConflict && (
                <p className="alert">
                  The submitted labels conflict. Their protective markings are withheld.
                </p>
              )}
              {r.facts.length ? (
                <ul className="fact-list">
                  {r.facts.slice(0, 3).map((f, i) => (
                    <li key={i}>
                      <div>
                        <small>{f.name}</small>
                        <span>{f.value}</span>
                      </div>
                      {f.source && (
                        <button
                          className="mini-link"
                          aria-label={'Open source for ' + f.name + ' ' + (i + 1)}
                          onClick={() => open(f.source!)}
                        >
                          <Icon name="upRight" size={16} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  There isn’t a readable label that the shop can link to this garment yet.
                </p>
              )}
              {r.facts.length > 3 && (
                <a className="inline-link" href={recordHref(id, 'evidence')}>
                  All label evidence <Icon name="arrow" size={15} />
                </a>
              )}
              <p className="fine">{disclosure}</p>
            </section>
            <section className="paper-panel">
              <div className="panel-heading">
                <Icon name="layers" />
                <h2>What we could see</h2>
              </div>
              <h3 className="feature-stat">{r.coverage}</h3>
              <p className="muted">{r.zoneSummary}</p>
              <a className="inline-link" href={recordHref(id, 'evidence')}>
                Explore the evidence <Icon name="arrow" size={16} />
              </a>
            </section>
          </div>
        </>
      )}
      {tab === 'evidence' && (
        <div className="evidence-layout">
          <section>
            <div className="block-title">
              <div className="kicker">Condition evidence</div>
              <h2>Outside and inside</h2>
              <p>
                {r.coverage}. {r.zoneSummary}
              </p>
            </div>
            {r.zones.length > 0 ? (
              <div className="zone-grid">
                {r.zones.map((z) => (
                  <article className="zone" key={z.name}>
                    <h3>{z.name}</h3>
                    <div>
                      {z.cells.map((c) => {
                        const f = r.frames.find((x) => x.id === c.source),
                          useWhole = f?.startFull || !f?.crop;
                        return (
                          <div className="zone-cell" key={c.layer}>
                            <strong>{c.layer}</strong>
                            {f ? (
                              <button
                                aria-label={'Open ' + z.name + ' ' + c.layer}
                                className="zone-photo"
                                onClick={() => open(f.id)}
                              >
                                <img src={useWhole ? f.src : f.crop} loading="lazy" alt={f.name} />
                                <Icon name="expand" size={15} />
                              </button>
                            ) : (
                              <div className="zone-missing">
                                <Icon name="image" />
                                <span>No source photo</span>
                              </div>
                            )}
                            <span className={'zone-finding ' + (c.adverse ? 'adverse' : '')}>
                              <Icon
                                name={c.adverse ? 'flag' : c.quality === 'full' ? 'check' : 'info'}
                                size={14}
                              />
                              {riderFinding(c.finding)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="paper-panel">
                <h3>Source photographs</h3>
                <p className="muted">
                  {mode === 'examples'
                    ? 'Open a photograph to inspect the garment at full size.'
                    : 'No zone locations were returned for this item.'}
                </p>
                <div className="source-tiles">
                  {whole.map((f) => (
                    <button key={f.id} onClick={() => open(f.id)}>
                      <img src={f.src} loading="lazy" alt={f.name} />
                      <span>
                        {f.name} <Icon name="upRight" size={13} />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p className="fine">{r.limitation}</p>
          </section>
          <aside>
            <section className="paper-panel">
              <div className="panel-heading">
                <Icon name="tag" />
                <h2>Source details</h2>
              </div>
              {r.facts.length ? (
                <ul className="fact-list">
                  {r.facts.map((f, i) => (
                    <li key={i}>
                      <div>
                        <small>{f.name}</small>
                        <span>{f.value}</span>
                      </div>
                      {f.source && (
                        <button
                          className="mini-link"
                          aria-label={'Inspect label source ' + (i + 1)}
                          onClick={() => open(f.source!)}
                        >
                          <Icon name="upRight" size={15} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  The shop has not confirmed a readable label on this garment yet.
                </p>
              )}
              {r.guidance.map((g, i) => (
                <div className="guidance" key={i}>
                  <h3>{g.title}</h3>
                  <p>{g.text}</p>
                  {safeLink(g.url) && (
                    <a className="inline-link" href={g.url} target="_blank" rel="noreferrer">
                      Read the source <Icon name="upRight" size={14} />
                    </a>
                  )}
                </div>
              ))}
            </section>
          </aside>
        </div>
      )}
      {tab === 'trade' && tradeEligible && (
        <TradePanel
          key={mode + id + pick}
          record={r}
          mode={mode}
          scenario={pick}
          staff={staff}
          setStaff={setStaff}
          demo={demo}
          open={open}
        />
      )}
      {(tab === 'specialist' || tab === 'shop') && (
        <>
          {mode === 'workshop' && (
            <StaffAccess
              demo={demo}
              name={staffName}
              token={token}
              onToken={(v, n) => setStaff({ token: v, name: n })}
            />
          )}
          {tab === 'specialist' ? (
            <Specialist
              mode={mode}
              r={r}
              scenario={pick}
              demo={demo}
              token={token}
              open={open}
              changed={changed}
              setNotice={setNotice}
              addPhoto={canUpload ? () => setFollow(true) : undefined}
              onSigned={() => {
                if (demo) setManual('custody_clear');
                changed();
              }}
            />
          ) : (
            <ShopPanel
              key={r.card.id + ':' + pick}
              r={r}
              mode={mode}
              scenario={pick}
              token={token}
            />
          )}
        </>
      )}
      {(tab === 'overview' || (tab === 'trade' && !tradeEligible)) &&
        mode === 'examples' &&
        !r.card.example &&
        id.startsWith('LOCAL-') && (
          <div className="draft-bottom">
            <span>
              <Icon name="lock" size={14} />
              Personal intake on this device
            </span>
            <button className="text-button" onClick={() => setRemove(true)}>
              Remove intake
            </button>
          </div>
        )}
      {remove && (
        <Modal
          title="Remove this personal intake?"
          onClose={() => {
            if (!removing) setRemove(false);
          }}
        >
          <p>Its photographs and review notes will be removed from this browser.</p>
          <div className="dialog-actions">
            <button className="button soft" disabled={removing} onClick={() => setRemove(false)}>
              Keep intake
            </button>
            <button
              className="button primary"
              disabled={removing}
              onClick={async () => {
                setRemoving(true);
                try {
                  await removePersonalRecord(id);
                  onChange();
                  location.hash = '/notebook';
                } catch (e) {
                  setErr((e as Error).message);
                  setRemove(false);
                  setRemoving(false);
                }
              }}
            >
              Remove from this device
            </button>
          </div>
        </Modal>
      )}
      {r.receipt && (
        <details className="receipt">
          <summary>
            <Icon name="file" size={15} />
            Inspection receipt
          </summary>
          <code>{r.receipt}</code>
        </details>
      )}
      {viewer && viewGroup.length > 0 && (
        <Viewer frames={viewGroup} start={viewer} close={() => setViewer('')} />
      )}
      {follow && (
        <FollowUp
          r={r}
          mode={mode}
          scenario={pick}
          close={() => setFollow(false)}
          done={() => {
            setFollow(false);
            setNotice('Photo attached for specialist review.');
            changed();
          }}
        />
      )}
    </article>
  );
}
function FollowUp({
  r,
  mode,
  scenario,
  close,
  done,
}: {
  r: RecordData;
  mode: Mode;
  scenario: string;
  close: () => void;
  done: () => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Add requested photo"
      onClose={() => {
        if (!busy) close();
      }}
    >
      <p>{r.observation ?? r.next}</p>
      <form
        className="stack follow-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!file || busy) return;
          setBusy(true);
          try {
            const p = await readImage(file);
            if (mode !== 'examples')
              await api(itemPath(r.card.id) + '/requested-photo', {
                scenario,
                inspection: r.receipt,
                base64: b64(p.uri),
              });
            else {
              const id = 'follow-' + p.hash;
              await amendSample(r, (latest) => {
                if (!latest.frames.some((f) => f.id === id)) {
                  latest.frames.push({
                    id,
                    photo: id,
                    name: 'Requested photograph',
                    caption: r.next ?? 'Rider follow-up.',
                    src: p.uri,
                    width: p.width,
                    height: p.height,
                    hash: p.hash,
                  });
                  latest.card.photos++;
                }
                return latest;
              });
            }
            done();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          Photograph
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {error && <Alert>{error}</Alert>}
        <button className="button primary" disabled={!file || busy}>
          {busy ? 'Attaching…' : 'Attach photo'}
        </button>
      </form>
    </Modal>
  );
}
