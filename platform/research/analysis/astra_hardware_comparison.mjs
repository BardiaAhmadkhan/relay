/** Opus D-015. Identical head math for historical repeatability and cloud qualification. */
import { isDeepStrictEqual as same } from 'node:util';
import { createHash } from 'node:crypto';
export const evidenceDigest = (rows) =>
  createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const key = (r) => r.cohort + '/' + r.id;
const quantile = (v) => v.slice().sort((a, b) => a - b)[Math.ceil(0.95 * v.length) - 1];
function observe(table, head, a, b) {
  const v = (table[head] ??= { dist: [], changedImages: 0, changedValues: 0, values: 0 });
  const delta = a.map((p, i) => Math.abs(p - b[i]));
  v.dist.push(Math.max(...delta));
  v.values += delta.length;
  v.changedValues += delta.filter((d) => d !== 0).length;
  if (delta.some((d) => d !== 0)) v.changedImages++;
}
function heads(a, b, ...tables) {
  const issues = [],
    choices = [];
  for (const h of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const u = a[h],
      v = b[h];
    if (!u || !v || u.type !== v.type) {
      issues.push(h);
      continue;
    }
    if (u.type === 'yesno') {
      for (const t of tables) observe(t, h, [u.p], [v.p]);
      continue;
    }
    const labels = Object.keys(u.probabilities).sort();
    if (!same(labels, Object.keys(v.probabilities).sort())) {
      issues.push(h);
      continue;
    }
    for (const t of tables)
      observe(
        t,
        h,
        labels.map((k) => u.probabilities[k]),
        labels.map((k) => v.probabilities[k]),
      );
    if (u.type === 'level') {
      for (const t of tables) observe(t, h + '.expectedLevel', [u.score], [v.score]);
    }
    if (u.type === 'choice' && u.choice !== v.choice) choices.push(h);
  }
  return { issues, choices };
}
const summary = (table) =>
  Object.fromEntries(
    Object.entries(table).map(([h, v]) => [
      h,
      {
        n: v.dist.length,
        values: v.values,
        changedImages: v.changedImages,
        changedValues: v.changedValues,
        max: Math.max(...v.dist),
        p95: quantile(v.dist),
      },
    ]),
  );
