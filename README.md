# Relay

Relay helps a rider trade in used motorcycle clothing. It guides four photographs, explains which evidence supports the shop’s decision, and shows how an eligible garment’s estimated value translates into store credit. Staff issue credit when they receive the garment.

## Try it locally

Use Node.js 22.13 or later and npm.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. The example workspace includes six fictional garments, original illustrations, and practice credit. It runs without credentials, a catalog connection, or a model download.

- Open the **Meridian Café Jacket** to see why a seam needs a closer look and inspect the marked photograph.
- Open the **Fieldway Touring Jacket** to see comparable prices, estimated used value and trade-in credit.
- Start a personal intake to try the camera or upload flow. An affirmative crash, protective-area damage or repair history immediately closes the offer. Other new example intakes wait for human review.

## Rider and workshop workflows

A rider chooses the garment type and answers one history question. Optional size, cut and riding preferences guide replacement suggestions. The camera or upload path collects the front, back, attached label and open inside. A fifth close-up is optional. Drafts survive refresh. The browser strips image metadata before submitting a photo or its label crop.

The result explains the decision, the supporting evidence, what is still uncertain and the next useful action. Riders can open the original photograph from the explanation. A trade-in inspection cannot certify protective performance.

| Workspace             | Access and behavior                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `?workspace=examples` | Illustrated garments, device-local drafts and practice credit.                                                                        |
| `?workspace=rider`    | An enabled rider desk exposes the rider’s own inspections and receipts. A bearer credit code can restore a balance on another device. |
| `?workspace=workshop` | Authorized shop staff review evidence, set merchant rates, confirm handover and record redemption.                                    |

Shop pricing uses available Canadian-dollar variants and merchant-supplied rates. Relay separates the price of comparable new gear from estimated used value and the proposed credit. A complete quote is checked again at physical handover. The storefront connector and finance ledger run on the server. See the [workshop setup and operations guide](docs/shop-operations.md).

## Repository layout

| Directory                                         | Contents                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `platform/`                                       | Recognition engine, signed inspection desk, native applications, deployment source and reproducible studies. [Run the platform](platform/README.md). |
| `src/intake/`                                     | Rider questions, guided camera and upload preparation.                                   |
| `src/inspection/`                                 | Notebook, decisions, specialist review and photographic evidence viewer.                 |
| `src/trade/`                                      | Recommendations, valuations, wallet and shop counter.                                    |
| `src/engine/`                                     | Shared evidence, price and eligibility-presentation rules.                               |
| `src/shared/`, `src/components/`, `src/examples/` | Application contracts, clients, device storage, shared controls and illustrated records. |
| `server/`                                         | Production web host, workshop and rider gateways, catalog and credit services.           |
| `public/`, `notices/`                             | Distributable artwork, fonts, source information and third-party license notices.        |
| `scripts/`, `tests/`                              | Catalog refresh, release checks and automated tests.                                     |

## Build and verify

```sh
npm run verify
npm start
```

Verification runs the tests, TypeScript check, production build, asset and server smoke checks, and the Git-content audit. The default production listener is `http://127.0.0.1:4188`. The illustrated app can also be served from `dist/` at a static host’s root or under a directory. Hash routes restore individual screens on refresh.

To repeat the browser checks locally after building:

```sh
npx playwright install chromium webkit
npm run test:browser -- chromium
npm run test:browser -- webkit
```

The web app, workshop gateway, recognition service and native clients are part of this release. The public source includes original illustrative gear, reviewed fonts and individually attributed reference photography. Private workshop photos, participant or organizer material, receipts, credentials, model caches and scraped catalog snapshots belong outside the published tree. The [asset manifest](notices/assets.json) records web asset provenance. The [platform inventory](notices/platform.json) and [photo credits](platform/assets/fixtures/ATTRIBUTION.md) cover native artwork, historical experiments and licensed examples.
