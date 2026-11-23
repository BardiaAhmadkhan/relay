# Relay V4: the complete system

Relay never guarantees or certifies protective performance. Every indicator, protection status and replacement suggestion carries the line "Based on what we can see and what the label and maker state. Not a test or guarantee of protective performance." Fibres come only from what labels state.

The implementation and design use three status levels.

- **● running:** implemented in the inspection workspace.
- **◐ partial:** a first version runs; the full design is not finished.
- **○ designed:** specified, needs further development.

This page is the whole vision. Today's working version is the part marked ●.

## 1 · Capture: the rider does almost nothing

| Mechanism | What it does | Status |
|---|---|---|
| Decision-driven capture | A photo is requested only if it could change the outcome, and the app says which outcome it would change | ◐ partial |
| Full-resolution regions on the phone | One wide photo yields the garment context, the label and the close-up regions from the original pixels, before anything is shrunk | ● running |
| Privacy on the device | Location and device metadata are stripped before upload, and the outgoing bytes are checked | ● running |
| One history tap | "Crash, or damage or repair in an impact area? Yes / No / Not sure." The country comes from the account | ◐ partial (history tap running; country set in the app) |

## 2 · Evidence: many checks, each with a measured error rate

| Check | What it does | Status |
|---|---|---|
| Visible-damage checks | V3.5's calibrated exterior questions: damage, repair, road contact | ● running |
| Label reader | Maker, model, size, class, standard edition, production code and stated fibres. A local model, plus a cloud reader for ambiguous fields on explicitly authorised routes | ● running |
| Identity check | Two garment identities on one item is a conflict | ● running |
| Evidence binding | Staff custody, a crop from one parent frame, or a geometric chain. Colour can refute but never confirm | ◐ partial |
| Zone inspection, inside and out | Each impact zone at native resolution, looking for holes, tears and repairs in protective areas (offer exclusions) | ◐ partial |
| Crash-pattern check | Same-side marks on shoulder, elbow, hip and knee indicate a slide; even marks on both sides indicate normal wear. Feeds the crash exclusion and the specialist | ◐ partial |
| Wear indicators | Fading measured against unexposed fabric in the same photo, pilling, thinning, shine and fraying. They set the resale grade and price, and can trigger a replacement suggestion, with the disclosure line | ◐ partial |
| Consistency network | Class against the standard part printed, armour-only CE misread as a garment class, dates against editions. Each mismatch is a disclosure flag | ◐ partial |

## 3 · Disclosure and knowledge: what can truthfully be said

| Mechanism | What it does | Status |
|---|---|---|
| Protection disclosure | "The label states …": class, standard and edition, scope (garment or armour only), production code. Built from bound labels only. It always adds: "Relay reads what the label states. It does not test or assess protective performance" | ● running |
| Maker statements | Service lives and replace-after-crash guidance, quoted and attributed, for the right component | ◐ partial |
| Knowledge packs | Standards, maker statements, brands, shipping lanes and duty lines. Every fact has a source, an access date and a validity window | ◐ partial |
| Pack fingerprints in every receipt | Every decision records exactly which knowledge it used | ● running |
| Re-evaluation when facts change | A recall or a corrected fact lists every affected garment | ◐ partial (re-check command running on named facts) |
| Regulatory sentinel | Watches official sources (EU law and standards lists, GOV.UK, customs tariffs, postal rates, recall feeds in four jurisdictions, maker statements), feeds first and polite crawling where no feed exists. It detects changes to the exact clause or row Relay relies on, drafts the update, and gets human sign-off for anything with legal weight. It then versions the rule and lists every affected garment, offer and rider | ◐ partial (three sources watched; no scheduler or automatic promotion) |
| Freshness limits, failing closed | Every rule has a freshness limit. A stale or unreviewed rule is never used silently: the decisions that depend on it show "rule update pending verification", or go to the specialist | ◐ partial (freshness limits on the watched sources) |
| Research queue for unknown models | The first rider of an unknown model triggers research and review; every later rider gets it at no cost | ○ designed |

