import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compareHardware,
  referenceBaseline,
} from '../research/analysis/astra_hardware_comparison.mjs';
const manifest = {
  rows: [{ id: 'x', cohort: 'field44', view: 'front', stratum: 'riding' }],
  uniqueRawImages: 1,
};
const score = (p) => ({ road_contact: { type: 'yesno', p } });
const decision = (p, code = 'check') => ({
  outcome: 'retake',
  grade: null,
  nextAction: 'Photograph the front',
  requestPhoto: { view: 'front' },
  reasons: [{ code, text: 'Check the item', photoId: 'index', question: null, score: p }],
});
const row = (p, code) => ({
  id: 'x',
  cohort: 'field44',
  manifest: 'frozen',
  input: 'raw',
  normalized: 'norm',
  answers: score(p),
  decisions: { no: decision(p, code), yes: decision(p), unknown: decision(p) },
  r2: null,
});
const local = [row(0.2)],
  base = referenceBaseline(
    [{ item: 'x', record: { sha256: 'norm' }, scores: { answers: score(0.18) } }],
    local,
  );
test('rescoring keeps a numerical reason change separate from a rider instruction and reports threshold margin', () => {
  const r = compareHardware(manifest, 'frozen', local, [row(0.22)], base);
  assert(r.passed);
  assert.equal(r.numericOnlyPayloadDifferences.length, 1);
  assert.equal(r.operationalDecisionOrRoutingFlips.length, 0);
  assert.equal(r.perHead.road_contact.changedValues, 1);
  assert.equal(r.strata['field44/riding'].perHead.road_contact.n, 1);
  assert.equal(r.smallestLocalDistanceToLine['damage.clear'].case, 'field44/x');
});
test('fails an operative flip, missing evidence and missing head; alarms on excessive drift with no outcome flip', () => {
  assert(!compareHardware(manifest, 'frozen', local, [row(0.2, 'other')], base).operativePassed);
  assert(!compareHardware(manifest, 'frozen', local, [], base).passed);
  assert(!compareHardware(manifest, 'frozen', local, [{ ...row(0.2), answers: {} }], base).passed);
  const r = compareHardware(manifest, 'frozen', local, [row(0.34)], base);
  assert(r.operativePassed);
  assert(!r.passed);
  assert.equal(r.alarms.length, 2);
});
