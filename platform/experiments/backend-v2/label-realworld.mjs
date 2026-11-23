// E19 labels: real-world gear photographs in the corpus case format, from the blind annotations in
// datasets/realworld-v3/annotations.txt (cm-: Commons categories; ox-: the Openverse damage search,
// manifest-openverse.json) plus the first Openverse set's labels (datasets/gear-v2-openverse/labels.json,
// experiment report E15). Openverse photographs are grouped by photographer as in that set (ov-<creator>),
// so the same crash series stays one group across both harvests.
//
// Kept apart, never silently mixed:
// - photographs annotated x (not intake photographs) are dropped, with the reason;
// - a file listed twice by the two harvests (same bytes) is kept once, under its first id;
// - a file that is also in a calibration corpus (quality-audit-01, quality-cycle-02, matched by Commons
//   title) is kept but marked `seenInCalibration`, because the shipped thresholds were fitted with it.
//   The held-out result excludes these; they are reported as a control.
// node experiments/backend-v2/label-realworld.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './lib.mjs';

const read = async (p) => JSON.parse(await fs.readFile(path.join(ROOT, p), 'utf8'));
const dir = 'datasets/realworld-v3';
const { images } = await read(dir + '/manifest.json');
const byId = new Map(images.map((m) => [m.id, m]));
const ox = (
  await fs
    .readFile(path.join(ROOT, dir, 'manifest-openverse.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => ({ images: [] }))
).images;
for (const m of ox) byId.set(m.id, m);
const ovLicense = (m) =>
  ('CC ' + m.license.toUpperCase() + ' ' + (m.licenseVersion ?? ''))
    .trim()
    .replace('CC PDM', 'Public Domain Mark')
    .replace('CC CC0', 'CC0');
const CONDITION = { c: 'clean', d: 'damaged', a: 'ambiguous' };
const SUBJECT = { J: 'jacket', T: 'trousers', S: 'suit', G: 'gloves', B: 'boots', H: 'helmet', A: 'armour', V: 'vest', O: 'other', M: 'several' };
const FRAMING = { i: 'item', m: 'several_items', w: 'worn', s: 'scene', d: 'detail', l: 'label' };
const norm = (t) => String(t ?? '').replace(/^File:/, '').replaceAll('_', ' ').trim().toLowerCase();
const seen = new Map();
for (const corpus of ['datasets/quality-audit-01/labels.json', 'datasets/quality-cycle-02/labels.json'])
  for (const c of (await read(corpus)).cases) seen.set(norm(c.title), c.id);
const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

const cases = [],
  dropped = [],
  firstBySha = new Map();
const lines = (await fs.readFile(path.join(ROOT, dir, 'annotations.txt'), 'utf8'))
  .split('\n')
  .filter((l) => l.startsWith('cm-') || l.startsWith('ox-'));
for (const line of lines) {
  const [id, cond, subj, framing, ...note] = line.trim().split(/\s+/);
  const m = byId.get(id);
  if (!m || m.error) throw new Error('annotated photograph missing from the manifest: ' + id);
  if (cond === 'x') {
    dropped.push({ id, reason: 'not an intake photograph: ' + note.join(' ') });
    continue;
  }
  if (firstBySha.has(m.sha256)) {
    dropped.push({ id, reason: 'same file as ' + firstBySha.get(m.sha256) });
    continue;
  }
  firstBySha.set(m.sha256, id);
  if (!CONDITION[cond] || !SUBJECT[subj] || !FRAMING[framing[0]]) throw new Error('bad annotation: ' + line);
  const back = framing.endsWith('b');
  const isOx = id.startsWith('ox-');
  cases.push({
    id,
    source: isOx ? 'openverse' : 'commons',
    domain: 'realworld',
    file: m.file,
    page: isOx ? m.landingUrl : m.source,
    author: isOx ? m.creator : m.author,
    license: isOx ? ovLicense(m) : m.license,
    licenseUrl: m.licenseUrl,
    title: m.title,
    sha256: m.sha256,
    width: m.width,
    height: m.height,
    originalWidth: m.originalWidth ?? null,
    fetched: isOx ? 'original' : (m.fetched ?? null),
    group: isOx ? 'ov-' + (slug(m.creator).replaceAll('-', '') || id) : 'cm-' + (slug(m.author) || id),
    condition: CONDITION[cond],
    subject: SUBJECT[subj],
    framing: FRAMING[framing[0]],
    view: framing[0] === 'd' ? 'detail' : framing[0] === 'l' ? 'label' : back ? 'back' : 'front',
    seenInCalibration: seen.get(norm(m.title)) ?? null,
    labelledBy: 'assistant, blind, before scoring (annotations.txt)',
    visualBasis: note.join(' '),
  });
}
// The Openverse set (E15): already held out from calibration, scored there as front views.
const OV_CONDITION = { visible_defect: 'damaged', no_visible_defect: 'clean', ambiguous: 'ambiguous' };
for (const c of (await read('datasets/gear-v2-openverse/labels.json')).cases)
  cases.push({
    id: c.id,
    source: 'openverse',
    domain: 'realworld',
    file: c.file,
    page: c.source,
    author: c.author,
    license: c.license,
    licenseUrl: c.licenseUrl,
    title: c.title,
    sha256: c.sha256,
    width: c.width,
    height: c.height,
    originalWidth: null,
    fetched: 'original',
    group: c.group,
    condition: OV_CONDITION[c.condition],
    subject: c.subject === 'garment' ? 'garment' : c.subject,
    framing: 'item',
    view: c.view,
    seenInCalibration: null,
    labelledBy: c.labelledBy,
    visualBasis: c.visualBasis,
  });
const count = (f) => cases.reduce((o, c) => ((o[f(c)] = (o[f(c)] ?? 0) + 1), o), {});
const out = {
  created: new Date().toISOString().slice(0, 10),
  note: 'E19 real-world set. Labels are the assistant\'s blind visual annotations, not expert labels. Use heldOut cases for the result; seenInCalibration cases are a control.',
  counts: {
    cases: cases.length,
    heldOut: cases.filter((c) => !c.seenInCalibration).length,
    seenInCalibration: cases.filter((c) => c.seenInCalibration).length,
    byCondition: count((c) => c.condition),
    byFraming: count((c) => c.framing),
    bySubject: count((c) => c.subject),
    dropped: dropped.length,
  },
  cases,
  dropped,
};
await fs.writeFile(path.join(ROOT, dir, 'labels.json'), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out.counts, null, 1));
