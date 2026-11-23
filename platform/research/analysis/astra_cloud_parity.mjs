/** D-015 hardware gate. No OpenAI attachments or paid provider keys. One upload at a time.
 * Lock a local reference first. Reruns resume verified rows from the same manifest and endpoint.
 * Output records may be shared internally. They contain no pixels or signing secrets. */
import fs from 'node:fs';
import { compareHardware, referenceBaseline } from './astra_hardware_comparison.mjs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import { scorePhoto, assess, serviceBase, serviceHealthV2 } from '../../app/src/api-v2.ts';
import { bindingCountPhoto } from '../../packages/core/v2/count-review.ts';
import { decide2 } from '../../packages/core/v2/policy.ts';
const policy = JSON.parse(fs.readFileSync('packages/core/v2/policy.config.json')),
  bands = JSON.parse(fs.readFileSync('packages/core/v2/thresholds.json'));
const model = 'qwen3.5:4b@d8b0f5e9760c';
bands.perScorer.local_logprob.models = [model, model + ' cascade'];
const [mode, outDir, reference] = process.argv.slice(2);
if (!['local', 'cloud', 'compare'].includes(mode) || !outDir)
  throw Error('Use local OUT, cloud OUT LOCAL.jsonl, or compare CLOUD.jsonl LOCAL.jsonl.');
const root = 'collab/baseline/v35-activation/hosting',
  rawManifest = fs.readFileSync(
    process.env.RELAY_PARITY_MANIFEST ?? root + '/cloud-parity-manifest.json',
  );
const manifest = JSON.parse(rawManifest),
  hash = (b) => createHash('sha256').update(b).digest('hex'),
  signature = hash(rawManifest);
const lines = (p) =>
  fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse) : [];
const id = (r) => r.cohort + '/' + r.id,
  byId = (list) => new Map(list.map((r) => [id(r), r]));
