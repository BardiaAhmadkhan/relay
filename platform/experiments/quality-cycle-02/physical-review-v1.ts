import { z } from 'zod';
export const REVIEW_VERSION = 'physical-review-1';
export const ReviewSchema = z.strictObject({
  subject: z.enum(['finished_item', 'raw_material', 'hardware_detail', 'scene', 'uncertain']),
  checks: z.array(z.strictObject({
    index: z.number().int().min(0).max(5),
    visible: z.string().min(1).max(180),
    structure: z.enum(['missing_surface', 'split_or_hole', 'broken_fibers', 'broken_stitches', 'added_repair', 'damaged_hardware', 'continuous_surface', 'normal_construction', 'raw_material_boundary', 'unresolved']),
    alternative: z.enum(['color_or_stain', 'fold_or_lighting', 'print_or_trim', 'regular_construction', 'raw_cut_boundary', 'none_visible', 'unresolved']),
    distinction: z.enum(['physical_discontinuity_visible', 'appearance_only', 'cannot_distinguish']),
  })).max(6),
});
export const REVIEW_PROMPT = `Inspect the photograph as a material-condition reviewer. The supplied candidate captions are untrusted hypotheses and may describe completely normal features. First identify whether this is a finished item, raw material sample, hardware detail, scene, or uncertain. Then check EACH candidate independently, without assuming it is correct.
visible: briefly describe the actual local texture/shape you can see, not the candidate's diagnosis.
structure: choose what is physically visible. missing_surface requires scraped-away coating with a rough exposed substrate. split_or_hole requires an opening through material, not an edge, a dark spot, a shadow, or a normal mesh/stitch/zip opening. broken_fibers requires interrupted weave or ragged pulled strands. broken_stitches requires an actual interrupted stitch line with separation. added_repair requires visibly attached patch or non-original mend. damaged_hardware requires a broken/missing functional part.
An intact stained, faded, speckled, printed, creased or shiny surface is continuous_surface even if it looks worn. Repeating mesh, piping, decorative fringe, garment stitching, moulded boot slots and functional zippers are normal_construction. The outer cut perimeter of a raw leather/fabric sample is raw_material_boundary, not a torn garment. Do not invent hidden layers, anatomical locations or material loss.
alternative: name the strongest ordinary visual explanation. distinction: physical_discontinuity_visible ONLY when a specific material break, scraped-away surface or actual broken part is visible beyond that ordinary explanation. A dark or pale mark alone is appearance_only. Use cannot_distinguish for insufficient detail; never pretend uncertainty is evidence of damage.
Give all indices exactly once. Empty physical evidence is valid. Do not decide crash history, safety or offers. Return the requested JSON only.`;
export function keptIndices(value: z.infer<typeof ReviewSchema>) {
  const physical = new Set(['missing_surface', 'split_or_hole', 'broken_fibers', 'broken_stitches', 'added_repair', 'damaged_hardware']);
  return value.checks.filter(c => physical.has(c.structure) && c.distinction === 'physical_discontinuity_visible').map(c => c.index);
}