import type { z } from 'zod';
import type { PhotoInspectionSchema } from '../core/schema';

export const EVIDENCE_CONTRACT_VERSION = 'negative-evidence-1';
type Photo = z.infer<typeof PhotoInspectionSchema>;
const defectWord =
  /\b(?:damage|defects?|abrasion|tears?|torn|cuts?|holes?|scrapes?|scuff(?:s|ing|ed)?|fraying|frayed|exposed|broken|missing|severed)\b/i;
const negativeWords = new Set(
  'no without visible apparent obvious clear signs sign evidence of surface material structural damage defect defects abrasion abrasions tear tears cut cuts hole holes scrape scrapes scuff scuffs scuffing fraying exposed fiber fibers fibre fibres broken stitching stitches threads or and any on at in the a an panel panels seam seams area areas sleeve sleeves back chest forearm arm arms shoulder shoulders elbow elbows cuff cuffs hem collar fabric textile leather material materials lining garment item'.split(
    ' ',
  ),
);

/** Reject only a wholly negated defect statement in this limited grammar.
 * This is a text-consistency check, not a classifier of the photograph.
 * Mixed, unfamiliar, double-negative and qualified statements remain untouched.
 */
export function isWhollyNegativeEvidence(evidence: string): boolean {
  const value = evidence.normalize('NFKC').trim();
  if (
    /[;!?]/.test(value) ||
    /\b(?:but|however|except|although|though|yet|while|not|cannot|can't)\b/i.test(value)
  )
    return false;
  const match = /^(.*?)\b(no|without)\s+(.+?)[.]?$/i.exec(value);
  if (!match) return false;
  const [, prefix = '', negative = '', remainder = ''] = match;
  if (defectWord.test(prefix)) return false;
  if (
    negative.toLowerCase() !== 'without' &&
    prefix.trim() &&
    !/\b(?:shows?|has|have|displays?|is|are|with)\s*$/i.test(prefix)
  )
    return false;
  if (!defectWord.test(remainder)) return false;
  const words = (negative + ' ' + remainder)
    .toLowerCase()
    .split(/[\s,./-]+/)
    .filter(Boolean);
  return words.length > 0 && words.every((word) => negativeWords.has(word));
}

export function removeNegativeEvidence(photo: Photo): Photo {
  const findings = photo.findings.filter((finding) => !isWhollyNegativeEvidence(finding.evidence));
  if (findings.length === photo.findings.length) return photo;
  return {
    ...photo,
    findings,
    crashPattern: findings.length ? photo.crashPattern : 'not_observed',
  };
}
