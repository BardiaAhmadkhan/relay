import policy from '../../packages/core/v2/policy.config.json';
import { SignedScoresSchema } from '../../packages/core/v2/schema';
import { verifyScores } from '../../packages/vision/v2/scorer-chain';
type Area = { photo: string; sourceHash: string; state: string; layer: string; zone: string };
export function visibleAppearance(slots: unknown[], key: string, areas: Area[]) {
  const measurements: { view: string; source: string; wear: number }[] = [];
  for (const row of slots) {
    const s = row as { assigned?: string; source?: string; signed?: unknown };
    if (!['front', 'back'].includes(s.assigned ?? '')) continue;
    const read = SignedScoresSchema.safeParse(s.signed);
    if (!read.success || read.data.scores.view !== s.assigned || !verifyScores(read.data, key))
      continue;
    const wear = read.data.scores.answers.wear;
    if (wear?.type === 'level' && s.source)
      measurements.push({ view: s.assigned!, source: s.source, wear: wear.score });
  }
  let grade: string | null = null;
  if (new Set(measurements.map((o) => o.view)).size === 2) {
    const max = Math.max(...measurements.map((o) => o.wear));
    const bands = policy.gradeFromWear as [number, string][];
    grade = (bands.find(([upper]) => max < upper) ?? bands.at(-1))?.[1] ?? null;
  }
  const surface = areas.filter((f) => f.state === 'surface_change');
  return {
    grade,
    basis: grade
      ? 'Original signed exterior wear readings and the existing Relay appearance bands.'
      : 'Two signed exterior wear readings are needed.',
    measurements,
    surfaceChanges: surface.map((f) => ({ photo: f.photo, zone: f.zone, layer: f.layer })),
    pricingUse:
      'Use this appearance grade when selecting a shop resale ratio. The shop supplies the ratio.',
  };
}
export function sameSidePatterns(areas: Area[], roadContactConcern: boolean) {
  // Directional road contact is separate evidence. Two same-side inferred coordinates alone cannot establish a crash.
  const out: {
    side: string;
    areas: string[];
    photos: string[];
    text: string;
    requiresSpecialist: boolean;
  }[] = [];
  for (const side of ['left', 'right'])
    for (const pair of [
      ['shoulder', 'elbow'],
      ['hip', 'knee'],
    ]) {
      const groups = pair.map((z) =>
        areas.filter(
          (f) =>
            f.layer === 'exterior' &&
            f.zone === side + '_' + z &&
            ['surface_change', 'open_damage', 'repair_like'].includes(f.state),
        ),
      );
      const pairViews = groups[0]!.flatMap((a) =>
        groups[1]!.filter((b) => a.sourceHash !== b.sourceHash).map((b) => [a, b]),
      );
      if (!pairViews.length) continue;
      const photos = [...new Set(pairViews.flat().map((a) => a.photo))].sort();
      out.push({
        side,
        areas: pair,
        photos,
        requiresSpecialist: roadContactConcern,
        text: roadContactConcern
          ? 'Changes on the same side accompany an original road-contact concern. A specialist should inspect the direction and surrounding surface.'
          : 'Changes occur on the same candidate side. Direction and cause are unconfirmed.',
      });
    }
  return out;
}
