import { useState } from 'react';
import { asset, disclosure, framingPhoto, type Outcome } from '../shared/domain';
import { viewInstructions, requiredViews } from '../engine/capture-views';
import { Icon, Status } from '../components/ui';
export function Guide() {
  const [garment, setGarment] = useState<'jacket' | 'pants'>('jacket');
  const tips =
    garment === 'pants'
      ? {
          front: 'Lay the trousers flat. Include the whole waistband, both legs and both hems.',
          back: 'Turn the trousers over and show the seat, knees and both hems.',
          label: 'Find the sewn-in label inside the waistband. Hold it flat and fill the frame.',
          inside: 'Open the waist and show the lining and the inside of the hips and knees.',
        }
      : {
          front: 'Close the jacket and lay it flat. Keep the collar, sleeves and hem in the frame.',
          back: 'Turn it over and show both shoulders, elbows and the full back.',
          label: 'Hold the sewn-in label flat. Let the camera focus so the print is readable.',
          inside: 'Open the jacket wide and show the lining, shoulders and inside seams.',
        };
  return (
    <article className="guide">
      <header className="guide-cover">
        <div>
          <div className="kicker">
            <Icon name="book" size={16} /> Field guide
          </div>
          <h1>
            Photographing
            <br />
            riding gear<span>.</span>
          </h1>
          <p>
            Four views give the workshop a consistent starting point. A close-up helps when
            something catches your eye.
          </p>
          <a className="button primary" href="#/intake">
            <Icon name="camera" />
            Start an inspection
          </a>
        </div>
        <img
          src={asset('meridian-shoulder')}
          alt="Illustration of the leather grain and stitching on a riding jacket"
        />
      </header>
      <section className="guide-section">
        <div className="section-title">
          <h2>The four required views</h2>
          <div className="guide-switch" role="group" aria-label="Garment framing examples">
            {(['jacket', 'pants'] as const).map((g) => (
              <button key={g} aria-pressed={garment === g} onClick={() => setGarment(g)}>
                {g === 'jacket' ? 'Jacket' : 'Trousers'}
              </button>
            ))}
          </div>
        </div>
        <div className="guide-grid">
          {requiredViews.map((key, i) => (
            <article key={key}>
              <img
                src={framingPhoto(key, garment)}
                loading="lazy"
                alt={
                  (garment === 'jacket' ? 'Jacket' : 'Trouser') +
                  ' framing example, ' +
                  viewInstructions[key].short
                }
              />
              <div className="guide-line">
                <span className="step-num">{i + 1}</span>
                <h3>{viewInstructions[key].short}</h3>
              </div>
              <p>{tips[key]}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="guide-bottom">
        <div className="paper-panel">
          <h2>How decisions work</h2>
          {(
            [
              ['request', 'A specific photograph or history detail is still needed.'],
              ['specialist', 'A person reviews the sources and the competing explanations.'],
              ['keep', 'The shop can consider an offer using its own terms.'],
              ['retire', 'A disclosed or established exclusion closes the offer.'],
            ] as [Outcome, string][]
          ).map(([o, t]) => (
            <div className="guide-decision" key={o}>
              <Status outcome={o} />
              <p>{t}</p>
            </div>
          ))}
        </div>
        <div className="guide-notes">
          <article>
            <Icon name="shield" />
            <h3>What a photograph can establish</h3>
            <p>{disclosure} An unknown history stays unknown.</p>
          </article>
          <article>
            <Icon name="layers" />
            <h3>About the example workspace</h3>
            <p>
              The example records are fictional and the garment images are original illustrations.
              Personal intakes saved here stay in this browser. A connected workshop uses its own
              records and inspection service.
            </p>
          </article>
        </div>
      </section>
    </article>
  );
}
