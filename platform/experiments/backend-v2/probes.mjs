// Frozen probe definitions. A probe is a single-token question whose answer distribution is
// read from token log-probabilities. Changing wording requires a NEW key, never an edit.
export const PROBES = {
  // P1: the core routing question. "Structural" separates what blocks an offer from ordinary wear.
  'structural-1': {
    words: ['yes', 'no'],
    system:
      'You answer with exactly one word: yes or no. Structural damage means a hole, tear, cut, split seam, or material scraped through. Ordinary wear, creases, dirt, fading, logos and stitching are not structural damage.',
    user: 'Does this photograph show structural damage to the item? Answer yes or no.',
  },
  // P2: same decision, phrased as a material-integrity check with the nuisance list expanded
  // from the recorded false-alarm causes (stains, prints, fringe, raw edges, zips).
  'structural-2': {
    words: ['yes', 'no'],
    system:
      'You are screening used gear photographs. Answer with exactly one word: yes or no. Say yes only when the material itself is visibly broken: a hole, a rip or tear, a cut, an open or burst seam, or a surface scraped through so that fibres, backing or a different layer show. Say no for stains, dirt, discolouration, fading, creases, scuff marks on an intact surface, printed or embroidered graphics, decorative stitching, fringe, mesh or perforation by design, zips, and the raw cut edge of a material sample.',
    user: 'Is the material in this photograph visibly broken (hole, tear, cut, open seam, or scraped through)? Answer yes or no.',
  },
  // P3: a wear-level question, for the condition grade rather than the exclusion.
  'wear-1': {
    words: ['yes', 'no'],
    system:
      'Answer with exactly one word: yes or no. Visible wear means scuffs, rubbed or faded patches, pilling, creasing from use, soiling, or small marks on a surface that is still intact.',
    user: 'Does this photograph show clearly visible wear from use? Answer yes or no.',
  },
  // P4: road-contact pattern, the cue for "looks crashed" that needs a rider conversation.
  'slide-1': {
    words: ['yes', 'no'],
    system:
      'Answer with exactly one word: yes or no. Road-contact damage looks like directional scrape marks, ground-away surface, melted or torn fabric with frayed edges concentrated on outer contact areas such as shoulders, elbows, knees, hips, palms or toes.',
    user: 'Does this photograph show damage that looks like the item slid along a road surface? Answer yes or no.',
  },
  // P5: is the subject protective motorcycle gear at all.
  'gear-1': {
    words: ['yes', 'no'],
    system:
      'Answer with exactly one word: yes or no. Motorcycle protective gear means a riding jacket, riding trousers, a one-piece or two-piece suit, riding gloves, riding boots, a motorcycle helmet, or an armour insert.',
    user: 'Is the main subject of this photograph a piece of motorcycle protective gear? Answer yes or no.',
  },
};
