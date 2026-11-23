/** These describe requested photographs, never an attestation of what a photograph proves. */
export const requiredViews = ['front', 'back', 'label', 'inside'] as const;
export const intakeViews = [...requiredViews, 'detail'] as const;
export type IntakeView = (typeof intakeViews)[number];
export const viewInstructions: Record<
  IntakeView,
  { title: string; short: string; instruction: string }
> = {
  front: {
    title: 'Front, laid flat',
    short: 'Front',
    instruction: 'Lay the garment flat and fit the whole front in the frame.',
  },
  back: {
    title: 'Turn it over',
    short: 'Back',
    instruction: 'Smooth the back and include both sides from top to hem.',
  },
  label: {
    title: 'The label, attached',
    short: 'Label',
    instruction:
      'Centre the readable label and keep its stitching and the garment around it in the same photo.',
  },
  inside: {
    title: 'Open the inside front',
    short: 'Inside front',
    instruction:
      'Unfold the garment and show the entire inside front, including the lining and edges.',
  },
  detail: {
    title: 'Anything worn or damaged?',
    short: 'Detail',
    instruction: 'If you see wear or damage, include its edge and the material around it.',
  },
};
