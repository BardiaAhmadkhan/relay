import type { RecordData } from '../shared/domain';
export type ReasonLine = { label: string; text: string; sources: string[] };
const needs: Record<string, string> = {
  history: 'the rider’s crash and repair history',
  layer: 'which layer the mark is on',
  identity: 'which garment the labels belong to',
  bound_garment_identity: 'a maker label visibly attached to this garment',
  bound_readable_label: 'a readable close-up of the sewn-in label',
  view: 'a clearer photograph of this garment',
  zone: 'where the mark sits on the garment',
  area: 'a view showing the surrounding impact area',
  inside_front: 'a full view of the inside front',
  outer_front: 'the full front of the garment',
  outer_back: 'the full back of the garment',
};
export function plainStep(text: string) {
  return text
    .replace(/bound garment identity/gi, 'the maker label attached to this garment')
    .replace(/protective substrate/gi, 'protective fabric')
    .replace(/custodial(?:ly)?/gi, 'shop-verified')
    .replace(/native region/gi, 'photo detail')
    .replace(/(?:exterior|outer) shell/gi, 'outer fabric')
    .replace(/resolving set/gi, 'evidence needed')
    .replace(/decision gate/gi, 'inspection check');
}
export function riderFinding(s: string) {
  if (/Not usable.*locate this zone/i.test(s))
    return 'We could not locate this area reliably in the photo.';
  if (/Screening cue on an estimated location/i.test(s))
    return 'There may be a mark here. A specialist must check its position.';
  if (/Photographed, awaiting a reading/i.test(s))
    return 'Photo available. This area still needs to be checked.';
  return plainStep(s);
}
export function explainDecision(r: RecordData) {
  const lines: ReasonLine[] = [];
  const add = (label: string, text: string, sources: string[] = []) => {
    lines.push({
      label,
      text,
      sources: [...new Set(sources)].filter((id) => r.frames.some((f) => f.id === id)),
    });
  };
  const kinds = new Set(r.needs?.flat() ?? []),
    historyUnknown = /unconfirmed|unsure|unknown/i.test(r.history),
    historyYes = /exclusion|crash disclosed/i.test(r.history);
  const flagged = r.zones.flatMap((z) =>
    z.cells
      .filter((c) => c.adverse)
      .map((c) => ({
        name: z.name.toLowerCase(),
        layer: c.layer.toLowerCase(),
        source: c.source,
        quality: c.quality,
      })),
  );
  const selected = flagged.find((f) => ['full', 'partial'].includes(f.quality)) ?? flagged[0];
  const source = r.observationSource ?? r.frames.find((f) => f.id.startsWith('finding:'))?.id;
  const out = r.card.outcome,
    garment =
      r.card.category === 'pants' ? 'trousers' : r.card.category === 'jacket' ? 'jacket' : 'gear';
  let lead = '',
    next = '';
  if (out === 'retire') {
    const direct = r.historyDetails?.filter((h) => h.answer === 'yes').map((h) => h.label) ?? [];
    lead = historyYes
      ? direct.length
        ? 'You reported ' + direct.join(' and ') + '.'
        : 'You reported a crash, damage or repair in an area the gear is meant to protect.'
      : 'The shop recorded a condition that rules out a trade-in.';
    add(
      historyYes ? 'Your answer' : 'Shop finding',
      historyYes
        ? 'That history rules out a store offer, even if the outside looks intact.'
        : plainStep(r.note ?? r.reason),
      historyYes ? [] : r.notes.map((n) => n.source),
    );
    next = 'There is no trade-in offer for this garment.';
  } else if (r.eligible && out === 'keep') {
    lead = 'The shop can accept this ' + garment + ' for trade-in.';
    if (!historyUnknown && !historyYes)
      add(
        'Your answer',
        'The recorded history reports no crash, damage or repair in a protective area.',
      );
    add(
      'Shop decision',
      'The inspection cleared this garment for an offer. Its price is worked out separately from that decision.',
    );
    if (r.custody)
      add(
        'Shop check',
        'A member of staff verified that the garment and its source photos belong together.',
      );
    next =
      'Review the estimated credit, then bring the garment to the shop to complete the exchange.';
  } else if (r.identityConflict && !(out === 'specialist' && r.observation)) {
    lead = 'The labels in these photos point to different garments.';
    add(
      'Photo evidence',
      'The shop cannot tell which label describes this item.',
      r.identitySources ?? [],
    );
    next =
      r.next ??
      'Take one photo with the maker label and the fabric it is sewn into in the same frame.';
  } else if (out === 'replace') {
    lead = 'The shop recommends looking at replacement gear.';
    add('Shop decision', plainStep(r.reason), source ? [source] : []);
    next = r.next ?? 'Open the shop details to see the recorded recommendation.';
  } else if (out === 'specialist' && (selected || kinds.has('layer') || r.observation)) {
    const placed = selected && ['full', 'partial'].includes(selected.quality);
    lead = placed
      ? 'A mark on the ' + selected.layer + ' of the ' + selected.name + ' needs a closer look.'
      : r.card.example && r.observation
        ? 'The shoulder seam could be worn on the surface or starting to open.'
        : r.observationKind === 'hardware_damage'
          ? 'The photo shows a gap at a fitting. It could be a normal opening or a broken mount.'
          : r.observationKind === 'repair_like'
            ? 'The stitching could be original or it could be a repair. The photo does not settle which.'
            : 'The photo leaves open whether the mark affects the lining or the protective outer fabric.';
    add(
      'What the photo shows',
      placed
        ? 'The marked photo shows the area that raised the question. A photo alone has not confirmed damage.'
        : r.observationKind === 'hardware_damage'
          ? 'There appears to be a gap at a fitting. The attachment is not clear in this view.'
          : r.observationKind === 'repair_like'
            ? 'The stitching or extra panel is visible. The photo does not establish whether it was added later.'
            : r.card.example && r.observationSource === 'detail'
              ? 'The close-up shows wear along the shoulder stitching. Its depth is unclear.'
              : 'The mark may be an opening. The photo does not establish which layer is affected.',
      [...(source ? [source] : []), ...(selected?.source ? [selected.source] : [])],
    );
    add(
      'Why it matters',
      r.observationKind === 'hardware_damage'
        ? 'A designed vent and a broken attachment have different consequences. The shop needs to identify which is visible.'
        : r.observationKind === 'repair_like'
          ? 'Original construction can pass this check. A confirmed repair in a protective area rules out a trade-in.'
          : 'Surface wear and an opening in protective fabric lead to different decisions. The shop has held the offer until it knows which applies.',
    );
    next = plainStep(
      r.observation ?? r.next ?? 'A specialist will examine the garment and record what they find.',
    );
  } else if (
    historyUnknown &&
    (kinds.has('history') || /crash|history question/i.test(r.next ?? ''))
  ) {
    lead = 'The shop still needs the garment’s history.';
    add(
      'Your answer',
      'A photo cannot tell us whether gear has been through a crash or had a protective panel repaired.',
    );
    next =
      'Tell the shop whether it has been in a crash, or damaged or repaired in an impact area. “Not sure” is a valid answer.';
  } else if (out === 'request') {
    lead = 'The shop needs another view before it can make an offer.';
    const nextPhoto = plainStep(
      r.next ?? 'Show the whole garment and the detail the shop asked about.',
    );
    add(
      'Missing evidence',
      /label|tag/i.test(nextPhoto)
        ? 'The shop needs to read the label and see that it belongs to this garment.'
        : /inside|lining/i.test(nextPhoto)
          ? 'The current photos do not show enough of the inside to finish this check.'
          : nextPhoto,
    );
    next = nextPhoto;
  } else {
    lead = 'A person needs to review this garment before the shop can offer credit.';
    add(
      'What is known',
      r.card.id.startsWith('LOCAL-')
        ? 'Your photos are stored on this device. A live inspection has not been run.'
        : plainStep(r.reason || 'The photos did not settle the condition check.'),
    );
    next = plainStep(
      r.next ?? 'A specialist will review the evidence and record the next decision.',
    );
  }
  if (r.identityConflict && out === 'specialist' && r.next && r.observation)
    next = plainStep(r.observation);
  if (r.identityConflict && !lines.some((x) => x.text.includes('which label')))
    add(
      'Label evidence',
      'These labels point to different garments. The shop has held back their protection markings.',
      r.identitySources ?? [],
    );
  if (out === 'specialist' && !r.card.example && !selected && !r.observation) {
    const unclear = r.zones.flatMap((z) =>
      z.cells
        .filter((c) => ['missing', 'unread', 'unplaced'].includes(c.quality))
        .map((c) => ({
          name: z.name.toLowerCase() + ' (' + c.layer.toLowerCase() + ')',
          source: c.source,
        })),
    );
    if (unclear.length)
      add(
        'Unseen or unclear',
        unclear
          .slice(0, 2)
          .map((c) => c.name)
          .join(' and ') + ' could not be checked from the available photos.',
        unclear.slice(0, 2).flatMap((c) => (c.source ? [c.source] : [])),
      );
  }
  if (historyUnknown && kinds.has('history') && !lines.some((x) => x.label === 'Your answer'))
    add('Still to confirm', 'The shop also needs the rider’s crash and repair history.');
  if (r.note && out !== 'retire')
    add(
      'Specialist observation',
      r.note,
      r.notes.map((n) => n.source),
    );
  const routes = (r.needs ?? [])
    .map((g) => [...new Set(g.map((k) => needs[k]).filter(Boolean))])
    .filter((g) => g.length);
  const heading =
    out === 'retire'
      ? 'No trade-in offer'
      : r.eligible && out === 'keep'
        ? 'Eligible for trade-in'
        : out === 'replace'
          ? 'Replacement recommended'
          : out === 'specialist'
            ? 'A specialist needs a closer look'
            : r.identityConflict || /label|tag/i.test(r.next ?? '')
              ? 'We need the attached label'
              : /crash|history/i.test(r.next ?? '')
                ? 'We need your garment’s history'
                : /inside|lining/i.test(r.next ?? '')
                  ? 'We need an inside photo'
                  : 'We need another view';
  return { heading, lead, lines, next, routes };
}
