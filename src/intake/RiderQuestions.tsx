import { useEffect, useRef } from 'react';
import { asset, type Draft, type History } from '../shared/domain';
import { Icon } from '../components/ui';
export type RiderStep = 'garment' | 'history' | 'fit' | 'method' | 'capture';
type Props = {
  draft: Draft;
  step: RiderStep;
  update: (patch: Partial<Draft>) => void;
  history: (v: History) => void;
  issue?: string;
  saving?: boolean;
};
export function RiderQuestions({ draft: d, step, update, history, issue, saving }: Props) {
  const title = useRef<HTMLHeadingElement>(null),
    prev = useRef(step);
  useEffect(() => {
    if (prev.current !== step) {
      title.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
      prev.current = step;
    }
  }, [step]);
  const stages = ['garment', 'history', 'fit', 'method'],
    index = stages.indexOf(step);
  const move = (riderStep: RiderStep, patch: Partial<Draft> = {}) =>
    update({ ...patch, riderStep });
  return (
    <article className="rider-form">
      <nav className="form-top">
        <a href="#/trade">Trade-in desk</a>
        <span>/</span>
        <span>New trade-in</span>
      </nav>
      <div className="question-layout">
        <section className="question-main">
          <ol className="question-progress" aria-label="Trade-in steps">
            {['Garment', 'History', 'Fit', 'Photos'].map((label, i) => (
              <li
                key={label}
                aria-current={index === i ? 'step' : undefined}
                className={i < index ? 'done' : ''}
              >
                <span>{i < index ? <Icon name="check" size={13} /> : i + 1}</span>
                {label}
              </li>
            ))}
          </ol>
          <h1 ref={title} tabIndex={-1}>
            {step === 'garment'
              ? 'What are you trading in?'
              : step === 'history'
                ? 'What’s the gear’s history?'
                : step === 'fit'
                  ? 'What fit are you looking for?'
                  : 'How will you add photos?'}
          </h1>
          {step === 'garment' ? (
            <>
              <p>Pick the closest match. We’ll use it to frame your photos.</p>
              <div className="choice-grid">
                {[
                  ['jacket', 'Riding jacket', 'meridian-card'],
                  ['pants', 'Riding trousers', 'selvedge-card'],
                ].map(([v, l, img]) => (
                  <button
                    key={v}
                    className="garment-choice"
                    onClick={() => move('history', { garment: v as Draft['garment'] })}
                  >
                    <img src={asset(img)} alt="" />
                    <span>
                      {l}
                      <Icon name="arrow" />
                    </span>
                  </button>
                ))}
              </div>
              <button
                className="under-button"
                onClick={() => move('history', { garment: 'unknown' })}
              >
                I’m not sure
              </button>
            </>
          ) : step === 'history' ? (
            <>
              <p>
                Has it been in a crash, or been damaged or repaired in an impact area such as the
                shoulders, elbows, hips or knees?
              </p>
              <div className="answer-stack">
                {(
                  [
                    ['no', 'No', 'None of these apply.'],
                    ['yes', 'Yes', 'A crash, damage or repair applies.'],
                    ['unknown', 'Not sure', 'I don’t know its full history.'],
                  ] as const
                ).map(([v, l, t]) => (
                  <button onClick={() => history(v)} key={v}>
                    <div>
                      <strong>{l}</strong>
                      <small>{t}</small>
                    </div>
                    <Icon name="right" />
                  </button>
                ))}
              </div>
            </>
          ) : step === 'fit' ? (
            <>
              <p>
                All three answers are optional. They help the shop suggest new gear in your size and
                riding style.
              </p>
              <div className="rider-fields">
                <label className="field">
                  Size you’re shopping for
                  <input
                    value={d.preferences?.size ?? ''}
                    maxLength={24}
                    placeholder={d.garment === 'pants' ? 'e.g. W32 / L32' : 'e.g. M or EU 48'}
                    onChange={(e) =>
                      update({ preferences: { ...d.preferences, size: e.target.value } })
                    }
                  />
                </label>
                <label className="field">
                  Fit preference
                  <select
                    value={d.preferences?.fit ?? 'any'}
                    onChange={(e) =>
                      update({ preferences: { ...d.preferences, fit: e.target.value } })
                    }
                  >
                    <option value="any">Any fit</option>
                    <option value="women">Women’s cut</option>
                    <option value="men">Men’s cut</option>
                  </select>
                </label>
                <label className="field">
                  Usual riding
                  <select
                    value={d.preferences?.riding ?? ''}
                    onChange={(e) =>
                      update({ preferences: { ...d.preferences, riding: e.target.value } })
                    }
                  >
                    <option value="">No preference</option>
                    <option value="commuting">Everyday commuting</option>
                    <option value="touring">Long-distance touring</option>
                    <option value="adventure">Adventure riding</option>
                    <option value="sport">Sport riding</option>
                  </select>
                </label>
              </div>
              <button className="button signal" onClick={() => move('method')}>
                Continue to photos
                <Icon name="arrow" />
              </button>
            </>
          ) : (
            <>
              <p>
                We’ll need the front, back, sewn-in label and inside. Both paths save your progress.
              </p>
              <div className="answer-stack methods">
                {(
                  [
                    ['camera', 'Use the camera', 'A live framing guide for each view.', 'camera'],
                    [
                      'upload',
                      'Upload existing photos',
                      'Choose an image for each of the four views.',
                      'upload',
                    ],
                  ] as const
                ).map(([v, l, t, i]) => (
                  <button key={v} onClick={() => move('capture', { method: v })}>
                    <i>
                      <Icon name={i} size={24} />
                    </i>
                    <div>
                      <strong>{l}</strong>
                      <small>{t}</small>
                    </div>
                    <Icon name="arrow" />
                  </button>
                ))}
              </div>
            </>
          )}
          {issue && (
            <p className="alert" role="alert">
              {issue}
            </p>
          )}
          <div className="question-footer">
            {index > 0 && (
              <button
                className="back-question"
                onClick={() => move(stages[index - 1] as RiderStep)}
              >
                <Icon name="back" size={15} />
                Back
              </button>
            )}
            {index > 0 &&
              !issue &&
              (saving ? (
                <small role="status">Saving…</small>
              ) : (
                <a href="#/trade">Save &amp; leave</a>
              ))}
          </div>
        </section>
        <aside className="question-art">
          <img
            src={asset(
              step === 'history'
                ? d.garment === 'pants'
                  ? 'selvedge-seam'
                  : 'meridian-shoulder'
                : step === 'method'
                  ? d.garment === 'pants'
                    ? 'selvedge-label'
                    : 'meridian-label'
                  : step === 'garment'
                    ? 'workbench'
                    : d.garment === 'pants'
                      ? 'selvedge-card'
                      : 'fieldway-card',
            )}
            alt=""
          />
          {(step === 'history' || step === 'method') && (
            <div>
              <i />
              <span>
                {step === 'history'
                  ? d.garment === 'pants'
                    ? 'Trouser seam'
                    : 'Shoulder seam'
                  : step === 'method'
                    ? 'Sewn-in label'
                    : d.garment === 'pants'
                      ? 'Riding denim'
                      : 'Riding apparel'}
              </span>
            </div>
          )}
        </aside>
      </div>
    </article>
  );
}
