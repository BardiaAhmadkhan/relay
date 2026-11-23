#!/usr/bin/env bash
# Unattended experiment queue C (added 2026-11-17, after queues A and B). Resumable like A and B.
# Question: can a local model that reuses the evaluated image between questions (probe-prefix-cache.mjs,
# E5a) replace qwen3.5:4b as the laptop fallback without losing separation?
#   qwen3-vl:4b-instruct  plain transformer; measured reuse: first question ~0.6 s, each further one ~0.1 s
#   gemma4:e2b            no reuse, but ~470 prompt tokens per photograph, ~0.2 s per question
set -u
cd "$(dirname "$0")/../.."
run() { echo "=== $(date +%H:%M:%S) $*"; "$@" || echo "!!! step failed: $*"; }

# 0. Localisation photographs that failed on the tile-crop bug fixed on 2026-11-17 (the runner resumes,
#    so only the failed ids run again), and the gear overlays under a new tag so all six are drawn.
run node experiments/backend-v2/run-locate.mjs
run node experiments/backend-v2/run-locate.mjs --ids sample-01,sample-02,sample-03,commons-031,commons-093,commons-037 --overlay --tag gear-overlay

# 1. The full reference battery b1 on all 261 photographs, same options as the qwen3.5:4b reference run,
#    so analyze_battery.py and analyze_sweep.py compare like with like.
for model in qwen3-vl:4b-instruct gemma4:e2b; do
  run node experiments/backend-v2/run-battery.mjs --battery b1 --model $model
done

# 2. Battery b2 (paraphrases, usable, single item, four-level wear, jacket zones) on the gear photographs.
for model in qwen3-vl:4b-instruct gemma4:e2b; do
  run node experiments/backend-v2/run-battery.mjs --battery b2 --domain garments_and_gear --model $model
done

# 3. Image-size sweep for the two candidates on the exclusion questions.
for model in qwen3-vl:4b-instruct gemma4:e2b; do
  for edge in 1280 1024 768; do
    run node experiments/backend-v2/run-battery.mjs --battery b1 --only break,slide --edge $edge --model $model --scored
  done
done
# 4. The Openverse gear set (2026-11-17): 22 real gear photographs, 6 damaged from two crash series,
#    assistant labels made before scoring. Reference battery and b2, all three local candidates.
for model in qwen3.5:4b qwen3-vl:4b-instruct gemma4:e2b; do
  run node experiments/backend-v2/run-battery.mjs --battery b1 --corpus openverse --model $model
  run node experiments/backend-v2/run-battery.mjs --battery b2 --corpus openverse --model $model
done
echo "=== $(date +%H:%M:%S) queue C finished"
