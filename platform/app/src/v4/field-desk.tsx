import * as React from 'react';
import {
  View,
  Text,
  Image,
  Pressable,
  ScrollView,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Platform,
  AccessibilityInfo,
  findNodeHandle,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Button, C, F, Icon, RelayMark } from '../design';
import {
  desk,
  photoUrl,
  words,
  money,
  type Brief,
  type DeskRecord,
  type Market,
  type Scenario,
  type Shop,
  type Terms,
} from './api';
import { NativeIntake } from './intake';
import { Notebook, PhoneStage, StatusPill } from './notebook';
import { SubmittedPhotos } from './requested-photo';
import { ZoneEvidence } from './zone-report';
import { EvidenceViewer } from './photo-viewer';
import { SpecialistIntro, RoleFold, ReceiptBanner } from './role-cards';
import { RiderSummary, findingText, layerText, requestedAction } from './rider-summary';
import { VisionPage } from './vision-page';
import { QuoteScenario } from './quote';
import { CustodyPanel } from './custody';
import { performanceDisclosure } from '../../../packages/core/v4/disclosure';

const css = StyleSheet.create({
  page: { flex: 1, minHeight: 0, backgroundColor: C.paper },
  shopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  roleTitle: { fontFamily: F.serif, fontSize: 28, lineHeight: 31, color: C.ink, marginTop: 5 },
  findingHero: { width: 91, height: 98, borderRadius: 10, backgroundColor: C.wash },
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  formCell: { width: '48%', gap: 8 },
  metricCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.white,
    padding: 20,
    gap: 8,
  },
  evidenceThumb: { width: 64, height: 66, borderRadius: 8, backgroundColor: C.wash },
  wrap: {
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingBottom: 48,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomColor: C.line,
    borderBottomWidth: 1,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  word: { fontFamily: F.bold, fontSize: 20, color: C.ink },
  eyebrow: {
    fontFamily: F.bold,
    fontSize: 11,
    letterSpacing: 1.4,
    color: C.forest,
    textTransform: 'none',
  },
  title: {
    fontFamily: F.serif,
    fontSize: 34,
    lineHeight: 38,
    color: C.ink,
    marginTop: 8,
    marginBottom: 12,
  },
  body: { fontFamily: F.body, fontSize: 15, lineHeight: 22, color: C.ink },
  subdued: { fontFamily: F.body, fontSize: 13, lineHeight: 18, color: C.muted },
  heading: { fontFamily: F.serif, fontSize: 22, lineHeight: 26, color: C.ink, marginTop: 32 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { paddingVertical: 12 },
  chip: {
    minHeight: 32,
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    paddingHorizontal: 12,
    backgroundColor: C.white,
  },
  chipOn: { backgroundColor: C.forest, borderColor: C.forest },
  chipText: { fontFamily: F.medium, color: C.ink, fontSize: 13 },
  chipActive: { color: 'white' },
  hero: { width: '100%', height: 248, backgroundColor: C.wash, borderRadius: 12 },
  thumb: {
    width: 72,
    height: 88,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.wash,
  },
  panel: {
    backgroundColor: '#edf1e9',
    borderWidth: 1,
    borderColor: '#d4dcd0',
    borderRadius: 12,
    padding: 20,
    gap: 8,
    marginVertical: 16,
  },
  danger: { backgroundColor: C.dangerWash, borderLeftColor: C.red },
  pad: { marginTop: 16, gap: 12 },
  number: { fontFamily: F.serif, fontSize: 26, color: C.ink },
  input: {
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.white,
    color: C.ink,
    fontFamily: F.body,
    borderRadius: 5,
    padding: 11,
    minHeight: 44,
  },
  mono: { fontFamily: F.medium, fontSize: 12, color: C.muted },
});
function Chip({ label, on, hit }: { label: string; on?: boolean; hit: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => [
        css.chip,
        label.length > 29 && {
          minHeight: 44,
          borderRadius: 8,
          alignSelf: 'stretch',
          paddingVertical: 8,
        },
        on && css.chipOn,
        pressed && { opacity: 0.72 },
      ]}
      onPress={hit}
    >
      <Text style={[css.chipText, on && css.chipActive]}>{label}</Text>
    </Pressable>
  );
}
function Why({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={({ pressed }) => ({
          minHeight: 44,
          justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={[css.subdued, { color: C.forest, fontFamily: F.bold }]}>
          {open ? 'Hide explanation' : 'Why?'}
        </Text>
      </Pressable>
      {open && children}
    </View>
  );
}
function Line({ name, value }: { name: string; value: string }) {
  return (
    <View style={css.tile}>
      <Text style={css.eyebrow}>{name}</Text>
      <Text selectable style={[css.body, { fontVariant: ['tabular-nums'] }]}>
        {value}
      </Text>
    </View>
  );
}
const formKey: Record<keyof Terms, string> = {
  buyRate: 'Buy rate (%)',
  resaleRatio: 'Resale ratio (%)',
  handlingMinor: 'Handling (local currency)',
  creditPremium: 'Credit premium (%)',
};
export function FieldDesk({ back }: { back?: () => void }) {
  return (
    <PhoneStage>
      <StatusBar style="dark" />
      <FieldDeskContent back={back} />
    </PhoneStage>
  );
}
function FieldDeskContent({ back }: { back?: () => void }) {
  const [list, setList] = React.useState<Brief[]>([]),
    [id, setId] = React.useState(''),
    [record, setRecord] = React.useState<DeskRecord | null>(null);
  const [view, setView] = React.useState<'Rider' | 'Specialist' | 'Shop'>('Rider'),
    [scenario, setScenario] = React.useState<Scenario>('actual'),
    [market, setMarket] = React.useState<Market>('CA');
  const [shop, setShop] = React.useState<Shop | null>(null),
    [staff, setStaff] = React.useState(''),
    [error, setError] = React.useState(''),
    [notice, setNotice] = React.useState(''),
    [busy, setBusy] = React.useState(false);
  const [selected, setSelected] = React.useState(''),
    [crop, setCrop] = React.useState<number[] | undefined>(),
    [note, setNote] = React.useState(''),
    [size, setSize] = React.useState(''),
    [purchase, setPurchase] = React.useState('');
  const [stockAuthority, setStockAuthority] = React.useState(false),
    [wearZone, setWearZone] = React.useState(''),
    [wantedSize, setWantedSize] = React.useState(''),
    [serviceProof, setServiceProof] = React.useState(false);
  const [exclusionKind, setExclusionKind] = React.useState<
    'protective_failure' | 'protective_repair' | null
  >(null);
  const [tagProof, setTagProof] = React.useState<{ hash: string; maker: string } | null>(null);
  const [vision, setVision] = React.useState(false),
    [showHistory, setShowHistory] = React.useState(false);
  const [expandedLabels, setExpandedLabels] = React.useState(false),
    [expandedRaw, setExpandedRaw] = React.useState(false);
  const [listLoaded, setListLoaded] = React.useState(false);
  const [showFollow, setShowFollow] = React.useState(false);
  const [followOn, setFollowOn] = React.useState(false);
  const [listError, setListError] = React.useState('');
  const [capture, setCapture] = React.useState(false),
    [reload, setReload] = React.useState(0);
  const [draft, setDraft] = React.useState<Record<keyof Terms, string>>({
    buyRate: '',
    resaleRatio: '',
    handlingMinor: '',
    creditPremium: '',
  });
  React.useEffect(() => {
    let live = true;
    setListError('');
    desk<{ items: Brief[] }>('/v4/items?presentation=1')
      .then((x) => {
        if (live) {
          setList(x.items);
          setListLoaded(true);
        }
      })
      .catch((e) => {
        if (live) setListError(e.message);
      });
    return () => {
      live = false;
    };
  }, [reload]);
  React.useEffect(() => {
    if (!id) return;
    let live = true;
    setRecord(null);
    setShop(null);
    setError('');
    setCrop(undefined);
    setNote('');
    desk<DeskRecord>('/v4/items/' + id + '?scenario=' + scenario)
      .then((d) => {
        if (!live) return;
        setRecord(d);
        setSelected(
          d.value.images.find((p) => p.role === 'outer_front')?.id ?? d.value.images[0]?.id ?? '',
        );
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [id, scenario, reload]);
  React.useEffect(() => {
    if (!id || view !== 'Shop') return;
    let live = true;
    setShop(null);
    desk<Shop>('/v4/shop/' + id + '?market=' + market + '&scenario=' + scenario)
      .then((d) => {
        if (!live) return;
        setShop(d);
        const f = {} as Record<keyof Terms, string>;
        for (const k of Object.keys(formKey) as (keyof Terms)[]) {
          const n = d.terms.terms[k];
          f[k] =
            n === null ? '' : String(k === 'handlingMinor' ? n / 100 : Math.round(n * 10000) / 100);
        }
        setDraft(f);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [id, view, market, scenario, reload]);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This action did not finish.');
    } finally {
      setBusy(false);
    }
  };
  const session = async () => {
    if (staff) return staff;
    const r = await desk<{ token: string }>('/v4/staff/session', {
      purpose: 'demo',
      name: 'Field desk',
    });
    setStaff(r.token);
    return r.token;
  };
  const d = record?.value,
    im = d?.images.find((p) => p.id === selected),
    ref = React.useRef<ScrollView>(null);
  const orderedLabels = [...(d?.guidance.lines ?? [])].sort(
    (a, b) =>
      ['garment_class', 'standard', 'production_date', 'composition'].indexOf(a.kind) -
      ['garment_class', 'standard', 'production_date', 'composition'].indexOf(b.kind),
  );
  const selectItem = (x: string, rehearsal = false) => {
    setId(x);
    setSourceModal(false);
    setShowFollow(false);
    setFollowOn(false);
    setScenario(rehearsal ? 'custody_clear' : 'actual');
    setView('Rider');
    setShowHistory(false);
    setTagProof(null);
    setStockAuthority(false);
    setServiceProof(false);
    setSize('');
    setPurchase('');
    setWearZone('');
    setWantedSize('');
    setExpandedLabels(false);
    setExpandedRaw(false);
    setExclusionKind(null);
    setNotice('');
    setError('');
    ref.current?.scrollTo({ y: 0, animated: false });
  };
  const [sourceModal, setSourceModal] = React.useState(false);
  const returnAnchor = React.useRef<any>(null);
  const choosePhoto = (pid: string, region?: number[], zone?: string, trigger?: any) => {
    returnAnchor.current = trigger ?? (Platform.OS === 'web' ? document.activeElement : null);
    setSourceModal(true);
    setSelected(pid);
    setCrop(region);
    setWearZone(zone ?? '');
  };
  if (vision) return <VisionPage back={() => setVision(false)} />;
  if (capture)
    return (
      <NativeIntake
        close={() => setCapture(false)}
        opened={(next) => {
          setCapture(false);
          setReload((x) => x + 1);
          selectItem(next);
        }}
      />
    );
  if (!id)
    return (
      <SafeAreaView style={css.page}>
        <Notebook
          items={list}
          loaded={listLoaded}
          error={listError}
          retry={() => setReload((x) => x + 1)}
          open={selectItem}
          inspect={() => setCapture(true)}
          vision={() => setVision(true)}
          back={back}
        />
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={css.page}>
      <ScrollView ref={ref} contentContainerStyle={css.wrap} keyboardShouldPersistTaps="handled">
        <View style={css.bar}>
          <View style={css.brand}>
            <RelayMark size={26} />
            <Text style={css.word}>relay</Text>
          </View>
          {id ? (
            <Chip
              label="All items"
              hit={() => {
                setId('');
                setNotice('');
                setError('');
              }}
            />
          ) : back ? (
            <Chip label="Back to notebook" hit={back} />
          ) : null}
        </View>
        {error ? (
          <View accessibilityLiveRegion="polite" style={[css.panel, css.danger]}>
            <Text style={css.body}>{error}</Text>
            <Chip label="Try again" hit={() => setReload((x) => x + 1)} />
          </View>
        ) : null}
        {notice ? (
          <Text accessibilityLiveRegion="polite" style={css.panel}>
            {notice}
          </Text>
        ) : null}
        {!d ? (
          <ActivityIndicator style={css.pad} />
        ) : (
          <>
            <View style={css.pad}>
              <Text style={css.eyebrow}>
                {d.id.startsWith('RL') ? d.id : 'Rider intake'} ·{' '}
                {d.category === 'pants'
                  ? 'Trousers'
                  : d.category === 'unknown'
                    ? 'Garment'
                    : d.category}
                {scenario === 'custody_clear' ? ' · Rehearsal' : ''}
              </Text>
              <Text style={css.title}>
                {d.identity.unresolved
                  ? 'Garment under review'
                  : (list.find(
                      (x) => x.id === d.id && !!x.rehearsal === (scenario === 'custody_clear'),
                    )?.product ??
                    (d.names.length
                      ? d.names.join(' / ') +
                        ' ' +
                        (d.category === 'pants'
                          ? 'riding trousers'
                          : d.category === 'unknown'
                            ? 'garment'
                            : d.category)
                      : 'Garment inspection'))}
              </Text>
              <View style={css.flow}>
                {(['Rider', 'Specialist', 'Shop'] as const).map((t) => (
                  <Chip
                    key={t}
                    label={t}
                    on={view === t}
                    hit={() => {
                      setView(t);
                      setNotice('');
                      setError('');
                    }}
                  />
                ))}
              </View>
            </View>
            {view === 'Specialist' && <SpecialistIntro record={d} source={choosePhoto} />}
            {view === 'Shop' &&
              (shop ? (
                <View style={css.pad}>
                  <View style={css.shopHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={css.eyebrow}>Moto Reloaded</Text>
                      <Text style={css.roleTitle}>Shop decision</Text>
                    </View>
                    <StatusPill action={d.result.action} />
                  </View>
                  <View style={css.metricCard}>
                    <Text style={css.roleTitle}>Market</Text>
                    <ReceiptBanner value={shop.inspection} />
                    <View style={css.flow}>
                      {(['CA', 'US', 'DE', 'PH', 'GB'] as Market[]).map((c) => (
                        <Chip key={c} label={c} on={market === c} hit={() => setMarket(c)} />
                      ))}
                    </View>
                    <Text style={css.subdued}>
                      {shop.market.jurisdiction} · {shop.market.currency}
                    </Text>
                    <Text style={css.body}>{shop.market.wording}</Text>
                    <Pressable
                      accessibilityRole="link"
                      onPress={() => void Linking.openURL(shop.market.source)}
                    >
                      <Text style={css.subdued}>Official market guidance</Text>
                    </Pressable>
                    {shop.freshness?.component &&
                      shop.freshness.component.status !== 'verified' && (
                        <Text style={css.subdued}>
                          The maker’s interval is awaiting verification.
                        </Text>
                      )}
                    {shop.freshness?.tariff && shop.freshness.tariff.status !== 'verified' && (
                      <Text style={css.subdued}>
                        The Canadian leather-apparel tariff is awaiting verification.
                      </Text>
                    )}
                  </View>
                  {d.appearance && (
                    <View style={css.metricCard}>
                      <Line
                        name="Visible appearance grade"
                        value={d.appearance.grade ?? 'Awaiting two exterior readings'}
                      />
                      <Why>
                        <Text style={css.subdued}>
                          {d.appearance.basis} {d.appearance.pricingUse}
                        </Text>
                      </Why>
                    </View>
                  )}
                  <View style={css.metricCard}>
                    <Text style={css.roleTitle}>Cost floor and contribution</Text>
                    <Line
                      name="Known cost floor"
                      value={money(shop.margin.knownCostFloorMinor, shop.market.currency)}
                    />
                    <Line
                      name="Break-even sale price"
                      value={money(shop.margin.breakEvenMinor, shop.market.currency)}
                    />
                    <Line
                      name="Known transport floor · sample packed parcel"
                      value={money(shop.route.minor, shop.route.currency)}
                    />
                    <Why>
                      <Text style={css.subdued}>{shop.route.basis}</Text>
                    </Why>
                    <Line
                      name="Expected contribution"
                      value={money(shop.margin.expectedContributionMinor, shop.market.currency)}
                    />
                    <Text style={css.subdued}>
                      Needed: {shop.margin.missing.join(', ') || 'no outstanding inputs'}.
                    </Text>
                  </View>
                  {shop.comparable.length > 0 && (
                    <Text style={css.heading}>Comparable retail items</Text>
                  )}
                  {shop.comparable.map((c) => (
                    <Pressable
                      accessibilityRole="link"
                      key={c.source}
                      style={css.metricCard}
                      onPress={() => void Linking.openURL(c.source)}
                    >
                      <Text style={css.eyebrow}>New-retail reference</Text>
                      <Text style={css.body}>
                        {c.model} · {money(c.minor, c.currency)}
                      </Text>
                      <Text style={css.subdued}>
                        {c.availability} · {c.basis}
                      </Text>
                      <Text style={css.subdued}>{c.attribution}</Text>
                    </Pressable>
                  ))}
                  <View style={css.metricCard}>
                    <Text style={css.roleTitle}>Shop terms</Text>
                    <View style={css.formGrid}>
                      {(Object.keys(formKey) as (keyof Terms)[]).map((k) => (
                        <View key={k} style={css.formCell}>
                          <Text style={css.subdued}>{formKey[k]}</Text>
                          <TextInput
                            accessibilityLabel={formKey[k]}
                            keyboardType="decimal-pad"
                            placeholder="Not set"
                            style={css.input}
                            value={draft[k]}
                            onChangeText={(v) => setDraft((o) => ({ ...o, [k]: v }))}
                          />
                        </View>
                      ))}
                    </View>
                    <Button
                      disabled={busy}
                      label="Save shop terms"
                      onPress={() =>
                        void run(async () => {
                          const t = {} as Terms;
                          for (const k of Object.keys(formKey) as (keyof Terms)[]) {
                            if (!draft[k].trim()) {
                              t[k] = null;
                              continue;
                            }
                            const v = Number(draft[k]);
                            if (!Number.isFinite(v) || v < 0)
                              throw Error('Enter a nonnegative amount.');
                            t[k] = k === 'handlingMinor' ? Math.round(v * 100) : v / 100;
                          }
                          const proof = shop.inspection;
                          await desk('/v4/shop/terms/' + market, t, await session());
                          const fresh = await desk<Shop>(
                            '/v4/shop/' + d.id + '?market=' + market + '&scenario=' + scenario,
                          );
                          setShop(fresh);
                          setNotice(
                            fresh.inspection === proof
                              ? 'Terms recorded. Inspection receipt unchanged: ' +
                                  proof.slice(0, 12)
                              : 'The inspection changed independently; review its new receipt.',
                          );
                        })
                      }
                    />
                  </View>
                  {shop.service &&
                    shop.componentResolvingSet?.includes('verified_purchase_date') && (
                      <View style={css.metricCard}>
                        <Text style={css.roleTitle}>Protector service</Text>
                        <Text style={css.body}>{shop.service}</Text>
                        <TextInput
                          style={css.input}
                          accessibilityLabel="Verified protector purchase date"
                          placeholder="Purchase date · YYYY-MM-DD"
                          value={purchase}
                          onChangeText={setPurchase}
                        />
                        <Chip
                          label="I verified this Knox protector and its purchase record"
                          on={serviceProof}
                          hit={() => setServiceProof(!serviceProof)}
                        />
                        <Button
                          kind="secondary"
                          disabled={!serviceProof || !purchase.trim()}
                          label="Check verified Knox component"
                          onPress={() =>
                            void run(async () => {
                              const mark = d.fields.find(
                                (f) =>
                                  f.field === 'component_brand' &&
                                  f.value === 'KNOX' &&
                                  ['custodial', 'same_frame'].includes(f.attachment),
                              );
                              const photo = d.images.find((p) => p.id === mark?.photo);
                              if (!photo) throw Error('Find the attached Knox marking first.');
                              const s = await desk<{ status: string; dueDate?: string }>(
                                '/v4/shop/' + d.id + '/component-service',
                                {
                                  scenario,
                                  photo: photo.hash,
                                  componentVerified: true,
                                  purchaseDate: purchase,
                                },
                                await session(),
                              );
                              setReload((n) => n + 1);
                              setNotice(
                                s.status === 'replacement_due'
                                  ? 'Replacement suggested for this protector. Knox’s five-year interval ended ' +
                                      s.dueDate +
                                      '. ' +
                                      d.guidance.disclosure
                                  : words(s.status) + (s.dueDate ? ' · ' + s.dueDate : ''),
                              );
                            })
                          }
                        />
                      </View>
                    )}
                  <QuoteScenario
                    id={d.id}
                    scenario={scenario}
                    market={market}
                    shop={shop}
                    session={session}
                  />
                  {shop.lifecycle?.map((e) => (
                    <Line key={e.receipt} name={e.kind} value={e.due + ' · protector only'} />
                  ))}
                  <View style={css.metricCard}>
                    <Line
                      name="Ten jackets from the Philippines"
                      value={
                        money(shop.philippines.exact.totalMinor, 'PHP') + ' at 5 kg packed each'
                      }
                    />
                    <Text style={css.body}>
                      {money(shop.philippines.withPackaging.totalMinor, 'PHP')} if packaging takes
                      each to the next half-kilo. {shop.philippines.action}
                    </Text>
                  </View>
                  <View style={css.metricCard}>
                    <Text style={css.roleTitle}>Stock acceptance</Text>
                    <Text style={css.subdued}>
                      {shop.eligible
                        ? 'Current inspection allows staff to consider intake.'
                        : 'Intake is withheld on this inspection.'}
                    </Text>
                    <TextInput
                      accessibilityLabel="Verified stock size"
                      style={css.input}
                      placeholder="Verified size"
                      value={size}
                      onChangeText={setSize}
                    />
                    <Chip
                      label="The shop owns this item or has permission to consign it"
                      on={stockAuthority}
                      hit={() => setStockAuthority(!stockAuthority)}
                    />
                    <Button
                      kind="secondary"
                      label="Accept authorized stock · demo"
                      disabled={busy || !shop.eligible || !size.trim() || !stockAuthority}
                      onPress={() =>
                        void run(async () => {
                          const p = await desk<{ sha256: string }>(
                            '/v4/shop/' + d.id + '/stock',
                            {
                              scenario,
                              inspection: shop.inspection,
                              consignmentOrOwnership: stockAuthority,
                              size: size.trim(),
                            },
                            await session(),
                          );
                          setNotice('Demo staff acceptance signed: ' + p.sha256.slice(0, 12));
                        })
                      }
                    />
                  </View>
                  <View style={css.metricCard}>
                    <Text style={css.roleTitle}>Replacement matches</Text>
                    <Text style={css.subdued}>
                      Uses the garment’s verified size. Enter a different size if the rider requests
                      it.
                    </Text>
                    <TextInput
                      accessibilityLabel="Requested replacement size"
                      style={css.input}
                      placeholder="Use verified label size"
                      value={wantedSize}
                      onChangeText={setWantedSize}
                    />
                    <Button
                      kind="secondary"
                      label="Find accepted stock"
                      disabled={busy}
                      onPress={() =>
                        void run(async () => {
                          const fresh = await desk<Shop>(
                            '/v4/shop/' +
                              d.id +
                              '?market=' +
                              market +
                              '&scenario=' +
                              scenario +
                              (wantedSize.trim()
                                ? '&size=' + encodeURIComponent(wantedSize.trim())
                                : ''),
                          );
                          setShop(fresh);
                          setNotice(
                            fresh.matches.length === 1
                              ? 'One signed stock match.'
                              : String(fresh.matches.length) + ' signed stock matches.',
                          );
                        })
                      }
                    />
                    <Line
                      name="Available size matches"
                      value={
                        shop.matches.map((v) => v.item + ' · ' + v.size).join(', ') ||
                        'No accepted matching stock.'
                      }
                    />
                  </View>
                </View>
              ) : (
                <ActivityIndicator style={css.pad} />
              ))}
            {view === 'Rider' ? (
              <RiderSummary
                openPhoto={choosePhoto}
                record={d}
                scenario={scenario}
                inspection={record!.sha256}
                showFollow={showFollow}
                followOn={followOn}
                onDone={() => {
                  setFollowOn(false);
                  setShowFollow(true);
                }}
                action={() => {
                  if (d.result.action === 'keep' || d.result.action === 'replace') {
                    setView('Shop');
                    return;
                  }
                  if (d.result.action === 'retire') {
                    setId('');
                    return;
                  }
                  if (d.result.action === 'specialist') {
                    setView('Specialist');
                    return;
                  }
                  if (requestedAction(d) === 'history') {
                    setShowHistory(true);
                    return;
                  }
                  setShowFollow(true);
                  setFollowOn(true);
                }}
              />
            ) : (
              <View style={[css.panel, d.result.action === 'retire' && css.danger]}>
                <Text style={css.eyebrow}>Offer decision</Text>
                <Text style={css.number}>{d.result.title}</Text>
                <Text style={css.body}>{d.result.reasons[0]}</Text>
                {d.result.next && d.result.next !== d.result.reasons[0] && (
                  <Text style={css.subdued}>{d.result.next}</Text>
                )}
                {d.result.reasons
                  .filter((r) => r.startsWith('An uncalibrated'))
                  .map((r) => (
                    <Text key={r} style={css.subdued}>
                      {r}
                    </Text>
                  ))}
              </View>
            )}
            <View style={css.flow}>
              <Chip
                label={
                  scenario === 'actual'
                    ? 'History · as submitted'
                    : scenario === 'clear'
                      ? 'History · declared clear'
                      : scenario === 'crash'
                        ? 'History · declared crash'
                        : 'History · signed rehearsal'
                }
                on={showHistory}
                hit={() => setShowHistory(!showHistory)}
              />
            </View>
            {showHistory && (
              <View style={css.flow}>
                {(
                  [
                    ['actual', 'As submitted'],
                    ['clear', 'Declared clear · demo'],
                    ['custody_clear', 'Staff-signed + clear · rehearsal'],
                    ['crash', 'Declared crash · demo'],
                  ] as const
                ).map(([k, l]) => (
                  <Chip
                    key={k}
                    label={l}
                    on={k === scenario}
                    hit={() => {
                      setScenario(k);
                      setShowHistory(false);
                      setNotice('');
                    }}
                  />
                ))}
              </View>
            )}
            {view === 'Specialist' && (
              <CustodyPanel
                openPhoto={choosePhoto}
                key={d.id}
                record={d}
                session={session}
                signed={() => {
                  setScenario('custody_clear');
                  setReload((n) => n + 1);
                  setNotice(
                    'Signed intake rehearsal recorded. The as-submitted record is available separately.',
                  );
                }}
              />
            )}
            {scenario === 'custody_clear' && view !== 'Rider' && (
              <View style={css.panel}>
                <Text style={css.eyebrow}>Rehearsal</Text>
                <Text style={css.body}>
                  Staff-signed intake session + rider declares no crash, damage or repair.
                </Text>
                <Text style={css.subdued}>
                  {d.custodyAttested
                    ? 'The staff signature is on record.'
                    : 'The rider history is simulated. A staff signature is still needed to bind this photo session.'}
                </Text>
              </View>
            )}
            <RoleFold title="Label disclosure and source lines" plain={view === 'Rider'}>
              <View style={css.panel}>
                <Text style={css.eyebrow}>Protection disclosure</Text>
                {!expandedLabels && d.guidance.compact?.headline && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      const p = d.guidance.compact?.source;
                      if (p) {
                        if (view === 'Shop') setView('Rider');
                        choosePhoto(p);
                      }
                    }}
                  >
                    <Text style={css.body}>{d.guidance.compact.headline}</Text>
                  </Pressable>
                )}
                {!expandedLabels && d.guidance.compact?.composition && (
                  <Text style={css.body}>{d.guidance.compact.composition}</Text>
                )}
                {(expandedLabels
                  ? orderedLabels
                  : d.guidance.compact
                    ? []
                    : orderedLabels.slice(0, 3)
                ).map((line) => (
                  <Pressable
                    key={line.text}
                    accessibilityRole="button"
                    onPress={() => {
                      if (view === 'Shop') setView('Rider');
                      choosePhoto(line.photo);
                    }}
                  >
                    <Text style={css.body}>{line.text}</Text>
                  </Pressable>
                ))}
                {orderedLabels.length > 0 && (
                  <Chip
                    label={expandedLabels ? 'Show compact disclosure' : 'Show every label line'}
                    on={expandedLabels}
                    hit={() => setExpandedLabels(!expandedLabels)}
                  />
                )}
                {d.guidance.flags.map((f) => (
                  <Text key={f} style={css.subdued}>
                    {f}
                  </Text>
                ))}
                {d.guidance.suggestions.map((g, i) => (
                  <View key={i} style={css.tile}>
                    <Text style={css.number}>
                      {g.primary
                        ? 'Verified wear'
                        : g.scope === 'component'
                          ? 'Maker service guidance'
                          : 'Newer marking available'}
                    </Text>
                    <Text style={css.body}>{g.reason}</Text>
                    <Text style={css.subdued}>{d.guidance.disclosure}</Text>
                    {g.authority && (
                      <Pressable
                        accessibilityRole="link"
                        onPress={() => void Linking.openURL(g.authority!)}
                      >
                        <Text style={css.subdued}>Read the source</Text>
                      </Pressable>
                    )}
                  </View>
                ))}
                {!d.guidance.suggestions.length && (
                  <Text style={[css.subdued, { marginTop: 5 }]}>{d.guidance.disclosure}</Text>
                )}
              </View>
            </RoleFold>
            {view !== 'Shop' && (
              <ZoneEvidence
                item={d}
                open={choosePhoto}
                selectSource={(pid, box, zone) => {
                  setSelected(pid);
                  setCrop(box);
                  setWearZone(zone);
                }}
                add={() => {
                  setView('Rider');
                  setFollowOn(true);
                  setShowFollow(true);
                  ref.current?.scrollTo({ y: 0, animated: true });
                }}
              />
            )}
            {view !== 'Shop' && (
              <>
                {im ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Enlarge source photograph"
                      onPress={(e) =>
                        choosePhoto(im.id, crop, wearZone || undefined, e.currentTarget)
                      }
                      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
                    >
                      <Image
                        accessibilityLabel={words(im.role) + ' evidence'}
                        source={{ uri: photoUrl(d.id, im.hash, crop) }}
                        style={css.hero}
                        resizeMode="contain"
                      />
                    </Pressable>
                    <View style={[css.row, { justifyContent: 'space-between' }]}>
                      <Text style={css.subdued}>
                        {im.cardCandidate
                          ? 'Item ID card'
                          : view === 'Rider'
                            ? layerText(im.role)
                            : words(im.role)}{' '}
                        · {crop ? 'selected region' : 'full photograph'}
                      </Text>
                      {crop && <Chip label="Full photo" hit={() => setCrop(undefined)} />}
                    </View>
                  </>
                ) : null}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8, paddingVertical: 9 }}
                >
                  {d.images.map((p) => (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={'Show ' + words(p.role) + ' ' + p.id}
                      key={p.id}
                      onPress={() => choosePhoto(p.id)}
                      style={{
                        borderWidth: 2,
                        borderColor: p.id === selected ? C.forest : C.paper,
                      }}
                    >
                      <Image source={{ uri: photoUrl(d.id, p.hash) }} style={css.thumb} />
                    </Pressable>
                  ))}
                </ScrollView>
                {d.identity.conflicted && (
                  <View style={[css.panel, css.danger]}>
                    <Text style={css.eyebrow}>Tag attachment</Text>
                    <Text style={css.body}>
                      {d.identity.makers.join(' and ')} appear in the same submission.{' '}
                      {d.identity.unresolved
                        ? 'Both identities are withheld.'
                        : 'An attached frame resolved the conflict.'}
                    </Text>
                    <View style={css.flow}>
                      {d.identity.photos.map((p, i) => (
                        <Chip key={p} label={'Inspect tag ' + (i + 1)} hit={() => choosePhoto(p)} />
                      ))}
                    </View>
                  </View>
                )}
                {view === 'Specialist' && (
                  <RoleFold title="Original condition readings">
                    {d.visible.length ? (
                      d.visible.map((f, i) => (
                        <Button
                          key={i}
                          kind="secondary"
                          icon="image"
                          label={findingText(f.state) + ' · ' + layerText(f.layer)}
                          onPress={() => choosePhoto(f.photo, f.box)}
                        />
                      ))
                    ) : (
                      <Text style={css.subdued}>No separate adverse reading was recorded.</Text>
                    )}
                  </RoleFold>
                )}
                {view === 'Specialist' && (
                  <>
                    <Chip
                      label={
                        expandedRaw
                          ? 'Hide source transcriptions'
                          : 'Show raw source transcriptions'
                      }
                      on={expandedRaw}
                      hit={() => setExpandedRaw(!expandedRaw)}
                    />
                    {expandedRaw && (
                      <>
                        <Text style={css.heading}>Source transcriptions</Text>
                        <Text style={css.subdued}>
                          A reading marked unresolved or conflicting describes the photograph. Its
                          attachment to this item still needs confirmation.
                        </Text>
                        {d.fields
                          .filter((f) =>
                            [
                              'garment_class',
                              'standard',
                              'production_date',
                              'composition',
                              'size',
                              'origin',
                            ].includes(f.field),
                          )
                          .filter(
                            (f, i, a) =>
                              a.findIndex(
                                (g) =>
                                  f.field === g.field &&
                                  f.value === g.value &&
                                  f.component === g.component,
                              ) === i,
                          )
                          .map((f, i) => (
                            <Pressable
                              key={i}
                              accessibilityRole="button"
                              onPress={() => choosePhoto(f.photo)}
                              style={css.tile}
                            >
                              <Text style={css.eyebrow}>
                                {words(f.field)} ·{' '}
                                {f.requiresConfirmation ? 'confirm reading · ' : ''}
                                {f.attachment === 'unresolved'
                                  ? 'Tag not yet tied to this garment'
                                  : f.attachment === 'conflict'
                                    ? 'Disputed garment attachment'
                                    : f.attachment === 'custodial'
                                      ? 'Staff-signed item session'
                                      : words(f.attachment)}
                              </Text>
                              <Text style={css.body}>
                                {f.value}
                                {f.field === 'composition' ? ' · ' + words(f.component) : ''}
                              </Text>
                            </Pressable>
                          ))}
                        {d.scopedNotes.map((n) => (
                          <Text key={n} style={css.subdued}>
                            {n}
                          </Text>
                        ))}
                      </>
                    )}
                  </>
                )}
                {view === 'Specialist' && (
                  <Text style={[css.subdued, { marginTop: 12 }]}>{d.result.limitation}</Text>
                )}
              </>
            )}
            {view === 'Specialist' && (
              <View style={css.pad}>
                <Text style={css.heading}>Staff actions</Text>
                <SubmittedPhotos record={d} scenario={scenario} />
                {d.sidePatterns?.map((p, i) => (
                  <View key={i} style={css.panel}>
                    <Text style={css.eyebrow}>
                      {p.requiresSpecialist
                        ? 'Same-side condition review'
                        : 'Same-side observations'}
                    </Text>
                    <Text style={css.body}>{p.text}</Text>
                  </View>
                ))}
                {d.areaChecks?.some((r) => r.decisionUse === 'screening_cue') && (
                  <RoleFold title="Additional screening cues">
                    <Text style={css.subdued}>
                      Open a cue to inspect the source. These region readings are uncalibrated.
                    </Text>
                    {d.areaChecks
                      .filter((r) => r.decisionUse === 'screening_cue')
                      .map((r, i) => (
                        <Chip
                          key={i}
                          label={words(r.zone) + ' · ' + words(r.state)}
                          hit={() => choosePhoto(r.photo, r.box)}
                        />
                      ))}
                  </RoleFold>
                )}
                <RoleFold title="Inspection basis">
                  <Line
                    name="Original offer check"
                    value={d.baseline.outcome + ' · ' + d.baseline.why}
                  />
                  <Line
                    name="Information that could settle this"
                    value={
                      d.result.resolvingSets.map((v) => v.map(words).join(' + ')).join(' or ') ||
                      'No open conditions.'
                    }
                  />
                </RoleFold>
                {d.identity.conflicted && (
                  <View style={css.panel}>
                    <Text style={css.eyebrow}>Reconcile the tag</Text>
                    <Text style={css.subdued}>
                      Select the attached maker label, then a wider view showing the same fabric or
                      hardware. Record the landmarks both photos share.
                    </Text>
                    <Button
                      kind="secondary"
                      label="Use selected maker tag"
                      disabled={
                        !im || !d.fields.some((f) => f.photo === im.id && f.field === 'brand')
                      }
                      onPress={() => {
                        const f = d.fields.find((f) => f.photo === im!.id && f.field === 'brand');
                        if (f) setTagProof({ hash: im!.hash, maker: f.value });
                      }}
                    />
                    {tagProof && (
                      <>
                        <Text style={css.subdued}>Selected label · {tagProof.maker}</Text>
                        <Button
                          label="Confirm selected context · demo"
                          disabled={
                            busy || !im || im.hash === tagProof.hash || note.trim().length < 8
                          }
                          onPress={() =>
                            void run(async () => {
                              await desk(
                                '/v4/staff/' + d.id + '/identity',
                                {
                                  maker: tagProof.maker,
                                  tag: tagProof.hash,
                                  overview: im!.hash,
                                  matchingLandmarks: note.trim(),
                                },
                                await session(),
                              );
                              setTagProof(null);
                              setReload((n) => n + 1);
                              setNotice(
                                'The signed reconciliation applies to this identity branch.',
                              );
                            })
                          }
                        />
                      </>
                    )}
                  </View>
                )}
                <RoleFold title="Record a sourced observation">
                  <TextInput
                    accessibilityLabel="Specialist observation"
                    style={css.input}
                    value={note}
                    onChangeText={setNote}
                    multiline
                    placeholder="What did you verify in the selected photo?"
                  />
                  <Button
                    disabled={busy || !im || note.trim().length < 5}
                    label="Save sourced observation"
                    onPress={() =>
                      void run(async () => {
                        await desk(
                          '/v4/staff/' + d.id + '/review',
                          { scenario, kind: 'observation', source: im!.hash, note: note.trim() },
                          await session(),
                        );
                        setReload((n) => n + 1);
                        setNotice('Observation recorded with a signed source reference.');
                      })
                    }
                  />

                  <Text style={css.subdued}>
                    If you verified an offer exclusion, select the affected photo and record what
                    connects it to the protective area.
                  </Text>
                  <View style={css.flow}>
                    {(
                      [
                        ['protective_failure', 'Area damage'],
                        ['protective_repair', 'Area repair'],
                      ] as const
                    ).map(([k, l]) => (
                      <Chip
                        key={k}
                        label={l}
                        on={exclusionKind === k}
                        hit={() => setExclusionKind(k === exclusionKind ? null : k)}
                      />
                    ))}
                  </View>
                  {exclusionKind && (
                    <Button
                      kind="secondary"
                      label="Confirm sourced exclusion · demo"
                      disabled={!im || busy || note.trim().length < 8}
                      onPress={() =>
                        void run(async () => {
                          await desk(
                            '/v4/staff/' + d.id + '/review',
                            { scenario, kind: exclusionKind, source: im!.hash, note: note.trim() },
                            await session(),
                          );
                          setExclusionKind(null);
                          setReload((n) => n + 1);
                          setNotice('The exclusion and its photographic source are recorded.');
                        })
                      }
                    />
                  )}
                  {wearZone && (
                    <Button
                      kind="secondary"
                      label="Record pronounced visible wear · demo"
                      disabled={busy || note.trim().length < 8 || !im}
                      onPress={() =>
                        void run(async () => {
                          await desk(
                            '/v4/staff/' + d.id + '/wear',
                            { scenario, source: im!.hash, zone: wearZone, note: note.trim() },
                            await session(),
                          );
                          setReload((n) => n + 1);
                          setNotice('Visible wear and its source were recorded.');
                        })
                      }
                    />
                  )}
                </RoleFold>
                {d.specialistNote && (
                  <Line name="Latest recorded observation" value={d.specialistNote} />
                )}
              </View>
            )}
            <View style={css.pad}>
              <Chip label="Complete vision" hit={() => setVision(true)} />
              <Text style={css.mono} selectable>
                Inspection receipt · {record!.sha256.slice(0, 18)}
              </Text>
            </View>
          </>
        )}
      </ScrollView>
      {sourceModal && d && im && (
        <EvidenceViewer
          item={d}
          photo={im.id}
          box={crop}
          zone={wearZone || undefined}
          close={() => {
            setSourceModal(false);
            const target = returnAnchor.current;
            setTimeout(() => {
              if (Platform.OS === 'web') target?.focus?.({ preventScroll: true });
              else if (target) {
                try {
                  const handle = findNodeHandle(target);
                  if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
                } catch {}
              }
            }, 80);
          }}
        />
      )}
    </SafeAreaView>
  );
}
