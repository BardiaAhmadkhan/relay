import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketWindow, readBill } from '../deploy/billing.mjs';
const start = '2026-11-21T17:00:00Z',
  end = '2026-11-21T18:00:00Z',
  w = bucketWindow(start, end);
function actualShape(kind = 'serverless') {
  const field = kind === 'pods' ? 'podId' : 'serverlessId';
  return {
    records: [
      {
        [field]: 'test-resource',
        startTime: start,
        endTime: end,
        totalAmount: 0.23,
        gpuAmount: 0.21,
        diskAmount: 0.02,
      },
    ],
    metadata: {
      query: { [field]: 'test-resource', startTime: start, endTime: end, bucketSize: 'hour' },
      recordCount: 1,
      totals: { totalAmount: 0.23, gpuAmount: 0.21, diskAmount: 0.02 },
    },
  };
}
test('uses the exact aligned window and reconciles per-resource RunPod v2 totals', () => {
  for (const k of ['pods', 'serverless'])
    assert.equal(readBill(actualShape(k), 'test-resource', k, w).reportedTotalUsd, 0.23);
  assert.throws(() => bucketWindow('2026-11-21T17:30:00Z', end));
});
test('rejects misattributed spend, duplicate buckets, sum differences and missing totals', () => {
  for (const change of [
    (x) => (x.metadata.query.serverlessId = 'unrelated'),
    (x) => (x.metadata.query.startTime = '2026-11-20T17:00:00Z'),
    (x) => x.records.push(x.records[0]),
    (x) => (x.records[0].totalAmount = -1),
    (x) => (x.metadata.totals.totalAmount = 4),
    (x) => delete x.metadata.totals,
  ]) {
    const v = actualShape();
    change(v);
    assert.throws(() => readBill(v, 'test-resource', 'serverless', w));
  }
});
