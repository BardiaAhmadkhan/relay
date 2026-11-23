import { allDraftPhotos } from './session';
import React from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import type { PhotoView } from '../../packages/core/schema';
import type { Decision2 } from '../../packages/core/v2/schema';
import { categoryLabels2 } from './brief-v2';
import { Button, C, Fade, Label, Note, s } from './design';
import { a } from './styles';
import type { RelayModel } from './useRelay';

/** Result screen for a backend v2 decision (work package 11). Same layout and design pieces as the v1
 * result screen; no redesign. Every reason that names a photograph shows that photograph beside it,
 * because unexplained adverse results are what riders distrust most in photo-graded trade-ins. */
const statusColour: Record<Decision2['outcome'], string> = {
  offer: C.forest,
  review: C.ochre,
  retake: C.ochre,
  no_offer: C.red,
};
const statusLabel: Record<Decision2['outcome'], string> = {
  offer: 'Offer recommended',
  review: 'A specialist takes it from here',
  retake: 'One more photo needed',
  no_offer: 'Offer process closed',
};
const viewNames: Record<PhotoView, string> = {
  front: 'front',
  back: 'back',
  label: 'label',
  detail: 'close-up',
};

export function ResultV2({ m, d }: { m: RelayModel; d: Decision2 }) {
  const photos = m.draft ? allDraftPhotos(m.draft) : [];
  const photoUri = (id: string | null) => (id ? photos.find((p) => p.id === id)?.uri : undefined);
  const facts = !!d.grade || d.category !== 'unknown';
  return (
    <Fade>
      <View style={a.resultLabel}>
        <View style={[a.statusLine, { backgroundColor: statusColour[d.outcome] }]} />
        <Label>{statusLabel[d.outcome]}</Label>
      </View>
      <Text style={[s.title, { marginTop: 20 }]}>{d.title}</Text>
      <Text style={[s.body, { marginTop: 18 }]}>{d.summary}</Text>
      {facts && (
        // One ruled list from the facts down through the reasons: a single top rule, no double line.
        <View style={{ marginTop: 26, borderTopWidth: 1, borderTopColor: C.line }}>
          <View style={a.factRow}>
            <Text style={s.small}>Item</Text>
            <Text style={a.factValue}>{categoryLabels2[d.category]}</Text>
          </View>
          {d.grade && (
            <View style={a.factRow}>
              <Text style={s.small}>Condition grade</Text>
              <Text style={a.factValue}>{d.grade}</Text>
            </View>
          )}
        </View>
      )}
      <View style={[a.reasonList, facts && { marginTop: 0, borderTopWidth: 0 }]}>
        {d.reasons.map((reason, i) => {
          const uri = photoUri(reason.photoId);
          const mark = photos.find((p) => p.id === reason.photoId)?.fromOverview;
          const parent = mark && photoUri(mark.parentId);
          return (
            <View style={a.reason} key={reason.code + '-' + i}>
              <Text style={a.number}>0{i + 1}</Text>
              <Text style={[s.body, { flex: 1, color: C.ink }]}>{reason.text}</Text>
              {parent && (
                <Image
                  source={{ uri: parent }}
                  style={r.thumb}
                  resizeMode="contain"
                  accessibilityLabel="Original overview for this marked area"
                />
              )}
              {uri && (
                <Image
                  source={{ uri }}
                  style={r.thumb}
                  resizeMode="cover"
                  accessibilityLabel="The photograph this reason refers to"
                />
              )}
            </View>
          );
        })}
      </View>
      <View style={a.nextStep}>
        <Label>The next step</Label>
        <Text style={[s.body, { marginTop: 10, color: C.ink }]}>{d.nextAction}</Text>
      </View>
      <View style={{ marginTop: 24, gap: 12 }}>
        {d.requestPhoto && (
          <View>
            <Button
              label={'Take the ' + viewNames[d.requestPhoto.view] + ' photo'}
              icon="camera"
              onPress={() => {
                m.setView(d.requestPhoto!.view);
                m.setScreen('capture');
              }}
            />
            <Text style={[s.small, { marginTop: 8 }]}>{d.requestPhoto.hint}</Text>
          </View>
        )}
        <Button
          label={Platform.OS === 'web' ? 'Copy inspection brief' : 'Share inspection brief'}
          kind={d.requestPhoto ? 'secondary' : 'primary'}
          icon="share"
          onPress={() => void m.share()}
        />
        {d.outcome !== 'retake' && (
          <View>
            <Button
              label="Save brief & check next item"
              kind="secondary"
              icon="plus"
              disabled={m.busy}
              onPress={() => void m.archiveAndNext()}
            />
            <Text style={[s.small, { marginTop: 8 }]}>
              Keeps the brief and photographs in your notebook.
            </Text>
          </View>
        )}
        <Button
          label="Back to your notebook"
          kind="quiet"
          icon="back"
          onPress={() => m.setScreen('home')}
        />
      </View>
      <View style={{ marginTop: 16 }}>
        <Note>
          No safety certification. No offer guarantee. Internal damage, authenticity and
          independently verified history remain unknown.
        </Note>
      </View>
      {m.error && (
        <View style={{ marginTop: 16 }} accessibilityRole="alert">
          <Note tone="error">{m.error}</Note>
        </View>
      )}
    </Fade>
  );
}
const r = StyleSheet.create({
  thumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: C.wash },
});
