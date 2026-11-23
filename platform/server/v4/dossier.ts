import { z } from 'zod';
import { DecisionSchema2 } from '../../packages/core/v2/schema';
import {
  custodyCardCandidate,
  imageFact,
  type ImageFact,
  type TagRead,
  processingTiers,
} from '../../packages/core/v4/acquisition';
import {
  extractLabel,
  identityConflict,
  routedGarmentMaker,
  type LabelField,
} from '../../packages/core/v4/labels';
import {
  EvidenceLedger,
  type Observation,
  type SourceRegion,
} from '../../packages/core/v4/evidence';
import { modelFusion } from '../../packages/core/v4/fusion';
import { visibleAppearance, sameSidePatterns } from './appearance';
import { nextObservation } from '../../packages/core/v4/next-observation';
import { describeLabels, publicOutcomes } from '../../packages/core/v4/disclosure';
import { packHashes, digest, retailComparables } from '../../packages/core/v4/knowledge';
import { seal } from './seal';
import { resolveFoundation, disclosuresFor } from './foundation';

export const header = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  category: z.enum(['jacket', 'pants', 'unknown']),
  at: z.string().datetime(),
  images: z.array(imageFact).max(160),
  history: z.enum(['yes', 'no', 'unknown']).default('unknown'),
  combinedHistory: z.enum(['yes', 'no', 'unknown']).optional(),
  damage: z.enum(['yes', 'no', 'unknown']).default('unknown'),
  repair: z.enum(['yes', 'no', 'unknown']).default('unknown'),
  foundation: z.enum(['offer', 'review', 'retake', 'no_offer', 'pending']),
  foundationReason: z.string().max(500).default(''),
  foundationGrade: z.string().max(3).nullable().default(null),
  foundationReceipt: z.string().max(64).nullable().default(null),
  custody: z.string().nullable().default(null),
});
export type SourceCase = z.infer<typeof header>;
export const titles = publicOutcomes;
// The tested local pelvis-front head accepted folded side photographs. Its outputs are retained only as observations.
const qualifiedLiningInstruments: ReadonlySet<string> = new Set();
const weak = new Set(['standard', 'standard_year', 'garment_class', 'composition']);
export function buildDossier(
  raw: SourceCase,
  key: string,
  options: {
    verifiedCustody?: string;
    staffInsideFront?: string;
    reconciledAnchor?: string;
    confirmedFailure?: boolean;
    confirmedRepair?: boolean;
    specialistNote?: string;
    foundationEvidence?: { decision: unknown; slots: unknown[] };
    staffResolvedMaker?: string;
    wear?: { photo: string; zone: string };
    service?: { status: string; dueDate?: string; source: string; photo: string };
  } = {},
) {
  const item = header.parse(raw);
  const unique = new Map<string, ImageFact>();
  for (const im of [...item.images].sort((a, b) => a.photoId.localeCompare(b.photoId)))
    if (!unique.has(im.workingHash)) unique.set(im.workingHash, im);
  const images = [...unique.values()].sort((a, b) => a.photoId.localeCompare(b.photoId));
  const reads = images.flatMap((im): TagRead[] => {
    if (
      custodyCardCandidate(im, item.id) ||
      (!im.label && !im.acceptedLabel && !im.verifiedMakerRead)
    )
      return [];
    let fields = extractLabel(im.label);
    if (im.localOriginRead && !fields.some((f) => f.field === 'origin'))
      fields.push(...extractLabel(im.localOriginRead.text).filter((f) => f.field === 'origin'));
    if (im.verifiedMakerRead && !fields.some((f) => f.field === 'brand')) {
      const maker = routedGarmentMaker(im.verifiedMakerRead.text);
      if (maker) fields.push(maker);
    }
    if (im.acceptedLabel) {
      const external = extractLabel(im.acceptedLabel).filter((x) => weak.has(x.field));
      fields = [...fields.filter((x) => !weak.has(x.field)), ...external];
    }
    const attachment =
      im.attachment === 'same_frame' && im.anchor
        ? 'same_frame'
        : options.verifiedCustody
          ? 'custodial'
          : 'unresolved';
    return [{ photo: im.photoId, root: im.anchor ?? im.sourceHash, fields, attachment }];
  });
  const check = identityConflict(reads);
  const anchor =
    options.reconciledAnchor &&
    images.some((i) => i.workingHash === options.reconciledAnchor && i.attachment === 'same_frame')
      ? options.reconciledAnchor
      : null;
  const anchorMakers = anchor
    ? new Set(
        reads
          .find((t) => images.find((i) => i.photoId === t.photo)?.workingHash === anchor)
          ?.fields.filter((f) => f.field === 'brand')
          .map((f) => f.value),
      )
    : undefined;
  const selectedMaker =
    options.staffResolvedMaker && check.makers.includes(options.staffResolvedMaker)
      ? options.staffResolvedMaker
      : anchorMakers?.size === 1
        ? [...anchorMakers][0]
        : undefined;
  const unresolvedIdentity = check.conflicted && !selectedMaker;
  const claim = (im: ImageFact) => {
    const t = reads.find((a) => a.photo === im.photoId);
    const maker = t?.fields.filter((f) => f.field === 'brand').map((f) => f.value) ?? [];
    if (
      check.conflicted &&
      (unresolvedIdentity || !maker.length || !maker.every((m) => m === selectedMaker))
    )
      return 'conflict';
    if (im.attachment === 'same_frame' && im.anchor) return 'same_frame';
    return options.verifiedCustody ? 'custodial' : 'unresolved';
  };
  const entry = new EvidenceLedger(item.id);
  for (const im of images) {
    const t = reads.find((v) => v.photo === im.photoId);
    if (!t) continue;
    for (const f of t.fields) {
      if (
        ![
          'brand',
          'size',
          'origin',
          'standard',
          'garment_class',
          'production_date',
          'composition',
          'care',
          'model_code',
          'model_line',
          'component_mark',
          'component_brand',
        ].includes(f.field)
      )
        continue;
      const field: Observation['fact'] = f.field.startsWith('model_')
        ? 'model'
        : f.field.startsWith('component_')
          ? 'standard'
          : (f.field as Observation['fact']);
      const status = claim(im);
      const fromMaker =
        f.field === 'brand' &&
        im.verifiedMakerRead &&
        !extractLabel(im.label).some((s) => s.field === 'brand');
      const readCrop = fromMaker
        ? { hash: im.verifiedMakerRead!.cropHash, rect: im.verifiedMakerRead!.rect }
        : im.acceptedLabel && weak.has(f.field)
          ? im.acceptedLabelCrop
          : undefined;
      const source: SourceRegion = {
        photoId: im.photoId,
        parentHash: im.anchor ?? im.workingHash,
        cropHash: readCrop?.hash ?? im.workingHash,
        rect: readCrop?.rect ?? im.region ?? [0, 0, 1, 1],
        pixelWidth: im.width,
        pixelHeight: im.height,
        metadataChecked: true,
      };
      const factId = digest([im.photoId, field, f.value, f.component]).slice(0, 30);
      entry.append({
        id: factId,
        caseId: item.id,
        at: item.at,
        fact: field,
        value: f.value,
        status: 'read',
        instrument:
          f.field === 'origin' && im.localOriginRead
            ? 'two local origin readings'
            : fromMaker
              ? 'specialist maker reading'
              : im.acceptedLabel && weak.has(f.field)
                ? 'specialist tag reading'
                : 'local tag reading',
        instrumentVersion: '2026-11-21.1',
        calibration: 'uncalibrated',
        confidence: 'observed',
        sources: [source],
        binding: {
          status,
          method:
            status === 'custodial'
              ? 'authenticated operator and card'
              : status === 'same_frame'
                ? 'server-derived frame'
                : 'associated photo set',
          reason:
            status === 'conflict'
              ? 'Evidence cannot yet be tied to one garment.'
              : status === 'unresolved'
                ? 'The photographed text is legible; garment attachment needs context.'
                : 'The source and its attachment were recorded.',
          support:
            status === 'custodial'
              ? [options.verifiedCustody]
              : status === 'same_frame'
                ? [im.anchor]
                : [],
        },
        knowledgeRefs: [],
      });
    }
  }
  for (const im of images) {
    for (const f of im.findings) {
      if (!f.regionHash || f.box.length !== 4) continue;
      const attachment = claim(im);
      const region: SourceRegion = {
        photoId: im.photoId,
        parentHash: im.sourceHash,
        cropHash: f.regionHash,
        rect: f.box as SourceRegion['rect'],
        pixelWidth: im.width,
        pixelHeight: im.height,
        metadataChecked: true,
      };
      const anatomical = im.regions.find((r) => r.zone === f.zone);
      entry.append({
        id: digest([im.workingHash, f.regionHash, f.state]).slice(0, 30),
        caseId: item.id,
        at: item.at,
        fact: 'zone_condition',
        value: f.state,
        status: 'inferred',
        instrument: 'native-region condition',
        instrumentVersion: '2026-11-21.1',
        calibration: 'uncalibrated',
        confidence: 'tentative',
        layer: f.layer === 'exterior' ? 'shell' : 'unknown',
        zone: anatomical?.zone ?? 'unknown',
        sources: [region],
        binding: {
          status: attachment,
          method: 'source image association',
          reason: 'Localized model cue; material function and damage need confirmation.',
          support:
            attachment === 'custodial'
              ? [options.verifiedCustody]
              : attachment === 'same_frame'
                ? [im.anchor]
                : [],
        },
        knowledgeRefs: [packHashes.materials],
      });
    }
  }
  const evidence = entry.active();
  const visible = images.flatMap((i) =>
    i.findings
      .filter((f) =>
        ['open_damage', 'hardware_damage', 'repair_like', 'surface_change'].includes(f.state),
      )
      .map((f) => ({ photo: i.photoId, sourceHash: i.workingHash, ...f })),
  );
  const structural = visible.filter((f) =>
    ['open_damage', 'hardware_damage', 'repair_like'].includes(f.state),
  );
  const risk = structural.length > 0;
  const separating = nextObservation(structural);
  const areaChecks = images.flatMap((i) =>
    i.areaChecks.map((f) => ({ photo: i.photoId, sourceHash: i.workingHash, ...f })),
  );
  const inspectedZones = new Set(
    areaChecks
      .filter((f) => f.zone !== 'unknown' && f.decisionUse !== 'unplaced' && f.regionHash)
      .map((f) => f.layer + ' · ' + f.zone),
  );
  const roles = new Set(images.map((i) => i.role));
  const complete = roles.has('outer_front') && roles.has('outer_back') && reads.length > 0;
  const insideCovered = images.some(
    (im) => im.role === 'inner_overview' || im.regions.some((a) => a.layer === 'interior'),
  );
  const incumbentInside = images
    .flatMap((im) => im.findings)
    .filter((f) => f.layer === 'interior' && f.regionHash);
  const insideReturned = incumbentInside.length > 0;
  const insideInterpretable = [
    ...incumbentInside,
    ...areaChecks.filter((f) => f.layer === 'interior' && f.regionHash),
  ].some((f) => f.state !== 'unresolved' && f.state !== 'unknown');
  const insideReady = insideCovered && insideReturned && insideInterpretable;
  const initialFoundation = item.foundation;
  const boundFacts = reads
    .flatMap((t) => {
      const im = images.find((i) => i.photoId === t.photo)!;
      const attach = claim(im);
      return t.fields.map((f) => ({ f, im, attach }));
    })
    .filter((r) => ['custodial', 'continuity', 'same_frame'].includes(r.attach));
  const identityLabel = (f: LabelField, rokker: boolean) =>
    f.field === 'garment_class' ||
    (f.field === 'standard' && /17092-[2-6]\b|13595-1\b/.test(f.value)) ||
    (f.field === 'composition' &&
      ((/reinforce|protective/i.test(f.component + ' ' + f.line) &&
        /DYNATEC|ARAMID|DYNEEMA/i.test(f.value)) ||
        (rokker && /^inside$|^lining$/i.test(f.component) && /\bDYNATEC\b/i.test(f.line)))) ||
    (f.field === 'component_mark' && item.category !== 'unknown' && complete);
  const boundRokker = boundFacts.some(({ f }) => f.field === 'brand' && f.value === 'ROKKER');
  const tentativeRokker = reads.some((r) =>
    r.fields.some((f) => f.field === 'brand' && f.value === 'ROKKER'),
  );
  const premises = boundFacts
    .filter(({ f, im }) => !weak.has(f.field) || !!im.acceptedLabel)
    .filter(({ f }) => identityLabel(f, boundRokker))
    .map(({ f, im, attach }) => ({
      kind: 'garment_identity' as const,
      verified: true,
      attachment: attach,
      source: im.workingHash,
      coverage:
        f.field === 'component_mark' ? ('protector_in_garment' as const) : ('garment' as const),
    }));
  const textFrame = boundFacts.find(({ f, im }) =>
    f.field === 'standard' || f.field === 'composition' ? !!im.acceptedLabel : f.field === 'size',
  );
  const route =
    !unresolvedIdentity && options.foundationEvidence
      ? resolveFoundation({
          retainedExclusion:
            item.combinedHistory === 'yes' ||
            item.history === 'yes' ||
            item.damage === 'yes' ||
            item.repair === 'yes' ||
            options.confirmedFailure === true ||
            options.confirmedRepair === true,
          decision: options.foundationEvidence.decision,
          slots: options.foundationEvidence.slots,
          key,
          histories: disclosuresFor(
            item.history === 'no' && item.damage === 'no' && item.repair === 'no'
              ? 'no'
              : 'unknown',
            item.at,
          ),
          premises: [
            ...premises,
            ...(textFrame
              ? [
                  {
                    kind: 'label_legible' as const,
                    verified: true,
                    attachment: textFrame.attach,
                    source: textFrame.im.workingHash,
                    coverage: 'garment' as const,
                  },
                ]
              : []),
          ],
        })
      : null;
  const onward = route && 'replayDecision' in route ? route.replayDecision : undefined;
  const effective =
    onward?.outcome === 'no_offer' || onward?.outcome === 'retake'
      ? onward.outcome
      : route?.resolved
        ? route.decision.outcome
        : item.foundation;
  const originalReasons = DecisionSchema2.safeParse(options.foundationEvidence?.decision);
  const needsLiningFront =
    item.category === 'pants' &&
    route?.resolved === true &&
    originalReasons.success &&
    originalReasons.data.reasons.some((r) => r.code === 'not_recognised_as_gear');
  const staffFront =
    options.verifiedCustody && options.staffInsideFront
      ? images.find(
          (im) =>
            im.workingHash === options.staffInsideFront &&
            ['inner_overview', 'inner_zone', 'pocket'].includes(im.role),
        )
      : undefined;
  const localFront = images.find(
    (im) =>
      im.liningFront?.supported &&
      im.liningFront.conclusive &&
      qualifiedLiningInstruments.has(im.liningFront.method),
  );
  const liningSource = staffFront ?? localFront;
  const frontMissing = needsLiningFront && !liningSource;
  const signedReasons = DecisionSchema2.safeParse(onward ?? options.foundationEvidence?.decision);
  const codes = signedReasons.success ? signedReasons.data.reasons.map((r) => r.code) : [];
  const labelOnly =
    codes.length > 0 &&
    codes.every((c) => c === 'not_recognised_as_gear' || c === 'label_unreadable');
  const canAcquire =
    !route?.resolved &&
    labelOnly &&
    reads.some((t) =>
      t.fields.some(
        (f) =>
          identityLabel(f, tentativeRokker) ||
          (codes.includes('label_unreadable') &&
            ['size', 'standard', 'composition'].includes(f.field)),
      ),
    );
  const awaitingRiderHistory =
    item.combinedHistory === undefined &&
    [item.history, item.damage, item.repair].includes('unknown') &&
    signedReasons.success &&
    signedReasons.data.outcome === 'review' &&
    signedReasons.data.reasons.length > 0 &&
    signedReasons.data.reasons.every((r) =>
      /^history_unknown_(crash|protective_damage|protective_repair)$/.test(r.code),
    );
  const result = modelFusion({
    foundation: effective,
    awaitingRiderHistory,
    resolvableFoundation: canAcquire,
    combinedHistory: item.combinedHistory,
    crash: item.history,
    areaDamage: item.damage,
    areaRepair: options.confirmedRepair ? 'yes' : item.repair,
    verifiedProtectiveFailure: options.confirmedFailure === true,
    identityConflict: unresolvedIdentity,
    unresolvedComponent: false,
    possibleStructural: risk && !options.confirmedFailure,
    acquisitionComplete: complete,
    needsSourceView: !insideReady || frontMissing,
  });
  const names = selectedMaker
    ? [selectedMaker]
    : [
        ...new Set(
          reads.flatMap((t) => t.fields.filter((f) => f.field === 'brand').map((f) => f.value)),
        ),
      ].sort();
  const observations = reads.flatMap((t) => {
    const source = images.find((i) => i.photoId === t.photo)!;
    return t.fields.map((f) => ({
      ...f,
      photo: t.photo,
      attachment: claim(source),
      requiresConfirmation: weak.has(f.field) && !source.acceptedLabel,
    }));
  });
  const production = observations
    .filter((f) => f.field === 'production_date')
    .map((f) => ({
      text: f.value,
      photo: f.photo,
      attachment: f.attachment,
      authority: 'explicit production mark',
    }));
  const edition = observations
    .filter((f) => f.field === 'standard_year')
    .map((f) => ({
      text: f.value,
      photo: f.photo,
      authority: 'standard edition; does not establish production or expiry',
    }));
  const scopedNotes: string[] = [];
  if (
    observations.some((f) => f.field === 'component_mark') &&
    !observations.some((f) => f.field === 'garment_class')
  )
    scopedNotes.push(
      'The photographed standard identifies a protector. The garment class is unestablished.',
    );
  if (
    observations.some((a) => a.field === 'standard' && /17092-1\b/.test(a.value)) &&
    !observations.some((a) => a.field === 'standard' && /17092-[2-6]\b/.test(a.value))
  )
    scopedNotes.push(
      'Part 1 refers to the test method. A separately printed class is recorded on its own evidence.',
    );
  const trusted = observations.filter((f) =>
    ['same_frame', 'custodial', 'continuity'].includes(f.attachment),
  );
  const search = trusted
    .filter((f) => ['model_code', 'model_line'].includes(f.field))
    .map((f) => f.value.toUpperCase());
  const possibles = observations
    .filter((f) => ['model_code', 'model_line'].includes(f.field))
    .map((f) => f.value.toUpperCase());
  const match = (all: string[], m: (typeof retailComparables)[number]) =>
    all.some((x) => (!!m.article && x.includes(m.article)) || x.includes(m.model));
  const references = retailComparables
    .filter((m) => names.includes(m.maker) && match(possibles, m))
    .map((m) => ({
      ...m,
      attribution:
        match(search, m) && !unresolvedIdentity
          ? 'item-linked'
          : 'unverified comparable; no offer value',
    }));
  const appearance = visibleAppearance(options.foundationEvidence?.slots ?? [], key, areaChecks);
  const sidePatterns = sameSidePatterns(
    areaChecks,
    codes.some((code) => code.includes('road_contact')),
  );
  const guidance = describeLabels(observations, unresolvedIdentity, options.wear, options.service);
  const primary =
    result.action === 'keep' && guidance.suggestions.some((g) => g.primary)
      ? 'replacement'
      : result.action;
  const targeted = codes.includes('label_unreadable')
    ? 'Photograph the care or standard label still attached, with readable text and the surrounding fabric.'
    : 'Show the sewn label that identifies the riding garment, its technical layer or its installed protector, together with the garment.';
  const machineSets = result.resolvingSets;
  const specialistEvidence =
    !result.robust && machineSets.length === 0
      ? codes.includes('not_recognised_as_gear')
        ? 'A specialist must identify the garment from its construction or a connected manufacturer marking.'
        : codes.includes('label_unreadable')
          ? 'A specialist must verify the printed label and its attachment.'
          : signedReasons.success
            ? signedReasons.data.nextAction
            : 'A specialist must verify the recorded condition on the garment.'
      : null;
  const captureRetake = !!(
    signedReasons.success &&
    signedReasons.data.outcome === 'retake' &&
    signedReasons.data.requestPhoto &&
    !canAcquire
  );
  const evidenceSets: string[][] = specialistEvidence
    ? [['specialist_judgement']]
    : machineSets.map((set) =>
        set.map((f) =>
          f === 'foundation' && captureRetake
            ? 'view'
            : f === 'foundation' && canAcquire
              ? codes.includes('label_unreadable')
                ? 'bound_readable_label'
                : 'bound_garment_identity'
              : f,
        ),
      );
  const next =
    frontMissing && !risk && !unresolvedIdentity
      ? 'Show the full inside front of the trousers in one unfolded photo, with both hips and the centre fly visible.'
      : ((!risk && !unresolvedIdentity && captureRetake && signedReasons.success
          ? signedReasons.data.nextAction
          : null) ??
        specialistEvidence ??
        (!insideReady && complete && result.next?.startsWith('Add the missing view')
          ? insideCovered
            ? 'The inside photo is on record. Finish its condition check. If the region stays unreadable, show the lining and its attachment.'
            : 'Show the inside in one full view so the reviewer can see the lining and its attachment.'
          : canAcquire && result.next?.startsWith('Finish the visible-condition')
            ? targeted
            : result.next));
  const reasons = risk
    ? [
        ...result.reasons,
        'An uncalibrated region check flagged a possible ' +
          [
            ...new Set(
              structural.map((f) => f.state.replace(/_/g, ' ') + ' in the ' + f.layer + ' view'),
            ),
          ].join(', ') +
          '. A specialist can inspect each source.',
      ]
    : result.reasons;
  const snap = {
    version: '4.0-event',
    id: item.id,
    at: item.at,
    category: item.category,
    names,
    history: {
      crash: item.history,
      damage: item.damage,
      repair: item.repair,
      combined: item.combinedHistory ?? null,
    },
    baseline: {
      outcome: initialFoundation,
      grade: item.foundationGrade,
      why: item.foundationReason,
      receipt: item.foundationReceipt,
      semanticResolution: route?.resolved ?? false,
      effective,
      otherHold: route && 'otherHold' in route ? route.otherHold : null,
      onward: onward
        ? { outcome: onward.outcome, reasons: onward.reasons, requestPhoto: onward.requestPhoto }
        : null,
    },
    packs: packHashes,
    routingVersion: processingTiers.version,
    custodyAttested: !!options.verifiedCustody,
    result: {
      ...result,
      reasons,
      next: result.action === 'specialist' && separating ? separating.action.text : next,
      resolvingSets: evidenceSets,
      machineResolvingSets: machineSets,
      specialistEvidence,
      title: titles[primary],
      primary,
    },
    guidance,
    identity: {
      ...check,
      unresolved: unresolvedIdentity,
      anchor,
      resolvedMaker: selectedMaker ?? null,
    },
    sourceCount: images.length,
    images: images.map((i) => ({
      id: i.photoId,
      hash: i.workingHash,
      sourceHash: i.sourceHash,
      role: i.role,
      cardCandidate: custodyCardCandidate(i, item.id),
      liningCandidate: i.liningFront?.supported ?? false,
      metadataChecked: i.metadataChecked,
      width: i.width,
      height: i.height,
      attachment: claim(i),
      regions: i.regions,
    })),
    fields: observations,
    evidence,
    structural,
    visible,
    areaChecks,
    appearance,
    sidePatterns,
    nextObservation: separating,
    coverage: {
      insideFront: {
        required: needsLiningFront,
        witness: liningSource?.workingHash ?? null,
        method: staffFront
          ? 'staff-confirmed exact source'
          : localFront
            ? 'local pocket and fly comparison'
            : null,
      },
      incumbentInsideReturned: insideReturned,
      insideInterpretable,
      insideReady,
      nativeReads: areaChecks.filter((f) => f.regionHash).length,
      distinctAreas: inspectedZones.size,
      areas: [...inspectedZones].sort(),
    },
    dating: { production, edition },
    scopedNotes,
    specialistNote: options.specialistNote ?? null,
    dimensions: ['abrasion', 'impact coverage', 'seam integrity'].map((d) => ({
      dimension: d,
      current: 'unmeasured',
      basis: 'Photos and a printed type do not measure remaining laboratory performance.',
    })),
    serviceCandidate: trusted.some((f) => f.field === 'component_brand' && f.value === 'KNOX'),
    references,
  };
  return seal('inspection', snap, key);
}
export type Dossier = ReturnType<typeof buildDossier>;
