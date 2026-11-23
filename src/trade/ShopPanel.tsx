import { useEffect, useState } from 'react';
import {
  markets,
  money,
  recordHref,
  type Market,
  type Mode,
  type RecordData,
  type ShopData,
  type Terms,
} from '../shared/domain';
import { exampleShop, sampleCards, sampleRecord } from '../examples/records';
import { api, liveShop } from '../shared/workshop';
import { read, write } from '../shared/storage';
import { contribution, sizeKey, validateTerms } from '../engine/commerce';
import { Alert, Icon, Loading, safeLink } from '../components/ui';

const termNames: Record<keyof Terms, string> = {
  buyRate: 'Buy rate (%)',
  resaleRatio: 'Resale ratio (%)',
  creditPremium: 'Credit premium (%)',
  handlingMinor: 'Handling cost',
};
type TermForm = Record<keyof Terms, string>;
const emptyForm: TermForm = { buyRate: '', resaleRatio: '', creditPremium: '', handlingMinor: '' };
const firstQuote = {
  retail: '',
  acquisition: '',
  freight: '',
  duties: '',
  chance: '',
  salvage: '',
  grams: '1000',
  quantity: '1',
};
const num = (s: string, scale = 1) => {
  if (!s.trim()) return null;
  const v = Number(s);
  if (!Number.isFinite(v) || v < 0)
    throw Error('Enter a nonnegative number or leave the field blank.');
  return scale === 100 ? Math.round(v * 100) : v * scale;
};
const toForm = (terms: Terms): TermForm =>
  Object.fromEntries(
    Object.entries(terms).map(([k, v]) => [
      k,
      v == null ? '' : String(k === 'handlingMinor' ? v / 100 : Math.round(v * 10000) / 100),
    ]),
  ) as TermForm;
