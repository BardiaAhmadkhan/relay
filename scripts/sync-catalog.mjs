import { openLedger, catalogCache } from '../server/trade-service.mjs';
const db = openLedger(process.env);
try {
  const c = await catalogCache(process.env, db).refresh();
  console.log('Catalog refreshed', {
    store: c.origin,
    at: c.updated,
    products: c.products.length,
    variants: c.variantCount,
    currency: c.currency,
  });
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  db.close();
}
