import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, C, F, Icon, s } from './design';
import { a } from './styles';
import type { RelayModel } from './useRelay';
export function CaptureFooter({ m }: { m: RelayModel }) {
  const hasPhotos = !!m.draft?.photos.length;
  return (
    <View style={f.footer}>
      {m.analyzing ? (
        <View accessibilityLiveRegion="polite">
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel="Allow these photos to be processed by the selected Relay service"
            accessibilityState={{ checked: m.consent, disabled: true }}
            aria-checked={m.consent}
            disabled
            style={f.consent}
          >
            <View style={[a.checkbox, { backgroundColor: C.ink }]}>
              <Icon name="check" size={16} color={C.white} />
            </View>
            <Text style={f.consentText}>Processing with your selected Relay service.</Text>
          </Pressable>
          <View style={f.progress}>
            <ActivityIndicator color={C.forest} />
            <Text style={[s.small, { flex: 1, color: C.ink }]}>{m.phase}</Text>
          </View>
          <Button label="Cancel analysis" kind="quiet" icon="close" onPress={m.back} />
        </View>
      ) : (
        <>
          <View style={f.actions}>
            <View style={{ flex: 1 }}>
              <Button
                label={m.busy ? 'Preparing…' : m.currentPhoto ? 'Retake' : 'Camera'}
                accessibilityLabel={
                  m.busy
                    ? 'Preparing photograph…'
                    : m.currentPhoto
                      ? 'Retake this view'
                      : 'Take a photograph'
                }
                kind={hasPhotos ? 'secondary' : 'primary'}
                icon="camera"
                disabled={m.busy}
                onPress={() => void m.openCamera()}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label="Photos"
                accessibilityLabel="Choose a photograph"
                kind="secondary"
                icon="image"
                disabled={m.busy}
                onPress={() => void m.chooseImage()}
              />
            </View>
          </View>
          {hasPhotos && (
            <>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel="Allow these photos to be processed by the selected Relay service"
                accessibilityState={{ checked: m.consent }}
                aria-checked={m.consent}
                onPress={() => m.setConsent((v) => !v)}
                style={f.consent}
              >
                <View
                  style={[a.checkbox, m.consent && { backgroundColor: C.ink, borderColor: C.ink }]}
                >
                  {m.consent && <Icon name="check" size={16} color={C.white} />}
                </View>
                <Text style={f.consentText}>
                  Process these photos with my selected Relay service.
                </Text>
              </Pressable>
              <Button
                label="Review the evidence"
                icon="scan"
                disabled={!m.consent || m.busy}
                onPress={() => void m.analyze()}
              />
            </>
          )}
          {!hasPhotos && <Text style={f.helper}>Your photos stay in a draft on this device.</Text>}
        </>
      )}
    </View>
  );
}
const f = StyleSheet.create({
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: C.line,
    backgroundColor: C.paper,
  },
  actions: { flexDirection: 'row', gap: 10 },
  consent: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    minHeight: 54,
    paddingVertical: 10,
  },
  consentText: { flex: 1, fontFamily: F.body, fontSize: 12, lineHeight: 18, color: C.muted },
  helper: {
    fontFamily: F.body,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
    color: C.muted,
    marginTop: 10,
  },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
