import { asset, recordHref, type Mode } from '../shared/domain';
import { Icon } from '../components/ui';
export function TradeHome({
  mode,
  draft,
  retailer,
}: {
  mode: Mode;
  draft: boolean;
  retailer?: string;
}) {
  return (
    <article className="trade-home">
      <header className="ride-cover">
        <picture>
          <source media="(max-width:640px)" srcSet={asset('coast-rider-phone')} />
          <img
            src={asset('coast-rider')}
            alt="A rider in a weathered jacket overlooking the coast"
            fetchPriority="high"
          />
        </picture>
        <div className="ride-shadow" />
        <div className="ride-copy">
          {retailer && (
            <div className="ride-kicker">
              <i />
              {retailer}
            </div>
          )}
          <h1>
            Trade in your
            <br />
            <em>riding gear.</em>
          </h1>
          <p>
            See what your used jacket or riding trousers could be worth toward new gear at the shop.
          </p>
          <a className="button signal" href="#/intake">
            {draft ? 'Continue your trade-in' : 'Start a trade-in'}
            <Icon name="arrow" />
          </a>
        </div>
      </header>
      <section className="trade-steps" aria-label="How a trade-in works">
        {[
          ['01', 'Tell us about your gear', 'A few questions about the garment and its history.'],
          [
            '02',
            'Show us four views',
            'Follow the camera guide or upload photos you already have.',
          ],
          [
            '03',
            'Get your trade-in offer',
            'Bring in eligible gear to receive credit toward something new.',
          ],
        ].map(([n, h, p]) => (
          <div key={n}>
            <span>{n}</span>
            <div>
              <h2>{h}</h2>
              <p>{p}</p>
            </div>
          </div>
        ))}
      </section>
      <section className="rider-shelf">
        <div className="shelf-intro">
          <h2>
            {mode === 'examples'
              ? 'Inside a trade-in'
              : mode === 'rider'
                ? 'Your inspections'
                : 'Workshop inspections'}
          </h2>
          <p>
            {mode === 'examples'
              ? 'Explore two illustrated cases to see how a shop reaches a decision.'
              : 'Reopen a garment to see its decision, check a photo, or review the trade-in value.'}
          </p>
          <a className="inline-link" href="#/notebook">
            {mode === 'rider' ? 'Open my inspections' : 'Open the notebook'}{' '}
            <Icon name="arrow" size={16} />
          </a>
        </div>
        {mode === 'examples' ? (
          <>
            {[
              [
                'RW-003',
                'fieldway-card',
                'Fieldway touring jacket',
                'Eligible for trade-in',
                'trade',
              ],
              [
                'RW-001',
                'meridian-card',
                'Meridian café jacket',
                'Why a closer look matters',
                'overview',
              ],
            ].map(([id, file, title, caption, tab]) => (
              <a
                key={id}
                className="shelf-case"
                href={recordHref(id, tab === 'trade' ? 'trade' : 'overview')}
              >
                <div>
                  <img src={asset(file)} alt="" />
                </div>
                <p>{caption}</p>
                <h3>
                  {title}
                  <Icon name="upRight" />
                </h3>
              </a>
            ))}
          </>
        ) : (
          <a className="guide-promo" href="#/guide">
            <img
              src={asset('meridian-shoulder')}
              alt="Detail of a stitched riding jacket shoulder"
            />
            <div>
              <div className="section-overline">Field guide</div>
              <h3>Photograph your gear</h3>
              <span>
                See the four views <Icon name="arrow" size={15} />
              </span>
            </div>
          </a>
        )}
      </section>
    </article>
  );
}