## 4 · Decisions: offer eligibility, only when the evidence settles it

| Mechanism | What it does | Status |
|---|---|---|
| Hard exclusions | A crash, or damage or repair in a protective area, means no offer. No model can override this | ● running |
| Robust decisions | Act only when every admissible state of the evidence gives the same answer; otherwise name the cheapest resolving evidence | ● running |
| Five outcomes | Eligible for an offer (with the disclosure); no offer (with the exclusion found and any maker replace-after-crash guidance); replacement suggested (evidence indicators, with the disclosure line); one more piece of evidence needed; a specialist will review it | ● running |
| Competing explanations and the next useful observation | Each open finding keeps its competing explanations, for example "repair in a protective area (no offer)" or "original construction". Relay picks the one action that best separates them, by measured or conservatively bounded resolution rates and the rider's effort, within a one-request limit. If no single action is likely to settle it, it goes straight to the specialist. Evaluated as cases resolved per request | ◐ partial (alternatives and one useful photo; response rates unmeasured) |
| Counterfactuals for the specialist | "If this were confirmed, the outcome would be …" | ◐ partial |
| Sealed, signed receipts | The inspection is sealed before any money is looked at | ● running |

*Research foundation for choosing the next observation:* EC², Golovin, Krause and Ray, NIPS 2010 ([paper](https://papers.nips.cc/paper_files/paper/2010/hash/1e6e0a04d20f50967c64dac2d639a577-Abstract.html)); Decision Region Determination, Javdani et al., AISTATS 2014 ([paper](https://proceedings.mlr.press/v33/javdani14.html)). Their guarantees depend on their own models and are not claimed for Relay. How often each requested view settles a case is still to be measured with riders and staff.

## 5 · Commerce: money without touching the inspection

| Mechanism | What it does | Status |
|---|---|---|
| Firewall | Changing a price, coupon or the stock leaves the inspection receipt byte-identical | ● running |
| Break-even floors | From the shop's terms, freight, duty, handling and cosmetic grade. Missing inputs are named, never invented | ● running |
| Lane economics per lot | Published postage and duty by country. The Philippines lot: keep it local | ◐ partial |
| Replacement suggestions and maker-guided sales | Evidence indicators, a maker's stated service life (Knox: protectors every 5 years) or replace-after-crash guidance become trade-in credit toward a replacement, or a protector sale | ◐ partial |
| Signed staff acceptance, then stock, then a replacement match | Matched on the size and type already read from the rider's label | ● running |
| Consignment versus purchase | Uncertain high-value items carry no inventory risk | ◐ partial |

## 6 · People: rider, specialist, shop

| View | What it shows | Status |
|---|---|---|
| Rider | Their own photos as evidence, the disclosure, one of five outcomes, at most one request | ● running |
| Specialist | Why the item is open, the cheapest resolving evidence, corrections that supersede with an audit trail | ● running |
| Shop | Economics, the disclosure, comparables, acceptance, the firewall check | ● running |

## 7 · Growth: wider and more decisive, without training any model

| Mechanism | What it does | Status |
|---|---|---|
| Measured error rates | Each specialist correction measures how often each check is right, so fewer items need a question. No model is trained or fine-tuned | ◐ partial |
| Country packs | CA, US, DE/EU, GB and PH as data: disclosure wording, currency, lanes, duty and standards meaning | ◐ partial (CA, US, DE, GB, PH switch; GB postage not yet priced) |
| Partner-shop network | Routes riders and items between shops, with fees | ○ designed |
| Lifecycle record | Dated components bring riders back when a maker's stated service date arrives or a recall is issued. The shop sees coming replacement demand | ◐ partial (component reminder only) |
| Hybrid protection | Routing registry, contract tests, graceful fallback, swappable cloud reader | ◐ partial |

**One sentence for the judges:** "What you saw running is the core of this system, on your own photos. The rest is designed to this level of detail and is the next stage of development."
