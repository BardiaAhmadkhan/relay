# Operating a Relay workshop

## Connect a shop

Copy `.env.example` to `.env`. Set `RELAY_UPSTREAM` to the existing V4 service origin and `RELAY_UPSTREAM_TOKEN` if that service requires it. The recognition service source ships in this repository. Follow the [recognition and native setup](../platform/README.md) to start it. Each shop supplies its model runtime, private signing key, storage and merchant credentials.

Set `RELAY_STORE_URL` to the shop’s public HTTPS Shopify storefront or localized market path. Use `RELAY_STORE_NAME` for the retailer name shown to riders. The public repository contains sample apparel and artwork. The connector builds a private runtime catalog.

```sh
npm run catalog:sync
npm run build
npm start
```

In the **Shop** section of an inspection, authorized staff set the Canadian resale ratio, acquisition rate and store-credit premium. Blank rates produce a pending valuation. Optional `RELAY_RESALE_GRADE_A` through `RELAY_RESALE_GRADE_D` replace the general resale ratio only when the engine supplied that appearance grade. Enter grade ratios as fractions from 0 to 1. Percentage fields in the interface use whole percentages.

For a shared installation, use HTTPS, a persistent volume and a shop password. The web server requires `RELAY_WEB_PASSWORD` for a network-facing connection to the inspection service. Set `RELAY_HTTPS=1` behind an HTTPS reverse proxy. Keep the underlying V4 service private. The rider gateway uses its own HTTP-only session and a device-held return ticket. Rider access never grants staff privileges. `RELAY_RIDER_STARTS_PER_HOUR` controls new intakes per observed connection address. Existing saved intakes can resume. Personal records and bearer codes belong on devices the rider controls.

## Catalog, values and recommendations

The importer reads the merchant’s crawl rules, product sitemaps and market-specific public product pages. Where a product sitemap is unavailable it pages through the public product index. Each variant retains its current listed price, available status, size, options and product link. A product title can disambiguate an inconsistent retailer category. Rain layers and accessories have separate categories. The importer validates the market currency. Only Canadian-dollar values participate in this release.

Refreshes are shared across requests. A completed catalog stays fresh for six hours. Failed or partial imports preserve the last complete snapshot. Older prices are labeled, and credit issuance waits for a fresh snapshot. After 30 days the old snapshot is excluded from estimates. Product photography comes from the public storefront at runtime. It is never written into this source tree.

An exact new-price reference needs a uniquely matched product, a linked maker and a distinctive model. Otherwise Relay looks for at least three same-category products, preferring the observed material when enough alternatives exist. Each product contributes one median available-variant price. The catalog median is the reference, and the displayed range summarizes the middle of the comparison set. This is an estimate of comparable new gear. It does not establish what the rider originally paid.

Used value is the new-price reference multiplied by the merchant’s resale ratio. The shop’s buy rate sets the acquisition amount. Its credit premium sets the final credit. Each step rounds to cents. The example workspace defaults to a 55% resale ratio, 40% buy rate and 10% premium for illustration. Live workspaces use their own terms. Uncertain or closed inspections never get a commercial offer.

Recommendations use available variants from the same gear category. An entered size must match a listed variant. A contradictory known cut is excluded. Ranking considers verified model, material, maker, riding use, desired fit and how close the price is to the reference. Each suggestion states its reasons, listed price and amount remaining after applicable credit. The retailer confirms final availability and fit.

## Credit and redemption

The SQLite ledger defaults to `.local/trade-in.sqlite`. Set `RELAY_TRADE_DB` to a private persistent location and back up its contents consistently with SQLite. It contains financial receipts and bearer codes. `RELAY_WORKSHOP_ID` identifies the same merchant across upstream server moves. Use an independent ledger for another merchant.

At handover, staff confirm receipt of the physical garment. The server rereads the signed eligibility, current terms, catalog freshness and displayed quote before issuing. Each intake has one credit in its workspace. Its original valuation is retained. Practice and live ledgers have separate scopes.

**In-store counter.** Staff select any available new product and exact variant, enter the actual purchase amount and unique sale reference, and verify the presented code. Relay records the amount to apply to that sale, capped by the purchase and remaining balance. The cashier applies that amount at the till. A retry with the same inputs returns the original deduction. Conflicting reuse of a sale reference is rejected.

**Shopify checkout.** Configure `RELAY_SHOPIFY_ADMIN_DOMAIN` and `RELAY_SHOPIFY_ADMIN_TOKEN` with merchant-authorized gift-card read/write access. The admin domain, primary storefront and currency must match. Relay reserves one code before requesting a Shopify gift card. A retry reconciles the original reservation, including an interrupted response. Shopify is the balance authority for that credit and handles redemption online or at a compatible Shopify POS. Counter-mode credit is never also spendable through Shopify. No Shopify credential is needed to crawl a public catalog. [Shopify gift-card API](https://shopify.dev/docs/api/admin-graphql/latest/mutations/giftCardCreate) · [Shopify product API](https://shopify.dev/docs/api/ajax/reference/product)
