# Relay V3.5 production hosting and cost measurement

**Hosting study, 19 November 2026.** The design uses an authenticated HTTPS scoring service and a separately metered GPU worker. The prices below are historical estimates. Measure a cold and warm intake on the selected hardware before using them as a shop budget. [Operations guide](relay-v35-event.md) · [Activation study](../research/release-35/v35-activation-results.md)

## Price per photograph

| Path | Incremental provider cost in USD |
| --- | --- |
| Ordinary photo on the current laptop | **$0 in hosting and API fees.** The owner supplies the laptop, local network and electricity. |
| Laptop photo with a disputed boot or glove count | **About $0.00386 (0.386 cents)** for the extra OpenAI check. This is the observed average of 14 real calls at standard uncached rates. |
| Future 16 GB Flex worker | $0.58 per billed GPU-hour. **10 billed seconds cost $0.00161**, 20 seconds $0.00322 and 40 seconds $0.00644. Add the CPU API, disk and any optional count check. |
| Future cloud photo using 20 billed seconds and OpenAI | About **$0.00708 (0.71 cents)** before the shared API and storage. Actual cloud billing is unmeasured. |

The 14 calls used 19,675 input and 1,463 output tokens, or $0.053980 at $2 and $10 per million respectively. The 4B makes most decisions on its own. The historical 10/363 routing fraction came from a one-photo convenience sample. At a hypothetical 3% routing rate, the average OpenAI component would be about $0.000116 per submitted photo. The event’s observed rate should replace that assumption. [OpenAI rates](https://developers.openai.com/api/docs/models/gpt-6.2-sol) · [Original evaluation](../research/release-35/release-notes-v3.5.md)

The first split-host test measured 2.838 s for a front, 3.701 s for a back and 1.165 s for a label on the warm laptop. These local wall times establish what the engine did. RunPod’s invoice also includes worker initialization and the time a worker waits after the last request. A repeated cache hit can require no GPU request. Local split measurements · [RunPod billing rules](https://docs.runpod.io/serverless/pricing)

## Production design for future authorization

| Role | Responsibilities and data |
| --- | --- |
| Authenticated CPU API | Mobile HTTPS connection, image preparation and focus checks, photo cache, signing, policy, optional OpenAI count, shop review and intake metering. A single local persistent block volume stores SQLite. The CPU stays available when the GPU scales to zero. |
| Private GPU worker | Receives the exact 512/1600 JPEGs, view and ordered question keys. Executes the existing planner with the original text weights and projector. No rider history, signing key, OpenAI key or billing authority is required. |
| Optional OpenAI reader | The CPU independently verifies the original photo hash and count gate. Only the disputed overview can leave Relay. A strict count response can change the count decision. The eight-second deadline, 1,024 output token limit and `store: false` remain in force. |
| Read-only billing | Queries the CPU Pod and Serverless endpoint for a specific UTC-hour window and reconciles provider totals. Optional intake metering deduplicates assessment and fallback retries with a keyed opaque identifier. |

Startup, health, a disclosed crash, signed receipt reuse and a repeated photo issued zero GPU calls in the split test. The three unique photos issued three GPU requests and reproduced all 18 returned answers, quality records and feedback. This establishes software equivalence on the tested laptop. Cloud hardware, real internet latency and cloud charges still require their own observations. Cleanly installed API and GPU from the final archive · Two-process verification · Close-up transport · Measured intake and photo deduplication · Opus production design decision

## Alternatives considered

- **RunPod Flex** provides a 16 GB tier at $0.58/billed hour. The 24 GB tier lists $0.75/hour. Add the running CPU Pod’s regional quote and its disk. Pod-local volume storage currently lists $0.10/GB-month running and $0.20/GB-month stopped. A 5 GB running volume works out to about $0.50 for a full month. The design has one durable writer; losing the Pod can interrupt service. [GPU rates](https://www.runpod.io/pricing) · [Storage and balance behavior](https://docs.runpod.io/pods/pricing)
- **One combined A5000 Pod** has a published Secure Cloud reference of $0.27/hour. Eight continuously running hours would be $2.16 plus disk, and 730 hours about $197 before disk. Actual availability and regional price must be checked. This can be economical during dense traffic. [Published A5000 rate](https://www.runpod.io/articles/guides/ai-server-cost)
- **Modal Starter** includes $30 monthly compute under its current terms. A T4, one physical CPU core and 8 GiB RAM total about $0.7015/hour at the quoted rates. Modal Volumes document last-writer-wins semantics and lack distributed file locking. A separate durable transaction authority is needed for this spending guard. [Pricing](https://modal.com/pricing) · [Volume semantics](https://modal.com/docs/guide/volumes)
- **Google Cloud Run L4** can scale to zero and charges for GPU, CPU and RAM. It needs regional qualification and external durable state. **Vercel Functions** have a 4.5 MB request limit. One permitted Relay photo can contain 5.6 million base64 characters, and the shop submission can be larger. [Cloud Run configuration](https://docs.cloud.google.com/run/docs/configuring/services/gpu) · [Cloud Run pricing](https://cloud.google.com/run/pricing) · [Vercel limits](https://vercel.com/docs/functions/limitations)
- **Small CPU-only inference** failed a real fixture on the reference laptop. The warmed two-thread configuration used zero GPU memory and returned HTTP 503 on the first front at 58.812 s. It did not meet the existing per-question deadline. This was one CPU trial and does not benchmark every server CPU. CPU trace

## Reproducible deployment procedure for Friday

1. For any later deployment, the owner supplies a separately authorized RunPod account, billing controls, and a Relay-private registry namespace accessible to RunPod. Store independent operator, endpoint-invocation and billing-read credentials. Never put the provider credential into an APK or IPA.
2. From the Relay checkout run `node deploy/lock-runtime.mjs` and `node deploy/package-context.mjs`. Use the resulting gzip context and hash manifest in `artifacts/relay-v3.5-host`. The build lock matches the evaluated dependency versions and integrity fields. Only the server graph and build files are in the archive. No model weights, photographs, private configuration, datasets or credentials are in that source bundle. Build manifest
3. Build both targets on a Linux OCI builder and save the resulting registry digests. The worker fetches and verifies the exact 4B model once at build time. Subsequent workers load it from the image. The two learned layers occupy 3,324,162,336 bytes; startup checks the text and projector parameter counts. Verified public manifest

```sh
docker buildx build --platform linux/amd64 --target api -t REGISTRY/NAMESPACE/relay-api:3.5 --push - < relay-v3.5-backend.tar.gz
docker buildx build --platform linux/amd64 --target worker -t REGISTRY/NAMESPACE/relay-gpu:3.5 --push - < relay-v3.5-backend.tar.gz
```

4. The Serverless endpoint type is **Load Balancer**. Use the GPU worker digest, 16 GB Flex, zero active workers and maximum one for a pilot. Set `PORT=8080`, `PORT_HEALTH=8081`, health path `/ping`, and a random `RELAY_GPU_TOKEN` of at least 32 characters. A real scored warmup precedes readiness. Compare the default five-second idle tail with longer tails using the actual billed records. [Worker contract](https://docs.runpod.io/serverless/load-balancing/build-a-worker)
5. A CPU Pod serves the API image. Start the pilot with two vCPUs and 4 GiB if available. Record actual SKU, region and price. Expose only **8788/http** through the HTTPS proxy. The 100-second proxy timeout makes cold-start measurement necessary. Mount a persistent Pod-local block volume at `/workspace` and test stop/start persistence before paid activation. [Proxy behavior](https://docs.runpod.io/pods/configuration/expose-ports)
6. Configure the following on the CPU Pod. `RELAY_HOST=0.0.0.0`, `RELAY_PORT=8788`, `RELAY_SCORERS=local_logprob`, `RELAY_GPU_ORIGIN=https://ENDPOINT_ID.api.runpod.ai`, the worker’s `RELAY_GPU_TOKEN`, and the endpoint-invocation `RELAY_GPU_PROVIDER_KEY`. Set separate random `RELAY_ACCESS_TOKEN` (at least 24 chars) and `RELAY_SIGNING_KEY` (at least 32). Retain the signing identity when migrating drafts that must keep their signatures. Keep the server token out of public app source.
7. When terms cover actual rider uploads, the CPU service can use `RELAY_ALLOW_PAID=1`, `RELAY_R2_ENABLED=1`, `RELAY_R2_TERMS_COVERED=1`, and its private OpenAI key. Set `RELAY_R2_LEDGER=/workspace/relay/allowance.sqlite`, `RELAY_R2_BUDGET_SCOPE` to the unique approved allocation, `RELAY_R2_LIFETIME_USD` to its ceiling, `RELAY_R2_DAILY_CALLS=300`, `RELAY_R2_DAILY_USD=6`, and `RELAY_R2_RESERVE_USD=0.02`. Set `RELAY_USAGE_DB=/workspace/relay/intakes.sqlite`. The current proposed cloud OpenAI allocation is unprovisioned. The daily setting is a nominal rate throttle; the lifetime guard reserves the worst case.
8. On first authorized setup, run `node --import tsx scripts/v35-budget.ts init` **once on the persistent volume**. Restart and run the same script with `status`. A running service never recreates a missing allowance. Set `RELAY_R2_ENABLED=0` and restart to disable paid checks; the ordinary decision resumes. The rehearsal exercised both states with the same signed evidence and ledger. Kill-switch proof
9. The public client uses the CPU API's actual HTTPS origin, entered in Connection settings or supplied before Expo export as `EXPO_PUBLIC_RELAY_API_URL`. Saved settings override the build default. The installed V3.5 Android APK already supports a public HTTPS service. Confirm unauthorized health returns 401, authorized health identifies V3.5 and the expected 4B, and a physical phone on cellular can complete, cancel and reopen an intake. These public tests have not run.
10. For a replaced Pod, stop the old writer and preserve the signer and latest authoritative ledger. Use a consistent SQLite backup. Reconcile the spending high-water mark before allowing another paid call. A stale backup can resurrect already-spent allowance and must not be used as a fresh budget. The replacement Pod gets a different HTTPS origin. Staff update Connection settings, re-enter the token and check an existing draft. If spending cannot be reconciled, keep R2 disabled. Protect and back up expert verdicts if the console is enabled.

## Cost measurement for a future account

Run `node --import tsx deploy/pilot.mjs` from the checkout with an actual `RELAY_PILOT_URL`, private `RELAY_PILOT_TOKEN` and a stable `RELAY_PILOT_ID`. The optional `--with-count` mode adds the explicitly metered checks. The runner times two constructed three-view intakes with four distinct photographs. It deliberately exercises a repeated back and label. Use event traffic when reporting shop cost.

After the provider posts billing, supply an operator credential with `billing:read`, the CPU Pod and Serverless endpoint IDs, and access to both ledgers. Use `RUNPOD_BILLING_KEY`, `RELAY_BILLING_POD_ID`, `RELAY_BILLING_ENDPOINT_ID`, `RELAY_USAGE_DB` and `RELAY_R2_LEDGER`. For example:

```sh
node deploy/billing.mjs 2026-11-21T16:00:00Z 2026-11-22T03:00:00Z
```

The tool reconciles resource filters, hourly UTC boundaries, duplicate buckets and provider totals. It reports hosting dollars and the separate estimated OpenAI component. Intake deduplication counts the first successful assessment for each intake, including retakes and crash decisions. The tool also calculates cost per **submitted photograph** automatically from the first successful score per assessment and photo ID. A retry or an optional count attachment does not increase that denominator. If no billing records are returned, recheck after posting. The current repository has no cloud invoice. [Pod billing API](https://docs.runpod.io/api-reference-v2/billing/get-pod-billing-history) · [Serverless billing API](https://docs.runpod.io/api-reference-v2/billing/get-serverless-billing-history)
