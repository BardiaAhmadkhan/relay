import { useEffect, useRef, useState } from 'react';
import {
  framingPhoto,
  blankDraft,
  labels,
  recordHref,
  type Draft,
  type Frame,
  type History,
  type Mode,
  type Slot,
} from '../shared/domain';
import { intakeViews, requiredViews, viewInstructions } from '../engine/capture-views';
import { getDraft, saveDraft, clearDraft } from '../shared/storage';
import { createLocalRecord, saveSample } from '../examples/records';
import { api, intakePath, labelRect, type IntakeState } from '../shared/workshop';
import { readImage, b64 } from './images';
import { Alert, Icon, Loading, Modal } from '../components/ui';
import { grantRider } from '../shared/rider-access';
import { RiderQuestions } from './RiderQuestions';
import { GuidedCamera } from './GuidedCamera';
import { claimToken, saveTicket, tradeAPI } from '../trade/trade-client';
export function Intake({ mode, onFinish }: { mode: Mode; onFinish: () => void }) {
  const [d, setD] = useState<Draft>(blankDraft),
    latest = useRef(d),
    [loaded, setLoaded] = useState(false),
    [slot, setSlot] = useState<Slot>('front'),
    [phase, setPhase] = useState<'ready' | 'prepare' | 'submit' | 'wait'>('ready'),
    [issue, setIssue] = useState(''),
    [status, setStatus] = useState(''),
    [drag, setDrag] = useState(false),
    [discard, setDiscard] = useState(false),
    [optionalOpen, setOptionalOpen] = useState(false);
  const live = useRef(true),
    lock = useRef(false),
    saving = useRef<Promise<void>>(Promise.resolve()),
    library = useRef<HTMLInputElement>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'failed'>('saved');
  const currentOnFinish = useRef(onFinish);
  currentOnFinish.current = onFinish;
  function store(next: Draft) {
    latest.current = next;
    if (live.current) {
      setD(next);
      setSaveState('saving');
    }
    saving.current = saving.current.catch(() => {}).then(() => saveDraft(mode, next));
    void saving.current.then(
      () => {
        if (live.current && latest.current === next) setSaveState('saved');
      },
      () => {
        if (live.current && latest.current === next) setSaveState('failed');
      },
    );
    return saving.current;
  }
  function change(next: Draft) {
    void store(next).catch(() => {
      if (live.current)
        setIssue('This browser could not save the draft. Keep this tab open and try again.');
    });
  }
  useEffect(() => {
    live.current = true;
    let here = true;
    getDraft(mode)
      .then((v) => {
        if (!here) return;
        if (!v.riderStep) {
          v = {
            ...v,
            riderStep: v.history || v.job || Object.keys(v.shots).length ? 'capture' : 'garment',
            method: 'upload',
          };
        }
        latest.current = v;
        setD(v);
        setLoaded(true);
        setSlot(requiredViews.find((k) => !v.shots[k]) ?? 'detail');
        if (v.job && (v.state === 'queued' || v.state === 'analyzing')) setPhase('wait');
      })
      .catch(() => {
        if (here) {
          setLoaded(true);
          setSaveState('failed');
          setIssue(
            'Device storage is unavailable. Enable browser storage to keep an inspection draft.',
          );
        }
      });
    return () => {
      live.current = false;
      here = false;
    };
  }, [mode]);
  async function finishRecord(id: string) {
    await saving.current.catch(() => {});
    await saveTicket(mode, id, {
      claim: latest.current.claim,
      prefs: latest.current.preferences,
      garment: latest.current.garment,
    });
    await clearDraft(mode);
    if (!live.current) return;
    currentOnFinish.current();
    location.hash = recordHref(id, 'result');
  }
  useEffect(() => {
    if (phase !== 'wait' || !d.job) return;
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    const id = d.job;
    async function poll() {
      try {
        const result = await api<IntakeState>(intakePath(id!));
        if (!mounted) return;
        if (result.state === 'complete') {
          await finishRecord(id!);
          return;
        }
        if (result.state === 'retry') {
          await store({ ...latest.current, state: 'retry' });
          setIssue(result.message || 'The check paused. Your photographs are saved; try again.');
          setStatus('');
          setPhase('ready');
          return;
        }
        setIssue('');
        setStatus(
          result.state === 'queued'
            ? 'Waiting for the workshop checker…'
            : 'The workshop is inspecting the photographs…',
        );
      } catch {
        if (mounted) setIssue('Reconnecting to your saved inspection…');
      }
      if (mounted) timer = setTimeout(() => void poll(), 2200);
    }
    void poll();
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [phase, d.job]);
  if (!loaded)
    return (
      <div className="utility-page">
        <Loading label="Opening the inspection draft" />
      </div>
    );
  const hasHistory = d.history !== null,
    stage = d.riderStep ?? 'garment',
    yes = d.history === 'yes',
    count = requiredViews.filter((k) => !!d.shots[k]).length,
    busy = phase !== 'ready',
    ready = hasHistory && (yes || count === 4);
  async function chooseFile(file?: File) {
    if (!file || lock.current || busy) return false;
    lock.current = true;
    setPhase('prepare');
    setIssue('');
    try {
      const p = await readImage(file, slot === 'label');
      const before = latest.current;
      if (Object.entries(before.shots).some(([k, v]) => k !== slot && v.hash === p.hash))
        throw Error('This photo is already in another slot. Choose a different view.');
      const shots = { ...before.shots, [slot]: p };
      await store({
        ...before,
        shots,
        claim: before.job ? undefined : before.claim,
        job: undefined,
        state: undefined,
        uploaded: [],
      });
      if (live.current) {
        setSlot(requiredViews.find((k) => !shots[k]) ?? 'detail');
        setStatus(labels[slot] + ' saved.');
      }
      return true;
    } catch (e) {
      if (live.current) setIssue((e as Error).message);
      return false;
    } finally {
      lock.current = false;
      if (live.current) setPhase('ready');
    }
  }
  function historyAnswer(value: History) {
    setIssue('');
    setStatus('');
    change({
      ...latest.current,
      history: value,
      riderStep: value === 'yes' ? 'capture' : 'fit',
      claim: undefined,
      job: undefined,
      uploaded: [],
      state: undefined,
    });
  }
  async function submit() {
    if (lock.current || !ready || !d.history) return;
    lock.current = true;
    setPhase('submit');
    setIssue('');
    try {
      let draft = latest.current;
      await saving.current.catch(() => {});
      if (mode === 'examples') {
        const frames: Frame[] =
          draft.history === 'yes'
            ? []
            : intakeViews.flatMap((k) => {
                const p = draft.shots[k];
                return p
                  ? [
                      {
                        id: k,
                        photo: k,
                        name: labels[k],
                        caption: 'Photograph supplied for this intake.',
                        src: p.uri,
                        width: p.width,
                        height: p.height,
                        hash: p.hash,
                        role: k,
                      },
                    ]
                  : [];
              });
        const rec = createLocalRecord(
          draft.name ||
            (draft.garment === 'pants'
              ? 'My riding trousers'
              : draft.garment === 'jacket'
                ? 'My riding jacket'
                : 'My gear'),
          draft.history!,
          frames,
        );
        rec.card.category = draft.garment ?? 'unknown';
        await saveSample(rec);
        await finishRecord(rec.card.id);
        return;
      }
      let id = draft.job;
      if (!id) {
        const claim = draft.claim ?? claimToken();
        draft = { ...draft, claim };
        await store(draft);
        const start = await tradeAPI<IntakeState>('begin', { claim, history: draft.history });
        id = start.id;
        draft = { ...draft, job: id };
        await store(draft);
        if (mode === 'rider')
          await saveTicket(mode, id, { claim, prefs: draft.preferences, garment: draft.garment });
      }
      if (mode === 'rider' && draft.claim) await grantRider(id, draft.claim, true);
      if (draft.history !== 'yes')
        for (const k of intakeViews) {
          const p = draft.shots[k];
          if (!p || draft.uploaded.includes(k)) continue;
          setStatus('Sending ' + labels[k].toLowerCase() + '…');
          await api(intakePath(id) + '/photos', {
            view: k,
            base64: b64(p.uri),
            purpose: k === 'label' ? 'attached_label' : 'overview',
            ...(k === 'label'
              ? { rect: labelRect, nativeRegion: p.crop ? b64(p.crop) : undefined }
              : {}),
          });
          draft = { ...draft, uploaded: [...draft.uploaded, k] };
          await store(draft);
        }
      const result = await api<IntakeState>(intakePath(id) + '/finish', {});
      if (result.state === 'complete') {
        await finishRecord(id);
        return;
      }
      if (result.state === 'retry')
        throw Error(result.message || 'The inspection paused. Try again.');
      await store({ ...draft, state: result.state === 'queued' ? 'queued' : 'analyzing' });
      if (live.current) {
        setStatus('Your photos are saved.');
        setPhase('wait');
      }
    } catch (e) {
      if (live.current) {
        setIssue(
          (e as Error).message || 'The intake could not finish. Your draft is available here.',
        );
        setPhase('ready');
      }
    } finally {
      lock.current = false;
    }
  }
  if (phase === 'wait' || phase === 'submit')
    return (
      <article className={'intake-page ' + (d.method === 'camera' ? 'camera-intake' : '')}>
        <header className="capture-head">
          <div className="section-overline">
            <Icon name="clock" size={15} />
            Trade-in inspection
          </div>
          <h1>{phase === 'wait' ? 'Checking your gear' : 'Sending your inspection'}</h1>
        </header>
        <section className="analysis-wait">
          <Icon name="aperture" size={31} />
          <div>
            <h2>
              {phase === 'wait' ? 'Your photos are with the workshop' : 'Preparing your record'}
            </h2>
            <p role="status">{status || 'Connecting to the workshop…'}</p>
            {phase === 'wait' && (
              <p>The result will open here. You can return to this draft while the check runs.</p>
            )}
            {issue && <Alert>{issue}</Alert>}
          </div>
        </section>
      </article>
    );
  if (stage !== 'capture')
    return (
      <RiderQuestions
        draft={d}
        step={stage}
        update={(patch) => {
          setIssue('');
          change({ ...latest.current, ...patch });
        }}
        history={historyAnswer}
        issue={issue}
        saving={saveState === 'saving'}
      />
    );
  return (
    <article className={'intake-page ' + (d.method === 'camera' ? 'camera-intake' : '')}>
      <header className="capture-head">
        <div className="crumb">
          <a href="#/notebook">Notebook</a>
          <Icon name="right" size={13} />
          <span>New inspection</span>
        </div>
        <h1>
          {yes
            ? 'History recorded'
            : d.method === 'camera'
              ? 'Guided camera'
              : 'Upload your photos'}
          <span>.</span>
        </h1>
        <p>
          {mode === 'examples'
            ? 'This intake is saved on this device in the example workspace.'
            : 'Create a record in your connected workshop.'}
        </p>
      </header>
      {yes ? (
        <section className="exclusion-panel paper-panel">
          <i className="section-icon">
            <Icon name="shield" />
          </i>
          <h2>No photos needed</h2>
          <p>
            You reported a crash, damage, or a repair in an impact area. The shop will withhold an
            offer on this history.
          </p>
          <button className="button primary" disabled={busy} onClick={() => void submit()}>
            Open inspection
            <Icon name="arrow" />
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => change({ ...latest.current, riderStep: 'history' })}
          >
            Edit history
          </button>
        </section>
      ) : (
        <div className="capture-layout">
          <aside className="checklist">
            <div className="checklist-head">
              <h2>Capture checklist</h2>
              <span>{count} / 4</span>
            </div>
            <div
              className="capture-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={4}
              aria-valuenow={count}
              aria-label={count + ' of 4 required views saved'}
            >
              {requiredViews.map((k) => (
                <i key={k} className={d.shots[k] ? 'done' : ''} />
              ))}
            </div>
            <div className="slot-list">
              {intakeViews.map((k, i) => (
                <button
                  key={k}
                  className={'slot ' + (k === slot ? 'current' : '')}
                  aria-current={k === slot ? 'step' : undefined}
                  title={(d.shots[k] ? 'Retake ' : 'Show ') + labels[k]}
                  disabled={busy}
                  onClick={() => {
                    setOptionalOpen(k === 'detail');
                    setSlot(k);
                    setIssue('');
                  }}
                >
                  <span className={'slot-number ' + (d.shots[k] ? 'filled' : '')}>
                    {d.shots[k] ? <Icon name="check" size={14} /> : i + 1}
                  </span>
                  <span>
                    <strong>{labels[k]}</strong>
                    <small>
                      {d.shots[k]
                        ? 'Photo saved · Retake'
                        : k === 'detail'
                          ? 'Optional'
                          : 'Required view'}
                    </small>
                  </span>
                  {d.shots[k] ? (
                    <img src={d.shots[k]!.uri} alt="" />
                  ) : (
                    <Icon name="right" size={14} />
                  )}
                </button>
              ))}
            </div>
            <button
              className="text-button history-edit"
              disabled={busy}
              onClick={() => change({ ...latest.current, riderStep: 'history' })}
            >
              Edit garment history
            </button>
          </aside>
          <div className="capture-main">
            {d.method === 'camera' && slot === 'detail' && count === 4 && !optionalOpen ? (
              <section className="shot-complete">
                <Icon name="check" />
                <h2>Four views captured</h2>
                <p>You can send the photos now or add a close-up of wear or damage.</p>
                <button className="button soft" onClick={() => setOptionalOpen(true)}>
                  Add a close-up
                </button>
              </section>
            ) : d.method === 'camera' ? (
              <>
                <GuidedCamera
                  slot={slot}
                  garment={d.garment}
                  busy={busy}
                  save={chooseFile}
                  switchUpload={() => change({ ...latest.current, method: 'upload' })}
                />
                {issue && <Alert>{issue}</Alert>}
              </>
            ) : (
              <section className="paper-panel capture-card">
                <div className="kicker">
                  {slot === 'detail'
                    ? 'Optional close-up'
                    : 'View ' + (requiredViews.findIndex((k) => k === slot) + 1) + ' of 4'}
                </div>
                <h2>{viewInstructions[slot].title}</h2>
                <p>{viewInstructions[slot].instruction}</p>
                <div
                  className={'photo-drop ' + (drag ? 'dragging' : '')}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDrag(true);
                  }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDrag(false);
                    void chooseFile(e.dataTransfer.files[0]);
                  }}
                >
                  <img
                    src={d.shots[slot]?.uri ?? framingPhoto(slot, d.garment)}
                    alt={
                      d.shots[slot]
                        ? labels[slot] + ' captured'
                        : 'Illustrated ' + labels[slot].toLowerCase() + ' framing example'
                    }
                  />
                  <span className="photo-tag">
                    {d.shots[slot] ? 'Your photograph' : 'Framing example'}
                  </span>
                </div>
                <div className="capture-actions">
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => library.current?.click()}
                  >
                    <Icon name="upload" />
                    {d.shots[slot] ? 'Replace photo' : 'Choose photo'}
                  </button>
                  <button
                    className="button soft"
                    disabled={busy}
                    onClick={() => change({ ...latest.current, method: 'camera' })}
                  >
                    <Icon name="camera" />
                    Use camera
                  </button>
                </div>
                {issue && <Alert>{issue}</Alert>}
                <input
                  className="sr"
                  type="file"
                  tabIndex={-1}
                  aria-label={'Choose ' + labels[slot] + ' photograph'}
                  ref={library}
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    void chooseFile(f);
                  }}
                />
              </section>
            )}
            <section className="capture-finish">
              {mode === 'examples' && (
                <label className="field">
                  Garment name <span className="optional">Optional</span>
                  <input
                    maxLength={80}
                    value={d.name}
                    placeholder="e.g. Brown leather riding jacket"
                    disabled={busy}
                    onChange={(e) => change({ ...latest.current, name: e.target.value })}
                  />
                </label>
              )}
              <div>
                <p>
                  {ready
                    ? 'All four required views are ready.'
                    : 'Add the four required views to open your inspection.'}
                </p>
                <button
                  className="button primary"
                  disabled={!ready || busy}
                  onClick={() => void submit()}
                >
                  Open inspection
                  <Icon name="arrow" />
                </button>
              </div>
            </section>
          </div>
        </div>
      )}
      {yes && issue && <Alert>{issue}</Alert>}
      {status && (
        <p className="capture-status" role="status">
          <Icon name="check" size={16} />
          {status}
        </p>
      )}
      {phase === 'prepare' && <p role="status">Preparing a private copy of your photograph…</p>}
      {(hasHistory || Object.keys(d.shots).length > 0) && !busy && (
        <div className="draft-bottom">
          <span>
            <Icon name="lock" size={14} />
            {saveState === 'saved'
              ? 'Draft saved on this device'
              : saveState === 'saving'
                ? 'Saving draft…'
                : 'Draft could not be saved on this device'}
          </span>
          <button className="text-button" onClick={() => setDiscard(true)}>
            Discard draft
          </button>
        </div>
      )}
      {discard && (
        <Modal title="Discard this draft?" onClose={() => setDiscard(false)}>
          <p>
            The photographs in this draft will be removed from this browser. Previously completed
            records stay in the notebook.
          </p>
          <div className="dialog-actions">
            <button className="button soft" onClick={() => setDiscard(false)}>
              Keep draft
            </button>
            <button
              className="button primary"
              onClick={async () => {
                await saving.current.catch(() => {});
                try {
                  await clearDraft(mode);
                } catch {
                  setDiscard(false);
                  setIssue('This browser could not remove the saved draft. Try again.');
                  return;
                }
                latest.current = blankDraft();
                setD(latest.current);
                setDiscard(false);
                setIssue('');
                setStatus('');
                setSlot('front');
              }}
            >
              Discard draft
            </button>
          </div>
        </Modal>
      )}
    </article>
  );
}
