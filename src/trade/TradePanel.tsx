import { useEffect, useRef, useState } from 'react';
import { type RecordData, type Mode } from '../shared/domain';
import { Icon, Alert, Loading } from '../components/ui';
import { read, write } from '../shared/storage';
import type { Preferences } from '../engine/trade-value.mjs';
import {
  dollars,
  getQuote,
  issueExample,
  rememberOwnWallet,
  spendExample,
  ticketKey,
  tradeAPI,
  type Quote,
  type RiderTicket,
  type Wallet,
} from './trade-client';
import { StaffAccess } from '../inspection/Specialist';
import { DecisionStory } from '../inspection/DecisionStory';
import { StoreSelector, type PurchaseItem } from './StoreSelector';
type Staff = { token: string; name: string };
function StorePhoto({ src, title }: { src: string | null; title: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && !failed ? (
    <img
      src={src}
      alt={title}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="store-photo-fallback">
      <Icon name="shop" size={25} />
      Photo at the shop
    </span>
  );
}
export function TradePanel({
  record: r,
  mode,
  scenario,
  staff,
  setStaff,
  demo,
  open,
}: {
  record: RecordData;
  mode: Mode;
  scenario: string;
  staff: Staff;
  setStaff: (s: Staff) => void;
  demo: boolean;
  open: (id: string) => void;
}) {
  const [q, setQ] = useState<Quote | null>(null),
    [prefs, setPrefs] = useState<Preferences>({}),
    [form, setForm] = useState<Preferences>({}),
    [prefsReady, setPrefsReady] = useState(false),
    [edit, setEdit] = useState(false),
    [tick, setTick] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [received, setReceived] = useState(false),
    [sale, setSale] = useState(''),
    [selected, setSelected] = useState<PurchaseItem | null>(null),
    [amount, setAmount] = useState(''),
    [code, setCode] = useState(''),
    [notice, setNotice] = useState('');
  const op = useRef(false);
  const eligible = r.eligible && r.card.outcome === 'keep';
  const id = r.card.id,
    key = ticketKey(mode, id);
  useEffect(() => {
    let on = true;
    setPrefsReady(false);
    read<RiderTicket>(key)
      .catch(() => undefined)
      .then((t) => {
        if (on) {
          const p = t?.prefs ?? {};
          setPrefs(p);
          setForm(p);
          setPrefsReady(true);
        }
      });
    return () => {
      on = false;
    };
  }, [key]);
  useEffect(() => {
    if (!prefsReady || !eligible) return;
    let on = true;
    setError('');
    setRefreshing(true);
    getQuote(r, mode, scenario, prefs, staff.token)
      .then((v) => {
        if (on) {
          setQ(v);
          if (v.wallet?.state === 'issued') void rememberOwnWallet(mode, id).catch(() => {});
        }
      })
      .catch((e) => {
        if (on) setError(e.message);
      })
      .finally(() => {
        if (on) setRefreshing(false);
      });
    return () => {
      on = false;
    };
  }, [id, r.receipt, eligible, mode, scenario, staff.token, prefs, prefsReady, tick]);
  useEffect(() => {
    if (mode !== 'rider' || !eligible) return;
    let active = true,
      running = false;
    async function refresh() {
      if (running || document.hidden) return;
      running = true;
      try {
        const t = await read<RiderTicket>(key);
        if (!t?.claim) return;
        const v = await tradeAPI<{ wallet: Wallet | null }>('balance', { id, claim: t.claim });
        if (active && v.wallet?.state === 'issued') {
          setQ((old) => (old ? { ...old, wallet: v.wallet, creditIssued: true } : old));
        }
      } catch {
        /* The displayed receipt remains available during a connection interruption. */
      } finally {
        running = false;
      }
    }
    const timer = setInterval(() => void refresh(), 15000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [mode, eligible, id, key]);
  if (!eligible) return null;
  async function action(fn: () => Promise<void>) {
    if (op.current) return;
    op.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      op.current = false;
      setBusy(false);
    }
  }
  if (!q)
    return (
      <div className="trade-loading">
        {error ? (
          <Alert>
            {error}{' '}
            <button className="under-button" onClick={() => setTick((t) => t + 1)}>
              Try again
            </button>
          </Alert>
        ) : (
          <Loading label="Checking shop prices and trade-in terms" />
        )}
      </div>
    );
  const quote = q,
    o = q.offer,
    credit = q.wallet,
    practice = q.demo,
    canClerk = mode === 'examples' || !!staff.token;
  async function updateWallet(value: Wallet) {
    setQ({ ...quote, wallet: value, creditIssued: true });
    await rememberOwnWallet(mode, id).catch(() => {});
  }
  const applicableCredit = credit ? credit.remaining : q.creditIssued ? null : o.credit;
  const market = q.illustrated
      ? 'Illustrated shop'
      : q.source
        ? new URL(q.source).hostname
        : 'Shop catalog',
    available = o.recommendations;
  return (
    <div className="trade-result">
      <div className="offer-layout">
        <section className="offer-ticket">
          <div className="ticket-head">
            <div className="section-overline">
              <i />
              {practice ? 'Practice trade-in' : 'Garment trade-in'}
            </div>
            <Icon name="tag" size={30} />
          </div>
          <h2>{credit?.state === 'issued' ? 'Your store credit' : 'Estimated store credit'}</h2>
          <strong className="credit-amount">
            {o.credit === null && !credit ? 'Pending' : dollars(credit?.amount ?? o.credit)}
            <small>{o.credit !== null || credit ? ' CAD' : ''}</small>
          </strong>
          <p>
            {credit?.state === 'issued'
              ? credit.channel === 'shopify'
                ? 'Use your code at the store’s checkout.'
                : 'Present your code at the shop counter.'
              : o.credit !== null
                ? 'The shop issues this credit when you hand over the garment.'
                : o.reason}
          </p>
          <div className="ticket-rule" />
          <div className="ticket-foot">
            <Icon name={credit ? 'check' : 'clock'} size={16} />
            {credit?.state === 'issued'
              ? 'Garment received'
              : q.creditIssued && !credit
                ? 'Trade-in already received'
                : credit?.state === 'pending'
                  ? 'Store confirmation pending'
                  : 'Awaiting trade-in'}
            {practice && <b>Practice only</b>}
          </div>
        </section>
        <section className="price-breakdown">
          <div className="section-overline">Value breakdown</div>
          <h2>How we priced it</h2>
          {o.retail ? (
            <>
              <dl>
                <div>
                  <dt>
                    {o.basis === 'same-model' ? 'New price for this model' : 'Comparable new gear'}
                  </dt>
                  <dd>
                    {o.retail.low === o.retail.high
                      ? dollars(o.retail.mid)
                      : dollars(o.retail.low) + ' – ' + dollars(o.retail.high)}
                  </dd>
                </div>
                <div>
                  <dt>Estimated used value</dt>
                  <dd>{dollars(o.used)}</dd>
                </div>
                <div>
                  <dt>Trade-in credit</dt>
                  <dd>{dollars(o.credit)}</dd>
                </div>
              </dl>
              <p>
                {o.basis === 'same-model'
                  ? 'We found the same identified model in the catalog.'
                  : 'We used the middle listed price of ' +
                    o.comparables.length +
                    ' comparable ' +
                    (r.card.category === 'pants'
                      ? 'pairs of trousers'
                      : r.card.category === 'jacket'
                        ? 'jackets'
                        : 'items of the same type') +
                    '. The original purchase price is unknown.'}
              </p>
              <details>
                <summary>See prices and calculation</summary>
                {q.terms && (
                  <p>
                    New-price reference {dollars(o.retail.mid)}.{' '}
                    {q.gradeRateApplied
                      ? 'The shop’s resale rate for observed condition grade ' +
                        q.grade +
                        ' was used. '
                      : ''}{' '}
                    {q.terms.resaleRatio !== null
                      ? 'The resale rate is ' + Math.round(q.terms.resaleRatio * 100) + '%. '
                      : ''}
                    {q.terms.buyRate !== null
                      ? 'The shop offers ' + Math.round(q.terms.buyRate * 100) + '% of used value. '
                      : ''}
                    {q.terms.creditPremium !== null
                      ? 'Store credit adds ' +
                        Math.round(q.terms.creditPremium * 100) +
                        '% to that offer.'
                      : ''}
                  </p>
                )}
                {o.comparables.map((c, i) => (
                  <div className="comp-line" key={i}>
                    {c.url ? (
                      <a target="_blank" rel="noreferrer" href={c.url}>
                        {c.title}
                      </a>
                    ) : (
                      <span>{c.title}</span>
                    )}
                    <strong>{dollars(c.price)}</strong>
                  </div>
                ))}
              </details>
            </>
          ) : (
            <p>{o.reason}</p>
          )}
          <small>
            {market}
            {q.updated
              ? ' · Checked ' +
                new Date(q.updated).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
              : q.illustrated
                ? ' · Illustrative prices'
                : ''}
            {!q.fresh ? ' · Refresh required for issuance' : ''}
          </small>
        </section>
      </div>
      <details className="trade-reason">
        <summary>Why was this garment accepted?</summary>
        <DecisionStory record={r} open={open} />
      </details>
      <section className="replacement">
        <div className="match-heading">
          <div>
            <div className="section-overline">New gear at the shop</div>
            <h2>Good matches for you</h2>
          </div>
          <button
            className="button soft"
            onClick={() => {
              setForm(prefs);
              setEdit(!edit);
            }}
          >
            <Icon name="sliders" size={16} />
            Your preferences
          </button>
        </div>
        {edit && (
          <form
            className="match-filters"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                const t = (await read<RiderTicket>(key)) ?? {};
                await write(key, { ...t, prefs: form });
                setPrefs({ ...form });
                setEdit(false);
              });
            }}
          >
            <label className="field">
              Desired size
              <input
                value={form.size ?? ''}
                maxLength={24}
                onChange={(e) => setForm({ ...form, size: e.target.value })}
              />
            </label>
            <label className="field">
              Fit
              <select
                value={form.fit ?? 'any'}
                onChange={(e) => setForm({ ...form, fit: e.target.value })}
              >
                <option value="any">Any fit</option>
                <option value="women">Women’s cut</option>
                <option value="men">Men’s cut</option>
              </select>
            </label>
            <label className="field">
              Riding style
              <select
                value={form.riding ?? ''}
                onChange={(e) => setForm({ ...form, riding: e.target.value })}
              >
                <option value="">Any style</option>
                {['commuting', 'touring', 'adventure', 'sport'].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <button className="button primary">Update matches</button>
          </form>
        )}
        {available.length ? (
          <div className="match-grid">
            {available.map((m) => (
              <article key={m.handle}>
                <div className="match-image">
                  <StorePhoto src={m.image} title={m.title} />
                </div>
                <div className="match-copy">
                  <span>{m.reasons.join(' · ')}</span>
                  <h3>{m.title}</h3>
                  <strong>{dollars(m.price)}</strong>
                  {applicableCredit != null && (
                    <p>
                      {dollars(Math.max(0, m.price - applicableCredit))} after{' '}
                      {credit ? 'available' : 'estimated'} credit, before tax
                    </p>
                  )}
                  {m.url ? (
                    <a className="inline-link" href={m.url} target="_blank" rel="noreferrer">
                      View at the shop <Icon name="upRight" size={14} />
                    </a>
                  ) : (
                    <small>Illustrated shop item</small>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="paper-panel">
            <h3>No available match in this selection</h3>
            <p>Change your size or fit preferences to see other new gear.</p>
          </div>
        )}
      </section>
      {credit?.state === 'issued' && (
        <section className="wallet-card">
          <div>
            <div className="section-overline">
              {practice ? 'Practice credit' : 'Store credit receipt'}
            </div>
            <h2>
              {credit.remaining === null
                ? 'Balance at checkout'
                : dollars(credit.remaining) + ' remaining'}
            </h2>
            <p>
              {credit.channel === 'shopify'
                ? 'Enter this gift-card code at checkout.'
                : 'Show this code at the shop counter.'}
            </p>
          </div>
          <div>
            <strong className="voucher-code">{credit.code?.match(/.{1,4}/g)?.join(' ')}</strong>
            <button
              className="under-button"
              onClick={() =>
                void action(async () => {
                  await navigator.clipboard.writeText(credit.code ?? '');
                  setNotice('Credit code copied.');
                })
              }
            >
              Copy code
            </button>
          </div>
        </section>
      )}
      {mode !== 'rider' && (
        <section className="counter-tools">
          <details>
            <summary>
              <span>
                <Icon name="shop" size={18} />
                Shop counter
              </span>
              <Icon name="down" size={16} />
            </summary>
            <div>
              {mode === 'workshop' && (
                <StaffAccess
                  name={staff.name}
                  token={staff.token}
                  demo={demo}
                  onToken={(token, name) => setStaff({ token, name })}
                />
              )}
              {(!q.creditIssued || credit?.state === 'pending') && o.credit !== null && (
                <form
                  className="stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(async () => {
                      const value =
                        mode === 'examples'
                          ? await issueExample(id, o.credit!)
                          : (
                              await tradeAPI<{ wallet: Wallet }>(
                                'issue',
                                { id, scenario, receipt: q.receipt, quote: q.quote, received },
                                staff.token,
                              )
                            ).wallet;
                      await updateWallet(value);
                      setNotice('Trade-in recorded.');
                    });
                  }}
                >
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={received}
                      onChange={(e) => setReceived(e.target.checked)}
                    />
                    I have received this garment from the rider.
                  </label>
                  <button
                    className="button primary"
                    disabled={!canClerk || !q.fresh || !received || busy || refreshing}
                  >
                    {credit
                      ? 'Confirm reserved credit'
                      : practice
                        ? 'Issue practice credit'
                        : 'Issue store credit'}
                  </button>
                </form>
              )}
              {credit?.state === 'issued' && credit.channel === 'counter' && (
                <form
                  className="stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(async () => {
                      if (!selected) throw Error('Choose a new product.');
                      const value = Math.round(Number(amount) * 100);
                      if (!Number.isSafeInteger(value) || value <= 0 || value > selected.price)
                        throw Error('Enter a valid purchase amount up to the listed price.');
                      if (
                        code.replace(/[ -]/g, '').toUpperCase() !==
                        credit.code?.replace(/[ -]/g, '').toUpperCase()
                      )
                        throw Error('The code does not match this credit.');
                      const outcome =
                        mode === 'examples'
                          ? await spendExample(id, value, sale, selected.variant)
                          : (
                              await tradeAPI<{ wallet: Wallet }>(
                                'redeem',
                                {
                                  id,
                                  scenario,
                                  code,
                                  sale,
                                  variant: selected.variant,
                                  amount: value,
                                },
                                staff.token,
                              )
                            ).wallet;
                      await updateWallet(outcome);
                      setNotice(
                        'Sale recorded. Remaining credit ' + dollars(outcome.remaining) + '.',
                      );
                    });
                  }}
                >
                  <h3>Apply credit to a purchase</h3>
                  <StoreSelector
                    mode={mode}
                    onSelect={(v) => {
                      setSelected(v);
                      setAmount(v ? (v.price / 100).toFixed(2) : '');
                    }}
                  />
                  <label className="field">
                    Purchase amount before tax (CAD)
                    <input
                      type="number"
                      min=".01"
                      step=".01"
                      max={selected ? selected.price / 100 : undefined}
                      required
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    Store sale reference
                    <input
                      value={sale}
                      required
                      minLength={2}
                      maxLength={80}
                      onChange={(e) => setSale(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    Presented credit code
                    <input value={code} required onChange={(e) => setCode(e.target.value)} />
                  </label>
                  <button
                    className="button primary"
                    disabled={!canClerk || busy || !selected || !credit.remaining}
                  >
                    Apply credit
                  </button>
                </form>
              )}
              {!credit && o.credit === null && (
                <p>Set the shop’s Canadian trade-in rates in the Shop tab to calculate an offer.</p>
              )}
            </div>
          </details>
        </section>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <Alert>
          {error} <button onClick={() => setTick((t) => t + 1)}>Refresh offer</button>
        </Alert>
      )}
    </div>
  );
}
