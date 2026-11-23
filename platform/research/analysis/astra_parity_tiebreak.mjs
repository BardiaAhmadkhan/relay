/** D-015. Predeclared before any cloud measurements. Compare two complete studies
 * together so the maximum of two unstable rows applies across the deployment. */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual as same } from 'node:util';
import { operativeDisposition, evidenceDigest } from './astra_hardware_comparison.mjs';
const id = (r) => r.cohort + '/' + r.id;
const sorted = (v) =>
  Array.isArray(v)
    ? v.map(sorted)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sorted(v[k])]),
        )
      : v;
const vote = (r) => JSON.stringify(sorted(operativeDisposition(r)));
const tally = (values) => {
  const counts = new Map();
  for (const v of values) counts.set(v, 1 + (counts.get(v) ?? 0));
  return counts;
};
function goodReruns(original, rounds, side) {
  if (!original || rounds.length !== 3) return false;
  const sourceOK = (r) => {
    try {
      const u = new URL(r.endpoint);
      return side === 'local'
        ? u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
        : u.protocol === 'https:' && r.endpoint === original.endpoint;
    } catch {
      return false;
    }
  };
  const processes = new Set(),
    times = new Set();
  for (let i = 0; i < 3; i++) {
    const row = rounds[i],
      t = row?.tieBreak;
    if (
      !row ||
      !sourceOK(row) ||
      id(row) !== id(original) ||
      row.manifest !== original.manifest ||
      row.input !== original.input ||
      row.normalized !== original.normalized ||
      !t ||
      t.side !== side ||
      t.round !== i + 1 ||
      t.indexScoredFresh !== true ||
      !Number.isSafeInteger(t.scoredBefore) ||
      !Number.isSafeInteger(t.cachedBefore) ||
      t.scoredAfter !== t.scoredBefore + 1 ||
      t.cachedAfter !== t.cachedBefore ||
      !Number.isFinite(Date.parse(t.signedScoredAt)) ||
      typeof t.processEvidence !== 'string' ||
      !t.processEvidence.length ||
      !row.answers ||
      !row.decisions?.no ||
      !row.decisions?.yes ||
      !row.decisions?.unknown ||
      !Object.hasOwn(row, 'r2') ||
      (row.r2 && (!row.decisions.fixedPositive || !row.decisions.fixedNegative))
    )
      return false;
    if (times.has(t.signedScoredAt)) return false;
    times.add(t.signedScoredAt);
    if (side === 'local' && processes.has(t.processEvidence)) return false;
    processes.add(t.processEvidence);
  }
  return true;
}
export function classifyRow(a, b, localRounds, cloudRounds) {
  if (
    !a ||
    !b ||
    a.manifest !== b.manifest ||
    a.input !== b.input ||
    a.normalized !== b.normalized ||
    !goodReruns(a, localRounds, 'local') ||
    !goodReruns(b, cloudRounds, 'cloud')
  )
    return { classification: 'incomplete' };
  const local = [a, ...localRounds].map(vote),
    cloud = [b, ...cloudRounds].map(vote),
    l = tally(local),
    c = tally(cloud);
  const measurements = {
    localDistinct: l.size,
    cloudDistinct: c.size,
    cloudVotesForLocalFirst: c.get(local[0]) ?? 0,
  };
  if (l.size > 1)
    return {
      ...measurements,
      classification: cloud.every((v) => l.has(v))
        ? 'unstable-on-any-hardware'
        : 'investigate-new-cloud-disposition',
    };
  const majority = [...c.entries()].find(([, count]) => count > 2);
  if (!majority) return { ...measurements, classification: 'inconclusive-tied-cloud-vote' };
  return {
    ...measurements,
    classification: majority[0] === local[0] ? 'cloud-majority-matches' : 'hardware-flip',
  };
}
export function combinedGate(studies) {
  const manifests = [
    'e0c09edc030f5dc547b2e4d803c0d6f34c4ae3062351c50121cb64c503077519',
    'b2738e202a435fb0f2edac83cdd58bbba174801125ff620ed2bd5761e027a3c9',
  ];
  if (!same(studies.map((x) => x.report.manifest).sort(), [...manifests].sort()))
    throw Error('Both approved cloud study reports are required.');
  const rows = [],
    holds = [];
  for (const s of studies) {
    const z = s.report;
    const correct = (set, side) =>
      set.length === z.memberships &&
      new Set(set.map(id)).size === z.memberships &&
      set.every((r) => {
        try {
          const u = new URL(r.endpoint);
          return (
            r.manifest === z.manifest &&
            (side === 'local'
              ? u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
              : u.protocol === 'https:' &&
                !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
          );
        } catch {
          return false;
        }
      });
    if (
      z.localEvidenceSha256 !== evidenceDigest(s.local) ||
      z.cloudEvidenceSha256 !== evidenceDigest(s.cloud)
    )
      holds.push({
        manifest: z.manifest,
        reason: 'comparison does not bind these exact initial measurements',
      });
    if (!correct(s.local, 'local') || !correct(s.cloud, 'cloud'))
      holds.push({
        manifest: z.manifest,
        reason: 'initial evidence is incomplete or is not local versus public cloud',
      });
    if (!z.complete || z.missingEvidenceOrHeads.length || z.investigate)
      holds.push({ manifest: z.manifest, reason: 'missing evidence, coverage or numerical alarm' });
    const affected = new Set([
      ...z.operationalDecisionOrRoutingFlips,
      ...z.cascadeBranchChanges.map((x) => x[0]),
    ]);
    for (const k of [...affected].sort()) {
      const get = (records) => {
        const matches = records.filter((r) => id(r) === k);
        return matches.length === 1 ? matches[0] : undefined;
      };
      const result = classifyRow(
        get(s.local),
        get(s.cloud),
        s.localRounds.map(get),
        s.cloudRounds.map(get),
      );
      rows.push({ manifest: z.manifest, row: k, ...result });
      if (!['unstable-on-any-hardware', 'cloud-majority-matches'].includes(result.classification))
        holds.push({ manifest: z.manifest, row: k, reason: result.classification });
    }
  }
  const unstable = rows.filter((r) => r.classification === 'unstable-on-any-hardware');
  if (unstable.length > 2)
    holds.push({
      reason: 'more than two unstable rows across primary and supplement',
      count: unstable.length,
    });
  return {
    threshold:
      'Three additional actual scores per side, four votes per side in total. A majority is at least three. Unstable rows remain visible in release notes.',
    originalComparisons: studies.length,
    rows,
    unstableRows: unstable.length,
    holds,
    qualificationPassed: holds.length === 0,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const lines = (p) =>
    fs.readFileSync(p, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const result = combinedGate(
    spec.studies.map((s) => ({
      report: JSON.parse(fs.readFileSync(s.comparison, 'utf8')),
      local: lines(s.firstLocal),
      cloud: lines(s.firstCloud),
      localRounds: (s.localRounds ?? []).map(lines),
      cloudRounds: (s.cloudRounds ?? []).map(lines),
    })),
  );
  console.log(JSON.stringify(result, null, 2));
  if (!result.qualificationPassed) process.exitCode = 1;
}
