import { createHmac, timingSafeEqual } from 'node:crypto';
import { decide2, decisionBands } from '../packages/core/v2/policy';
import { canonicalJson, verifyScores } from '../packages/vision/v2/scorer-chain';
import {
  isCue,
  type CueCode,
  type SignedFinding,
  type ReplacementStatus,
} from '../packages/core/v2/replacement';
import type {
  Decision2,
  PhotoRecord,
  PhotoScores,
  Thresholds,
  PolicyConfig,
  ReplacedOverview,
} from '../packages/core/v2/schema';

type Config = { signingKey: string; thresholds: Thresholds; config: PolicyConfig };
const mac = (f: SignedFinding['finding'], key: string) =>
  createHmac('sha256', key).update('relay.prior-finding.v1\n').update(canonicalJson(f)).digest();
function matches(p: PhotoRecord | undefined, s: PhotoScores | undefined) {
  return (
    !!p &&
    !!s &&
    p.id === s.photoId &&
    p.sha256 === s.sha256 &&
    p.view === s.view &&
    !s.fromOverview
  );
}
function eligible(s: PhotoScores, ctx: Config) {
  return s.batteryVersion === ctx.thresholds.batteryVersion && !!decisionBands(ctx.thresholds, s);
}
export function observedCues(s: PhotoScores, t: Thresholds): CueCode[] {
  const bands = decisionBands(t, s);
  if (
    !bands ||
    s.fromOverview ||
    (s.view !== 'front' && s.view !== 'back') ||
    s.batteryVersion !== t.batteryVersion
  )
    return [];
  const out: CueCode[] = [];
  for (const q of ['broken', 'road_contact', 'repair'] as const) {
    const a = s.answers[q],
      band = q === 'repair' ? bands.repair : bands.damage;
    if (a?.type === 'yesno' && a.p >= band.clear) out.push(('possible_' + q) as CueCode);
  }
  return out;
}
export function signFindings(
  assessmentId: string,
  d: Decision2,
  photos: PhotoRecord[],
  scores: PhotoScores[],
  ctx: Config,
): SignedFinding[] {
  const receipts: SignedFinding[] = [];
  for (const p of photos) {
    if (p.view !== 'front' && p.view !== 'back') continue;
    const codes = [
      ...new Set(
        d.reasons
          .filter((r) => r.photoId === p.id)
          .map((r) => r.code)
          .filter(isCue),
      ),
    ];
    if (!codes.length) continue;
    const s = scores.find((v) => matches(p, v));
    if (!s || !eligible(s, ctx)) continue;
    const exclusion = d.outcome === 'no_offer' && codes.some((code) => code.startsWith('visible_'));
    const finding: SignedFinding['finding'] = {
      assessmentId,
      photoId: p.id,
      sha256: p.sha256,
      view: p.view,
      policyVersion: d.policyVersion,
      thresholdsVersion: d.thresholdsVersion,
      kind: exclusion ? 'exclusion' : 'observation',
      codes,
    };
    receipts.push({ finding, signature: mac(finding, ctx.signingKey).toString('hex') });
  }
  return receipts;
}
/** Only a service-attested actual policy disposition can carry an exclusion. For tap-era clients
 * that predate those receipts, replay the saved assessment using its complete authenticated score set. */
export function verifyReplacements(
  assessmentId: string,
  entries: ReplacedOverview[] | undefined,
  ctx: Config,
): ReplacementStatus[] {
  return (entries ?? []).map((e) => {
    const meta = {
      photoId: e.photoId,
      view: e.view,
      replacementId: e.replacementId,
      sha256: e.record?.sha256,
    };
    const prior = e.finding?.finding;
    const scopedClaim =
      prior?.kind === 'exclusion' &&
      prior.assessmentId === assessmentId &&
      prior.photoId === e.photoId &&
      prior.view === e.view;
    const legacyClaim = e.previouslyExcluded === true && !!(e.legacyAssessment || e.record);
    const unknown: ReplacementStatus = {
      ...meta,
      status: scopedClaim || legacyClaim ? 'unverified_exclusion' : 'unverified',
      codes: [],
    };
    const s = e.signed?.scores;
    if (
      !e.signed ||
      !s ||
      !e.record ||
      !matches(e.record, s) ||
      s.photoId !== e.photoId ||
      s.view !== e.view ||
      !eligible(s, ctx) ||
      !verifyScores(e.signed, ctx.signingKey)
    )
      return unknown;
    let proof = e.finding;
    // Legacy fallback is used only for a saved result and all of the original photo records.
    if (!proof && e.legacyAssessment) {
      const a = e.legacyAssessment;
      if (
        a.photos.length === a.signedScores.length &&
        new Set(a.photos.map((p) => p.id)).size === a.photos.length &&
        a.photos.every((p) =>
          a.signedScores.some(
            (v) =>
              p.id === v.scores.photoId && p.sha256 === v.scores.sha256 && p.view === v.scores.view,
          ),
        ) &&
        a.signedScores.every((v) => verifyScores(v, ctx.signingKey)) &&
        a.signedScores.some((v) => v.signature === e.signed!.signature)
      ) {
        const scores = a.signedScores.map((x) => x.scores);
        const d = decide2({ ...a, scores, thresholds: ctx.thresholds, config: ctx.config });
        proof = signFindings(assessmentId, d, a.photos, scores, ctx).find(
          (f) => f.finding.photoId === e.photoId,
        );
      }
    }
    if (proof) {
      const f = proof.finding;
      if (
        f.assessmentId !== assessmentId ||
        f.photoId !== e.photoId ||
        f.sha256 !== s.sha256 ||
        f.view !== e.view ||
        !timingSafeEqual(mac(f, ctx.signingKey), Buffer.from(proof.signature, 'hex'))
      )
        return unknown;
      return {
        ...meta,
        status: f.kind === 'exclusion' ? 'confirmed_exclusion' : 'possible',
        codes: f.codes,
      };
    }
    if (legacyClaim) return unknown;
    const codes = observedCues(s, ctx.thresholds);
    return { ...meta, status: codes.length ? 'possible' : 'clear', codes };
  });
}
