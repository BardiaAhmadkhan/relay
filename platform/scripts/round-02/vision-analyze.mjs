import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const quantile = (a, p) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.max(0, Math.ceil(s.length * p) - 1)];
};
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y),
    m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const rate = (n, d) => (d ? n / d : null);
const outcome = (prediction, expected, failed) =>
  failed
    ? 'failure'
    : prediction === 'unknown'
      ? 'abstention'
      : prediction === expected
        ? 'correct'
        : 'wrong';
function metrics(rows) {
  const valid = rows.filter((r) => r.scoreCategory);
  const summary = { n: valid.length, correct: 0, wrong: 0, abstention: 0, failure: 0 };
  for (const r of valid) summary[outcome(r.category, r.expectedCategory, r.failed)]++;
  summary.coverage = rate(summary.correct + summary.wrong, summary.n);
  summary.selectiveCorrectness = rate(summary.correct, summary.correct + summary.wrong);
  const groups = new Map();
  for (const r of valid) {
    const a = groups.get(r.group) ?? [];
    a.push(outcome(r.category, r.expectedCategory, r.failed));
    groups.set(r.group, a);
  }
  const grouped = { n: groups.size, correct: 0, wrong: 0, abstention: 0, failure: 0 };
  const perGroup = [];
  for (const [group, states] of groups) {
    const state = states.includes('failure')
      ? 'failure'
      : states.includes('wrong')
        ? 'wrong'
        : states.includes('abstention')
          ? 'abstention'
          : 'correct';
    grouped[state]++;
    perGroup.push({ group, outcome: state });
  }
  grouped.coverage = rate(grouped.correct + grouped.wrong, grouped.n);
  grouped.selectiveCorrectness = rate(grouped.correct, grouped.correct + grouped.wrong);
  return { ...summary, grouped, perGroup };
}
function rng(seed) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const format = (x) => (x === null ? 'n/a' : typeof x === 'number' ? x.toFixed(1) : String(x));
const pct = (x) => (x === null ? 'n/a' : (x * 100).toFixed(1) + '%');
export async function analyze(runDirectory) {
  const runDir = path.resolve(root, runDirectory);
  const run = JSON.parse(await fs.readFile(path.join(runDir, 'run.json'), 'utf8'));
  const corpus = JSON.parse(
    await fs.readFile(path.join(root, 'experiments/round-02/vision/corpus.json'), 'utf8'),
  );
  const cases = JSON.parse(
    await fs.readFile(path.join(root, 'experiments/round-02/vision/cases.json'), 'utf8'),
  );
  const plan = JSON.parse(
    await fs.readFile(path.join(root, 'experiments/round-02/vision/schedule.json'), 'utf8'),
  );
  const trials = (await fs.readFile(path.join(runDir, 'trials.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const first = trials
    .filter((t) => t.repeat === 0)
    .map((t) => ({
      ...t,
      category: t.observation?.category ?? 'unknown',
      failed: t.status !== 'success',
    }));
  const byKey = new Map(first.map((t) => [t.model + '|' + t.caseId, t]));
  const cross = cases.map((c) => {
    const a = byKey.get('local_clip|' + c.id),
      b = byKey.get('local_siglip|' + c.id);
    return {
      ...c,
      caseId: c.id,
      model: 'cross_model',
      repeat: 0,
      category:
        a && b && !a.failed && !b.failed && a.category === b.category ? a.category : 'unknown',
      failed: !a || !b || a.failed || b.failed,
      requestMs: (a?.requestMs ?? 0) + (b?.requestMs ?? 0),
    };
  });
  const all = [...first, ...cross];
  const conditions = [...new Set(cases.map((c) => c.condition))];
  const summaries = [];
  for (const dataset of ['historical', 'new'])
    for (const model of ['local_clip', 'local_siglip', 'cross_model'])
      for (const condition of conditions) {
        const rows = all.filter(
          (t) => t.dataset === dataset && t.model === model && t.condition === condition,
        );
        const timed = trials
          .filter(
            (t) =>
              t.dataset === dataset &&
              t.model === model &&
              t.condition === condition &&
              t.status === 'success' &&
              t.inferenceExecuted,
          )
          .map((t) => t.requestMs);
        summaries.push({
          dataset,
          model,
          condition,
          ...metrics(rows),
          inferenceTiming: {
            n: timed.length,
            medianMs: median(timed),
            p95NearestRankMs: quantile(timed, 0.95),
          },
          medianBytes: median(rows.map((r) => r.bytes)),
        });
      }
  const stability = [];
  for (const model of ['local_clip', 'local_siglip'])
    for (const c of cases) {
      const sample = trials.filter((t) => t.model === model && t.caseId === c.id);
      const labels = sample.map((t) =>
        t.status === 'success' ? t.observation.category : 'failure',
      );
      stability.push({
        model,
        caseId: c.id,
        dataset: c.dataset,
        repeatCount: sample.length,
        stable: sample.length === 3 && new Set(labels).size === 1,
        categories: labels,
      });
    }
  const hypothesis1 = [];
  for (const model of ['local_clip', 'local_siglip', 'cross_model']) {
    const reference = summaries.find(
      (s) => s.dataset === 'new' && s.model === model && s.condition === 'reference',
    );
    const medium = summaries.find(
      (s) => s.dataset === 'new' && s.model === model && s.condition === 'medium',
    );
    const ratios = new Map();
    for (const f of corpus.sources.filter((f) => f.dataset === 'new' && f.scoreCategory)) {
      const a = cases.find((c) => c.sourceId === f.id && c.condition === 'reference'),
        b = cases.find((c) => c.sourceId === f.id && c.condition === 'medium');
      const arr = ratios.get(f.group) ?? [];
      arr.push(b.bytes / a.bytes);
      ratios.set(f.group, arr);
    }
    const medianRatio = median([...ratios.values()].map(mean));
    const beforeWrong = new Set(
      reference.perGroup.filter((g) => g.outcome === 'wrong').map((g) => g.group),
    );
    const addedWrongGroups = medium.perGroup
      .filter((g) => g.outcome === 'wrong' && !beforeWrong.has(g.group))
      .map((g) => g.group);
    const changedGroups = reference.perGroup.map((g) => ({
      group: g.group,
      reference: g.outcome,
      medium: medium.perGroup.find((m) => m.group === g.group)?.outcome,
    }));
    const deltas = changedGroups.map(
      (g) => (g.medium === 'wrong' ? 1 : 0) - (g.reference === 'wrong' ? 1 : 0),
    );
    const random = rng(2026102699);
    const boot = [];
    for (let i = 0; i < 3000; i++) {
      const sample = [];
      for (let j = 0; j < deltas.length; j++)
        sample.push(deltas[Math.floor(random() * deltas.length)]);
      boot.push(mean(sample));
    }
    hypothesis1.push({
      model,
      groupCount: reference.grouped.n,
      medianByteRatio: medianRatio,
      medianByteReduction: 1 - medianRatio,
      addedWrongGroups,
      changedGroups,
      reference: reference.grouped,
      medium: medium.grouped,
      preregisteredNecessaryGatePassed: medianRatio <= 0.5 && addedWrongGroups.length === 0,
      groupResampleWrongRateDifference: {
        replicates: 3000,
        seed: 2026102699,
        observed: mean(deltas),
        percentile2_5: quantile(boot, 0.025),
        percentile97_5: quantile(boot, 0.975),
        interpretation:
          'Conditional resampling sensitivity of these convenience groups; no population confidence claim. A zero-width range does not exclude unseen failures.',
      },
    });
  }
  const probes = [];
  for (const p of plan.probes)
    for (const model of ['local_clip', 'local_siglip']) {
      const a = byKey.get(model + '|' + p.overviewCase),
        b = byKey.get(model + '|' + p.additionalCase);
      const overview = a?.observation?.category ?? 'unknown';
      const additional =
        p.additionalView === 'label' ? null : (b?.views?.[0]?.category ?? 'unknown');
      const baseline =
        overview !== 'unknown' && (additional === null || additional === overview)
          ? overview
          : 'unknown';
      const overviewOnly = overview;
      probes.push({
        ...p,
        model,
        baseline,
        overviewOnly,
        baselineOutcome: p.score ? outcome(baseline, p.expected, false) : 'unscored',
        overviewOnlyOutcome: p.score ? outcome(overviewOnly, p.expected, false) : 'unscored',
        derivedFromFrozenRepeatZero: true,
      });
    }
  const probeSummaries = [];
  for (const dataset of ['historical', 'new'])
    for (const model of ['local_clip', 'local_siglip'])
      for (const type of [...new Set(plan.probes.map((p) => p.type))]) {
        const rows = probes.filter(
          (p) => p.dataset === dataset && p.model === model && p.type === type && p.score,
        );
        const count = (field) =>
          Object.fromEntries(
            ['correct', 'wrong', 'abstention', 'failure'].map((o) => [
              o,
              rows.filter((r) => r[field] === o).length,
            ]),
          );
        probeSummaries.push({
          dataset,
          model,
          type,
          n: rows.length,
          baseline: count('baselineOutcome'),
          overviewOnly: count('overviewOnlyOutcome'),
        });
      }
  const workflows = trials.filter((t) => t.expectedWorkflowAbstention);
  const workflowSummary = {
    trials: workflows.length,
    unknown: workflows.filter((t) => t.status === 'success' && t.observation.category === 'unknown')
      .length,
    failed: workflows.filter((t) => t.status !== 'success').length,
    scope: 'Role-gating behavior, not successful visual category recognition.',
  };
  const perItem = corpus.sources.map((f) => ({
    id: f.id,
    dataset: f.dataset,
    group: f.group,
    expected: f.category,
    scored: f.scoreCategory,
    view: f.view,
    clip: byKey.get('local_clip|' + f.id + '--reference')?.category,
    siglip: byKey.get('local_siglip|' + f.id + '--reference')?.category,
    cross: cross.find((c) => c.caseId === f.id + '--reference')?.category,
    sourceUrl: f.sourceUrl,
    reviewNote: f.reviewNote ?? f.notes,
  }));
  const summary = {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    runDirectory: path.relative(root, runDir).replaceAll('\\', '/'),
    run,
    summaries,
    hypothesis1,
    workflowSummary,
    repeatConsistency: {
      total: stability.length,
      stable: stability.filter((s) => s.stable).length,
      unstable: stability.filter((s) => !s.stable),
    },
    perItem,
    probeSummaries,
    probes,
    limitations: [
      'Public convenience fixtures; unknown pretraining overlap.',
      'Source/agent labels lack expert adjudication.',
      'A pair of gloves/boots is treated as one item, while different gear categories together are multiple.',
      'Bib trousers reference includes boots/base layer; target-item taxonomy may differ from organizer rules.',
      'Thermal, real close-ups and motorcycle-ambiguous leather jacket are unscored challenge controls.',
      'Same image transformations and repeated runs are not independent accuracy samples.',
      'Synthetic checkerboard framing is not a real background replacement.',
      'Other machine workloads and thermal state are uncontrolled.',
      'No native capture, cloud billing, condition, safety or authenticity evaluation.',
    ],
  };
  await fs.writeFile(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', {
    flag: 'wx',
  });
  const csv = [
    'dataset,model,source,condition,repeat,status,category,reference,scored,bytes,request_ms',
    ...trials.map((t) =>
      [
        t.dataset,
        t.model,
        t.sourceId,
        t.condition,
        t.repeat,
        t.status,
        t.observation?.category ?? '',
        t.expectedCategory ?? '',
        t.scoreCategory,
        t.bytes,
        t.requestMs,
      ]
        .map((v) => JSON.stringify(v ?? ''))
        .join(','),
    ),
  ].join('\n');
  await fs.writeFile(path.join(runDir, 'trials.csv'), csv + '\n', { flag: 'wx' });
  const relRun = path.relative(root, runDir).replaceAll('\\', '/');
  const report = [
    '# Round 02: preregistered local vision robustness experiment',
    '',
    'Executed against an owned snapshot of baseline commit ' +
      run.baselineCommit +
      '. No production model, prompt, policy or dependency was changed by this experiment. No training or paid calls.',
    '',
    '## Evidence and design',
    '',
    '- [Preregistered protocol](../../experiments/round-02/vision/protocol.md), [freeze](../../experiments/round-02/vision/freeze.json), [source/label corpus](../../experiments/round-02/vision/corpus.json), [source ledger](../../experiments/round-02/vision/sources.json).',
    '- [Raw run](../../' +
      relRun +
      '/run.json), [trial records](../../' +
      relRun +
      '/trials.jsonl), [summary](../../' +
      relRun +
      '/summary.json), [CSV](../../' +
      relRun +
      '/trials.csv).',
    '- ' +
      run.trialsCompleted +
      ' scheduled trials completed; ' +
      run.failures +
      ' failed. Three repeats; cases shuffled, model order balanced/interleaved. Both models initialized and received one excluded historical warmup before measured trials.',
    '- ' +
      corpus.sources.filter((f) => f.dataset === 'new').length +
      ' newly acquired source images and eight historical diagnostic images. New means new to this project, not guaranteed absent from pretraining.',
    '',
    '## Reference condition: count the groups',
    '',
    '| Set | Model/rule | Correct images | Wrong images | Abstained images | Group correct/wrong/abstain | Image coverage | Selective correctness |',
    '|---|---|---:|---:|---:|---|---:|---:|',
    ...summaries
      .filter((s) => s.condition === 'reference')
      .map(
        (s) =>
          '| ' +
          s.dataset +
          ' | ' +
          s.model +
          ' | ' +
          s.correct +
          '/' +
          s.n +
          ' | ' +
          s.wrong +
          ' | ' +
          s.abstention +
          ' | ' +
          s.grouped.correct +
          '/' +
          s.grouped.wrong +
          '/' +
          s.grouped.abstention +
          ' of ' +
          s.grouped.n +
          ' | ' +
          pct(s.coverage) +
          ' | ' +
          pct(s.selectiveCorrectness) +
          ' |',
      ),
    '',
    'Group endpoint is conservative: any wrong accepted source view makes the group wrong; otherwise any abstention makes it abstained. Repeats and transformations are not new items. Cross-model requires agreement, with no threshold fitting.',
    '',
    '## New-set robustness by condition',
    '',
    '| Model/rule | Condition | Correct | Wrong | Unknown | Scored images | Median bytes | Median inference request ms | p95 ms |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|',
    ...summaries
      .filter((s) => s.dataset === 'new')
      .map(
        (s) =>
          '| ' +
          s.model +
          ' | ' +
          s.condition +
          ' | ' +
          s.correct +
          ' | ' +
          s.wrong +
          ' | ' +
          s.abstention +
          ' | ' +
          s.n +
          ' | ' +
          format(s.medianBytes) +
          ' | ' +
          format(s.inferenceTiming.medianMs) +
          ' | ' +
          format(s.inferenceTiming.p95NearestRankMs) +
          ' |',
      ),
    '',
    'Timing rows include only requests that executed model inference; label-role gates are excluded. Cross-model timings are not independently timed a third time. Its actual sequential cost is the sum of the two contributing requests, available per case in the summary. No phone/upload/render time is included.',
    '',
    '## Prespecified 480px/quality70 candidate',
    '',
    '| Model/rule | Median grouped byte reduction | Added wrong groups | Reference group outcomes C/W/A | Medium group outcomes C/W/A | Necessary gate |',
    '|---|---:|---|---|---|---|',
    ...hypothesis1.map(
      (h) =>
        '| ' +
        h.model +
        ' | ' +
        pct(h.medianByteReduction) +
        ' | ' +
        (h.addedWrongGroups.join(', ') || 'none') +
        ' | ' +
        h.reference.correct +
        '/' +
        h.reference.wrong +
        '/' +
        h.reference.abstention +
        ' | ' +
        h.medium.correct +
        '/' +
        h.medium.wrong +
        '/' +
        h.medium.abstention +
        ' | ' +
        (h.preregisteredNecessaryGatePassed ? 'met' : 'not met') +
        ' |',
    ),
    '',
    'The gate requires at least50% median byte reduction and no new wrong accepted group. Passing this necessary check does not prove noninferiority, cover label OCR/expert review, or authorize changing all uploaded evidence. Exact paired group-resampling sensitivity is in summary.json; a zero-width range cannot rule out unseen errors.',
    '',
    '## Per-source reference outcomes',
    '',
    '| Source | Set / role | Reference | CLIP | SigLIP | Agreement |',
    '|---|---|---|---|---|---|',
    ...perItem.map(
      (p) =>
        '| [' +
        p.id +
        '](' +
        p.sourceUrl +
        ') | ' +
        p.dataset +
        ' / ' +
        p.view +
        ' | ' +
        (p.scored ? p.expected : 'unscored') +
        ' | ' +
        p.clip +
        ' | ' +
        p.siglip +
        ' | ' +
        p.cross +
        ' |',
    ),
    '',
    'Thermal trousers, partial details, real labels and the motorcycle-ambiguous worn jacket are retained but not ordinary category accuracy samples. Source and agent review are weak labels. No crashed/repaired/protective condition is inferred.',
    '',
    '## Category aggregation candidates',
    '',
    '| Set | Model | Probe | N | Existing correct/wrong/unknown | Overview-only correct/wrong/unknown |',
    '|---|---|---|---:|---|---|',
    ...probeSummaries.map(
      (p) =>
        '| ' +
        p.dataset +
        ' | ' +
        p.model +
        ' | ' +
        p.type +
        ' | ' +
        p.n +
        ' | ' +
        p.baseline.correct +
        '/' +
        p.baseline.wrong +
        '/' +
        p.baseline.abstention +
        ' | ' +
        p.overviewOnly.correct +
        '/' +
        p.overviewOnly.wrong +
        '/' +
        p.overviewOnly.abstention +
        ' |',
    ),
    '',
    'These probes are deterministic compositions of frozen per-view predictions, not independent observations or extra timed app requests. Wrong-item detail/overview probes expect unknown. Overview-only can preserve valid categories while ignoring mismatched detail evidence; that tradeoff must be resolved before integration. The actual label-as-front probe records are in probes.json.',
    '',
    '## Repeat stability and limits',
    '',
    repeatString(stability),
    'Role-gating checks: ' +
      workflowSummary.unknown +
      '/' +
      workflowSummary.trials +
      ' returned unknown; ' +
      workflowSummary.failed +
      ' failed. This demonstrates input-role behavior, not visual understanding.',
    '',
    ...summary.limitations.map((x) => '- ' + x),
    '',
    'All candidates remain experimental. Preserve original/full-resolution evidence for human review and future OCR even if a lower-resolution classification derivative proves useful. Native devices and an expert-adjudicated larger holdout remain necessary.',
  ].join('\n');
  await fs.writeFile(path.join(root, 'docs/11-experiments/round-02-vision.md'), report + '\n');
  await fs.writeFile(
    path.join(root, 'benchmarks/round-02/vision/latest-run.json'),
    JSON.stringify({ runDirectory: relRun, generatedAt: summary.generatedAt }, null, 2) + '\n',
  );
  console.log(
    JSON.stringify(
      {
        trials: run.trialsCompleted,
        failures: run.failures,
        reference: summaries.filter((s) => s.condition === 'reference'),
        hypothesis1,
        repeatConsistency: summary.repeatConsistency,
      },
      null,
      2,
    ),
  );
  return summary;
}
function repeatString(stability) {
  return (
    stability.filter((s) => s.stable).length +
    '/' +
    stability.length +
    ' model-case combinations repeated the same application category across all three runs. Any unstable cases are listed explicitly in the summary.'
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Provide an existing round02 run directory');
  await analyze(process.argv[2]);
}
