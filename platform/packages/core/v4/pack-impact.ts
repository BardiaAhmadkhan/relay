export type ChangedFact =
  | { key: 'knox-purchase'; oldYears: number; newYears: number }
  | { key: 'US-to-CA-retail-postage'; oldCents: number[]; newCents: number[] }
  | { key: 'leather-apparel-duty'; oldPercent: number; newPercent: number };
export type DependentQuote = {
  id: string;
  item: string;
  inspection: string;
  market: string;
  packedGrams: number;
  quantity: number;
  tariffItem?: string;
  customsValueMinor?: number;
};
export type LinkedCase = {
  id: string;
  receipt: string;
  fields: { field: string; value: string; attachment: string }[];
};
export type ComponentRecord = { item: string; receipt: string; purchaseDate: string };
export function packImpact(
  change: ChangedFact,
  cases: LinkedCase[],
  quotes: DependentQuote[],
  components: ComponentRecord[],
) {
  const affectedCases: string[] = [],
    affectedQuotes: {
      id: string;
      item: string;
      oldCostMinor: number | null;
      newCostMinor: number | null;
      why: string;
    }[] = [],
    affectedReminders: { item: string; receipt: string; oldDue: string; newDue: string }[] = [];
  if (change.key === 'knox-purchase') {
    for (const item of cases)
      if (item.fields.some((f) => f.field === 'component_brand' && f.value === 'KNOX'))
        affectedCases.push(item.id);
    function due(date: string, years: number) {
      const d = new Date(date + 'T00:00:00Z');
      const year = d.getUTCFullYear() + years,
        month = d.getUTCMonth(),
        day = Math.min(d.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
      return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
    }
    for (const r of components.filter((r) => affectedCases.includes(r.item)))
      affectedReminders.push({
        item: r.item,
        receipt: r.receipt,
        oldDue: due(r.purchaseDate, change.oldYears),
        newDue: due(r.purchaseDate, change.newYears),
      });
  } else
    for (const q of quotes) {
      if (change.key === 'US-to-CA-retail-postage' && q.market === 'US') {
        const index = Math.ceil(q.packedGrams / 453.59237) - 1;
        const before = change.oldCents[index],
          after = change.newCents[index];
        if (before !== after)
          affectedQuotes.push({
            id: q.id,
            item: q.item,
            oldCostMinor: before === undefined ? null : before * q.quantity,
            newCostMinor: after === undefined ? null : after * q.quantity,
            why: 'US retail lane to Canada at the quoted packed weight',
          });
      } else if (change.key === 'leather-apparel-duty' && q.tariffItem === '4203.10.00') {
        const val = q.customsValueMinor;
        affectedQuotes.push({
          id: q.id,
          item: q.item,
          oldCostMinor: val === undefined ? null : Math.round((val * change.oldPercent) / 100),
          newCostMinor: val === undefined ? null : Math.round((val * change.newPercent) / 100),
          why: 'Explicit tariff classification on this quote',
        });
      }
    }
  for (const q of affectedQuotes) if (!affectedCases.includes(q.item)) affectedCases.push(q.item);
  return {
    fact: change.key,
    affectedCases: affectedCases.sort(),
    affectedQuotes,
    affectedReminders,
    originalReceipts: cases
      .filter((c) => affectedCases.includes(c.id))
      .map((c) => ({ item: c.id, receipt: c.receipt })),
    promotion: 'proposal only',
  };
}
