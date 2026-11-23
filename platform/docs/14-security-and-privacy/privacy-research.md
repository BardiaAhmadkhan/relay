# Privacy research and practical controls

Research checkpoint: 2026-10-26. This document translates Canadian privacy sources into proposed engineering controls for an experimental mobile intake app. It does not certify legal compliance. The production operator, processing contracts, actual data flows, retention purposes and event dataset terms remain unconfirmed.

## Applicable framework: assess the actual operation

BC's Personal Information Protection Act (PIPA) covers organizations, subject to its exceptions, and personal information about identifiable individuals. It requires organizational accountability, appropriate purposes, consent or another authorized basis, safeguards, and access/correction arrangements. A jacket-only photograph may be impersonal; an identifiable rider, name label, home interior or linked intake history can change the analysis. The latter examples are our application-specific inference. [BC PIPA, sections 1–11, 23–24 and 34](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/03063_01)

BC's substantially similar private-sector legislation does not make federal law irrelevant. The OPC explains that PIPEDA applies to personal information crossing provincial or national borders in commercial activities and to federally regulated businesses. Determine the actual operator, activity and transfer before selecting obligations. Do not claim either that PIPEDA never applies in BC or that every photo automatically falls under both statutes. [OPC summary of Canadian privacy laws](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/02_05_d_15/)

The preparation app should use owned, consented or appropriately licensed test material. "Hackathon" and "research" are not automatic exemptions. Event participant permission, image copyright/licensing, consent from identifiable people, permission for external processing and reuse in a public demonstration are separate questions.

## Data map and proposed minimization

The choices below are proposed product defaults. Each must match implementation before being represented as a promise to users.

| Data | Why it could be needed | Proposed experimental handling | Production decision still needed |
| --- | --- | --- | --- |
| Gear photos | Visible identification/condition observations | User-selected images only; strip metadata after decoding; keep outside source control | Storage region, encryption, retention and authorized reviewer access |
| Photo metadata | Orientation and technical decoding | Normalize orientation; discard GPS, device identifiers and unnecessary timestamps | Verify metadata removal on iOS and Android, including library imports |
| Brand/model/size/standards text | Item identification | Extract only relevant fields; preserve uncertainty | Avoid retaining unrelated names/contact details found in labels |
| Crash/damage/repair declarations | Required screening | Minimal categorical answers; no injury story requested | Decision record retention and correction procedure |
| Free text | Explain an unusual item or correction | Optional, bounded length, no request for medical or financial details | Redaction and authorized access |
| Identity/contact details | Only needed for a real follow-up | No account/contact collection for local preparation flow | Named operator, follow-up consent and contact retention |
| Session identifiers | Join one case to its images | Random opaque identifiers; no advertising ID | Authentication, cross-device access and expiry |
| Model input/output | Analysis and reproducibility | Minimized image payload and structured observations; no raw content in ordinary logs | Provider retention, training use, subprocessors and deletion limits |
| Operational telemetry | Reliability and cost measurement | Durations, byte counts, status codes and token usage; no image/base64/prompt logging | Retention, access, privacy notice and aggregation |
| Expert decision | Explain a real review | Do not fabricate a reviewer or delivery status | Identity/authority, access control, appeal and retention |

