import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Questions } from '../../packages/core/schema';
import { questionText, viewLabels } from '../../packages/core/policy';
import { C, Icon, JacketArt, Fade, Button, Label, Note, s } from './design';
import { a } from './styles';
import { guide, type RelayModel } from './useRelay';
export function Home({ m }: { m: RelayModel }) {
  return (
    <Fade>
      <View style={{ paddingTop: 8 }}>
        <Label>Gear, reconsidered.</Label>
        <Text style={[s.title, { marginTop: 14, fontSize: 52, lineHeight: 52 }]}>
          Good gear.{'\n'}Another chapter.
        </Text>
        <Text style={[s.body, { marginTop: 14, maxWidth: 330 }]}>
          A thoughtful first look at the gear you’re ready to pass on.
        </Text>
      </View>
      <View style={a.heroArt}>
        <View style={a.heroIndex}>
          <Text style={a.technical}>01 / THE JACKET</Text>
          <View style={a.smallDash} />
        </View>
        <JacketArt />
        <View style={a.artCaption}>
          <Text style={a.technical}>CAPTURE / CONSIDER / REVIEW</Text>
          <Text style={a.technical}>↗</Text>
        </View>
      </View>
      <View style={{ gap: 10, marginTop: 20 }}>
        {m.draft ? (
          <>
            <Button
              label="Continue your gear check"
              onPress={() =>
                m.setScreen(m.draft?.result ? 'evidence' : m.allAnswered ? 'capture' : 'history')
              }
            />
            <Button
              label="View your history answers"
              kind="quiet"
              icon="back"
              onPress={() => m.setScreen('history')}
            />
          </>
        ) : (
          <Button label="Start a gear check" onPress={m.start} />
        )}
      </View>
      <View style={a.promise}>
        <Text style={s.small}>
          A few honest answers. A few useful photos.{'\n'}A clear next step, with a person in the
          loop.
        </Text>
      </View>
      <View style={a.rule} />
      <View style={a.footerRow}>
        <Text style={a.technical}>PRE-EVENT EXPERIMENT</Text>
        <Text style={a.technical}>JACKETS / V.01</Text>
      </View>
      <Text style={[s.small, { marginTop: 12 }]}>
        Relay prepares an inspection record. It cannot certify protective performance or guarantee
        an offer.
      </Text>
    </Fade>
  );
}
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
      <Label>Begin with what you know</Label>
      <Text style={[s.title, { marginTop: 12 }]}>Every jacket{'\n'}has a history.</Text>
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
        <Label>The evidence, in your hands</Label>
        <Text style={a.technical}>{m.completeViews} / 3 VIEWS</Text>
      </View>
      <Text style={[s.heading, { marginTop: 12 }]}>Make the details clear.</Text>
      <Text style={[s.body, { marginTop: 10 }]}>
        Start with three views. Keep the same jacket in each one.
      </Text>
      <View style={a.photoTabs}>
        {(['front', 'back', 'label', 'detail'] as const).map((v) => {
          const photo = m.draft?.photos.find((p) => p.view === v);
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
      <View style={a.captureCanvas}>
        <View style={a.captureTop}>
          <Text style={a.technical}>
            {m.view === 'detail'
              ? 'OPTIONAL DETAIL'
              : 'VIEW ' + { front: '01', back: '02', label: '03', detail: '04' }[m.view]}
          </Text>
          {m.currentPhoto && <Text style={a.technical}>CAPTURED</Text>}
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
        {m.currentPhoto?.quality.warnings.length ? (
          <Text style={[s.small, { color: C.ochre, marginTop: 12 }]}>
            {m.currentPhoto.quality.warnings.some((w) =>
              ['dark', 'bright', 'low_resolution'].includes(w),
            )
              ? 'Please replace this view: light or resolution may hide details.'
              : 'Fine detail may be soft. Check it before continuing; this is a photo-quality hint.'}
          </Text>
        ) : null}
      </View>
      {!m.analyzing && (
        <View style={{ gap: 10, marginTop: 14 }}>
          <Button
            label={
              m.busy
                ? 'Preparing photograph…'
                : m.currentPhoto
                  ? 'Retake this view'
                  : 'Take a photograph'
            }
            icon="camera"
            disabled={m.busy}
            onPress={() => void m.openCamera()}
          />
          <Button
            label="Choose a photograph"
            kind="secondary"
            icon="plus"
            disabled={m.busy}
            onPress={() => void m.chooseImage()}
          />
        </View>
      )}
      <View style={[a.rule, { marginTop: 26 }]} />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel="Allow these photos to be processed by the selected Relay service"
        accessibilityState={{ checked: m.consent }}
        aria-checked={m.consent}
        onPress={() => m.setConsent((v) => !v)}
        disabled={m.analyzing}
        style={a.consent}
      >
        <View style={[a.checkbox, m.consent && { backgroundColor: C.ink, borderColor: C.ink }]}>
          {m.consent && <Icon name="check" size={16} color={C.white} />}
        </View>
        <Text style={[s.small, { flex: 1 }]}>
          Process these photos with my selected Relay service. My draft stays on this device.
        </Text>
      </Pressable>
      <Text style={s.small}>
        Local mode keeps image analysis on your computer. The service address is in Connection &
        privacy.
      </Text>
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
      {m.analyzing ? (
        <View style={a.analysisPanel} accessibilityLiveRegion="polite">
          <ActivityIndicator color={C.orange} />
          <Text style={a.analysisTitle}>{m.phase}</Text>
          <Text style={s.small}>Your photos stay in place if this takes longer than expected.</Text>
          <Button label="Cancel analysis" kind="quiet" icon="close" onPress={m.back} />
        </View>
      ) : (
        <View style={{ marginTop: 20 }}>
          <Button
            label="Review the evidence"
            disabled={m.completeViews < 3 || !m.consent || m.busy}
            onPress={() => void m.analyze()}
          />
        </View>
      )}
      {m.error ? (
        <View accessibilityRole="alert" style={{ marginTop: 16 }}>
          <Note tone="error">{m.error}</Note>
          <Button
            label="Check connection settings"
            kind="quiet"
            icon="settings"
            onPress={m.settings}
          />
        </View>
      ) : null}
    </Fade>
  );
}
