# Backend v2 research: verified external facts

Retrieved 2026-11-16 (Pacific time). Each row says what the source establishes and what it does not. Prices and device lists change; re-read the linked page before relying on a number. Nothing here was measured by this project unless the row says so.

## 1. Hosted vision pricing (USD per million tokens, standard tier)

| Model ID | Input | Output | Source and limits |
| --- | ---: | ---: | --- |
| `gemini-decision-1` (Decisions API) | 0.10 | 0 billed | [Decisions API reference](https://aistudio.google.com/docs/decisions-api), [launch post, 2026-11-11](https://blog.google/innovation-and-ai/technology/developers-tools/gemini-decisions-api/), [pricing page](https://aistudio.google.com/docs/pricing). Closed-set answers only; no context caching, Batch, Flex or Priority. `v1beta`. Vertex "coming soon". |
| `gemini-3.5-flash-lite` | 0.30 | 2.50 | [Gemini pricing](https://aistudio.google.com/docs/pricing). Image input billed at the text rate. |
| `gemini-3.1-flash-lite` | 0.25 | 1.50 | Same page. |
| `gemini-2.5-flash-lite` | 0.10 | 0.40 | Same page. Older generation; `gemini-2.5-flash` and `gemini-2.5-pro` are marked deprecated with routing changes on 2026-12-01. |
| `gemini-3.8-flash` | 0.75 | 3.75 | Same page. Scheduled to double on 2027-01-01. |
| `gemini-embedding-2` | 0.45 per M image tokens, about 0.00012 per image | n/a | Same page. Multimodal embeddings. |
| `claude-haiku-5-5` | 0.10 | 0.50 | Anthropic model table cached 2026-11-03 (prompts up to 100K tokens). Confirm at [claude.com/pricing](https://claude.com/pricing). |
| `claude-sonnet-5-5` | 2.00 | 10.00 | Same table. |
| `claude-opus-5-5` | 4.00 | 20.00 | Same table. |
| `gpt-6-luna` | 0.10 | 0.50 | [OpenAI pricing](https://developers.openai.com/api/docs/pricing.md). Cached input 0.01. |
| `gpt-6.1-terra` | 1.00 | 5.00 | Same page. |
| `gpt-6.1-sol` | 2.00 | 10.00 | Same page. |

Free tiers: the Gemini pricing page states that free-tier content is used to improve Google products and paid-tier content is not. Use the free tier only with public, licensed fixtures. Private, rider or event photographs need the paid tier.

The previous cost note in this repository ([cost-model-research.md](../13-performance-and-cost/cost-model-research.md)) listed Luna, Haiku 5.5 and the Flash-Lite prices correctly. It predates the Decisions API.

## 2. How images are charged

| Provider | Rule | Source |
| --- | --- | --- |
| Claude | `ceil(width / 28) x ceil(height / 28)` visual tokens. Claude 4.7 and later accept a long edge up to 2,576 px and at most 4,784 visual tokens; larger images are downscaled. A 1000 x 1000 image is 1,296 tokens. | [Claude vision guide](https://platform.claude.com/docs/en/build-with-claude/vision) |
| Gemini 3 and 4 families | Per-image token budget set by `resolution` on the content block: `low` 280, `medium` 560, `high` 1,120 (the default), `ultra_high` 2,240. The page does not name `gemini-decision-1`; confirm from the `usage` object of a real response. | [Media resolution](https://aistudio.google.com/docs/media-resolution) |
| Gemini (older tiling rule) | 258 tokens when both sides are at most 384 px, otherwise 258 per 768 x 768 tile. | [Image understanding](https://aistudio.google.com/docs/image-understanding) |
| Local Qwen3.5 4B through Ollama | Measured here: 273 prompt tokens for a 387 x 516 photo, about 830 to 920 for 720 to 960 px, about 1,380 to 1,700 for 960 to 1,220 x 1,280. | build guide, section 3 |

Formats: Claude accepts JPEG, PNG, GIF and WebP. Gemini accepts PNG, JPEG, WebP, HEIC and HEIF (the Decisions API also lists GIF, BMP and TIFF). Send JPEG to every provider so one preprocessing path serves all of them.

## 3. Gemini Decisions API (the hosted form of the scored question battery)

From the [reference](https://aistudio.google.com/docs/decisions-api), not executed by this project:

- `POST https://generativelanguage.googleapis.com/v1beta/decisions`, header `x-goog-api-key`.
- Body: `model`, `input` (string, one content block or an array; image blocks take `data` base64 or `uri`, `mime_type`, optional `resolution`), `questions` (a map of 1 to 1,000 keys matching `[A-Za-z0-9_-]+`, at most 64 characters).
- Question types: `noul` (yes or no; optional `criteria.true_description` and `false_description`), `choice` (`criteria` is a map of option key to description, 2 to 255 options), `score` (`criteria` is an ordered array of level descriptions, 2 to 255 levels, 2 to 10 recommended).
- Response: `answers[key]` is `{type:"noul", noul: P(yes) in 0.01..0.99, confidence}` or `{type:"choice", choice, probabilities, confidence}` or `{type:"score", score (expected level, can be fractional), legend, probabilities, confidence}`; plus `usage.total_input_tokens` and `input_tokens_by_modality`. `total_output_tokens` is always 0.
- The model never sees the question keys. Adjacent text blocks are concatenated without a separator.
- Stated latency: 150 to 250 ms end to end, nearly flat from 1 to 100 questions. Context up to 262,144 tokens.
- Safety blocks return HTTP 400 with `error.code` in `safety`, `prohibited_content`, `blocklist`, `image_safety`, `content_blocked`.
- Guidance from the page: one decision per question, positive phrasing, describe every option, add a catch-all option with a non-positional key such as `other`, calibrate thresholds on your own labelled examples, route low confidence to people, treat input as untrusted.
- JavaScript: `@google/genai` 3.2 or later, `new GoogleGenAI({ apiVersion: "v1beta" })`, `ai.decisions.create({ model, input, questions })`.

What this does not establish: accuracy on used motorcycle gear, real latency from Victoria, rate limits, or behaviour on photographs that include people. Those are the first measurements in the build guide.

## 4. Free on-device image models exposed by the operating systems

| Platform | Fact | Source | Limit |
| --- | --- | --- | --- |
| Android | ML Kit GenAI Prompt API gives direct access to Gemini Nano with multimodal prompts and typed structured output. Galaxy S25 and S26 families, including the S26 Ultra, are listed under Gemini Nano 4, as are Pixel 10 and 11. | [ML Kit GenAI overview](https://developers.google.com/ml-kit/genai) | Foreground only; per-app inference quota (`BUSY`) and a long-duration battery quota; not on unlocked bootloaders. |
| Android | `com.google.mlkit:genai-prompt:1.0.0-beta4`; up to 10 images per request; context under about 4,000 tokens; `temperature`, `seed`, `topK`, `maxOutputTokens`; `checkStatus()`, `download()`, `warmup()`. No token probabilities are documented. | [Prompt API get started](https://developers.google.com/ml-kit/genai/prompt/android/get-started) | Beta. No accuracy claims. |
| iOS | The iOS 27 Foundation Models framework accepts image input (CGImage, CIImage, pixel buffer or file URL). Secondary coverage disagrees on which device tier carries it. | [Apple iOS 27 developer guide](https://developer.apple.com/wwdc26/guides/ios/) and developer write-ups | Newer iPhones only; details were still marked beta in the coverage read. |

Consequence: a free, zero-download on-device pre-screen is possible on recent flagships of both platforms, but it cannot return calibrated scores and it does not cover older phones. It is a progressive enhancement, never the only path.

## 5. Mobile runtime

- Expo SDK 58 is the current release (React Native 0.88, built for iOS 27); SDK 57 shipped 2026-06-30. Source: [Expo changelog](https://expo.dev/changelog/sdk-58). The existing app is pinned to SDK 57 and React Native 0.86.3.
- Expo's guidance for any native library outside Expo Go is a development build. The current Android build depends on `llama.rn`, which is why it cannot run in Expo Go.
- On-device text recognition packages exist that wrap ML Kit on Android and Apple Vision on iOS (`expo-text-extractor`, `expo-mlkit-ocr`, `expo-ocr-kit`). Maintenance status in late 2026 was not verified; treat as candidates and check each repository before adopting.

## 6. Domain facts used by the decision rules

| Fact | Source | How it is used |
| --- | --- | --- |
| EN 17092 divides a garment into three risk zones. Zone 1 (highest risk): shoulders, elbows, hips, knees. Zone 2: arms, back, buttocks, outer legs. Zone 3: chest, abdomen, inner arms, inside and back of legs. | [Dainese explainer](https://www.dainese.com/demonerosso/moto/how-do-motorcycle-jacket-and-pants-certifications-work/651317868.html); [SATRA](https://www.satra.com/ppe/EN17092.php) | Default protective-zone map. One retailer source places hips differently, so the map is configuration, to be corrected by the shop's expert on the day. |
| Classes AAA, AA, A (and B, C) are printed on the garment label; AAA is tested at the highest abrasion speed. | Same sources | Label text is recorded as read. It is never treated as proof of performance. |
| Gloves follow EN 13594 and boots EN 13634; protectors follow EN 1621-1 (limbs), -2 (back), -3 (chest). | [SATRA overview](https://www.satra.com/spotlight/article.php?id=483) | Label vocabulary. |
| Helmets: Arai and Shoei advise replacement about five years after first use or sale; SHARP advises against second-hand helmets because impact damage can be invisible. | [SHARP](https://sharp.dft.gov.uk/frequently-asked-questions/buying-a-new-helmet/), manufacturer guidance via retailer summaries | Helmets default to specialist review, never an automatic offer. Manufacture date is requested from the label. |
| REI's used-gear programme grades items as excellent, lightly worn, moderately worn or well worn and rejects rips, odours and missing parts. | [REI condition guide](https://www.rei.com/used/assets/REI_Used_Gear_Condition_Guide.pdf) | Model for the four-level wear rubric. |

## 7. What comparable photo-grading products teach

- Device trade-in programmes draw their loudest complaints when an instant quote is cut after inspection without a clear reason or a usable photo. Sources: [MacRumors on Phobio](https://www.macrumors.com/2021/04/14/apple-trade-in-partner-phobio-complaints/), Trustpilot reviews for trade-in services, [Back Market AI grading help](https://help.backmarket.com/hc/en-us/articles/16581114209820-How-does-Shake-to-Trade-in-work). Design consequence: every adverse result shows the photo region and the reason, and offers a one-tap request for a human look.
- Vehicle-damage products pair guided capture with reviewer tools and ask for more evidence on the spot. Sources: [Tractable AI Inspection coverage](https://www.vehicleremarket.com/news/smartphone-with-ai-tool-can-quickly-assess-vehicle-conditions), [UVeye](https://uveye.com/how-it-works/). No vendor publishes thresholds or accuracy, so nothing numeric is borrowed.
- Google's own guidance for the Decisions API is the same pattern: calibrate thresholds on labelled examples and route low confidence to a person.

## 7b. Hosting a small open model (retrieved 2026-11-17)

| Fact | Source | Limit |
| --- | --- | --- |
| Modal GPU prices per second: T4 $0.000164, L4 $0.000222 (about $0.80 per hour), A10 $0.000306, L40S $0.000542; Starter plan includes $30 of compute per month. | [Modal pricing](https://modal.com/pricing) | Read from the page on 2026-11-17; L4 inference speed for this model not measured. |
| RunPod serverless per hour: L4, A5000, RTX 3090 $0.75; A4000, A4500, RTX 4000, RTX 2000 $0.58; RTX 4090 $1.34 (page updated 2026-11-12). | [RunPod pricing](https://www.runpod.io/pricing) | The page did not show per-second or Flex versus Active prices. |
| vLLM v1 prefix caching keys each cache block on its tokens, the preceding prefix and extra keys including multimodal input hashes, so a repeated image can reuse its cache blocks. | [vLLM automatic prefix caching design](https://docs.vllm.ai/en/v0.8.5/design/v1/prefix_caching.html) | Design notes for v0.7 to v0.8; not executed here. Unquantised weights differ from the measured Ollama build. |
| Per-token prices for small Qwen vision models ($0.08 to $0.20 per million input tokens on Fireworks, Together, Novita and OpenRouter routes). | Aggregator pages only (for example [Artificial Analysis provider list](https://artificialanalysis.ai/models/qwen3-vl-8b-instruct/providers)) | Not provider pages. Token log-probability support on image requests not confirmed. |
| Openverse image search API returns openly licensed images with licence, creator and source; anonymous use is rate limited (HTTP 429 and 504 seen). | [Openverse API](https://api.openverse.org/v1/) | Used for `datasets/gear-v2-openverse/`; 22 of 75 candidates kept after visual review. |

Measured locally on 2026-11-17 (experiment report E5): `qwen3-vl:4b-instruct` reuses the evaluated image between questions in Ollama 0.40.16 (about 0.1 s per further question), `qwen3.5:4b` does not, even for an identical request.

## 8. Searches that found nothing

- No public page for "Reloaded Labs #01" or a rulebook beyond what the owner supplied. No web presence found for Moto Reloaded at 508 Herald Street. The organiser's rules, rubric and dataset terms remain unknown until the day.
- No published accuracy figures for any commercial used-gear or apparel condition grader.
- Wikimedia Commons holds almost no licensed photographs of crash-damaged motorcycle gear beyond the ones already in this repository; a metadata search on 2026-11-16 returned 47 candidates, nearly all irrelevant, before the API rate-limited the session. See `benchmarks/backend-v2/gear-v2-candidates.json`.
