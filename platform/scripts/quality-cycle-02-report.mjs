import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const read = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));
const lines = async (p) => (await fs.readFile(p, 'utf8')).trim().split('\n').map(JSON.parse);
const base = 'benchmarks/quality-cycle-02/';
try {
  await fs.access('experiments/quality-cycle-02/evidence.lock.json');
  throw new Error('This report is sealed');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const current = await lines(base + 'selected-program-replay.jsonl'),
  http = await lines(base + 'current-http-audit.jsonl'),
  historical = await read(base + 'final-evaluation.json');
const labels = (await read('datasets/quality-audit-01/labels.json')).cases;
const partial = new Set([
  'fabric-042',
  'fabric-049',
  'fabric-051',
  'fabric-052',
  'fabric-053',
  'fabric-058',
  'fabric-061',
  'fabric-065',
  'fabric-067',
  'fabric-074',
]);
const missed = new Set(['commons-087', 'commons-090', 'leather-007']);
const recovered = new Set(['commons-090', 'fabric-049']);
const notes = {
  'commons-031':
    'The damaged fingertips are described. The wrist-separation claim is less certain and is not needed for the match.',
  'commons-037':
    'The worn toe slider near the screw is described. The additional wear around the red mechanism is less conclusive.',
  'commons-087':
    'The whole-image pass misses the distant ripped jeans. The crop found the rips, but the 6.5-second optional budget expired during full-context verification. Recorded fallback is retained as a miss, not silently replaced with an earlier successful trial.',
  'commons-089':
    'The torn denim is correctly described. The additional claim of a torn right sleeve is unsupported.',
  'commons-090':
    'Full-context enlargement recovers the actual openings and frayed edges. Recovered evidence is capped at possible and does not establish crash history.',
  'fabric-042':
    'A large open cut is reduced to a linear mark. The crop describes peeled material but does not satisfy the deliberately narrow tear-language acceptance gate; remains unresolved.',
  'fabric-048':
    'The description of an open split corresponds to the real cut, but the structured kind seam is wrong.',
  'fabric-049':
    'A real cut was called a seam. Full-context enlargement describes frayed edges and exposed fibers at the cut; revised kind tear, possible.',
  'fabric-051':
    'A cut is described only as a dark linear mark. The alert does not identify the material break.',
  'fabric-052':
    'A cut is misidentified as a garment seam; the additional no-tears statement contradicts the photo.',
  'fabric-053':
    'An open cut is called a possible stain or abrasion; the defect type and material break are missed.',
  'fabric-058': 'A cut is reduced to a dark line and assigned the kind seam.',
  'fabric-061':
    'The caption describes missing printed surface and a lighter underlayer, without recognizing the visible puncture through the weave. A tear enum alone is not sufficient for a full match.',
  'fabric-065': 'A puncture is described as surface-coating loss, not a material opening.',
  'fabric-066':
    'Unlike the historical caption, this run identifies frayed edges at the real puncture. This counts as a physical-evidence match, while the kind other and spot wording remain imprecise.',
  'fabric-067':
    'The puncture is reduced to a dark spot without recognizing broken or missing material.',
  'fabric-069':
    'The original verifier names a nonexistent candidate index, causing a processing failure. One fixed-slot corrective review completes, but still endorses a white-patch description of the puncture. Reliability repaired; visual description remains partial.',
  'fabric-074':
    'The puncture is described only as a protruding thread loop and labelled seam. It does not identify the opening.',
  'leather-007':
    'The scratches exposing brown material are missed. The returned edge-fraying observation is on a different feature and does not count as detecting the reference defect.',
};
const review = current
  .filter((r) => r.condition === 'visible_defect')
  .map((r) => {
    const before = r.baselineError
      ? 'processing_failure'
      : missed.has(r.id)
        ? 'missed'
        : partial.has(r.id)
          ? 'partial'
          : 'matched';
    const after = r.error
      ? 'processing_failure'
      : r.id === 'fabric-069'
        ? 'partial'
        : recovered.has(r.id)
          ? 'matched'
          : before;
    if (before === 'matched')
      assert.deepEqual(r.candidatePhoto, r.baselinePhoto, 'Matched evidence altered ' + r.id);
    return {
      id: r.id,
      before,
      after,
      note:
        notes[r.id] ??
        'At least one returned description corresponds to the visibly broken, frayed or missing reference material. This does not certify every additional claim, exact damage type, severity, or cause.',
      wrongKind: ['fabric-048', 'fabric-066', 'fabric-074'].includes(r.id),
      unsupportedAnatomy: !!r.candidatePhoto?.findings.some(
        (f) =>
          r.domain !== 'garments_and_gear' &&
          /\b(?:lining|hem|seam|garment|painted panel)\b/i.test(f.evidence),
      ),
      unsupportedExtra: [
        'commons-089',
        'leather-001',
        'leather-003',
        'leather-004',
        'leather-016',
      ].includes(r.id),
    };
  });
const positiveReview = {
  at: new Date().toISOString(),
  reviewer:
    'Assistant visual review of every current positive source photograph against the returned description; not an independent specialist',
  rule: 'Matched means at least one actual physical defect or frayed/broken-material cue is described at the reference feature. A generic alert, wrong unrelated feature, or damage enum without corresponding evidence is insufficient. Wrong kinds, anatomy and extra claims are tracked separately; this is not all-claims accuracy.',
  evidence: [
    'datasets/quality-cycle-02/review/current-positive-01.jpg',
    'datasets/quality-cycle-02/review/current-positive-02.jpg',
    'datasets/quality-cycle-02/review/current-positive-03.jpg',
    'datasets/quality-cycle-02/review/current-positive-04.jpg',
    'datasets/quality-cycle-02/review/current-positive-05.jpg',
    'datasets/quality-cycle-02/review/current-positive-06.jpg',
    'datasets/quality-cycle-02/review/current-positive-07.jpg',
  ],
  cases: review,
};
await fs.writeFile(
  base + 'current-correspondence-review.json',
  JSON.stringify(positiveReview, null, 2) + '\n',
  { flag: 'w' },
);
const rows = current.map((r) => {
  const c = labels.find((c) => c.id === r.id),
    p = review.find((p) => p.id === r.id),
    old = http.find((v) => v.id === r.id);
  const improved =
    (r.condition === 'no_visible_defect' && r.baselineFlag && !r.candidateFlag) ||
    (p?.after === 'matched' && p.before !== 'matched');
  return {
    ...c,
    dataset: 'audit',
    image: path.posix.relative('datasets/quality-cycle-02', c.file),
    baselinePhoto: r.baselinePhoto,
    candidatePhoto: r.candidatePhoto,
    baselineFlag: r.baselineFlag,
    candidateFlag: r.candidateFlag,
    baselineError: r.baselineError,
    error: r.error,
    correspondenceBefore: p?.before ?? null,
    correspondenceAfter: p?.after ?? null,
    improved,
    regression:
      (r.condition === 'visible_defect' && r.baselineFlag && !r.candidateFlag) ||
      (r.condition === 'no_visible_defect' && !r.baselineFlag && r.candidateFlag) ||
      (p?.before === 'matched' && p?.after !== 'matched'),
    reliabilityImproved: !!r.baselineError && !r.error,
    reviewNote:
      p?.note ??
      (r.condition === 'no_visible_defect' && r.candidateFlag
        ? 'A condition alert remains despite no definite material defect in the frozen visual reference.'
        : null),
    referenceDispute: ['commons-024', 'commons-038', 'commons-061'].includes(r.id)
      ? 'The original annotation is disputed; it is unchanged and still included in the headline count.'
      : '',
    requestElapsedMs: old.requestElapsedMs ?? old.elapsedMs,
    firstAttemptSucceeded: old.firstAttemptSucceeded,
    selectedProgramSucceeded: !r.error,
    changeNote: improved
      ? p?.after === 'matched'
        ? 'A previously unresolved defect is now described.'
        : 'A description of an ordinary feature or negated damage no longer produces a condition alert.'
      : undefined,
  };
});
for (const r of historical.rows.filter((r) => ['fresh', 'final'].includes(r.set))) {
  const c = r.reference;
  rows.push({
    ...c,
    dataset: 'validation',
    validationSet: r.set,
    image: path.posix.relative('datasets/quality-cycle-02', c.file),
    baselinePhoto: r.baseline,
    candidatePhoto: r.candidate,
    baselineFlag: r.baselineFlag,
    candidateFlag: r.candidateFlag,
    correspondenceBefore: r.correspondenceBefore,
    correspondenceAfter: r.correspondenceAfter,
    improved: false,
    regression:
      (r.condition === 'visible_defect' && r.baselineFlag && !r.candidateFlag) ||
      (r.condition === 'no_visible_defect' && !r.baselineFlag && r.candidateFlag),
    reviewNote:
      r.condition === 'visible_defect'
        ? r.correspondenceAfter === 'matched'
          ? 'At least one description matches the reference physical defect; additional inferred lining, garment anatomy or precise cause may still be wrong.'
          : r.correspondenceAfter === 'missed'
            ? 'The visible torn jeans under a jacket were missed; the localization selected the jacket.'
            : 'The defect prompted an alert but the description does not correctly identify the material break.'
        : r.condition === 'no_visible_defect' && r.candidateFlag
          ? 'A false condition alert remains.'
          : '',
    priorSource: !!c.priorSource,
  });
}
const metrics = {};
for (const dataset of ['audit', 'validation']) {
  const g = rows.filter((r) => r.dataset === dataset),
    pos = g.filter((r) => r.condition === 'visible_defect'),
    neg = g.filter((r) => r.condition === 'no_visible_defect');
  metrics[dataset] = {
    total: g.length,
    positives: pos.length,
    negatives: neg.length,
    baselineMatched: pos.filter((r) => r.correspondenceBefore === 'matched').length,
    candidateMatched: pos.filter((r) => r.correspondenceAfter === 'matched').length,
    baselineFalse: neg.filter((r) => r.baselineFlag).length,
    candidateFalse: neg.filter((r) => r.candidateFlag).length,
    baselineCorrespondence: pos.reduce(
      (a, r) => ((a[r.correspondenceBefore] = (a[r.correspondenceBefore] ?? 0) + 1), a),
      {},
    ),
    candidateCorrespondence: pos.reduce(
      (a, r) => ((a[r.correspondenceAfter] = (a[r.correspondenceAfter] ?? 0) + 1), a),
      {},
    ),
    regressions: g.filter((r) => r.regression).length,
    completed: dataset === 'audit' ? g.filter((r) => r.firstAttemptSucceeded).length : g.length,
    selectedProgramCompleted: g.filter((r) => !r.error).length,
    visualFailures:
      neg.filter((r) => r.candidateFlag).length +
      pos.filter((r) => r.correspondenceAfter !== 'matched').length,
  };
}
const data = {
  at: new Date().toISOString(),
  metrics,
  auditScope:
    '194 real HTTP first requests: 193 completed, no socket disconnects, one invalid-index failure. Final program replay preserved those 193 outputs and repaired the failure using one 1.9-second live review. Original control uses exact captured model replies. Counts reflect assistant visual references; the corpus includes garments, raw fabric and leather, not 194 motorcycle jackets.',
  validationScope:
    '64 additional licensed images: 59 informed the conservative uncertainty guard; the final five were frozen before inference. Five are previously evaluated source controls. Many fabric photos share a capture population, so these are not independent field data. No validation accuracy gain is claimed.',
  footer:
    'A matched defect does not mean every claim or damage type is correct. 106 difficult variants and the original crash-damage photographs remain separate regression controls. Unknown history and photo-only limitations never authorize an offer or certify protective performance. The 4B model remains local to this computer; phone integration is paused.',
  rows,
};
assert.equal(rows.length, 258);
assert.equal(metrics.audit.regressions, 0);
await fs.writeFile(
  'datasets/quality-cycle-02/comparison.json',
  JSON.stringify(data, null, 2) + '\n',
  { flag: 'w' },
);
const headers = [
  'id',
  'dataset',
  'validationSet',
  'condition',
  'correspondenceBefore',
  'correspondenceAfter',
  'baselineFlag',
  'candidateFlag',
  'improved',
  'regression',
  'baselineError',
  'error',
  'reviewNote',
  'source',
  'author',
  'license',
  'licenseUrl',
  'group',
  'priorSource',
  'sha256',
];
const csv = (v) => '"' + String(v ?? '').replaceAll('"', '""') + '"';
await fs.writeFile(
  'datasets/quality-cycle-02/comparison.csv',
  [headers.map(csv).join(','), ...rows.map((r) => headers.map((k) => csv(r[k])).join(','))].join(
    '\r\n',
  ) + '\r\n',
  { flag: 'w' },
);
let template = await fs.readFile('scripts/quality-cycle-02-review-template.html', 'utf8');
template = template.replace(
  /const DATA\s*=\s*\/\*DATA\*\/\s*null;/,
  () => `const DATA=${JSON.stringify(data).replaceAll('<', '\\u003c')};`,
);
assert(!template.includes('/*DATA*/'));
await fs.writeFile('datasets/quality-cycle-02/review.html', template, { flag: 'w' });
await fs.writeFile(
  base + 'selected-summary.json',
  JSON.stringify(
    {
      at: data.at,
      metrics,
      positiveReview: 'current-correspondence-review.json',
      changes: rows
        .filter((r) => r.improved || r.reliabilityImproved)
        .map((r) => ({
          id: r.id,
          improved: r.improved,
          reliabilityImproved: r.reliabilityImproved,
        })),
      limits: [data.auditScope, data.validationScope, data.footer],
    },
    null,
    2,
  ) + '\n',
  { flag: 'w' },
);
const initial = await read('experiments/quality-cycle-02/failure-ledger.json');
const ledger = initial.cases.map((c) => {
  const r = rows.find((r) => r.id === c.id && r.dataset === 'audit');
  return {
    ...c,
    status: r.improved
      ? 'repaired_in_current_comparison'
      : r.condition === 'no_visible_defect' && !r.candidateFlag
        ? 'not_reproduced_in_current_outputs'
        : r.correspondenceAfter === 'matched'
          ? 'reference_defect_matched_other_claims_need_review'
          : 'unresolved',
    currentReview: r.reviewNote,
    currentCorrespondence: r.correspondenceAfter,
    currentFlag: r.candidateFlag,
    transport: r.firstAttemptSucceeded
      ? 'first_request_completed'
      : r.selectedProgramSucceeded
        ? 'invalid_index_failure_repaired_in_selected_program'
        : 'unresolved',
  };
});
for (const r of rows.filter(
  (r) =>
    r.dataset === 'audit' &&
    ((r.condition === 'no_visible_defect' && r.candidateFlag) ||
      (r.condition === 'visible_defect' && r.correspondenceAfter !== 'matched')) &&
    !ledger.some((c) => c.id === r.id),
))
  ledger.push({
    id: r.id,
    issues: [{ kind: 'current_visual_failure' }],
    status: 'unresolved',
    currentReview: r.reviewNote,
    currentCorrespondence: r.correspondenceAfter,
    currentFlag: r.candidateFlag,
  });
await fs.writeFile(
  'experiments/quality-cycle-02/failure-ledger-reviewed.json',
  JSON.stringify(
    {
      at: data.at,
      scope:
        'Case-level follow-up to the immutable original ledger. Not-reproduced is not a credited repair. A reference-defect match does not resolve anatomy or additional-claim errors. No case is declared universally solved.',
      cases: ledger,
      validationFailures: rows
        .filter(
          (r) =>
            r.dataset === 'validation' &&
            ((r.condition === 'no_visible_defect' && r.candidateFlag) ||
              (r.condition === 'visible_defect' && r.correspondenceAfter !== 'matched')),
        )
        .map((r) => ({
          id: r.id,
          condition: r.condition,
          correspondence: r.correspondenceAfter,
          note: r.reviewNote,
          status: 'unresolved',
        })),
    },
    null,
    2,
  ) + '\n',
  { flag: 'w' },
);
const additional = [
  ...(await read('datasets/quality-cycle-02/labels.json')).cases,
  ...(await read('datasets/quality-cycle-02/final-holdout-labels.json')).cases,
];
const hashes = [];
for (const c of additional) {
  const hash = createHash('sha256')
    .update(await fs.readFile(c.file))
    .digest('hex');
  assert.equal(hash, c.sha256);
  hashes.push(hash);
}
assert.equal(additional.length, 64);
assert.equal(new Set(hashes).size, 64);
await fs.writeFile(
  base + 'validation-image-integrity.json',
  JSON.stringify(
    {
      at: data.at,
      images: 64,
      uniqueEncodedImages: 64,
      previouslyEvaluatedSources: additional.filter((c) => c.priorSource).map((c) => c.id),
      labelsRetained: true,
      hashes: additional.map((c) => ({
        id: c.id,
        path: c.file,
        sha256: c.sha256,
        source: c.source,
        license: c.license,
      })),
    },
    null,
    2,
  ) + '\n',
  { flag: 'w' },
);
console.log(JSON.stringify(metrics, null, 2));