Camera permission is an OS access permission. It is not a complete explanation of collection, cloud use or retention. Canadian mobile-app guidance recommends limited collection and contextual notice, and discusses third-party SDK risks. [Joint mobile-app privacy guidance](https://www.priv.gc.ca/en/privacy-topics/technology/mobile-and-digital-devices/mobile-apps/gd_app_201210/)

Design implications: no background camera, no microphone request for still photographs, no location permission, no contact-book access, no automatic gallery scan, no advertising SDK, and no hidden upload on image selection. These are deliberate scope choices, not claims that every such permission is universally unlawful.

## Consent at the actual decision point

The joint Canadian consent guidance emphasizes understandable information about collection, recipients, purposes and consequences; optional secondary uses need an accessible choice. It supports layered, contextual notices and consent that can be revisited. [Meaningful-consent guidance](https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/appropriate-handling-of-personal-information/collecting-personal-information-and-consent/consent/gl_omc_201805/)

Proposed UI flow:

1. Before camera access: explain that the camera is used to photograph the selected item; provide an image-picker alternative.
2. Before an external analysis: name the configured service, state what leaves the device, describe the purpose, and link to provider/retention details. If the provider is not configured, show an honest unavailable state.
3. Allow review/removal of selected images before upload. Encourage framing the item without people, addresses or personal documents.
4. Keep privacy information available from capture and results. Do not bundle optional research/marketing/data reuse into the required screening agreement.
5. For a public demo, use dedicated approved fixtures. Permission to assess an item is not permission to project somebody's household or personal history onto a screen.

Draft language must be generated from actual configuration. Do not say "photos never leave your phone" when cloud analysis is enabled, "deleted immediately" when a provider retains abuse logs, or "not used for training" without a verified applicable provider term. A synthetic/demo session needs a visible mode label, but that label does not excuse undisclosed uploads.

## Cloud processing and vendor checks

Outsourcing does not transfer accountability. OPC cloud guidance calls for reviewing contractual use, access, safeguards, deletion/exit provisions and potential secondary purposes. A provider's general terms are not evidence that all intended processing is acceptable. [Joint cloud-computing guidance](https://www.priv.gc.ca/en/privacy-topics/technology/gd_cc_201206/)

OPC's September 2026 outsourcing guidance explains that PIPEDA permits outsourcing while requiring protection and clear information about foreign processing and possible foreign-authority access. It does not create a blanket Canadian-storage mandate. [Privacy and outsourcing for businesses](https://www.priv.gc.ca/en/privacy-topics/employers-and-employees/outsourcing/02_05_d_57_os_01/)

Before enabling a provider for identifiable real-user content, record:

| Check | Review evidence |
| --- | --- |
| Contracting party and service tier | Applicable agreement and API product; do not substitute consumer-chat terms |
| Processing locations | Region options, cross-border routing, backups and subprocessors |
| Retention | Request/response retention, abuse monitoring, logs, opt-outs and exceptions |
| Secondary use | Training and product-improvement terms for this account/service |
| Access and security | Authentication, staff access, encryption and relevant attestations |
| Deletion and exit | What can actually be deleted, through which mechanism, by when, and with what exceptions |
| Incidents | Notification terms, response contact, evidence preservation and subcontractor handling |
| Event data | Whether the organizer permits this exact processor and public demo use |

The OPC's [third-party assessment guidance](https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/appropriate-handling-of-personal-information/gd_third-party_202609/) is a useful due-diligence checklist, but the inspected page invites comments through 4 December 2026. Treat it as current guidance open to revision, not a new standalone statute.

## Retention: avoid an inaccurate deletion promise

PIPA section 35 requires at least one year's retention when personal information is used to make a decision directly affecting an individual; it otherwise requires destruction or de-identification when the purpose and legal/business need end. Whether a particular preliminary intake result triggers the decision provision depends on the actual operation. [BC PIPA, section 35](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/03063_01)

Separate three environments:

- **Development fixtures:** approved nonpersonal or consented test records; retain only for a documented evaluation purpose, licence and consent scope.
- **Experimental local session:** no real business decision or cloud persistence should be implied. Clear owned temporary captures on explicit reset/expiry according to verified implementation. OS camera-roll originals and provider copies, if any, are separate.
- **Production intake:** define decision evidence, raw-image necessity, abandoned-intake expiry, access requests, correction history and legal holds before deployment. Keep any retained record access-restricted and explain the retention basis.

Do not implement one unconditional "delete everything" promise across all three. Also do not retain every raw photo forever merely because a deterministic result exists. A privacy lead should determine which evidence must be retained and why. Technical cleanup tests must cover derived thumbnails, cached files, retry queues, exports and provider limitations, not only the primary database row.

## AI-specific privacy and fairness

Canadian regulators' generative-AI principles address legal authority, minimization, explainability, safeguards, access/correction and accountable human review. They also recognize that inferences about an identifiable person can themselves be personal information. [Joint generative-AI principles](https://www.priv.gc.ca/en/privacy-topics/technology/artificial-intelligence/gd_principles_ai/)

For this app, the useful inference concerns the item, not the person. Instruct the extractor to ignore identity, age, ethnicity, health, presumed income and household circumstances. Do not estimate honesty, ownership legitimacy or purchasing power from the rider or background. Brand recognition must not become an assessment of the person's financial status.

Keep generated item concerns distinct from disclosures. A false assertion that a named person crashed or repaired gear could matter beyond the immediate screen. Support correction and a human route. Store only the evidence required to explain a decision; chain-of-thought or speculative narrative is neither required nor appropriate as a user record.

## Proposed security controls and verification

These are implementation acceptance targets, not claims already verified by this document.

| Risk | Control to implement | Verification |
| --- | --- | --- |
| API key exposed in app bundle | Provider calls through a controlled backend; server-only secret | Inspect built JS/native config and logs for secrets |
| Unauthorized case access | Authenticate production sessions; enforce per-case ownership/assessor role | Cross-session and cross-case access tests |
| Publicly reachable development API | Bind safely or require a demo token; narrow allowed clients | Unauthenticated requests rejected where intended |
| Malicious/oversized image | Decode and validate supported formats, byte/pixel limits and count | Corrupt files, wrong MIME, decompression extremes and excessive images |
| SSRF through image URLs | Accept uploaded bytes or controlled object keys, not arbitrary fetch URLs | Internal/loopback URL input rejected |
| Prompt injection in labels | Treat image text as data; no model tools; strict schema; deterministic policy | "Ignore previous instructions" label cannot alter eligibility |
| Unnecessary personal content | Local preview/crop and metadata removal; short prompt fields | EXIF/GPS and stray-text fixtures |
| Raw data in logs | Allowlist operational fields; redact errors and payloads | Search server/test logs after success and failure |
| Stale result after correction | Version cases/requests and discard superseded responses | Change disclosure/image during an in-flight request |
| Accidental real-data demo | Dedicated fixtures and visible mode indication | Demo walkthrough from a clean session |
| Unbounded inference spend | Count/size limits, rate limits, request budget and cancellation | Burst, timeout and retry tests |
| False delivery confirmation | Only show receipt after a real authorized handoff | Network failure and unavailable-reviewer states |

If there is a suspected privacy incident: stop the affected processing; preserve only necessary incident evidence with restricted access; identify records/people/providers affected; contain exposure; have the accountable organization assess applicable notice/reporting obligations; document corrective action. This is an operational sequence, not a complete jurisdictional breach-notification opinion.

## Production decisions still open

The operating entity and privacy contact; dataset permissions; user population; processor agreements; hosting regions; authentication/reviewer model; decision-record retention; access/correction/deletion procedure; incident handling; and public-demo permissions require concrete decisions before real customer use. Experimental code and a source-backed research memo do not resolve those facts.

Recheck law and provider terms before an event or production launch. The precise BC statutory page inspected says current to 20 October 2026. All web sources were accessed on 26 October 2026; dates and limits are recorded in domain-sources.json.
