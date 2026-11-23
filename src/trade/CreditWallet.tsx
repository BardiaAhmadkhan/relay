import { useEffect, useState } from 'react';
import { recordHref, type Mode } from '../shared/domain';
import { read, write } from '../shared/storage';
import {
  dollars,
  tradeAPI,
  ticketKey,
  rememberWallet,
  type Wallet,
  type RiderTicket,
} from './trade-client';
import { Icon, Loading, Alert } from '../components/ui';
type Entry = { item: string; wallet: Wallet; practice: boolean; owned?: boolean };
export function CreditWallet({ mode }: { mode: Mode }) {
  const [entries, setEntries] = useState<Entry[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [code, setCode] = useState(''),
    [tick, setTick] = useState(0),
    [adding, setAdding] = useState(false);
  useEffect(() => {
    if (mode === 'examples') return;
    const refresh = () => {
      if (!document.hidden) setTick((x) => x + 1);
    };
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [mode]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setEntries([]);
    (async () => {
      const ids = (await read<string[]>('wallet-items:' + mode)) ?? [];
      const rows: Entry[] = [];
      let failed = false;
      for (const id of ids) {
        try {
          if (mode === 'examples') {
            const w = await read<Wallet>('example-credit:' + id);
            if (w) rows.push({ item: id, wallet: w, practice: true });
            continue;
          }
          const t = await read<RiderTicket>(ticketKey(mode, id)),
            saved = await read<string>('voucher:' + id);
          const v = await tradeAPI<Entry>(
            'balance',
            saved ? { code: saved } : { id, claim: t?.claim },
          );
          if (v.wallet?.state === 'issued') rows.push({ ...v, owned: !!t?.claim });
        } catch {
          failed = true;
        }
      }
      if (active) {
        setEntries(rows);
        if (failed) setError('One or more balances could not be refreshed.');
      }
    })()
      .catch(() => {
        if (active) setError('This browser could not open its saved credits.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, tick]);
  return (
    <article className="wallet-page">
      <div className="section-overline">
        <Icon name="tag" size={16} />
        Trade-in receipts
      </div>
      <h1>My store credit</h1>
      <p>Credit becomes available when the shop receives your eligible garment.</p>
      {loading ? (
        <Loading label="Checking your credits" />
      ) : entries.length ? (
        <div className="saved-credits">
          {entries.map(({ item, wallet: w, practice, owned }) => (
            <section key={item} className="wallet-card">
              <div>
                <div className="section-overline">
                  {practice ? 'Practice credit' : 'Store credit'}
                </div>
                <h2>
                  {w.remaining === null ? 'Check at checkout' : dollars(w.remaining) + ' available'}
                </h2>
                <p>
                  {w.channel === 'shopify'
                    ? 'Use at the store checkout.'
                    : 'Present at the shop counter.'}
                </p>
              </div>
              <div>
                <strong className="voucher-code">{w.code?.match(/.{1,4}/g)?.join(' ')}</strong>
                {(mode !== 'rider' || owned) && (
                  <a className="under-button" href={recordHref(item, 'trade')}>
                    View inspection <Icon name="arrow" size={15} />
                  </a>
                )}
              </div>
            </section>
          ))}
        </div>
      ) : (
        !error && (
          <section className="wallet-empty">
            <Icon name="tag" size={32} />
            <div>
              <h2>No credit issued yet</h2>
              <p>Start a trade-in to have your riding gear assessed.</p>
              <a className="button primary" href="#/intake">
                Start a trade-in
                <Icon name="arrow" />
              </a>
            </div>
          </section>
        )
      )}
      {mode !== 'examples' && (
        <form
          className="wallet-lookup"
          onSubmit={async (e) => {
            e.preventDefault();
            if (adding) return;
            setAdding(true);
            setError('');
            try {
              const v = await tradeAPI<Entry>('balance', { code: code.trim() });
              await write('voucher:' + v.item, code.trim());
              await rememberWallet(mode, v.item);
              setCode('');
              setTick((x) => x + 1);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setAdding(false);
            }
          }}
        >
          <label className="field">
            Have a code from the counter?
            <input
              autoComplete="off"
              value={code}
              maxLength={40}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Enter your credit code"
            />
          </label>
          <button className="button soft" disabled={adding || code.trim().length < 16}>
            Add my credit
          </button>
        </form>
      )}
      {error && (
        <Alert>
          {error} <button onClick={() => setTick((x) => x + 1)}>Refresh</button>
        </Alert>
      )}
    </article>
  );
}
