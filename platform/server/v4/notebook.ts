import type { Dossier } from './dossier';
const bound = new Set(['same_frame', 'continuity', 'custodial']);
const tidy = (text: string) =>
  text
    .replace(/^[\s:|[\]]+|[\s:|[\]]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const sentence = (text: string) =>
  tidy(text)
    .toLocaleLowerCase('en-CA')
    .replace(/\b[a-z]/g, (l) => l.toUpperCase());
export function notebookItem(d: Dossier['value'], rehearsal: boolean) {
  const fields = d.identity.unresolved
    ? []
    : d.fields.filter((f) => bound.has(f.attachment) && !f.requiresConfirmation);
  const value = (name: string) => fields.find((f) => f.field === name)?.value;
  const kind =
    d.category === 'pants'
      ? 'Riding trousers'
      : d.category === 'jacket'
        ? 'Riding jacket'
        : d.category === 'unknown'
          ? 'Garment'
          : sentence(d.category);
  const brand = d.identity.unresolved
    ? ''
    : sentence(value('brand') ?? (d.names.length === 1 ? d.names[0]! : ''));
  const line = value('model_line');
  const readable = line ? sentence(line.replace(/^the\s+/i, '')).replace(/\bJean$/i, 'Jeans') : '';
  const product = d.identity.unresolved
    ? 'Garment with mixed labels'
    : readable
      ? (brand && !readable.toLowerCase().startsWith(brand.toLowerCase()) ? brand + ' ' : '') +
        readable
      : brand
        ? brand + ' ' + kind.toLowerCase()
        : kind;
  const details = [
    d.category === 'pants' ? 'Trousers' : d.category === 'jacket' ? 'Jacket' : kind,
    value('size')?.replace(/^(US|EU)\s*:\s*/i, ''),
    value('garment_class') ? 'Class ' + value('garment_class') : null,
    value('production_date')?.match(/\b(?:19|20)\d{2}\b/)?.[0],
  ]
    .filter(Boolean)
    .join(' · ');
  const thumb =
    d.images.find((p) => p.role === 'outer_front') ?? d.images.find((p) => p.role === 'outer_back');
  return {
    id: d.id,
    category: d.category,
    names: d.names,
    title: d.result.title,
    action: d.result.action,
    count: d.sourceCount,
    product,
    details,
    thumb: thumb?.hash ?? null,
    rehearsal,
  };
}
