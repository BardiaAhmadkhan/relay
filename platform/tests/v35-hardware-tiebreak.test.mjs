import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRow, combinedGate } from '../research/analysis/astra_parity_tiebreak.mjs';
import { evidenceDigest } from '../research/analysis/astra_hardware_comparison.mjs';
const primary = 'e0c09edc030f5dc547b2e4d803c0d6f34c4ae3062351c50121cb64c503077519',
  supp = 'b2738e202a435fb0f2edac83cdd58bbba174801125ff620ed2bd5761e027a3c9';
function row(side, option, round = 0, id = 'x', manifest = primary) {
  const card = {
    outcome: option,
    grade: null,
    reasons: [{ code: 'why', text: option, photoId: 'index', score: 0.3 }],
    nextAction: option,
  };
  return {
    id,
    cohort: 'test',
    manifest,
    input: id + 'raw',
    normalized: id + 'jpeg',
    endpoint: side === 'local' ? 'http://127.0.0.1:8788' : 'https://example.invalid',
    r2: null,
    answers: { gear: { type: 'yesno', p: 0.6 } },
    decisions: { no: card, yes: card, unknown: card },
    ...(round
      ? {
          tieBreak: {
            round,
            side,
            processEvidence: side + '-process-' + round,
            indexScoredFresh: true,
            scoredBefore: 2,
            scoredAfter: 3,
            cachedBefore: 0,
            cachedAfter: 0,
            signedScoredAt: '2026-11-20T00:0' + round + ':00Z',
          },
        }
      : {}),
  };
}
const makeRounds = (s, opts) => opts.map((v, i) => row(s, v, i + 1));
test('stable laptop requires a strict cloud majority; a 2–2 split remains unresolved', () => {
  const a = row('local', 'a'),
    b = row('cloud', 'b'),
    l = makeRounds('local', ['a', 'a', 'a']);
  assert.equal(
    classifyRow(a, b, l, makeRounds('cloud', ['b', 'b', 'a'])).classification,
    'hardware-flip',
  );
  assert.equal(
    classifyRow(a, b, l, makeRounds('cloud', ['a', 'a', 'a'])).classification,
    'cloud-majority-matches',
  );
  assert.equal(
    classifyRow(a, b, l, makeRounds('cloud', ['b', 'a', 'a'])).classification,
    'inconclusive-tied-cloud-vote',
  );
});
test('does not count cached, missing, source-mismatched, or repeated local processes as new votes', () => {
  const a = row('local', 'a'),
    b = row('cloud', 'b');
  for (const change of [
    (r) => r.pop(),
    (r) => (r[1].tieBreak.indexScoredFresh = false),
    (r) => (r[1].input = 'changed'),
    (r) => (r[1].tieBreak.processEvidence = r[0].tieBreak.processEvidence),
    (r) => (r[1].tieBreak.signedScoredAt = r[0].tieBreak.signedScoredAt),
  ]) {
    const l = makeRounds('local', ['a', 'b', 'a']);
    change(l);
    assert.equal(
      classifyRow(a, b, l, makeRounds('cloud', ['a', 'a', 'b'])).classification,
      'incomplete',
    );
  }
  const l = makeRounds('local', ['a', 'b', 'a']);
  assert.equal(
    classifyRow(a, b, l, makeRounds('cloud', ['a', 'b', 'a'])).classification,
    'unstable-on-any-hardware',
  );
  assert.equal(
    classifyRow(a, b, l, makeRounds('cloud', ['c', 'b', 'a'])).classification,
    'investigate-new-cloud-disposition',
  );
});
function study(manifest, ids) {
  const s = {
    report: {
      manifest,
      memberships: ids.length,
      complete: true,
      missingEvidenceOrHeads: [],
      investigate: false,
      operationalDecisionOrRoutingFlips: ids.map((id) => 'test/' + id),
      cascadeBranchChanges: [],
    },
    local: ids.map((id) => row('local', 'a', 0, id, manifest)),
    cloud: ids.map((id) => row('cloud', 'b', 0, id, manifest)),
    localRounds: [1, 2, 3].map((n) =>
      ids.map((id) => row('local', n === 2 ? 'b' : 'a', n, id, manifest)),
    ),
    cloudRounds: [1, 2, 3].map((n) =>
      ids.map((id) => row('cloud', n === 2 ? 'a' : 'b', n, id, manifest)),
    ),
  };
  s.report.localEvidenceSha256 = evidenceDigest(s.local);
  s.report.cloudEvidenceSha256 = evidenceDigest(s.cloud);
  return s;
}
test('the third unstable row across both studies holds the deployment; local self-comparisons cannot approve', () => {
  assert(combinedGate([study(primary, ['x']), study(supp, ['y'])]).qualificationPassed);
  const over = combinedGate([study(primary, ['x', 'z']), study(supp, ['y'])]);
  assert.equal(over.unstableRows, 3);
  assert(!over.qualificationPassed);
  const a = study(primary, ['x']);
  a.cloud = a.local;
  assert(!combinedGate([a, study(supp, ['y'])]).qualificationPassed);
  const missing = study(primary, ['x']);
  missing.report.missingEvidenceOrHeads = [['x', 'hole']];
  assert(!combinedGate([missing, study(supp, ['y'])]).qualificationPassed);
});
