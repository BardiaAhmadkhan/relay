#!/usr/bin/env bash
# Unattended experiment queue B (after queue A). Resumable.
set -u
cd "$(dirname "$0")/../.."
run() { echo "=== $(date +%H:%M:%S) $*"; "$@" || echo "!!! step failed: $*"; }

# 1. Paraphrased damage questions, extra production questions and jacket zone questions, gear photos only.
run node experiments/backend-v2/run-battery.mjs --battery b2 --domain garments_and_gear

# 2. Repeatability: the same request sent a second time must give the same scores.
run node experiments/backend-v2/run-battery.mjs --battery b1 --only break,slide --edge 1024 --scored --tag repeat

# 3. Text-in-image attack on the scored questions.
run node experiments/backend-v2/run-injection.mjs

# 4. Label transcription by the local model.
run node experiments/backend-v2/run-label.mjs assets/fixtures/round-02/helmet-label.jpg assets/fixtures/backpack-label.jpg

# 5. The production scorer code path, live, on the fixture photographs that are not in the labelled corpora.
run npx tsx scripts/v2-score-set.ts --list experiments/backend-v2/fixtures-list.json --out benchmarks/backend-v2/fixtures--production-local.scores.jsonl --zones
echo "=== $(date +%H:%M:%S) queue B finished"
