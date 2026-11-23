# Performance and cost model

Research date: 2026-10-26 UTC. **No paid API calls were made for this research.** Listed prices are retrieved public documentation; arithmetic below is an estimate. Real benchmark records belong in `benchmarks/`. No provider latency or gear-recognition accuracy has been measured here.

## Retrieved API rates

USD per million tokens, standard online processing, short requests, no cache, no tools, no residency surcharge:

| Candidate | Input | Output | Scope |
|---|---:|---:|---|
| OpenAI `gpt-6-luna` | 0.10 | 0.50 | Text/image input; longer-than-272K input has different rates. |
| Anthropic `claude-haiku-5-5` | 0.10 | 0.50 | Prompts up to 100K tokens; longer prompts have different rates. |
| Google `gemini-3.1-flash-lite` | 0.25 | 1.50 | Text/image/video input; output rate includes thinking. |
| Google `gemini-3.5-flash-lite` | 0.30 | 2.50 | Multimodal input; output rate includes thinking. |
| OpenAI `gpt-6.1-sol` | 2.00 | 10.00 | Higher-cost candidate for a controlled quality escalation experiment. |
| Anthropic `claude-sonnet-5-5` | 2.00 | 10.00 | Higher-cost candidate; not automatically selected. |

Sources: [OpenAI model/pricing](https://developers.openai.com/api/docs/models/gpt-6-luna), [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [Claude Haiku overview](https://platform.claude.com/docs/en/models/haiku-5-5/overview), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).

These models were listed by the retrieved sources. Account access, rate limits, regional eligibility, billing enablement and future event-day availability remain unverified. A low token rate is not evidence of sufficient observation quality. Refresh the exact model ID and rates before enabling any paid adapter.

## Auditable arithmetic

For one attempt:

`model_cost = (input_tokens × input_rate + billed_output_tokens × output_rate) / 1_000_000`

For one submitted assessment:

`expected_variable_cost = sum(actual_attempt_costs) + preprocessing_compute + storage + transfer + other_services`

For normalized sensitivity only, assume **2,000 billed input tokens and 600 billed output tokens**. This is not a claim that the same photographs tokenize identically across providers.

| Rate pair | One attempt | 1,000 attempts | 10,000 attempts |
|---|---:|---:|---:|
| 0.10 / 0.50 | $0.00050 | $0.50 | $5.00 |
| 0.25 / 1.50 | $0.00140 | $1.40 | $14.00 |
| 0.30 / 2.50 | $0.00210 | $2.10 | $21.00 |
| 2.00 / 10.00 | $0.01000 | $10.00 | $100.00 |

Output means billed output, including any billed internal reasoning. For example, the 0.10/0.50 calculation is `(2000 × 0.10 + 600 × 0.50) / 1e6`. Doubling image-token input to 4,000 while preserving 600 output changes it to $0.00070. At 2,000 input and 4,000 output it becomes $0.00220. These are scenario calculations, not expected production invoices.

With an assumed independent retry probability of 10% and at most one retry, expected attempts are 1.10 per original request. This multiplier is only illustrative; actual retries can correlate with difficult/large images. Record failed and incomplete attempts rather than treating them as free.

Provider image accounting depends on the model, dimensions and detail setting. Measure response usage on the actual bounded photos; do not multiply all image counts by an old fixed token allowance. [OpenAI image-cost calculator](https://developers.openai.com/api/docs/guides/image-cost-calculator), [Claude vision costs](https://platform.claude.com/docs/en/build-with-claude/vision), [Gemini image inputs](https://ai.google.dev/gemini-api/docs/image-understanding)

## What local inference costs

Pretrained local inference has **zero external model-API charge** in this experiment. It still consumes model-download bandwidth, disk, RAM, CPU energy, development time and the laptop running the service. Calling it costless or on-phone would be inaccurate.

The CLIP conversion repository lists a combined quantized graph around 154 MB, or separate quantized text/vision graphs around 64.5 MB and 89.1 MB, before tokenizer/config files. Download only the graph format used by the adapter. Source sizes do not establish actual runtime memory. [CLIP ONNX files](https://huggingface.co/Xenova/clip-vit-base-patch32/tree/main/onnx)

For future hosting, calculate:

`monthly_cost = fixed_hosting + requests × average_compute_seconds × compute_rate + retained_GB × storage_rate + outbound_GB × transfer_rate + API_cost`

No hosting provider has been selected or purchased. Hosting rates are deliberately unfilled.

## Latency measurements and targets

Measure separately: capture, resize/encode, upload, queue wait, model load, inference, validation/rules, download and render. Report cold process/model load separately from warm inference. The local benchmark should include runtime/CPU/OS, package/model revision, precision, number of threads, fixture hashes, prompt variant, all failures and exact run count.

Report individual times, median and an explicitly defined percentile method. With fewer than 20 observations, a p95 is a descriptive upper-tail statistic, not a stable service promise. Repeated photos are not independent accuracy samples. A cached classification must be marked cached and excluded from uncached inference timing.

An illustrative transport calculation: three assumed 0.4 MB JPEGs total 1.2 MB, or 9.6 megabits. At a sustained 1 Mbps upload that alone takes 9.6 seconds; at 5 Mbps, 1.92 seconds, before protocol overhead. Base64 adds roughly one third before JSON. These are arithmetic examples, not measured file sizes or network performance.

Initial product targets may be set after the first baseline, but should remain labelled targets until measured on iPhone and Android. No invented sub-second or real-time claim is justified.

## Cost controls that preserve meaning

- Apply known exclusion rules before expensive inference. A crash disclosure cannot be overridden by an image model.
- Use category-only local inference as such; it is not a cheaper substitute for a condition inspection.
- Send a small useful set of views once, with label crops only when their detail matters.
- Reuse a result only for identical image hashes, model revision, prompt, preprocessing and schema version. Recompute policy from current disclosures.
- Bound payload bytes, image pixels, concurrent work, attempts and provider output tokens.
- Keep keys server-side. External transfer requires explicit consent and the configured paid route.
- Escalate to a larger model only on a measured task-specific benefit; disagreement is a reason for review, not automatic positive resolution.
- Forecast with actual model usage and actual provider billing; include refusals and failures. Capture usage without storing full image bodies or personal data in logs.

## Completion boundary

Public pricing and a reproducible cost formula are available. Hosted provider quality, actual billed usage, mobile battery/thermal impact, hosting invoices and competition-Wi-Fi latency remain unmeasured. The authorized local benchmark adds real inference/timing evidence without incurring hosted model charges.

## Local measured baseline

The [executed local comparison](../../benchmarks/vision-report.md) now separates populated-cache model initialization from warm image inference. Use its individual durations and stated scope; do not substitute them for cloud or phone capture-to-result latency. The run incurred no model-API charges.
