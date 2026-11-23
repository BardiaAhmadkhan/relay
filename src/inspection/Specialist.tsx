import { explainDecision } from './decision';
import { useEffect, useState } from 'react';
import { type Frame, type Mode, type RecordData } from '../shared/domain';
import { api, itemPath, staffSession } from '../shared/workshop';
import { amendSample } from '../examples/records';
import { Alert, Icon } from '../components/ui';

export function StaffAccess({
  demo,
  name,
  token,
  onToken,
}: {
  demo: boolean;
  name: string;
  token: string;
  onToken: (token: string, name: string) => void;
}) {
  const [who, setWho] = useState(''),
    [secret, setSecret] = useState(''),
    [issue, setIssue] = useState(''),
    [busy, setBusy] = useState(false);
  if (token)
    return (
      <div className="staff-line">
        <span>
          <Icon name="check" size={15} />
          {demo ? 'Rehearsal session' : 'Staff session'} · {name}
        </span>
        <button className="text-button" onClick={() => onToken('', '')}>
          Close session
        </button>
      </div>
    );
  return (
    <details className="staff-gate">
      <summary>
        <span>
          <Icon name="lock" size={16} />
          {demo ? 'Open a rehearsal staff session' : 'Open a staff session'}
        </span>
        <Icon name="down" size={16} />
      </summary>
      <form
        className="staff-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setIssue('');
          try {
            const key = await staffSession(who.trim(), secret, demo);
            setSecret('');
            onToken(key, who.trim());
          } catch (e) {
            setIssue((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          Your name
          <input
            required
            minLength={2}
            maxLength={60}
            value={who}
            onChange={(e) => setWho(e.target.value)}
            autoComplete="name"
          />
        </label>
        {!demo && (
          <label className="field">
            Staff credential
            <input
              type="password"
              required
              autoComplete="current-password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </label>
        )}
        <button className="button primary" disabled={busy}>
          Open session
        </button>
        {issue && <Alert>{issue}</Alert>}
      </form>
    </details>
  );
}
type Extra = { photo: string; request: string; width: number; height: number };
export function Specialist({
  mode,
  r,
  scenario,
  demo,
  token,
  open,
  changed,
  setNotice,
  addPhoto,
  onSigned,
}: {
  mode: Mode;
  r: RecordData;
  scenario: string;
  demo: boolean;
  token: string;
  open: (id: string) => void;
  changed: () => void;
  setNotice: (v: string) => void;
  addPhoto?: () => void;
  onSigned: () => void;
}) {
  const sources = r.frames.filter((f) => !f.id.startsWith('zone:') && !f.id.startsWith('finding:')),
    findings = r.frames.filter((f) => f.id.startsWith('finding:'));
  const [source, setSource] = useState(sources[0]?.id ?? ''),
    [kind, setKind] = useState('observation'),
    [note, setNote] = useState(''),
    [issue, setIssue] = useState(''),
    [busy, setBusy] = useState(false),
    [card, setCard] = useState(''),
    [front, setFront] = useState(''),
    [code, setCode] = useState(''),
    [attest, setAttest] = useState(false),
    [extra, setExtra] = useState<Extra[]>([]),
    [extraSelected, setExtraSelected] = useState(''),
    [extraError, setExtraError] = useState('');
  const [maker, setMaker] = useState(''),
    [tag, setTag] = useState(''),
    [overview, setOverview] = useState(''),
    [landmarks, setLandmarks] = useState('');
  const wearSources = r.frames.filter((f) => f.zone && f.hash),
    choices = kind === 'wear' ? wearSources : sources;
  const available = mode === 'examples' || !!token,
    ref = choices.find((f) => f.id === source);
  useEffect(() => {
    if (mode !== 'workshop') return;
    const ac = new AbortController();
    setExtraError('');
    api<{ items: Extra[] }>(
      itemPath(r.card.id) + '/requested-photos?scenario=' + scenario,
      undefined,
      undefined,
      ac.signal,
    )
      .then((v) => setExtra(v.items))
      .catch(() => {
        if (!ac.signal.aborted) setExtraError('Follow-up photos could not be loaded.');
      });
    return () => ac.abort();
  }, [mode, r, scenario]);
  async function perform(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setIssue('');
    try {
      await fn();
    } catch (e) {
      setIssue((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const extraFrames: Frame[] = extra.map((x) => ({
    id: x.photo,
    photo: x.photo,
    name: 'Rider follow-up',
    caption: x.request,
    src:
      '/relay-api/v4' +
      itemPath(r.card.id) +
      '/requested-photos/' +
      x.photo +
      '?scenario=' +
      scenario,
    width: x.width,
    height: x.height,
  }));
  return (
    <div className="role-layout">
      <section className="role-main">
        <div className="paper-panel">
          <div className="panel-heading">
            <Icon name="eye" />
            <h2>
              {r.card.outcome === 'specialist' || r.card.outcome === 'request'
                ? 'Why this needs review'
                : 'Inspection outcome'}
            </h2>
          </div>
          <p>{explainDecision(r).lead}</p>
          {r.reasons.length > 1 && (
            <details className="quiet-fold">
              <summary>More about this decision</summary>
              {r.reasons.slice(1).map((x, i) => (
                <p key={i}>{x}</p>
              ))}
            </details>
          )}
        </div>
        {r.explanations.length > 0 && (
          <section className="paper-panel">
            <div className="panel-heading">
              <Icon name="layers" />
              <h2>Possible explanations</h2>
            </div>
            <div className="explanations">
              {r.explanations.map((x, i) => (
                <div key={i}>
                  <h3>{x.name}</h3>
                  <p>{x.consequence}</p>
                </div>
              ))}
            </div>
          </section>
        )}
        {(r.observation || (addPhoto && r.next)) && (
          <div className="next-photo">
            <div className="kicker">
              <Icon name="camera" size={16} />
              Next useful photograph
            </div>
            <h3>{r.observation ?? r.next}</h3>
            {addPhoto && (
              <button className="button soft" onClick={addPhoto}>
                <Icon name="upload" size={16} />
                Add requested photo
              </button>
            )}
          </div>
        )}
        {findings.length > 0 && (
          <section className="paper-panel">
            <h2>Condition sources</h2>
            <div className="source-tiles">
              {findings.map((f) => (
                <button key={f.id} onClick={() => open(f.id)}>
                  <img src={f.crop ?? f.src} alt={f.name} loading="lazy" />
                  <span>
                    {f.name}
                    <Icon name="upRight" size={14} />
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
        {(extra.length > 0 || extraError) && (
          <section className="paper-panel">
            <h2>Photos from the rider</h2>
            {extraError && <p className="fine">{extraError}</p>}
            <div className="source-tiles">
              {extraFrames.map((f, i) => (
                <button key={f.id} onClick={() => setExtraSelected(f.id)}>
                  <img src={f.src} alt={f.name} />
                  <span>
                    Follow-up {i + 1}
                    <Icon name="expand" size={14} />
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </section>
      <aside className="role-aside">
        <section className="paper-panel">
          <div className="panel-heading">
            <Icon name="file" />
            <h2>Review notes</h2>
          </div>
          {r.notes.length ? (
            r.notes.map((n, i) => (
              <div className="saved-note" key={i}>
                <p>{n.text}</p>
                <button className="text-button" onClick={() => open(n.source)}>
                  View source
                </button>
              </div>
            ))
          ) : r.note ? (
            <p className="saved-note">{r.note}</p>
          ) : (
            <p className="muted">No specialist observation has been recorded.</p>
          )}
          {sources.length > 0 && (
            <form
              className="stack review-fields"
              onSubmit={(e) => {
                e.preventDefault();
                if (!available || !ref || note.trim().length < 5) return;
                void perform(async () => {
                  if (mode === 'workshop') {
                    const base = '/staff/' + encodeURIComponent(r.card.id);
                    if (kind === 'wear')
                      await api(
                        base + '/wear',
                        { scenario, source: ref.hash, zone: ref.zone, note: note.trim() },
                        token,
                      );
                    else
                      await api(
                        base + '/review',
                        { scenario, source: ref.hash, kind, note: note.trim() },
                        token,
                      );
                  } else {
                    await amendSample(r, (latest) => {
                      latest.notes.push({ text: note.trim(), source: ref.id });
                      latest.note = note.trim();
                      if (kind !== 'observation') {
                        latest.card.outcome = 'retire';
                        latest.eligible = false;
                        latest.reason =
                          'A specialist recorded ' +
                          (kind === 'protective_failure' ? 'damage' : 'a repair') +
                          ' in a protective area.';
                        latest.reasons = [latest.reason];
                        latest.next = null;
                      }
                      return latest;
                    });
                  }
                  setNote('');
                  setNotice(
                    mode === 'workshop'
                      ? 'Sourced review saved to the record.'
                      : 'Review saved on this device.',
                  );
                  changed();
                });
              }}
            >
              <label className="field">
                Source photograph
                <select value={source} onChange={(e) => setSource(e.target.value)}>
                  {choices.map((f, i) => (
                    <option key={f.id} value={f.id}>
                      {i + 1}. {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Observation type
                <select
                  value={kind}
                  onChange={(e) => {
                    const k = e.target.value;
                    setKind(k);
                    setSource((k === 'wear' ? wearSources : sources)[0]?.id ?? '');
                  }}
                >
                  <option value="observation">Observation</option>
                  {mode === 'workshop' && wearSources.length > 0 && (
                    <option value="wear">Verified visible wear</option>
                  )}
                  <option value="protective_failure">Confirmed protective-area damage</option>
                  <option value="protective_repair">Confirmed protective-area repair</option>
                </select>
              </label>
              <label className="field">
                What did you verify?
                <textarea
                  minLength={kind === 'wear' ? 8 : 5}
                  required
                  maxLength={450}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Describe what is visible in the selected photo."
                />
              </label>
              {kind.startsWith('protective_') && (
                <p className="fine">
                  Saving a confirmed exclusion will close the offer for this record.
                </p>
              )}
              {!available && (
                <p className="fine">Open a staff session above to save an observation.</p>
              )}
              <button
                className="button primary"
                disabled={
                  !available || busy || note.trim().length < (kind === 'wear' ? 8 : 5) || !ref
                }
              >
                Save sourced observation
              </button>
            </form>
          )}
        </section>
        {mode === 'workshop' && sources.some((f) => f.card || f.role === 'id_card') && (
          <details className="paper-panel fold">
            <summary>
              Verify item session <Icon name="down" size={16} />
            </summary>
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void perform(async () => {
                  await api(
                    '/staff/' + encodeURIComponent(r.card.id) + '/custody',
                    {
                      card,
                      cardText: code.trim(),
                      acknowledge: true,
                      ...(front ? { insideFront: front, frontAttested: true } : {}),
                    },
                    token,
                  );
                  setNotice('Item session verified and signed.');
                  onSigned();
                });
              }}
            >
              <label className="field">
                Photographed item card
                <select required value={card} onChange={(e) => setCard(e.target.value)}>
                  <option value="">Choose the card</option>
                  {sources
                    .filter((f) => f.card || f.role === 'id_card')
                    .map((f) => (
                      <option value={f.hash} key={f.id}>
                        {f.name} · {sources.indexOf(f) + 1}
                      </option>
                    ))}
                </select>
              </label>
              {card && (
                <button
                  type="button"
                  className="inline-link"
                  onClick={() => open(sources.find((f) => f.hash === card)!.id)}
                >
                  Enlarge item card <Icon name="expand" size={14} />
                </button>
              )}
              <label className="field">
                Printed item ID
                <input
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  maxLength={80}
                />
              </label>
              {r.card.category === 'pants' && (
                <label className="field">
                  Verified full inside-front photo
                  <select value={front} onChange={(e) => setFront(e.target.value)}>
                    <option value="">Card only</option>
                    {sources
                      .filter((f) =>
                        ['inner_overview', 'inner_zone', 'pocket'].includes(f.role ?? ''),
                      )
                      .map((f) => (
                        <option key={f.id} value={f.hash}>
                          Photo {sources.indexOf(f) + 1} · {f.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label className="check">
                <input
                  type="checkbox"
                  checked={attest}
                  onChange={(e) => setAttest(e.target.checked)}
                />
                I verified the printed card and the selected source views.
              </label>
              <button
                className="button primary"
                disabled={!token || !card || !attest || !code.trim() || busy}
              >
                {demo ? 'Sign rehearsal record' : 'Sign item session'}
              </button>
            </form>
          </details>
        )}
        {mode === 'workshop' && r.identityConflict && (
          <details className="paper-panel fold">
            <summary>
              Reconcile garment identity <Icon name="down" size={16} />
            </summary>
            <p>Match the attached maker label with a distinct view of the same garment.</p>
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void perform(async () => {
                  await api(
                    '/staff/' + encodeURIComponent(r.card.id) + '/identity',
                    { maker, tag, overview, matchingLandmarks: landmarks.trim() },
                    token,
                  );
                  setNotice('Identity reconciliation recorded with both source photographs.');
                  onSigned();
                });
              }}
            >
              <label className="field">
                Maker on the attached tag
                <select required value={maker} onChange={(e) => setMaker(e.target.value)}>
                  <option value="">Choose a maker</option>
                  {r.conflictingMakers?.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                Label source
                <select required value={tag} onChange={(e) => setTag(e.target.value)}>
                  <option value="">Choose a tag photo</option>
                  {sources
                    .filter((f) => f.role === 'tag')
                    .map((f) => (
                      <option key={f.id} value={f.hash}>
                        Photo {sources.indexOf(f) + 1} · {f.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                Connected garment view
                <select required value={overview} onChange={(e) => setOverview(e.target.value)}>
                  <option value="">Choose a different view</option>
                  {sources
                    .filter((f) =>
                      [
                        'outer_front',
                        'outer_back',
                        'outer_side',
                        'inner_overview',
                        'inner_zone',
                      ].includes(f.role ?? ''),
                    )
                    .map((f) => (
                      <option key={f.id} value={f.hash}>
                        Photo {sources.indexOf(f) + 1} · {f.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                Matching landmarks
                <textarea
                  minLength={8}
                  maxLength={400}
                  value={landmarks}
                  onChange={(e) => setLandmarks(e.target.value)}
                  required
                />
              </label>
              <button
                className="button primary"
                disabled={
                  !available || busy || !maker || !tag || !overview || landmarks.trim().length < 8
                }
              >
                Record source match
              </button>
            </form>
          </details>
        )}
        {r.labelReadings?.length ? (
          <details className="paper-panel fold">
            <summary>
              Label transcriptions <Icon name="down" size={16} />
            </summary>
            <div className="readings">
              {r.labelReadings.map((f, i) => (
                <button key={i} onClick={() => open(f.source)}>
                  <span>
                    <small>
                      {f.name} · {f.attachment.replace(/_/g, ' ')}
                    </small>
                    {f.value}
                  </span>
                  <Icon name="upRight" size={14} />
                </button>
              ))}
            </div>
          </details>
        ) : null}
        {issue && <Alert>{issue}</Alert>}
      </aside>
      {extraSelected && (
        <Viewer frames={extraFrames} start={extraSelected} close={() => setExtraSelected('')} />
      )}
    </div>
  );
}
import { Viewer } from './Viewer';