export function ShopPanel({
  mode,
  r,
  scenario,
  token,
}: {
  mode: Mode;
  r: RecordData;
  scenario: string;
  token: string;
}) {
  const [market, setMarket] = useState<Market>('CA'),
    [shop, setShop] = useState<ShopData | null>(null),
    [terms, setTerms] = useState<TermForm>(emptyForm),
    [q, setQ] = useState(firstQuote),
    [answer, setAnswer] = useState<{
      breakEven: number | null;
      contribution: number | null;
      receipt?: string;
      missing?: string[];
    } | null>(null);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0),
    [stock, setStock] = useState(''),
    [owns, setOwns] = useState(false),
    [wanted, setWanted] = useState(''),
    [matches, setMatches] = useState<{ item: string; size: string }[] | null>(null),
    [date, setDate] = useState(''),
    [verified, setVerified] = useState(false);
  const available = mode === 'examples' || !!token;
  useEffect(() => {
    let live = true;
    const ac = new AbortController();
    setShop(null);
    setError('');
    (mode === 'workshop'
      ? liveShop(r.card, scenario, market, '', ac.signal)
      : exampleShop(r, market)
    )
      .then((v) => {
        if (live) {
          setShop(v);
          setTerms(toForm(v.terms));
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
      ac.abort();
    };
  }, [r.card.id, mode, market, scenario, reload, r.eligible]);
  function changeMarket(m: Market) {
    setMarket(m);
    setAnswer(null);
    setNotice('');
    setMatches(null);
    setQ(firstQuote);
  }
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const endpoint = '/shop/' + encodeURIComponent(r.card.id);
  if (!shop)
    return error ? (
      <Alert>
        {error}{' '}
        <button className="text-button" onClick={() => setReload((n) => n + 1)}>
          Retry
        </button>
      </Alert>
    ) : (
      <Loading label="Opening shop terms" />
    );
  const s = shop,
    currency = s.currency;
  return (
    <div className="shop-workspace">
      <section className="shop-market paper-panel">
        <div>
          <div className="kicker">
            <Icon name="shop" size={15} />
            Shop decision
          </div>
          <h2>{s.jurisdiction}</h2>
          <p>
            {s.eligible
              ? 'The shop can consider this garment for intake.'
              : 'The current inspection withholds an offer.'}
          </p>
        </div>
        <label className="field">
          Market
          <select value={market} onChange={(e) => changeMarket(e.target.value as Market)}>
            {Object.entries(markets).map(([k, v]) => (
              <option value={k} key={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </section>
      {error && <Alert>{error}</Alert>}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <div className="metrics">
        {[
          ['Appearance grade', r.grade ?? 'Unconfirmed'],
          ['Known cost floor', money(s.knownCost, currency)],
          ['Break-even sale price', money(s.breakEven, currency)],
        ].map(([k, v]) => (
          <div key={k}>
            <small>{k}</small>
            <strong>{v}</strong>
          </div>
        ))}
      </div>
      <div className="role-layout">
        <section className="role-main">
          <section className="paper-panel">
            <div className="panel-heading">
              <Icon name="sliders" />
              <h2>Workshop terms</h2>
            </div>
            <p className="muted">
              {mode === 'examples'
                ? 'Example terms are saved on this device for the selected market.'
                : 'These terms apply to this market. Editing them preserves the physical inspection receipt.'}
            </p>
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const t = validateTerms({
                    buyRate: num(terms.buyRate, 0.01),
                    resaleRatio: num(terms.resaleRatio, 0.01),
                    creditPremium: num(terms.creditPremium, 0.01),
                    handlingMinor: num(terms.handlingMinor, 100),
                  });
                  if (mode === 'workshop') {
                    const before = s.inspection;
                    await api('/shop/terms/' + market, t, token);
                    const next = await liveShop(r.card, scenario, market);
                    setShop(next);
                    setTerms(toForm(next.terms));
                    setNotice(
                      next.inspection === before
                        ? 'Terms saved. The inspection receipt is unchanged.'
                        : 'Terms saved. The inspection also changed; review the current decision.',
                    );
                  } else {
                    await write('terms:' + market, t);
                    setShop({ ...s, terms: t });
                    setNotice('Example terms saved for ' + markets[market] + '.');
                  }
                  setAnswer(null);
                });
              }}
            >
              <div className="form-grid">
                {(Object.keys(termNames) as (keyof Terms)[]).map((key) => (
                  <label className="field" key={key}>
                    {termNames[key]}
                    {key === 'handlingMinor' ? ' (' + currency + ')' : ''}
                    <input
                      type="number"
                      min="0"
                      step="any"
                      placeholder="Not set"
                      value={terms[key]}
                      onChange={(e) => setTerms({ ...terms, [key]: e.target.value })}
                    />
                  </label>
                ))}
              </div>
              <button className="button primary" disabled={!available || busy}>
                Save shop terms
              </button>
            </form>
          </section>
          {s.eligible && (
            <details className="paper-panel fold">
              <summary>
                Quote calculator <Icon name="down" size={16} />
              </summary>
              <p className="muted">
                {mode === 'examples'
                  ? 'Explore an illustrative per-item calculation with your own inputs.'
                  : 'Calculate a per-item scenario against the current signed inspection.'}
              </p>
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const values = {
                      retailMinor: num(q.retail, 100),
                      dutiesMinor: num(q.duties, 100),
                      acquisitionMinor: num(q.acquisition, 100),
                      saleProbability: num(q.chance, 0.01),
                      salvageMinor: num(q.salvage, 100),
                    };
                    if (mode === 'examples') {
                      const v = contribution({
                        priceMinor: values.retailMinor,
                        currency,
                        terms: s.terms,
                        freightMinor: num(q.freight, 100),
                        dutiesMinor: values.dutiesMinor,
                        acquisitionMinor: values.acquisitionMinor,
                        saleProbability: values.saleProbability,
                        salvageMinor: values.salvageMinor,
                      });
                      setAnswer({
                        breakEven: v.breakEvenMinor,
                        contribution: v.expectedContributionMinor,
                        missing: v.missing,
                      });
                    } else {
                      const v = await api<{
                        quoteReceipt: string;
                        margin: {
                          breakEvenMinor: number | null;
                          expectedContributionMinor: number | null;
                          missing: string[];
                        };
                      }>(
                        endpoint + '/quote',
                        {
                          ...values,
                          scenario,
                          inspection: s.inspection,
                          market,
                          packedGrams: Number(q.grams),
                          quantity: Number(q.quantity),
                        },
                        token,
                      );
                      setAnswer({
                        breakEven: v.margin.breakEvenMinor,
                        contribution: v.margin.expectedContributionMinor,
                        receipt: v.quoteReceipt,
                        missing: v.margin.missing,
                      });
                    }
                  });
                }}
              >
                <div className="form-grid">
                  {(Object.keys(firstQuote) as (keyof typeof firstQuote)[])
                    .filter((k) =>
                      mode === 'examples' ? !['grams', 'quantity'].includes(k) : k !== 'freight',
                    )
                    .map((k) => (
                      <label className="field" key={k}>
                        {
                          {
                            retail: 'New-retail reference',
                            acquisition: 'Purchase cost',
                            freight: 'Transport',
                            duties: 'Duties and clearance',
                            chance: 'Chance of sale (%)',
                            salvage: 'Value if unsold',
                            grams: 'Packed weight (g)',
                            quantity: 'Quantity',
                          }[k]
                        }
                        {!['chance', 'grams', 'quantity'].includes(k) ? ' (' + currency + ')' : ''}
                        <input
                          type="number"
                          min={k === 'quantity' || k === 'grams' ? 1 : 0}
                          max={k === 'chance' ? 100 : k === 'quantity' ? 300 : undefined}
                          step={k === 'quantity' || k === 'grams' ? '1' : 'any'}
                          value={q[k]}
                          onChange={(e) => setQ({ ...q, [k]: e.target.value })}
                        />
                      </label>
                    ))}
                </div>
                <button className="button soft" disabled={!available || busy}>
                  Calculate scenario
                </button>
              </form>
              {answer && (
                <div className="quote-answer" role="status">
                  <strong>Break-even {money(answer.breakEven, currency)}</strong>
                  <span>Expected contribution {money(answer.contribution, currency)}</span>
                  {!!answer.missing?.length && <p>Still needed: {answer.missing.join(', ')}.</p>}
                  {answer.receipt && <small>Quote receipt · {answer.receipt.slice(0, 16)}</small>}
                </div>
              )}
            </details>
          )}
          {!!s.comparables.length && (
            <section className="paper-panel">
              <h2>Retail references</h2>
              {s.comparables.map((c, i) => (
                <div className="reference" key={i}>
                  <div>
                    <strong>{c.model}</strong>
                    <small>{c.availability}</small>
                  </div>
                  {safeLink(c.source) ? (
                    <a href={c.source} className="inline-link" target="_blank" rel="noreferrer">
                      {money(c.minor, c.currency)}
                      <Icon name="upRight" size={14} />
                    </a>
                  ) : (
                    money(c.minor, c.currency)
                  )}
                </div>
              ))}
            </section>
          )}
        </section>
        <aside className="role-aside">
          <section className="paper-panel">
            <div className="panel-heading">
              <Icon name="shop" />
              <h2>Stock and matching</h2>
            </div>
            {s.eligible && (
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    if (!stock.trim() || !owns) return;
                    if (mode === 'workshop')
                      await api(
                        endpoint + '/stock',
                        {
                          scenario,
                          inspection: s.inspection,
                          consignmentOrOwnership: true,
                          size: stock.trim(),
                        },
                        token,
                      );
                    else await write('stock:' + r.card.id, { size: stock.trim() });
                    setNotice(
                      mode === 'examples'
                        ? 'Example stock acceptance recorded on this device.'
                        : 'Stock acceptance recorded against this inspection.',
                    );
                  });
                }}
              >
                <label className="field">
                  Verified stock size
                  <input
                    required
                    value={stock}
                    placeholder={r.stockSize || 'Size on the garment'}
                    maxLength={30}
                    onChange={(e) => setStock(e.target.value)}
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={owns}
                    onChange={(e) => setOwns(e.target.checked)}
                  />
                  The shop owns the item or has permission to consign it.
                </label>
                <button
                  className="button soft"
                  disabled={!available || !owns || !stock.trim() || busy}
                >
                  Accept {mode === 'examples' ? 'example ' : ''}stock
                </button>
              </form>
            )}
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  if (mode === 'workshop') {
                    setMatches((await liveShop(r.card, scenario, market, wanted)).matches);
                    return;
                  }
                  const all = await sampleCards(),
                    found = [];
                  for (const c of all) {
                    if (c.id === r.card.id || c.category !== r.card.category) continue;
                    const record = await sampleRecord(c.id),
                      accepted = await read<{ size: string }>('stock:' + c.id);
                    if (record.eligible && accepted && sizeKey(wanted) === sizeKey(accepted.size))
                      found.push({ item: c.id, size: accepted.size });
                  }
                  setMatches(found);
                });
              }}
            >
              <label className="field">
                Requested replacement size
                <input
                  value={wanted}
                  maxLength={30}
                  onChange={(e) => setWanted(e.target.value)}
                  placeholder={r.stockSize || 'Enter a size'}
                />
              </label>
              <button
                className="button soft"
                disabled={busy || (mode === 'examples' && !wanted.trim())}
              >
                Find accepted stock
              </button>
            </form>
            {matches && (
              <div className="match-results" role="status">
                {matches.length
                  ? matches.map((m, i) => (
                      <a className="inline-link" key={i} href={recordHref(m.item)}>
                        {m.item} · {m.size}
                        <Icon name="upRight" size={14} />
                      </a>
                    ))
                  : 'No matching accepted stock.'}
              </div>
            )}
          </section>
          {mode === 'workshop' &&
            s.service &&
            r.componentSource &&
            s.componentResolvingSet.includes('verified_purchase_date') && (
              <details className="paper-panel fold">
                <summary>
                  Component service <Icon name="down" size={16} />
                </summary>
                <p>{s.service}</p>
                <form
                  className="stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      const result = await api<{ status: string; dueDate?: string }>(
                        endpoint + '/component-service',
                        {
                          scenario,
                          photo: r.componentSource,
                          purchaseDate: date,
                          componentVerified: true,
                        },
                        token,
                      );
                      setNotice(
                        'Component check: ' +
                          result.status.replace(/_/g, ' ') +
                          (result.dueDate ? ' · ' + result.dueDate : '') +
                          '.',
                      );
                    });
                  }}
                >
                  <label className="field">
                    Verified purchase date
                    <input
                      type="date"
                      required
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={verified}
                      onChange={(e) => setVerified(e.target.checked)}
                    />
                    I verified this component and its purchase record.
                  </label>
                  <button
                    className="button soft"
                    disabled={!available || !verified || !date || busy}
                  >
                    Check service date
                  </button>
                </form>
              </details>
            )}
          <details className="paper-panel fold">
            <summary>
              Market context <Icon name="down" size={16} />
            </summary>
            <p>{s.wording}</p>
            {mode === 'workshop' && <p>{s.route}</p>}
          </details>
          {!available && (
            <p className="fine">Open a staff session to save shop terms or record an acceptance.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