export function referenceBaseline(archive, local) {
  const current = new Map(local.filter((r) => r.cohort === 'field44').map((r) => [r.id, r])),
    table = {},
    issues = [];
  for (const r of archive) {
    const now = current.get(r.item);
    if (!now || r.record.sha256 !== now.normalized) {
      issues.push([r.item, 'identity']);
      continue;
    }
    for (const h of heads(r.scores.answers, now.answers, table).issues) issues.push([r.item, h]);
  }
  return { photos: archive.length, issues, perHead: summary(table) };
}
export function repeatabilityForRows(manifest, first, second) {
  const a = new Map(first.map((r) => [key(r), r])),
    b = new Map(second.map((r) => [key(r), r])),
    table = {},
    issues = [];
  for (const want of manifest.rows) {
    const k = key(want),
      x = a.get(k),
      y = b.get(k);
    if (!x || !y || x.normalized !== y.normalized || x.input !== y.input) {
      issues.push([k, 'identity']);
      continue;
    }
    for (const h of heads(x.answers, y.answers, table).issues) issues.push([k, h]);
  }
  return { photos: manifest.rows.length, issues, perHead: summary(table) };
}
function actions(decisions) {
  return Object.fromEntries(
    Object.entries(decisions).map(([h, d]) => [
      h,
      {
        ...d,
        reasons: d.reasons.map((r) => ({ ...r, score: r.score === null ? null : 'measured' })),
      },
    ]),
  );
}
export function operativeDisposition(row) {
  return {
    decisions: actions(row.decisions),
    r2: row.r2,
    detailCascadeBranch: row.detailCascadeBranch ?? null,
  };
}
function margin(heads, view) {
  const p = (k) => heads[k]?.p ?? null,
    acc = {};
  const line = (k, x, t) => {
    if (Number.isFinite(x)) acc[k] = { line: t, score: x, distance: Math.abs(x - t) };
  };
  const damage = [p('road_contact'), p('broken')].filter(Number.isFinite);
  if (damage.length) {
    line('damage.clear', Math.max(...damage), 0.145);
    line('damage.block', Math.max(...damage), 0.646);
  }
  line('repair.clear', p('repair'), 0.3);
  line('repair.block', p('repair'), 0.85);
  if (view === 'front' || view === 'back') line('single_item', p('single_item'), 0.5);
  const cat = heads.category;
  if (cat?.type === 'choice') line('category', cat.probabilities[cat.choice], 0.6);
  if (view === 'detail') {
    const low = [p('road_contact_low'), p('broken_low')].filter(Number.isFinite);
    if (low.length) {
      line('detail512.clear', Math.max(...low), 0.139);
      line('detail512.block', Math.max(...low), 0.552);
    }
  }
  return acc;
}
export function compareHardware(manifest, signature, local, cloud, baseline) {
  const l = new Map(local.map((r) => [key(r), r])),
    c = new Map(cloud.map((r) => [key(r), r])),
    table = {},
    groupTables = {},
    groups = {},
    minMargins = {},
    literalOnly = [],
    flips = [],
    issues = [],
    changedChoices = [],
    cascadeBranchChanges = [];
  for (const wanted of manifest.rows) {
    const k = key(wanted),
      a = l.get(k),
      b = c.get(k);
    const strata = [
      wanted.cohort,
      ...(wanted.stratum ? [wanted.cohort + '/' + wanted.stratum] : []),
    ];
    for (const s of strata) {
      groups[s] ??= { memberships: 0, comparable: 0, numericOnly: 0, flips: 0, issues: 0 };
      groups[s].memberships++;
      groupTables[s] ??= {};
    }
    const issue = (m) => {
      issues.push([k, m]);
      for (const s of strata) groups[s].issues++;
    };
    if (
      !a ||
      !b ||
      a.manifest !== signature ||
      b.manifest !== signature ||
      a.normalized !== b.normalized ||
      a.input !== b.input
    ) {
      issue('missing record or working-image identity');
      continue;
    }
    const valid = (r) =>
      r.answers &&
      r.decisions?.no &&
      r.decisions?.yes &&
      r.decisions?.unknown &&
      Object.hasOwn(r, 'r2') &&
      (!r.r2 || (r.decisions.fixedPositive && r.decisions.fixedNegative));
    if (!valid(a) || !valid(b)) {
      issue('incomplete signed-evidence workflow');
      continue;
    }
    for (const s of strata) groups[s].comparable++;
    if (!same(actions(a.decisions), actions(b.decisions)) || a.r2 !== b.r2) {
      flips.push(k);
      for (const s of strata) groups[s].flips++;
    } else if (!same(a.decisions, b.decisions)) {
      literalOnly.push(k);
      for (const s of strata) groups[s].numericOnly++;
    }
    if (a.detailCascadeBranch !== b.detailCascadeBranch)
      cascadeBranchChanges.push([k, a.detailCascadeBranch, b.detailCascadeBranch]);
    const result = heads(a.answers, b.answers, table, ...strata.map((s) => groupTables[s]));
    for (const h of result.issues) issue('head ' + h);
    for (const h of result.choices) changedChoices.push([k, h]);
    for (const [name, m] of Object.entries(margin(a.answers, wanted.view))) {
      if (!minMargins[name] || m.distance < minMargins[name].distance)
        minMargins[name] = { ...m, case: k };
    }
  }
  const perHead = summary(table),
    alarms = [],
    noBaseline = [];
  for (const [h, v] of Object.entries(perHead)) {
    const ref = baseline.perHead[h];
    if (v.max > 0.1) alarms.push({ head: h, criterion: 'max above 0.10', actual: v.max });
    if (ref) {
      if (v.p95 > 2 * ref.p95)
        alarms.push({
          head: h,
          criterion: 'p95 above twice local repeatability',
          actual: v.p95,
          localP95: ref.p95,
        });
    } else noBaseline.push(h);
  }
  for (const s of Object.keys(groups)) groups[s].perHead = summary(groupTables[s]);
  const required = manifest.rows.length,
    complete =
      local.length === required &&
      cloud.length === required &&
      l.size === required &&
      c.size === required;
  const operativePassed =
      complete && !issues.length && !flips.length && !cascadeBranchChanges.length,
    investigate =
      alarms.length > 0 ||
      baseline.issues.length > 0 ||
      noBaseline.some((h) => perHead[h].changedValues > 0);
  const lines = [
    'damage.clear',
    'damage.block',
    'repair.clear',
    'repair.block',
    'single_item',
    'category',
    'detail512.clear',
    'detail512.block',
  ];
  for (const name of lines) minMargins[name] ??= null;
  return {
    manifest: signature,
    memberships: required,
    uniqueRawImages: manifest.uniqueRawImages,
    referenceRows: local.length,
    localEvidenceSha256: evidenceDigest(local),
    cloudEvidenceSha256: evidenceDigest(cloud),
    candidateRows: cloud.length,
    complete,
    operationalDecisionOrRoutingFlips: flips,
    numericOnlyPayloadDifferences: literalOnly,
    missingEvidenceOrHeads: issues,
    changedHeadChoices: changedChoices,
    cascadeBranchChanges,
    tieBreakRequired: [...new Set([...flips, ...cascadeBranchChanges.map((r) => r[0])])].sort(),
    perHead,
    strata: groups,
    smallestLocalDistanceToLine: minMargins,
    alarms,
    referenceHeadsUnavailable: noBaseline,
    operativePassed,
    investigate,
    passed: operativePassed && !investigate,
  };
}
