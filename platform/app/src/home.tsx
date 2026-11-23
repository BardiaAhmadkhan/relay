import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { C, F, Icon, Button, Fade, s } from './design';
import type { RelayModel } from './useRelay';

export function Home({ m }: { m: RelayModel }) {
  return (
    <Fade>
      <Text style={h.title}>Before it{'\n'}rides again.</Text>
      <Text style={h.intro}>A closer look at your gear. A clear next step.</Text>
      <View style={h.hero}>
        <Image
          source={require('../assets/editorial-jacket.jpg')}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
          accessibilityLabel="Editorial illustration of a black riding jacket; not an assessed item"
        />
        <View style={h.heroTop}>
          <View style={h.heroTag}>
            <View style={h.dot} />
            <Text style={h.heroTagText}>Motorcycle jackets</Text>
          </View>
          <Icon name="scan" size={22} color="#D7DBCD" />
        </View>
        <View style={h.heroBottom}>
          <Text style={h.heroCaption}>Look beyond the surface.</Text>
          <Text style={h.artLabel}>Illustrative image</Text>
        </View>
      </View>
      <View style={h.steps}>
        {[
          ['camera', 'Photograph'],
          ['eye', 'Understand'],
          ['file', 'Decide'],
        ].map(([icon, label], i) => (
          <View key={label} style={h.step}>
            <View style={h.stepIcon}>
              <Icon name={icon!} size={18} color={C.forest} />
            </View>
            <Text style={h.stepText}>{label}</Text>
            {i < 2 && <Text style={h.stepArrow}>›</Text>}
          </View>
        ))}
      </View>
      <Button
        label={m.draft ? 'Continue your gear check' : 'Start a gear check'}
        icon="scan"
        onPress={
          m.draft ? () => m.setScreen(m.draft?.result ? 'evidence' : 'capture') : () => m.start()
        }
      />
      <Text style={h.hint}>Start with one photo. Add the details as you go.</Text>
      {m.draft && (
        <Button
          label="View your history answers"
          kind="quiet"
          icon="back"
          onPress={() => m.setScreen('history')}
        />
      )}
      {m.savedBriefs.length > 0 && (
        <Button
          label={'Saved briefs \u00b7 ' + m.savedBriefs.length}
          kind="quiet"
          icon="file"
          onPress={() => m.setScreen('records')}
        />
      )}
      <View style={h.boundary}>
        <Icon name="shield" size={18} color={C.muted} />
        <Text style={[s.small, { flex: 1 }]}>
          An informed first look. Protective performance still needs a specialist’s inspection.
        </Text>
      </View>
    </Fade>
  );
}
const h = StyleSheet.create({
  title: {
    fontFamily: F.bold,
    fontSize: 44,
    lineHeight: 47,
    letterSpacing: -2,
    color: C.ink,
    marginTop: 6,
  },
  intro: {
    fontFamily: F.body,
    fontSize: 15,
    lineHeight: 23,
    color: C.muted,
    marginTop: 14,
    marginBottom: 22,
  },
  hero: { height: 310, borderRadius: 24, overflow: 'hidden', backgroundColor: '#242625' },
  heroTop: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroTag: {
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
    backgroundColor: '#272C28',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 20,
  },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.signal },
  heroTagText: { fontFamily: F.medium, fontSize: 11, color: '#E2E8D7' },
  heroBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 17,
    backgroundColor: '#202421E8',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  heroCaption: { fontFamily: F.medium, fontSize: 12, color: '#F2F5E9', flexShrink: 1 },
  artLabel: { fontFamily: F.body, fontSize: 10, color: '#CBD0C3' },
  steps: { flexDirection: 'row', marginVertical: 22, gap: 8 },
  step: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  stepIcon: {
    width: 27,
    height: 27,
    borderRadius: 9,
    backgroundColor: '#E9EDDF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { fontFamily: F.medium, fontSize: 11, color: C.ink },
  stepArrow: { color: '#8E958A', fontSize: 16, marginLeft: 'auto' },
  hint: {
    fontFamily: F.body,
    fontSize: 12,
    lineHeight: 19,
    color: C.muted,
    textAlign: 'center',
    marginTop: 12,
  },
  boundary: {
    flexDirection: 'row',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: C.line,
    paddingTop: 17,
    marginTop: 23,
  },
});
