import type { LabelField } from './labels';

export const performanceDisclosure =
  'Based on what we can see and what the label and maker state. Not a test or guarantee of protective performance.';
export const publicOutcomes = {
  keep: 'Eligible for an offer',
  retire: 'No offer',
  request: 'One more piece of evidence needed',
  specialist: 'A specialist will review it',
  replacement: 'Replacement suggested',
} as const;

type Field = Pick<LabelField, 'field' | 'value' | 'component' | 'printed'> & {
  photo: string;
  attachment: string;
  requiresConfirmation?: boolean;
};
type Suggestion = {
  primary: boolean;
  scope: 'component' | 'garment';
  reason: string;
  photos: string[];
  authority: string | null;
};
type VerifiedWear = { photo: string; zone: string };
const bound = new Set(['same_frame', 'custodial', 'continuity', 'staff_reconciled']);
const visibleFields = new Set([
  'standard',
  'garment_class',
  'component_mark',
  'production_date',
  'composition',
]);
const classByPart: Record<string, string> = { '2': 'AAA', '3': 'AA', '4': 'A', '5': 'B', '6': 'C' };
export function describeLabels(
  fields: Field[],
  unresolvedIdentity: boolean,
  verifiedWear?: VerifiedWear,
  service?: { status: string; dueDate?: string; source: string; photo: string },
) {
  const confirmed = fields.filter(
    (f) => !unresolvedIdentity && bound.has(f.attachment) && !f.requiresConfirmation,
  );
  const relevant = confirmed.filter((f) => visibleFields.has(f.field));
  const lines: { text: string; photo: string; kind: string }[] = [];
  const flags: string[] = [];
  const suggestions: Suggestion[] = [];
  for (const f of relevant) {
    let fact: string;
    switch (f.field) {
      case 'standard':
        fact =
          (f.printed ?? f.value) +
          (f.component === 'protector' ? ' on the protector marking.' : ' on the garment marking.');
        break;
      case 'garment_class':
        fact = 'garment class ' + f.value + '.';
        break;
      case 'production_date':
        fact = 'a production code of ' + f.value + '.';
        break;
      case 'composition':
        fact =
          (f.printed ?? f.value) +
          (f.component === 'unspecified' ? ' (layer unspecified).' : ' for ' + f.component + '.');
        break;
      default:
        continue; // A derived component classification is context, not a verbatim printed code.
    }
    const text = 'The label states ' + fact;
    if (!lines.some((l) => l.text === text)) lines.push({ text, photo: f.photo, kind: f.field });
  }
  if (unresolvedIdentity)
    flags.push('Not confirmed. The submitted tags identify different garments.');
  else if (!lines.length)
    flags.push(
      fields.some((f) => visibleFields.has(f.field))
        ? 'Not confirmed. The tag needs a connected view or a verified reading.'
        : 'Not confirmed. A readable garment marking is needed.',
    );
  const standards = confirmed.filter((f) => f.field === 'standard'),
    classes = confirmed.filter((f) => f.field === 'garment_class');
  if (standards.some((f) => f.component === 'protector') && !classes.length)
    flags.push('The marking applies to the protector. A garment class has not been established.');
  const dates = confirmed.filter(
    (f) => f.field === 'production_date' && /^\d{4}-\d{2}$/.test(f.value),
  );
  const markedYears = standards.flatMap((s) => {
    const year = /:((?:19|20)\d{2})$/.exec(s.value)?.[1];
    return year ? [{ year: Number(year), photo: s.photo, scope: s.component, mark: s.value }] : [];
  });
  const dating = {
    production: dates.map((f) => ({ value: f.value, precision: 'month', photo: f.photo })),
    markingBounds: markedYears.map((y) => ({
      earliestStatedEditionYear: y.year,
      photo: y.photo,
      scope: y.scope,
      mark: y.mark,
    })),
  };
  for (const s of markedYears.filter((s) => s.scope === 'garment')) {
    if (dates.some((f) => Number(f.value.slice(0, 4)) < s.year))
      flags.push(
        'The printed production code precedes the cited garment edition. A specialist should confirm both dates and their scope.',
      );
  }
  if (markedYears.length && !dates.length) {
    const latest = Math.max(...markedYears.map((m) => m.year));
    flags.push(
      'Assuming this is the original label, its newest cited edition places that marking in ' +
        latest +
        ' or later. The garment’s production date is unconfirmed.',
    );
  }
  const partOne = standards.find((f) => /17092-1\b/.test(f.value));
  const matchingClassPart = standards.some((s) => {
    const part = /17092-([2-6])\b/.exec(s.value)?.[1];
    return !!part && classes.some((c) => c.value === classByPart[part]);
  });
  if (partOne && classes.length && !matchingClassPart)
    flags.push('Part 1 describes test methods. Confirm the garment class printed alongside it.');
  for (const f of standards) {
    const part = /17092-([2-6])\b/.exec(f.value)?.[1];
    const cls = classes.find((c) => c.photo === f.photo && part && c.value !== classByPart[part]);
    if (cls)
      flags.push('The printed class and standard part on one tag need specialist confirmation.');
  }
  if (!unresolvedIdentity && verifiedWear)
    suggestions.push({
      primary: true,
      scope: 'garment',
      reason:
        'A specialist recorded pronounced visible wear at the ' +
        verifiedWear.zone.replace(/_/g, ' ') +
        '. Consider a replacement.',
      photos: [verifiedWear.photo],
      authority: null,
    });
  const draft = standards.find((f) => /^(?:F?PR)EN 17092/.test(f.value));
  const production = confirmed.find(
    (f) => f.field === 'production_date' && /^\d{4}-\d{2}$/.test(f.value) && f.value < '2020-01',
  );
  if (draft && production) {
    suggestions.push({
      primary: false,
      scope: 'garment',
      reason:
        'A draft marking and an explicit production code before the 2020 EN 17092 edition support discussing newer options.',
      photos: [...new Set([draft.photo, production.photo])],
      authority: 'https://eur-lex.europa.eu/eli/dec_impl/2021/395/oj/eng',
    });
  }
  if (
    draft &&
    !production &&
    /17092-[2-6]:(?:19|20)\d{2}/.test(draft.value) &&
    Number(draft.value.slice(-4)) < 2020 &&
    classes.length
  ) {
    suggestions.push({
      primary: false,
      scope: 'garment',
      reason:
        'The label names the draft ' +
        (draft.printed ?? draft.value) +
        '. A published 2020 edition exists for that part. If the rider wants the newer marking, discuss a replacement. The draft year alone cannot date this garment.',
      photos: [draft.photo],
      authority: 'https://eur-lex.europa.eu/eli/dec_impl/2021/395/oj/eng',
    });
  }
  if (service?.status === 'replacement_due')
    suggestions.push({
      primary: false,
      scope: 'component',
      reason:
        'Knox recommends replacing the identified protector five years after purchase. The stated interval ended ' +
        service.dueDate +
        '.',
      photos: [service.photo],
      authority: service.source,
    });
  const order = ['garment_class', 'standard', 'production_date'];
  const headerFacts = relevant
    .filter((f) => order.includes(f.field))
    .sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field));
  const headline = [
    ...new Set(
      headerFacts.map((f) =>
        f.field === 'garment_class'
          ? 'class ' + f.value
          : f.field === 'production_date'
            ? 'production ' + f.value
            : (f.printed ?? f.value),
      ),
    ),
  ].join(' · ');
  const compositions = new Map<string, { text: string; photo: string }>();
  for (const f of relevant.filter((f) => f.field === 'composition')) {
    const k = f.component + '|' + f.value;
    if (!compositions.has(k))
      compositions.set(k, {
        text:
          (f.printed ?? f.value) +
          (f.component === 'unspecified'
            ? /^100\s*%/.test(f.value)
              ? ' (component not stated)'
              : ''
            : ' (' + f.component + ')'),
        photo: f.photo,
      });
  }
  const phrase = [...compositions.values()].map((f) => f.text).join(', ');
  return {
    lines,
    compact: {
      headline: headline ? 'The label states ' + headline + '.' : null,
      composition: phrase ? 'The label states ' + phrase + '.' : null,
      source:
        headerFacts.find((f) => f.field === 'standard')?.photo ?? headerFacts[0]?.photo ?? null,
    },
    flags: [...new Set(flags)],
    suggestions,
    dating,
    disclosure: performanceDisclosure,
  };
}
