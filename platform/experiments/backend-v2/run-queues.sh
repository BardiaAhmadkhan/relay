#!/usr/bin/env bash
# Run queues A, B and C in order, each appending to its own log. Every step resumes from its own output,
# so this can be started again after any interruption. Added 2026-11-17 because the interactive session
# that launched the queues kept ending; start it detached (see docs/22-backend-v2/build-guide.md 11.6).
cd "$(dirname "$0")/../.."
for q in a b c; do
  echo "=== $(date +%H:%M:%S) $(date +%F) started by run-queues.sh" >> benchmarks/backend-v2/queue-$q.log
  bash experiments/backend-v2/queue-$q.sh >> benchmarks/backend-v2/queue-$q.log 2>&1
done
echo "=== $(date +%H:%M:%S) all queues finished" >> benchmarks/backend-v2/queue-c.log