function compare(candidate, local) {
  const archived = lines('collab/baseline/v31-as-restored/restored-model-44-full-precision.jsonl');
  return compareHardware(
    manifest,
    signature,
    local,
    candidate,
    manifest.version === 2
      ? JSON.parse(fs.readFileSync(root + '/reference-closeups/local-repeatability.json', 'utf8'))
      : referenceBaseline(archived, local),
  );
}
if (mode === 'compare') {
  assert(reference);
  const r = compare(lines(outDir), lines(reference));
  console.log(JSON.stringify(r, null, 2));
  if (!r.passed) process.exitCode = 1;
} else {
  const cloud = mode === 'cloud';
  const url = serviceBase(process.env.RELAY_PARITY_URL ?? (cloud ? '' : 'http://127.0.0.1:8788'));
  if (!cloud && !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(url))
    throw Error('Local reference is restricted to loopback.');
  if (cloud && (!url.startsWith('https://') || !process.env.RELAY_PARITY_TOKEN || !reference))
    throw Error(
      'Cloud comparison requires the controlled HTTPS API, token and complete frozen reference.',
    );
  let tie, affected;
  if (process.env.RELAY_PARITY_TIE_REPORT) {
    const prior = JSON.parse(fs.readFileSync(process.env.RELAY_PARITY_TIE_REPORT, 'utf8'));
    const round = Number(process.env.RELAY_PARITY_ROUND),
      processEvidence = process.env.RELAY_PARITY_PROCESS_EVIDENCE;
    if (
      prior.manifest !== signature ||
      ![1, 2, 3].includes(round) ||
      !processEvidence ||
      !/^[-a-zA-Z0-9_.:@/ ]{3,160}$/.test(processEvidence)
    )
      throw Error(
        'A tie-break requires the original comparison, round 1–3, and fresh process evidence.',
      );
    affected = new Set([
      ...prior.operationalDecisionOrRoutingFlips,
      ...prior.cascadeBranchChanges.map((x) => x[0]),
    ]);
    if (!affected.size) throw Error('No operative or cascade flip requires a repeat.');
    tie = { side: cloud ? 'cloud' : 'local', round, processEvidence };
  }
  const previous = cloud ? lines(reference) : [];
  if (cloud && !compare(previous, previous).passed) throw Error('Incomplete local reference.');
  if (cloud) {
    const approved = 'e0c09edc030f5dc547b2e4d803c0d6f34c4ae3062351c50121cb64c503077519';
    const supplemental = 'b2738e202a435fb0f2edac83cdd58bbba174801125ff620ed2bd5761e027a3c9';
    if (
      ![approved, supplemental].includes(signature) ||
      manifest.rows.some(
        (r) => !r.attribution.license || !r.attribution.page || r.id.startsWith('user-'),
      )
    )
      throw Error(
        'Only the owner-approved noncommercial hardware qualification manifest may be sent.',
      );
  }
  let sharedEnd = Infinity;
  if (cloud) {
    const windowFile = root + '/cloud-rehearsal-window.json';
    if (!fs.existsSync(windowFile)) {
      try {
        fs.writeFileSync(windowFile, JSON.stringify({ url, start: Date.now(), limitMinutes: 90 }), {
          flag: 'wx',
        });
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }
    }
    const clock = JSON.parse(fs.readFileSync(windowFile, 'utf8'));
    if (clock.url !== url || clock.limitMinutes !== 90 || !Number.isFinite(clock.start))
      throw Error('Shared cloud qualification window differs.');
    sharedEnd = clock.start + 90 * 60000;
    if (Date.now() >= sharedEnd) throw Error('The shared 90-minute cloud rehearsal has ended.');
  }
  fs.mkdirSync(outDir, { recursive: true });
  const output = path.join(outDir, mode + '.jsonl'),
    done = byId(lines(output));
  for (const r of done.values())
    if (
      r.manifest !== signature ||
      r.endpoint !== url ||
      (tie
        ? r.tieBreak?.processEvidence !== tie.processEvidence || r.tieBreak?.round !== tie.round
        : r.tieBreak !== undefined)
    )
      throw Error('Mixed experiment provenance.');
  const c = { url, token: process.env.RELAY_PARITY_TOKEN ?? '' },
    health = await serviceHealthV2(c, AbortSignal.timeout(20000));
  assert.equal(health?.engineRelease, '3.5');
  async function metrics() {
    const res = await fetch(url + '/v2/metrics', {
      headers: c.token ? { 'X-Relay-Token': c.token } : {},
      signal: AbortSignal.timeout(9000),
    });
    assert(res.ok, 'Read-only metrics are required to verify a fresh score');
    const m = (await res.json()).local_logprob;
    return { scored: m?.scored ?? 0, cached: m?.cached ?? 0 };
  }
  const stamp = '2026-11-20T00:00:00.000Z',
    disc = (crash) =>
      ['crash', 'protective_damage', 'protective_repair'].map((question) => ({
        id: question,
        question,
        answer: question === 'crash' ? crash : 'no',
        recordedAt: stamp,
      }));
  const refs = JSON.parse(fs.readFileSync('datasets/realworld-v3/labels.json', 'utf8')).cases;
  const cmpBack = refs.find((q) => q.id === 'cm-107'),
    cmpLabel = 'assets/fixtures/backpack-label.jpg';
  const fixed = {
    back: fs.readFileSync(cmpBack.file).toString('base64'),
    label: fs.readFileSync(cmpLabel).toString('base64'),
  };
  async function guard() {
    if (cloud || process.platform !== 'win32') return;
    for (let i = 0; i < 180; i++) {
      const [temp, vram] = execFileSync(
        'nvidia-smi',
        ['--query-gpu=temperature.gpu,memory.used', '--format=csv,noheader,nounits'],
        { encoding: 'utf8', windowsHide: true },
      )
        .trim()
        .split(',')
        .map(Number);
      const tasks = execFileSync(
        'nvidia-smi',
        ['--query-compute-apps=pid,process_name', '--format=csv,noheader'],
        { encoding: 'utf8', windowsHide: true },
      );
      if (
        temp >= 85 ||
        vram >= 7000 ||
        os.freemem() < 2 * 2 ** 30 ||
        /\\steamapps\\common\\|\\xboxgames\\|shipping\.exe/i.test(tasks)
      )
        throw Error(
          'Local guard: C=' +
            temp +
            ' MiB=' +
            vram +
            ' freeGiB=' +
            (os.freemem() / 2 ** 30).toFixed(2),
        );
      if (temp <= 56 && os.freemem() > 3 * 2 ** 30) return;
      await wait(500);
    }
    throw Error('Cooling time expired.');
  }
  const safety = new AbortController();
  function checkGame() {
    if (cloud || process.platform !== 'win32') return;
    const rows = execFileSync('tasklist.exe', ['/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (
      /^"(?:Civilization[^"]*|FortniteClient[^"]*|cs2|dota2|GTA5|eldenring|Overwatch|RocketLeague|[^"]*-Win64-Shipping)\.exe"/im.test(
        rows,
      )
    )
      throw Error('Game running');
  }
  checkGame();
  const monitor = setInterval(() => {
    if (cloud || process.platform !== 'win32') return;
    try {
      checkGame();
      const [t, v] = execFileSync(
        'nvidia-smi',
        ['--query-gpu=temperature.gpu,memory.used', '--format=csv,noheader,nounits'],
        { encoding: 'utf8', windowsHide: true },
      )
        .split(',')
        .map(Number);
      if (t >= 85 || v >= 7000 || os.freemem() < 2 * 2 ** 30)
        throw Error(
          'Hardware guard: C=' +
            t +
            ' MiB=' +
            v +
            ' freeGiB=' +
            (os.freemem() / 2 ** 30).toFixed(2),
        );
    } catch (e) {
      safety.abort(e);
    }
  }, 3500);
  monitor.unref();
  const deadline = (ms) => AbortSignal.any([safety.signal, AbortSignal.timeout(ms)]);
  if (manifest.version === 2) {
    const fixture = (id) => fs.readFileSync(refs.find((x) => x.id === id).file).toString('base64');
    fixed.front = fixture('ox-080');
    fixed.back = fixture('ox-081');
  }
  const start = fs.existsSync(output) ? fs.statSync(output).birthtimeMs : Date.now(),
    maxMs = (cloud ? 90 : 120) * 60000;
  const fixtures = {};
  for (const [view, base64] of Object.entries(fixed)) {
    await guard();
    fixtures[view] = await scorePhoto(
      c,
      { assessmentId: 'd015-fixture', photoId: 'control-' + view, view, base64 },
      deadline(130000),
    );
  }
  for (const r of process.env.RELAY_PARITY_REVERSE === '1'
    ? [...manifest.rows].reverse()
    : manifest.rows) {
    if (done.has(id(r)) || (affected && !affected.has(id(r)))) continue;
    if (Date.now() >= sharedEnd) throw Error('The shared 90-minute cloud rehearsal has ended.');
    if (Date.now() - start > maxMs) throw Error('Preregistered session time limit.');
    await guard();
    const raw = fs.readFileSync(r.file);
    assert.equal(hash(raw), r.rawSha256);
    const source =
      r.cohort === 'field44'
        ? await sharp(raw)
            .rotate()
            .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
            .toColourspace('srgb')
            .jpeg({ quality: 82 })
            .toBuffer()
        : raw;
    const input = hash(source),
      assessmentId = 'd015-' + r.cohort + '-' + r.id;
    const beforeTie = tie ? await metrics() : null;
    let afterTie = null;
    const index = await scorePhoto(
      c,
      { assessmentId, photoId: 'index', view: r.view, base64: source.toString('base64') },
      deadline(130000),
    );
    assert.equal(index.signed.scores.scorer.model, 'qwen3.5:4b@d8b0f5e9760c cascade');
    if (tie) {
      afterTie = await metrics();
      assert.equal(afterTie.scored, beforeTie.scored + 1, 'Rerun did not add one fresh score');
      assert.equal(afterTie.cached, beforeTie.cached, 'A cache hit cannot count as a repeat');
    }
    const support = Object.entries(fixtures)
      .filter(([view]) => view !== r.view)
      .map(([, v]) => v);
    const photos = [index, ...support].map((x) => x.photo),
      signedScores = [index, ...support].map((x) => x.signed);
    const decisions = {};
    let r2 = null;
    for (const history of ['no', 'yes', 'unknown']) {
      const disclosures = disc(history);
      const res = await assess(
        c,
        { assessmentId, photos, signedScores, disclosures, closeUpsRequested: 0 },
        deadline(15000),
      );
      decisions[history] = res.decision;
      if (history === 'no') {
        const scores = signedScores.map((s) => s.scores);
        r2 = bindingCountPhoto(res.decision, disclosures, photos, scores, false)?.id ?? null;
        if (r2) {
          decisions.fixedNegative = res.decision;
          decisions.fixedPositive = decide2({
            disclosures,
            photos,
            scores,
            closeUpsRequested: 0,
            config: policy,
            thresholds: bands,
            acceptedCountPhotoId: r2,
          });
        }
      }
    }
    const measured = index.signed.scores.answers;
    let detailCascadeBranch = null;
    if (r.view === 'detail') {
      const road = measured.road_contact_low?.p,
        broken = measured.broken_low?.p;
      assert(Number.isFinite(road), 'Missing measured 512 road response');
      if (road >= 0.552) detailCascadeBranch = 'settled512';
      else {
        assert(Number.isFinite(broken), 'Missing measured 512 structural response');
        const p = Math.max(road, broken);
        detailCascadeBranch = p < 0.139 || p >= 0.552 ? 'settled512' : 'reasked1600';
      }
    }
    const row = {
      ...(tie
        ? {
            tieBreak: {
              ...tie,
              signedScoredAt: index.signed.scores.scoredAt,
              indexScoredFresh: true,
              scoredBefore: beforeTie.scored,
              scoredAfter: afterTie.scored,
              cachedBefore: beforeTie.cached,
              cachedAfter: afterTie.cached,
            },
          }
        : {}),
      ...(manifest.version === 2 ? { detailCascadeBranch } : {}),
      manifest: signature,
      endpoint: url,
      id: r.id,
      cohort: r.cohort,
      input,
      normalized: index.photo.sha256,
      archivedInputMatch: r.archivedMobileSha ? input === r.archivedMobileSha : null,
      answers: index.signed.scores.answers,
      decisions,
      r2,
    };
    fs.appendFileSync(output, JSON.stringify(row) + '\n');
    if (!cloud) await wait(1800);
  }
  if (cloud && !tie) {
    const summary = compare(lines(output), previous);
    fs.writeFileSync(
      path.join(outDir, 'cloud-comparison.json'),
      JSON.stringify(summary, null, 2) + '\n',
    );
    if (!summary.passed) process.exitCode = 1;
  }
}
