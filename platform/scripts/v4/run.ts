import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { buildDossier, header } from '../../server/v4/dossier';
import { laneQuote, lotQuote, emptyTerms, contribution } from '../../packages/core/v4/commerce';
import { authentic, hashDocument } from '../../server/v4/seal';
import { verifyScores } from '../../packages/vision/v2/scorer-chain';
const args = process.argv.slice(2),
  opt = (name: string) => {
    const idx = args.indexOf(name);
    return idx < 0 ? undefined : args[idx + 1];
  };
const source = opt('--input'),
  destination = opt('--out');
if (!source || !destination)
  throw Error(
    'Usage: node --env-file=.env --import tsx scripts/v4/run.ts --input ITEM_OR_ROOT --out PRIVATE_DIR [--all] [--python ...] [--cache exact-read-cache] [--measured-tags approved-study-results]',
  );
const key = process.env.RELAY_SIGNING_KEY;
if (!key || key.length < 32) throw Error('Relay signing identity required');
const folder = path.resolve(source),
  out = path.resolve(destination);
if (out === folder || out.startsWith(folder + path.sep))
  throw Error('Choose an output outside the source collection');
const python = opt('--python') ?? process.env.RELAY_V4_PYTHON ?? 'python';
const tasks = ['-B', '-u', 'scripts/v4/acquire.py', folder, '--output', out];
for (const k of ['--cache', '--measured-tags', '--at']) {
  const a = opt(k);
  if (a) tasks.push(k, a);
}
if (args.includes('--all')) tasks.push('--all');
const imageFile = (name: string) => /\.(jpe?g|png|webp)$/i.test(name);
const groupName = (p: string) =>
  /^[A-Za-z0-9_-]{1,80}$/.test(path.basename(p))
    ? path.basename(p)
    : 'case-' + createHash('sha256').update(p).digest('hex').slice(0, 12);
const requested = args.includes('--all')
  ? fs
      .readdirSync(folder, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.readdirSync(path.join(folder, e.name)).some(imageFile))
      .map((e) => path.join(folder, e.name))
  : [folder];
const groups = new Map(requested.map((p) => [groupName(p), p]));
if (!args.includes('--reuse-acquired')) {
  const child = spawnSync(python, tasks, {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: 'inherit',
  });
  if (child.error) throw child.error;
  if (child.status !== 0) {
    console.error('Acquisition exited with code ' + String(child.status));
    process.exit(child.status ?? 1);
  }
}
const cases = fs
  .readdirSync(out, { withFileTypes: true })
  .filter(
    (e) =>
      e.isDirectory() && groups.has(e.name) && fs.existsSync(path.join(out, e.name, 'input.json')),
  );
if (cases.length !== groups.size || !cases.length)
  throw Error('An input has no complete acquisition record');
async function fileDigest(p: string) {
  const hash = createHash('sha256');
  for await (const data of fs.createReadStream(p)) hash.update(data);
  return hash.digest('hex');
}
const index = [];
const atomic = (dest: string, data: unknown) => {
  const tmp = dest + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, dest);
};
for (const entry of cases) {
  const root = path.join(out, entry.name);
  const raw = header.parse(JSON.parse(fs.readFileSync(path.join(root, 'input.json'), 'utf8')));
  const foundation = JSON.parse(fs.readFileSync(path.join(root, 'foundation.json'), 'utf8'));
  if (
    !Array.isArray(foundation.slots) ||
    foundation.slots.some(
      (s: any) =>
        !verifyScores(s.signed, key) ||
        s.signed.scores.photoId !== s.photo.id ||
        s.signed.scores.sha256 !== s.photo.sha256,
    )
  )
    throw Error('Original photo score did not verify');
  if (args.includes('--reuse-acquired')) {
    const listing = groups.get(entry.name)!;
    const digests = new Set<string>();
    for (const file of fs
      .readdirSync(listing, { withFileTypes: true })
      .filter((f) => f.isFile() && imageFile(f.name)))
      digests.add(await fileDigest(path.join(listing, file.name)));
    const prior = JSON.parse(fs.readFileSync(path.join(root, 'run.json'), 'utf8'));
    const rawSet = new Set(raw.images.map((i) => i.sourceHash));
    if (
      digests.size !== rawSet.size ||
      [...digests].some((s) => !rawSet.has(s)) ||
      prior.inputSetHash !==
        createHash('sha256')
          .update([...digests].sort().join(' '))
          .digest('hex')
    )
      throw Error('Source set has changed since the acquisition');
    for (const im of raw.images) {
      if ((await fileDigest(path.join(root, 'photos', im.workingHash + '.jpg'))) !== im.workingHash)
        throw Error('Working photograph has changed');
    }
  }
  const signed = buildDossier(raw, key, {
    foundationEvidence: { decision: foundation.decisions.unreported, slots: foundation.slots },
  });
  if (!authentic(signed, 'inspection', key)) throw Error('Dossier failed readback');
  const d = signed.value;
  const clear = foundation.decisions.declared_clear_scenario,
    crash = foundation.decisions.declared_crash_scenario;
  const scenario = (answer: 'no' | 'yes', b: any) =>
    buildDossier(
      {
        ...raw,
        history: answer,
        damage: 'no',
        repair: 'no',
        foundation: b.outcome,
        foundationReason: b.summary,
        foundationGrade: b.grade ?? null,
      },
      key,
      { foundationEvidence: { decision: b, slots: foundation.slots } },
    );
  atomic(path.join(root, 'inspection.json'), signed);
  atomic(path.join(root, 'clearly-labelled-scenarios.json'), {
    description:
      'Alternative declared histories for demonstration, not facts supplied about the photographed gear.',
    declaredClear: scenario('no', clear),
    declaredCrash: scenario('yes', crash),
  });
  const cost = laneQuote('CA', 1000, 'small');
  const economics = {
    receipt: signed.sha256,
    market: 'CA',
    status: 'Unverified retail comparables are never an offer',
    references: d.references,
    eligibility: d.result.offerEligible,
    terms: emptyTerms,
    oneParcelScenario: { ...cost, assumption: '1 kg packed in a small box' },
    margin: contribution({
      priceMinor: null,
      currency: 'CAD',
      terms: emptyTerms,
      freightMinor: null,
      dutiesMinor: null,
      saleProbability: null,
      salvageMinor: null,
      acquisitionMinor: null,
    }),
    philippines: {
      exactPacked: lotQuote('PH', 10, 5000),
      oneAdditionalBand: lotQuote('PH', 10, 5500),
    },
  };
  atomic(path.join(root, 'economics.json'), economics);
  index.push({
    id: d.id,
    category: d.category,
    names: d.names,
    title: d.result.title,
    action: d.result.action,
    photoCount: d.sourceCount,
    receipt: signed.sha256,
    identityConflict: d.identity.conflicted,
  });
}
const all = fs
  .readdirSync(out, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(out, e.name, 'inspection.json')))
  .map((e) => {
    const s = JSON.parse(fs.readFileSync(path.join(out, e.name, 'inspection.json'), 'utf8'));
    const d = s.value;
    return {
      id: d.id,
      category: d.category,
      names: d.names,
      title: d.result.title,
      action: d.result.action,
      photoCount: d.sourceCount,
      receipt: s.sha256,
      identityConflict: d.identity.conflicted,
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));
atomic(path.join(out, 'index.json'), {
  version: '4.0-event',
  count: all.length,
  items: all,
  hash: hashDocument(all),
});
console.log(
  index.length,
  'sealed dossiers, independent receipts, separate scenarios and economics',
);
