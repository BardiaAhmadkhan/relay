import * as React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, C, F } from '../design';
import { desk, photoUrl, type DeskRecord, type Photo } from './api';
const s = StyleSheet.create({
  wrap: {
    marginVertical: 16,
    gap: 12,
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.white,
  },
  title: { fontFamily: F.serif, fontSize: 22, lineHeight: 26, color: C.ink },
  body: { fontFamily: F.body, fontSize: 15, lineHeight: 22, color: C.ink },
  muted: { fontFamily: F.body, fontSize: 13, color: C.muted },
  input: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    minHeight: 44,
    padding: 10,
    backgroundColor: C.white,
  },
  thumb: { width: 72, height: 72, borderRadius: 12, backgroundColor: C.wash },
  choice: { marginRight: 7, borderWidth: 2, borderColor: 'transparent', padding: 2 },
  chosen: { borderColor: C.forest },
  card: { width: '100%', height: 115, backgroundColor: C.wash },
});
export function CustodyPanel({
  record,
  openPhoto,
  session,
  signed,
}: {
  record: DeskRecord['value'];
  openPhoto: (photo: string, box?: number[], zone?: string, anchor?: any) => void;
  session: () => Promise<string>;
  signed: () => void;
}) {
  const [open, setOpen] = React.useState(false),
    [text, setText] = React.useState(''),
    [front, setFront] = React.useState(''),
    [issue, setIssue] = React.useState(''),
    [busy, setBusy] = React.useState(false);
  const cards = record.images.filter((p) => p.cardCandidate || p.role === 'id_card');
  const [card, setCard] = React.useState(cards.length === 1 ? cards[0]!.hash : '');
  const inside = record.images.filter((i) =>
    ['inner_overview', 'inner_zone', 'pocket'].includes(i.role),
  );
  const position = (p: Photo) => record.images.findIndex((i) => i.id === p.id) + 1;
  async function submit() {
    if (busy) return;
    setBusy(true);
    setIssue('');
    try {
      await desk(
        '/v4/staff/' + record.id + '/custody',
        {
          card,
          cardText: text.trim(),
          acknowledge: true,
          ...(front ? { insideFront: front, frontAttested: true } : {}),
        },
        await session(),
      );
      signed();
    } catch (e) {
      setIssue(e instanceof Error ? e.message : 'The item signature was not saved.');
    } finally {
      setBusy(false);
    }
  }
  function strip(rows: Photo[], pick: (hash: string) => void, chosen: string, prefix: string) {
    return (
      <ScrollView
        horizontal
        style={{ height: 103, flexGrow: 0 }}
        showsHorizontalScrollIndicator={false}
      >
        {rows.map((im) => (
          <Pressable
            key={im.id}
            accessibilityRole="button"
            accessibilityLabel={prefix + ' ' + im.id}
            accessibilityState={{ selected: im.hash === chosen }}
            onPress={() => pick(im.hash)}
            style={[s.choice, im.hash === chosen && s.chosen]}
          >
            <Image source={{ uri: photoUrl(record.id, im.hash) }} style={s.thumb} />
            <Text style={s.muted}>View {position(im)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    );
  }
  return (
    <View style={s.wrap}>
      <Button
        kind="secondary"
        label={open ? 'Close item signature' : 'Verify item session'}
        onPress={() => setOpen(!open)}
      />
      {open && (
        <>
          <Text style={s.title}>Verify the item session</Text>
          {record.category === 'pants' && (
            <>
              <Text style={s.body}>
                If the label identifies riding trousers, select the unfolded inside front showing
                both hips and the centre fly.
              </Text>
              {strip(inside, setFront, front, 'Choose inside front')}
            </>
          )}
          <Text style={s.body}>
            Read the photographed item card and enter its ID to sign the session.
          </Text>
          {cards.length > 1 && strip(cards, setCard, card, 'Choose item card')}
          {!!card && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Enlarge selected item card"
              onPress={(e) => {
                const p = record.images.find((p) => p.hash === card);
                if (p) openPhoto(p.id, undefined, undefined, e.currentTarget);
              }}
              style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
            >
              <Image
                accessibilityLabel="Selected photographed item card"
                source={{ uri: photoUrl(record.id, card, [0.2, 0.18, 0.8, 0.82]) }}
                resizeMode="contain"
                style={s.card}
              />
            </Pressable>
          )}
          {!cards.length && <Text style={s.muted}>A readable item-card photograph is needed.</Text>}
          <TextInput
            accessibilityLabel="ID visible on the selected card"
            value={text}
            onChangeText={setText}
            style={s.input}
            placeholder="Printed item ID"
            autoCapitalize="characters"
          />
          {!!issue && (
            <Text accessibilityLiveRegion="polite" style={s.body}>
              {issue}
            </Text>
          )}
          <Button
            label="Attest selected item card · demo"
            disabled={!card || !text.trim() || busy}
            onPress={() => void submit()}
          />
        </>
      )}
    </View>
  );
}
