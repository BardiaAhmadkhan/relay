import fs from 'node:fs/promises';
try {
  await fs.access('experiments/quality-audit-01/evidence.lock.json');
  throw new Error(
    'This audit is sealed. Use a new audit directory instead of rewriting its report.',
  );
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const root = 'datasets/quality-audit-01';
const labels = JSON.parse(await fs.readFile(root + '/labels.json', 'utf8'));
let evaluation;
let complete = true;
try {
  evaluation = JSON.parse(
    await fs.readFile('benchmarks/quality-audit-01/evaluation-full.json', 'utf8'),
  );
} catch {
  complete = false;
  const text = await fs.readFile('benchmarks/quality-audit-01/evaluation-full.jsonl', 'utf8');
  evaluation = {
    rows: text
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((s) => JSON.parse(s)),
  };
}
const reviews = new Map();
for (const file of await fs.readdir('benchmarks/quality-audit-01/prediction-review')) {
  for (const row of JSON.parse(
    await fs.readFile('benchmarks/quality-audit-01/prediction-review/' + file, 'utf8'),
  ).rows) {
    if (reviews.has(row.id)) throw new Error('Duplicate review ' + row.id);
    reviews.set(row.id, row);
  }
}
for (const correction of JSON.parse(
  await fs.readFile('benchmarks/quality-audit-01/review-corrections.json', 'utf8'),
).corrections) {
  const prior = reviews.get(correction.id);
  if (prior)
    reviews.set(correction.id, {
      ...prior,
      correspondence: correction.correspondence,
      note: correction.note,
    });
}
const rows = labels.cases.map((c) => ({
  ...c,
  review: reviews.get(c.id) ?? null,
  result: evaluation.rows.find((r) => r.id === c.id) ?? null,
  image: c.file.replace(root + '/', ''),
}));
const quantile = (a, p) => {
  if (!a.length) return null;
  const b = [...a].sort((a, b) => a - b);
  return b[Math.min(b.length - 1, Math.ceil(p * b.length) - 1)];
};
const metrics = (items) => {
  const results = items.filter((c) => c.result);
  const positive = items.filter((c) => c.condition === 'visible_defect'),
    negative = items.filter((c) => c.condition === 'no_visible_defect');
  return {
    images: items.length,
    completed: results.length,
    groups: new Set(items.map((c) => c.group)).size,
    positives: positive.length,
    reviewedPositives: items.filter((c) => c.review).length,
    correspondenceMatched: items.filter((c) => c.review?.correspondence === 'matched').length,
    correspondencePartial: items.filter((c) => c.review?.correspondence === 'partial').length,
    correspondenceMissed: items.filter((c) => c.review?.correspondence === 'missed').length,
    correspondenceUnscorable: items.filter((c) => c.review?.correspondence === 'unscorable').length,
    reviewedLocationErrors: items.filter((c) => c.review?.locationError).length,
    reviewedUnsupportedExtras: items.filter((c) => c.review?.unsupportedExtra).length,
    negatives: negative.length,
    ambiguous: items.filter((c) => c.condition === 'ambiguous').length,
    unassessable: items.filter((c) => c.condition === 'unassessable').length,
    detected: results.filter((c) => c.result.outcome === 'detected').length,
    misses: results.filter((c) => c.result.outcome === 'miss').length,
    falseFlags: results.filter((c) => c.result.outcome === 'false_flag').length,
    correctNegatives: results.filter((c) => c.result.outcome === 'correct_negative').length,
    processingErrors: results.filter((c) => c.result.error).length,
    firstAttemptFailures: results.filter((c) => c.result.firstAttemptFailed).length,
    recoveredAfterRetry: results.filter((c) => c.result.recoveredAfterRetry).length,
    wrongDefectKinds: results.filter((c) => c.result.expectedKindMatched === false).length,
    inventedGarmentAnatomy: results.filter((c) => c.result.inventedGarmentAnatomy).length,
    clearOnUnassessable: results.filter(
      (c) =>
        c.condition === 'unassessable' &&
        c.result.result?.observation?.inspection?.photos.some((p) =>
          p.findings.some((f) => f.clarity === 'clear'),
        ),
    ).length,
    p50EndToEndMs: quantile(
      results.map((c) => c.result.elapsedMs),
      0.5,
    ),
    p95EndToEndMs: quantile(
      results.map((c) => c.result.elapsedMs),
      0.95,
    ),
    p50InferenceMs: quantile(
      results.map((c) => c.result.result?.timing.inferenceMs).filter((x) => x > 0),
      0.5,
    ),
    p95InferenceMs: quantile(
      results.map((c) => c.result.result?.timing.inferenceMs).filter((x) => x > 0),
      0.95,
    ),
  };
};
const disputes = JSON.parse(
  await fs.readFile('benchmarks/quality-audit-01/reference-label-disputes.json', 'utf8'),
);
const disputeIds = new Set(disputes.cases.map((c) => c.id));
for (const row of rows) row.referenceDispute = disputes.cases.find((d) => d.id === row.id) ?? null;
const summary = {
  referenceLabelDisputes: disputes,
  sensitivityExcludingDisputed: metrics(rows.filter((c) => !disputeIds.has(c.id))),
  correspondenceReview: [...reviews.values()],
  generatedAt: new Date().toISOString(),
  complete,
  scope:
    'Purposeful diagnostic set; labels are assistant visual annotations, not expert physical inspection. Binary detection evaluates presence of any returned finding, not correctness of all descriptions. Ambiguous/unassessable cases excluded from binary totals. All request-attempt failures retained separately.',
  overall: metrics(rows),
  domains: Object.fromEntries(
    [...new Set(rows.map((c) => c.domain))].map((domain) => [
      domain,
      metrics(rows.filter((c) => c.domain === domain)),
    ]),
  ),
  failures: rows
    .filter((c) => c.result && ['miss', 'false_flag'].includes(c.result.outcome))
    .map((c) => ({
      id: c.id,
      domain: c.domain,
      label: c.condition,
      outcome: c.result.outcome,
      reference: c.visualBasis,
      findings: c.result.result?.observation?.inspection?.photos.flatMap((p) => p.findings) ?? [],
      firstAttemptFailed: c.result.firstAttemptFailed,
    })),
  operationalFailures: rows
    .filter((c) => c.result?.firstAttemptFailed)
    .map((c) => ({
      id: c.id,
      domain: c.domain,
      attempts: c.result.attempts,
      eventualOutcome: c.result.outcome ?? 'processing_error',
    })),
  metadataFindings: rows
    .filter((c) => c.result?.inventedGarmentAnatomy || c.result?.expectedKindMatched === false)
    .map((c) => ({
      id: c.id,
      subject: c.subject,
      inventedGarmentAnatomy: c.result.inventedGarmentAnatomy,
      expectedKindMatched: c.result.expectedKindMatched,
      findings: c.result.result?.observation?.inspection?.photos.flatMap((p) => p.findings) ?? [],
    })),
};
await fs.writeFile(
  'benchmarks/quality-audit-01/summary' + (complete ? '' : '-partial') + '.json',
  JSON.stringify(summary, null, 2) + '\n',
);
const safeCell = (v) =>
  '"' +
  String(v ?? '')
    .replace(/^[=+@-]/, "'$&")
    .replaceAll('"', '""') +
  '"';
const columns = [
  'id',
  'domain',
  'group',
  'reference_label',
  'outcome',
  'correspondence',
  'correspondence_note',
  'first_attempt_failed',
  'attempts',
  'elapsed_ms',
  'model_category',
  'model_findings',
  'source',
];
const csv = [
  columns.map(safeCell).join(','),
  ...rows.map((c) =>
    [
      c.id,
      c.domain,
      c.group,
      c.condition,
      c.result?.outcome ?? (c.result?.error ? 'processing_error' : 'pending'),
      c.review?.correspondence ?? '',
      c.review?.note ?? '',
      c.result?.firstAttemptFailed ?? '',
      c.result?.attempts.length ?? '',
      c.result?.elapsedMs ?? '',
      c.result?.result?.observation?.category ?? '',
      c.result?.result?.observation?.inspection?.photos
        .flatMap((p) => p.findings)
        .map((f) => f.kind + ' / ' + f.zone + ' / ' + f.clarity + ': ' + f.evidence)
        .join(' | ') ?? '',
      c.source,
    ]
      .map(safeCell)
      .join(','),
  ),
];
await fs.writeFile(root + '/results.csv', csv.join('\r\n') + '\r\n');
const page = await fs.readFile('scripts/quality-audit-review-template.html', 'utf8');
await fs.writeFile(
  root + '/review.html',
  page.replace('/*DATA*/', JSON.stringify({ summary, rows }).replaceAll('<', '\\u003c')),
);
console.log(JSON.stringify({ complete, overall: summary.overall }));
