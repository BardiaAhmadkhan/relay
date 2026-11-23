import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Questions } from '../../packages/core/schema';
import { questionText, viewLabels } from '../../packages/core/policy';
import { C, Icon, JacketArt, Fade, Button, Label, Note, s } from './design';
import { a } from './styles';
import { guide, type RelayModel } from './useRelay';
export { Home } from './home';
const explanations = {
  crash: 'Even if the garment looks unchanged.',
  protective_damage:
    'For example, worn-through fabric or damaged seams at a shoulder, elbow or back.',
  protective_repair:
    'Including patched material, replacement panels or re-stitched protective seams.',
};
export function History({ m }: { m: RelayModel }) {
  return (
    <Fade>
      <Label>The details only you know</Label>
      <Text style={[s.title, { marginTop: 12 }]}>The story behind{'\n'}the jacket.</Text>
      <Text style={[s.body, { marginTop: 14, marginBottom: 22 }]}>
        Photos only tell part of it. “Not sure” is a useful answer.
      </Text>
      {Questions.map((q, index) => (
        <View key={q} style={a.question}>
          <View style={a.questionHeading}>
            <Text style={a.number}>0{index + 1}</Text>
            <Text style={a.questionTitle}>{questionText[q]}</Text>
          </View>
          <Text style={[s.small, { marginLeft: 34, marginTop: 6 }]}>{explanations[q]}</Text>
          <View
            style={a.answers}
            accessibilityRole="radiogroup"
            accessibilityLabel={questionText[q]}
          >
            {(['no', 'yes', 'unknown'] as const).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityLabel={
                  questionText[q] +
                  ' ' +
                  (value === 'unknown' ? 'Not sure' : value === 'yes' ? 'Yes' : 'No')
                }
                accessibilityState={{ checked: m.answers[q] === value }}
                aria-checked={m.answers[q] === value}
                onPress={() => m.answer(q, value)}
                style={[a.answer, m.answers[q] === value && a.answerSelected]}
              >
                <Text style={[a.answerText, m.answers[q] === value && { color: C.white }]}>
                  {value === 'unknown' ? 'Not sure' : value === 'yes' ? 'Yes' : 'No'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
      {m.exclusion && (
        <View style={{ marginTop: 20 }}>
          <Note tone="error">
            A reported crash, protective-area damage or repair excludes this item from the offer
            process. More photographs cannot reverse that.
          </Note>
        </View>
      )}
      <View style={{ marginTop: 24 }}>
        <Button
          label={m.exclusion ? 'See the next step' : 'Continue to photos'}
          disabled={!m.allAnswered && !m.exclusion}
          onPress={() => {
            if (m.exclusion) m.setScreen('result');
            else {
              m.setView(
                (['front', 'back', 'label'] as const).find(
                  (v) => !m.draft?.photos.some((p) => p.view === v),
                ) ?? 'front',
              );
              m.setScreen('capture');
            }
          }}
        />
      </View>
      <Text style={[s.small, { marginTop: 14 }]}>
        Your answers are rider reports, not independently verified facts.
      </Text>
    </Fade>
  );
}
export function Capture({ m }: { m: RelayModel }) {
  return (
    <Fade>
      <View style={a.headingRow}>
        <Text style={s.small}>{m.completeViews} of 3 views added</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add item history"
          onPress={() => m.setScreen('history')}
          style={{
            minHeight: 44,
            paddingHorizontal: 8,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 7,
          }}
        >
          <Icon name="file" size={16} />
          <Text style={a.tabText}>History</Text>
        </Pressable>
      </View>
      <Text style={[s.heading, { marginTop: 6 }]}>Start with what you see.</Text>
      <Text style={[s.body, { marginTop: 10 }]}>
        One photo is enough to start. Add views of the same jacket as you go.
      </Text>
      <View style={a.photoTabs}>
        {(['front', 'back', 'label', 'detail'] as const).map((v) => {
          const photo = m.draft?.photos.find((p) => p.view === v && !p.fromOverview);
          return (
            <Pressable
              key={v}
              accessibilityRole="button"
              accessibilityLabel={viewLabels[v] + ' photo' + (photo ? ' captured' : ' needed')}
              accessibilityState={{ selected: m.view === v }}
              onPress={() => m.setView(v)}
              disabled={m.analyzing || m.busy}
              style={[a.photoTab, m.view === v && { borderColor: C.ink }]}
            >
              <View style={a.thumb}>
                {photo ? (
                  <Image
                    source={{ uri: photo.uri }}
                    style={StyleSheet.absoluteFill}
                    resizeMode="cover"
                    accessible={false}
                  />
                ) : (
                  <Icon
                    name={v === 'detail' ? 'plus' : v === 'label' ? 'file' : 'camera'}
                    size={22}
                    color={C.muted}
                  />
                )}
              </View>
              <View style={a.tabCaption}>
                <Text style={a.tabText}>{viewLabels[v]}</Text>
                {photo && <Icon name="check" size={13} color={C.forest} />}
              </View>
            </Pressable>
          );
        })}
      </View>
      {m.removedPhoto && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <Text style={s.small}>Photograph removed.</Text>
          <Button
            label="Undo removal"
            kind="quiet"
            onPress={m.undoPhotoRemoval}
            disabled={m.busy || m.analyzing}
          />
        </View>
      )}
      <View style={a.captureCanvas}>
        <View style={a.captureTop}>
          <Text style={a.technical}>
            {m.view === 'detail'
              ? 'CLOSE-UP'
              : 'VIEW ' + { front: '01', back: '02', label: '03', detail: '04' }[m.view]}
          </Text>
          {m.currentPhoto && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={a.technical}>CAPTURED</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove this photograph"
                disabled={m.busy || m.analyzing}
                onPress={m.removeCurrentPhoto}
                style={{
                  minWidth: 44,
                  minHeight: 44,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="close" size={18} />
              </Pressable>
            </View>
          )}
        </View>
        <View style={a.captureArt}>
          {m.currentPhoto ? (
            <Image
              source={{ uri: m.currentPhoto.uri }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="contain"
              accessibilityLabel={'Your ' + viewLabels[m.view].toLowerCase() + ' photograph'}
            />
          ) : m.view === 'label' ? (
            <View style={a.labelIllustration}>
              <Text style={a.technical}>BRAND / MODEL</Text>
              <View style={a.labelLine} />
              <View style={[a.labelLine, { width: '65%' }]} />
              <Text style={[s.small, { fontSize: 12 }]}>Size · Material · Markings</Text>
            </View>
          ) : (
            <JacketArt back={m.view === 'back'} />
          )}
        </View>
        <Text style={a.guideTitle}>{guide[m.view].title}</Text>
        <Text style={[s.small, { marginTop: 6 }]}>{guide[m.view].body}</Text>
        {m.currentPhoto?.v2 ? (
          // Backend v2: the service's calibrated check of this photograph (work package 11).
          <Text
            accessibilityLiveRegion="polite"
            style={[
              s.small,
              { color: m.currentPhoto.v2.feedback.length ? C.ochre : C.forest, marginTop: 12 },
            ]}
          >
            {m.currentPhoto.v2.feedback[0]?.text ?? 'Photo checked: clear enough to use.'}
          </Text>
        ) : m.currentPhoto && m.scoringIds.includes(m.currentPhoto.id) ? (
          <Text accessibilityLiveRegion="polite" style={[s.small, { marginTop: 12 }]}>
            Checking this photo…
          </Text>
        ) : m.currentPhoto?.quality.warnings.length ? (
          <Text style={[s.small, { color: C.ochre, marginTop: 12 }]}>
            {m.currentPhoto.quality.warnings.some((w) =>
              ['dark', 'bright', 'low_resolution'].includes(w),
            )
              ? 'Please replace this view: light or resolution may hide details.'
              : 'Fine detail may be soft. Check it before continuing; this is a photo-quality hint.'}
          </Text>
        ) : null}
      </View>
      {m.externalProvider && (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel="Allow external provider image processing"
          accessibilityState={{ checked: m.externalConsent }}
          aria-checked={m.externalConsent}
          onPress={m.toggleExternalConsent}
          style={a.consent}
        >
          <View style={[a.checkbox, m.externalConsent && { backgroundColor: C.ink }]}>
            {m.externalConsent && <Icon name="check" size={16} color={C.white} />}
          </View>
          <Text style={[s.small, { flex: 1 }]}>
            This service uses {m.externalProvider}. I have permission to send these images to that
            provider and have reviewed its data handling.
          </Text>
        </Pressable>
      )}
      {m.error ? (
        <View accessibilityRole="alert" style={{ marginTop: 16 }}>
          <Note tone="error">{m.error}</Note>
          <Button
            label={m.isOnDevice ? 'Offline engine settings' : 'Check connection settings'}
            kind="quiet"
            icon="settings"
            onPress={m.settings}
          />
        </View>
      ) : null}
    </Fade>
  );
}
