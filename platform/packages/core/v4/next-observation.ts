type Finding = { photo: string; zone: string; layer: string; state: string; box: number[] };
type Explanation = { key: string; text: string; consequence: string };
type Action = {
  key: string;
  text: string;
  separates: [string, string][];
  effort: 'one close photograph' | 'specialist inspection';
};
const noOffer = 'A confirmed defect or repair in a protective area closes the offer.';
const continueChecks =
  'This explanation supplies no exclusion by itself. The other checks still apply.';
function toolsFor(kind: string): {
  explanations: Explanation[];
  actions: Action[];
  uninformative: string;
} {
  if (kind === 'hardware_damage')
    return {
      explanations: [
        { key: 'broken', text: 'The surround or mount is fractured.', consequence: noOffer },
        {
          key: 'designed',
          text: 'The visible gap is the vent’s manufactured opening.',
          consequence: continueChecks,
        },
        {
          key: 'unknown_layer',
          text: 'The hardware function or its attachment remains unclear.',
          consequence: 'A specialist needs to establish its role.',
        },
      ],
      actions: [
        {
          key: 'oblique_hardware',
          text: 'Show the edge of the vent or hardware at a slight angle, with its mount and the surrounding panel in focus.',
          separates: [
            ['broken', 'designed'],
            ['broken', 'unknown_layer'],
          ],
          effort: 'one close photograph',
        },
      ],
      uninformative: 'Another full front photo is unlikely to reveal the edge or mount.',
    };
  if (kind === 'repair_like')
    return {
      explanations: [
        {
          key: 'repair',
          text: 'The patch or stitching is a repair in a protective area.',
          consequence: noOffer,
        },
        {
          key: 'factory',
          text: 'The seam or overlay is original construction.',
          consequence: continueChecks,
        },
        {
          key: 'unplaced',
          text: 'The affected layer is unidentified.',
          consequence: 'A specialist needs to inspect its attachment.',
        },
      ],
      actions: [
        {
          key: 'seam_connection',
          text: 'Show both sides of the stitching and where it joins the surrounding panel in one connected view.',
          separates: [
            ['repair', 'factory'],
            ['repair', 'unplaced'],
          ],
          effort: 'one close photograph',
        },
      ],
      uninformative: 'A second photo of the brand label does not identify the seam.',
    };
  return {
    explanations: [
      {
        key: 'shell',
        text: 'A tear runs through the shell or a protective-area seam.',
        consequence: noOffer,
      },
      {
        key: 'liner',
        text: 'The opening is confined to a removable or comfort lining.',
        consequence: 'Verify the lining’s function and check the underlying shell.',
      },
      {
        key: 'fold',
        text: 'A fold, pocket mouth or designed opening creates the dark edge.',
        consequence: continueChecks,
      },
    ],
    actions: [
      {
        key: 'layer_connection',
        text: 'Show both sides of the opening and where the lining attaches to the shell, keeping the surrounding seam in the same frame.',
        separates: [
          ['shell', 'liner'],
          ['shell', 'fold'],
          ['liner', 'fold'],
        ],
        effort: 'one close photograph',
      },
    ],
    uninformative: 'Another full front photo does not show which layer the opening reaches.',
  };
}
export function nextObservation(findings: Finding[]) {
  const sorted = [...findings].sort(
    (a, b) =>
      Number(b.layer === 'detail') - Number(a.layer === 'detail') ||
      Number(b.state === 'hardware_damage') - Number(a.state === 'hardware_damage') ||
      a.photo.localeCompare(b.photo),
  );
  const strongest = sorted[0];
  if (!strongest) return null;
  const { explanations, actions, uninformative } = toolsFor(strongest.state);
  // Each listed pair has different policy consequences. When empirical resolution rates are absent,
  // count only pairs the physical observation can separate; do not invent a probability of success.
  const ranked = [...actions].sort(
    (a, b) => b.separates.length - a.separates.length || a.key.localeCompare(b.key),
  );
  return {
    source: strongest.photo,
    zone: strongest.zone,
    layer: strongest.layer,
    box: strongest.box,
    explanations,
    action: ranked[0]!,
    uninformative,
    requestLimit: 1,
    empiricalResolutionRate: null,
    rateBasis:
      'The resolution rate per requested photograph is unmeasured. If the connected view is unavailable or still unclear, a specialist reviews the item.',
  };
}
