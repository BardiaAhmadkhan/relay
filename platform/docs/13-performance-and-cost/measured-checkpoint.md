# Measured performance checkpoint · 2026-10-26
Source data: benchmarks/vision-latest.json and quality-latest.json. These are developer-computer measurements, not phone or production service measurements.

## Recognition
CLIP: median 121.0 ms over 16 warm single-image requests; SigLIP: 593.6 ms. Both run two fixed text formulations. Descriptive nearest-rank p95: 137.6 and 693.2 ms. Model initialization from populated cache is separate. Category results were 5/6 and 4/6 images, with only five scored independent item groups. See the full report for failures and scope.

## Image preprocessing
One preserved original jacket photograph, eight variants, six runs per variant (first separated; five warm). Reference normalized JPEG: 205,181 bytes; 960 px variant: 115,102 bytes; 480 px variant: 36,402 bytes. Corresponding warm median host times were 93.66,54.58 and 18.90 ms in this run. Reduced bytes/timing do not prove retained recognition or defect visibility; the app retains a 1600 px upper bound pending a representative comparison.

Severe dark, bright and low-resolution variants were flagged. Synthetic sigma 8 blur was not flagged by the conservative sharpness threshold. This experiment therefore does not validate general blur rejection. Softness remains advisory; it is not a protective-condition signal.

## Bundled assets
The initial export included 40 font asset entries because importing package indexes pulled unused weights. Direct imports reduced the later export to 8 entries (four weights, platform export variants). Native Hermes bundles were approximately 2.6 MB each; the main web bundle approximately 1.3 MB. Sizes are build artifacts, not download-time or memory measurements.

## Costs
No external inference charge was incurred. CPU, memory, model download and operating costs remain real; no cloud invoice or phone battery measurement exists. Provider price arithmetic is isolated in cost-model-research.md and explicitly estimated. No price-quality Pareto superiority has been established for cloud candidates.
