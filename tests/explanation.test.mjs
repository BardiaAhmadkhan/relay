import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
let vite, explain;
before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true, watch: null, hmr: false },
    appType: 'custom',
    logLevel: 'silent',
  });
  explain = (await vite.ssrLoadModule('/src/inspection/decision.ts')).explainDecision;
});
after(() => vite?.close());
const base = {
  card: { id: 'test-item', category: 'jacket', outcome: 'request' },
  eligible: false,
  history: 'History unconfirmed',
  reason: 'More evidence needed.',
  reasons: [],
  next: null,
  needs: [],
  frames: [],
  zones: [],
  notes: [],
  identityConflict: false,
};
test('combined history never becomes a claim that a specific crash happened and carries no photo attribution', () => {
  const r = explain({
    ...base,
    card: { ...base.card, outcome: 'retire' },
    history: 'An exclusion was disclosed',
  });
  assert.match(r.lead, /crash, damage or repair/);
  assert.equal(r.lines[0].label, 'Your answer');
  assert.deepEqual(r.lines[0].sources, []);
});
test('mixed labels and uncertain hardware link only existing sources and keep alternative evidence groups separate', () => {
  const identity = explain({
    ...base,
    identityConflict: true,
    identitySources: ['one', 'missing'],
    frames: [{ id: 'one' }],
    needs: [['history', 'identity'], ['bound_readable_label']],
  });
  assert.deepEqual(identity.lines[0].sources, ['one']);
  assert.equal(identity.routes.length, 2);
  const hardware = explain({
    ...base,
    card: { ...base.card, outcome: 'specialist' },
    observation: 'Show the vent mount.',
    observationKind: 'hardware_damage',
    observationSource: 'finding:1',
    frames: [{ id: 'finding:1' }],
  });
  assert.match(hardware.lead, /normal opening or a broken mount/);
  assert.deepEqual(hardware.lines[0].sources, ['finding:1']);
  assert.match(hardware.next, /vent mount/);
});
test('an eligible assessment and an unfinished personal assessment get distinct explanations', () => {
  const ok = explain({
    ...base,
    card: { ...base.card, outcome: 'keep' },
    eligible: true,
    history: 'Rider declared clear',
  });
  assert.match(ok.heading, /Eligible/);
  const undecided = explain({
    ...base,
    card: { ...base.card, id: 'LOCAL-example', outcome: 'specialist' },
  });
  assert.match(undecided.lines[0].text, /live inspection has not been run/);
});
