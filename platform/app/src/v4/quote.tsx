import * as React from 'react';
import { Text, View, TextInput, StyleSheet } from 'react-native';
import { Button, C, F } from '../design';
import { desk, money, type Shop, type Market, type Scenario } from './api';
const s = StyleSheet.create({
  wrap: {
    gap: 12,
    marginVertical: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    backgroundColor: C.white,
  },
  head: { fontFamily: F.serif, fontSize: 22, lineHeight: 26, color: C.ink },
  label: { fontFamily: F.medium, fontSize: 13, color: C.muted },
  value: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    minHeight: 44,
    padding: 10,
    backgroundColor: C.white,
    color: C.ink,
  },
  body: {
    fontFamily: F.body,
    fontSize: 15,
    lineHeight: 22,
    fontVariant: ['tabular-nums'],
    color: C.ink,
  },
});
export function QuoteScenario({
  id,
  scenario,
  market,
  shop,
  session,
}: {
  id: string;
  scenario: Scenario;
  market: Market;
  shop: Shop;
  session: () => Promise<string>;
}) {
  const [open, setOpen] = React.useState(false),
    [busy, setBusy] = React.useState(false),
    [msg, setMsg] = React.useState(''),
    [form, setForm] = React.useState<Record<string, string>>({
      weight: '1000',
      price: '',
      duties: '',
      chance: '',
      salvage: '',
      acquisition: '',
    });
  const [quote, setQuote] = React.useState<{
    quoteReceipt: string;
    inspection: string;
    margin: Shop['margin'];
  } | null>(null);
  React.useEffect(() => {
    setOpen(false);
    setQuote(null);
    setMsg('');
    setForm({ weight: '1000', price: '', duties: '', chance: '', salvage: '', acquisition: '' });
  }, [id, market, scenario]);
  if (!shop.eligible) return null;
  const currency = shop.market.currency;
  const values = [
    ['weight', 'Packed grams per item'],
    ['price', 'Local new-retail reference (' + currency + ')'],
    ['duties', 'Duties and clearance (' + currency + ')'],
    ['chance', 'Chance of sale (%)'],
    ['salvage', 'Value if unsold (' + currency + ')'],
    ['acquisition', 'Agreed purchase cost (' + currency + ')'],
  ];
  function num(field: string, mult = 1) {
    const raw = form[field]?.trim();
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) throw Error('Enter a nonnegative number.');
    return mult === 100 ? Math.round(value * 100) : value * mult;
  }
  async function calculate() {
    if (busy) return;
    setBusy(true);
    setMsg('');
    try {
      const grams = num('weight');
      if (grams === null || !Number.isInteger(grams) || grams <= 0)
        throw Error('Enter the packed weight in whole grams.');
      const chance = num('chance', 0.01);
      if (chance !== null && chance > 1) throw Error('Chance of sale must be between 0 and 100%.');
      const response = await desk<{
        quoteReceipt: string;
        inspection: string;
        margin: Shop['margin'];
      }>(
        '/v4/shop/' + id + '/quote',
        {
          scenario,
          inspection: shop.inspection,
          market,
          packedGrams: grams,
          quantity: 1,
          retailMinor: num('price', 100),
          dutiesMinor: num('duties', 100),
          saleProbability: chance,
          salvageMinor: num('salvage', 100),
          acquisitionMinor: num('acquisition', 100),
        },
        await session(),
      );
      setQuote(response);
      setMsg('Commercial scenario saved separately from the inspection.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not calculate this scenario.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={s.wrap}>
      <Button
        kind="secondary"
        label={open ? 'Close quotation calculator' : 'Calculate a quotation scenario'}
        onPress={() => setOpen(!open)}
      />
      {open && (
        <>
          <Text style={s.head}>Quotation assumptions</Text>
          <Text style={s.label}>
            Enter known amounts in {currency}. A blank amount stays unknown.
          </Text>
          {values.map(([k, label]) => (
            <View key={k}>
              <Text style={s.label}>{label}</Text>
              <TextInput
                style={s.value}
                accessibilityLabel={label}
                value={form[k!]}
                placeholder="Not set"
                keyboardType="decimal-pad"
                onChangeText={(v) => setForm((p) => ({ ...p, [k!]: v }))}
              />
            </View>
          ))}
          <Button
            disabled={busy}
            label="Save separate quotation"
            onPress={() => void calculate()}
          />
          {!!msg && (
            <Text accessibilityLiveRegion="polite" style={s.body}>
              {msg}
            </Text>
          )}
          {quote && (
            <>
              <Text style={s.body}>
                Break-even sale price · {money(quote.margin.breakEvenMinor, currency)}
              </Text>
              <Text style={s.body}>
                Expected contribution · {money(quote.margin.expectedContributionMinor, currency)}
              </Text>
              <Text style={s.label}>
                {quote.margin.missing.length
                  ? 'Still needed · ' + quote.margin.missing.join(', ')
                  : 'All specified assumptions are present.'}
              </Text>
            </>
          )}
        </>
      )}
    </View>
  );
}
