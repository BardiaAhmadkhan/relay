import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { categoryLabels, zoneLabels, viewLabels } from '../../packages/core/policy';
import { C, F, Icon, Button, s } from './design';
import type { RelayModel } from './useRelay';

const findingNames = {
  abrasion: 'Abrasion',
  tear: 'Torn material',
  seam: 'Seam damage',
  repair: 'Possible repair',
  closure: 'Closure concern',
  insert: 'Insert concern',
  other: 'Surface concern',
};
export function InspectionEvidence({ m }: { m: RelayModel }) {
  const observation = m.draft!.result!.observation!,
    inspection = observation.inspection!;
  const [selected, setSelected] = useState(inspection.photos[0]!.imageId);
  const [limits, setLimits] = useState(false);
  const active = inspection.photos.find((p) => p.imageId === selected) ?? inspection.photos[0]!;
  const photo = m.draft!.photos.find((p) => p.id === active.imageId);
  const unassessed = m.draft!.photos.filter(
    (p) => !inspection.photos.some((i) => i.imageId === p.id),
  );
  const count = inspection.photos.reduce((n, p) => n + p.findings.length, 0);
  const warning = count > 0,
    elapsed = m.draft!.result!.timing.inferenceMs;
  const limitedReview = !warning && m.decision.reasons.some((r) => r.code.startsWith('quality_'));
  return (
    <View>
      <View style={v.reviewLine}>
        <View style={v.reviewState}>
          <Icon name="check" size={15} color={C.forest} />
          <Text style={v.reviewText}>Photo review complete</Text>
        </View>
        <Text style={s.small}>{elapsed < 1000 ? '< 1' : (elapsed / 1000).toFixed(1)}s</Text>
      </View>
      <Text style={[s.title, { marginTop: 18 }]}>
        {warning || limitedReview ? m.decision.title : 'Here’s what we can see.'}
      </Text>
      <View style={v.statusRow}>
        <View style={[v.status, { backgroundColor: warning ? C.dangerWash : C.wash }]}>
          <View style={[v.statusDot, { backgroundColor: warning ? C.red : C.muted }]} />
          <Text style={[v.statusText, { color: warning ? C.red : C.ink }]}>
            {warning
              ? 'Offer on hold'
              : limitedReview
                ? 'More photo detail needed'
                : 'Physical review needed'}
          </Text>
        </View>
        <Text style={v.category}>{categoryLabels[observation.category]}</Text>
      </View>
      <Text style={[s.body, { marginTop: 14 }]}>
        {warning || limitedReview
          ? m.decision.summary
          : 'No material damage was flagged in the supplied photos. That does not establish an absence of damage or a crash.'}
      </Text>
      {limitedReview && (
        <Button
          label="Add a clearer photograph"
          icon="camera"
          onPress={() => {
            if (photo) m.setView(photo.view);
            m.setScreen('capture');
          }}
        />
      )}
      {!!unassessed.length && (
        <View style={{ marginTop: 14 }}>
          <Text style={s.small}>
            {unassessed.length} photo{unassessed.length === 1 ? '' : 's'} could not be assessed
            because of exposure. The findings below come from the usable photos.
          </Text>
          <Button
            label="Retake unassessed photo"
            kind="quiet"
            icon="camera"
            onPress={() => {
              m.setView(unassessed[0]!.view);
              m.setScreen('capture');
            }}
          />
        </View>
      )}
      <View style={v.imageFrame}>
        {photo && (
          <Image
            source={{ uri: photo.uri }}
            style={v.image}
            resizeMode="contain"
            accessibilityLabel={'Inspected ' + viewLabels[photo.view].toLowerCase() + ' photograph'}
          />
        )}
        <View style={v.photoCaption}>
          <Icon name="image" size={14} color={C.ink} />
          <Text style={v.photoCaptionText}>
            Photo {inspection.photos.indexOf(active) + 1}
            {photo ? ' · ' + viewLabels[photo.view] : ''}
          </Text>
          <Text style={v.photoCount}>
            {active.findings.length} {active.findings.length === 1 ? 'finding' : 'findings'}
          </Text>
        </View>
      </View>
      {inspection.photos.length > 1 && (
        <View style={v.photoChoices}>
          {inspection.photos.map((p, i) => {
            const source = m.draft!.photos.find((photo) => photo.id === p.imageId);
            return (
              <Pressable
                key={p.imageId}
                accessibilityRole="button"
                accessibilityLabel={'Inspect photo ' + (i + 1)}
                accessibilityState={{ selected: active.imageId === p.imageId }}
                onPress={() => setSelected(p.imageId)}
                style={[
                  v.photoChoice,
                  active.imageId === p.imageId && { borderColor: C.ink, borderWidth: 2 },
                ]}
              >
                {source && (
                  <Image source={{ uri: source.uri }} style={v.miniImage} resizeMode="cover" />
                )}
                <Text style={v.miniLabel}>{i + 1}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      <View style={v.findingHeading}>
        <Text style={v.sectionTitle}>Visible evidence</Text>
        <Text style={s.small}>From this photograph</Text>
      </View>
      {active.findings.length ? (
        active.findings.map((f, i) => (
          <View key={i} style={v.finding}>
            <View style={v.findingNumber}>
              <Text style={v.findingNumberText}>{String(i + 1).padStart(2, '0')}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={v.findingTitle}>
                {zoneLabels[f.zone]} <Text style={v.findingKind}>/ {findingNames[f.kind]}</Text>
              </Text>
              <Text style={v.findingBody}>{f.evidence}</Text>
              <Text style={v.findingCertainty}>
                {f.clarity === 'clear'
                  ? 'Visible in photo · model observation'
                  : 'Possible finding · check closely'}
              </Text>
            </View>
          </View>
        ))
      ) : (
        <View style={v.emptyFinding}>
          <Icon name="eye" size={23} color={C.muted} />
          <Text style={[s.body, { flex: 1 }]}>
            No defect was returned for this view. Unseen areas remain unassessed.
          </Text>
        </View>
      )}
      <View style={v.historyRow}>
        <View style={{ flex: 1 }}>
          <Text style={v.sectionTitle}>Crash history</Text>
          <Text style={s.small}>
            {m.answers.crash === 'yes'
              ? 'Crash reported'
              : m.answers.crash === 'no'
                ? 'None reported by the rider'
                : 'Not yet established'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Review history answers"
          onPress={() => m.setScreen('history')}
          style={v.historyButton}
        >
          <Text style={v.historyButtonText}>Review</Text>
          <Icon name="arrow" size={16} />
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="What photos cannot tell us"
        accessibilityState={{ expanded: limits }}
        onPress={() => setLimits(!limits)}
        style={v.limitsToggle}
      >
        <Icon name="info" size={17} color={C.muted} />
        <Text style={[s.small, { flex: 1 }]}>What photos cannot tell us</Text>
        <Icon name={limits ? 'close' : 'plus'} size={16} />
      </Pressable>
      {limits && (
        <Text style={[s.small, { marginBottom: 16 }]}>
          A visual pattern can suggest road contact, but cannot prove when or how it happened.
          Internal damage, protector condition and protective performance need physical inspection.
          The image observations are model inferences, not verified facts.
        </Text>
      )}
      <Text style={[s.small, { fontSize: 11 }]}>Model inference · not verified</Text>
    </View>
  );
}
const v = StyleSheet.create({
  reviewLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reviewState: { flexDirection: 'row', gap: 7, alignItems: 'center' },
  reviewText: { fontFamily: F.medium, fontSize: 12, color: C.forest },
  statusRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 16,
  },
  status: {
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
  },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontFamily: F.bold, fontSize: 11 },
  category: { fontFamily: F.medium, fontSize: 12, color: C.muted },
  imageFrame: {
    backgroundColor: '#ECEDE7',
    marginTop: 24,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.line,
  },
  image: { height: 300, width: '100%' },
  photoCaption: {
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
    backgroundColor: C.white,
    paddingHorizontal: 15,
    paddingVertical: 13,
  },
  photoCaptionText: { fontFamily: F.medium, fontSize: 12, color: C.ink },
  photoCount: { fontFamily: F.medium, fontSize: 11, color: C.muted, marginLeft: 'auto' },
  photoChoices: { flexDirection: 'row', gap: 10, marginTop: 12 },
  photoChoice: {
    width: 58,
    height: 68,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.line,
  },
  miniImage: { width: '100%', height: '100%' },
  miniLabel: {
    position: 'absolute',
    bottom: 3,
    right: 4,
    backgroundColor: C.white,
    paddingHorizontal: 5,
    borderRadius: 4,
    fontFamily: F.bold,
    fontSize: 11,
    color: C.ink,
  },
  findingHeading: {
    marginTop: 26,
    marginBottom: 13,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  sectionTitle: { fontFamily: F.bold, fontSize: 15, lineHeight: 22, color: C.ink },
  finding: {
    flexDirection: 'row',
    gap: 13,
    borderTopWidth: 1,
    borderTopColor: C.line,
    paddingVertical: 18,
  },
  findingNumber: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: '#E9EDE2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  findingNumberText: { fontFamily: F.bold, fontSize: 11, color: C.forest },
  findingTitle: { fontFamily: F.bold, fontSize: 14, lineHeight: 21, color: C.ink },
  findingKind: { fontFamily: F.body, color: C.muted },
  findingBody: { fontFamily: F.body, fontSize: 14, lineHeight: 22, color: C.ink, marginTop: 5 },
  findingCertainty: {
    fontFamily: F.body,
    fontSize: 11,
    lineHeight: 17,
    color: C.muted,
    marginTop: 7,
  },
  emptyFinding: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 18,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.white,
    padding: 17,
    borderRadius: 17,
    marginTop: 16,
    borderWidth: 1,
    borderColor: C.line,
  },
  historyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 48,
    paddingHorizontal: 10,
  },
  historyButtonText: { fontFamily: F.medium, fontSize: 13, color: C.ink },
  limitsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    minHeight: 52,
    marginTop: 12,
  },
});
