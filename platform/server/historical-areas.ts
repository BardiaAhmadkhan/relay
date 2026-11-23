import { sameRegion } from '../packages/core/marked-region';
import type { HistoricalArea } from '../packages/core/v2/schema';
import { historicalReason } from '../packages/core/v2/historical-areas';
import { verifyScores } from '../packages/vision/v2/scorer-chain';

/** Old receipts are optional supporting evidence. A discarded or foreign service key
 * makes their provenance unknown, while the concern still caps the automated decision. */
export function historicalReasons(
  areas: HistoricalArea[] | undefined,
  key: string,
  battery: string,
) {
  return (areas ?? []).map((area) => {
    const crop = area.cropReceipt,
      overview = area.overviewReceipt;
    const verified =
      !!crop &&
      !!overview &&
      crop.scores.batteryVersion === battery &&
      overview.scores.batteryVersion === battery &&
      crop.scores.photoId === area.photoId &&
      crop.scores.view === 'detail' &&
      crop.scores.sha256 === area.cropSha256 &&
      overview.scores.photoId === area.region.parentId &&
      overview.scores.view === area.region.parentView &&
      !overview.scores.fromOverview &&
      overview.scores.sha256 === area.overviewSha256 &&
      crop.scores.parentSha256 === overview.scores.sha256 &&
      sameRegion(crop.scores.fromOverview, area.region) &&
      verifyScores(crop, key) &&
      verifyScores(overview, key);
    return historicalReason(area, verified);
  });
}
