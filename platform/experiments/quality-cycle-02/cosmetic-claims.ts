import type { z } from 'zod';
import type { PhotoInspectionSchema } from '../../packages/core/schema';
import { removeNegativeEvidence } from '../../packages/vision/evidence-contract';
type Photo = z.infer<typeof PhotoInspectionSchema>;
const cosmetic = /\b(?:stains?|stained|discolou?r(?:ation|ed)|faded|fading|creases?|creasing|wrinkl(?:es?|ing))\b/i;
const physical = /\b(?:abrasion|abraded|scrap(?:e[ds]?|ing)|scratch(?:e[ds]|es|ing)?|scuff\w*|tear(?:s|ing)?|torn|rip(?:ped|s|ping)?|holes?|puncture\w*|perforat\w*|cuts?|split\w*|fray\w*|break\w*|broken|sever\w*|ruptur\w*|disrupt\w*|separat\w*|detach\w*|delaminat\w*|peel\w*|crack\w*|missing|loss|lost|expos\w*|underl\w*|backing|fib(?:er|re)\w*|threads?|stitch\w*|rough\w*|gap\w*|repair\w*|mend\w*|patch\w*|wear|worn|thin\w*|pucker\w*|matt\w*|deform\w*|dent\w*|fuzz\w*|raised|protrud\w*)\b/i;
export function isOnlyCosmeticDescription(f: Photo['findings'][number]): boolean {
  return f.kind === 'other' && cosmetic.test(f.evidence) && !physical.test(f.evidence) && !/\b(?:no|not|without|except|but|however|although|rather|instead|cannot)\b|[;!?]/i.test(f.evidence);
}
export function normalizeClaims(photo: Photo): Photo {
  const current = removeNegativeEvidence(photo);
  const findings=current.findings.filter(f=>!isOnlyCosmeticDescription(f));
  return findings.length===current.findings.length?current:{...current,findings,crashPattern:findings.length?current.crashPattern:'not_observed'};
}