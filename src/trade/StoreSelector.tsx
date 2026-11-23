import { useEffect, useState } from 'react';
import type { Catalog, CatalogProduct } from '../engine/trade-value.mjs';
import { currentCatalog, exampleCatalog, dollars } from './trade-client';
import type { Mode } from '../shared/domain';
import { Alert } from '../components/ui';
export type PurchaseItem = { variant: string; price: number };
export function StoreSelector({
  mode,
  onSelect,
}: {
  mode: Mode;
  onSelect: (v: PurchaseItem | null) => void;
}) {
  const [c, setCatalog] = useState<Catalog | null>(null),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0),
    [search, setSearch] = useState(''),
    [handle, setHandle] = useState(''),
    [variant, setVariant] = useState('');
  useEffect(() => {
    let active = true;
    (mode === 'examples' ? exampleCatalog() : currentCatalog())
      .then((v) => {
        if (active) {
          setCatalog(v);
          setError('');
        }
      })
      .catch(() => {
        if (active) setError('Could not open the store catalog.');
      });
    return () => {
      active = false;
    };
  }, [mode, retry]);
  const products = (c?.products ?? []).filter(
    (p) =>
      p.variants.some((x) => x.available && x.price > 0) &&
      (p.title + ' ' + p.brand).toLowerCase().includes(search.trim().toLowerCase()),
  );
  const p = products.find((x) => x.handle === handle);
  function choose(product: CatalogProduct | undefined) {
    setHandle(product?.handle ?? '');
    const vars = product?.variants.filter((x) => x.available && x.price > 0) ?? [];
    const v = vars.length === 1 ? vars[0] : undefined;
    setVariant(v?.id ?? '');
    onSelect(v ? { variant: v.id, price: v.price } : null);
  }
  return (
    <>
      <label className="field">
        Find a new store item
        <input
          type="search"
          placeholder="Search the full catalog"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            choose(undefined);
          }}
        />
      </label>
      <label className="field">
        New store item
        <select
          aria-label="New store item"
          required
          value={handle}
          onChange={(e) => choose(products.find((p) => p.handle === e.target.value))}
        >
          <option value="">
            {c
              ? products.length
                ? 'Choose a product'
                : 'No available products match'
              : 'Loading the catalog…'}
          </option>
          {products.map((p) => (
            <option value={p.handle} key={p.handle}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
      {p && (
        <label className="field">
          Store variant
          <select
            aria-label="Store variant"
            required
            value={variant}
            onChange={(e) => {
              setVariant(e.target.value);
              const v = p.variants.find((v) => v.id === e.target.value);
              onSelect(v ? { variant: v.id, price: v.price } : null);
            }}
          >
            <option value="">Choose size and option</option>
            {p.variants
              .filter((v) => v.available && v.price > 0)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {[
                    'title' in v ? String(v.title) : '',
                    [v.size, v.length].filter(Boolean).join(' / '),
                    dollars(v.price),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </option>
              ))}
          </select>
        </label>
      )}
      {error && (
        <Alert>
          {error}{' '}
          <button type="button" onClick={() => setRetry((x) => x + 1)}>
            Try again
          </button>
        </Alert>
      )}
    </>
  );
}
