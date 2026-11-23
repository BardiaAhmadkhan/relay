import React from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { type Category } from '../../packages/core/schema';
import { categoryLabels, concernText } from '../../packages/core/policy';
import { recoveryAction } from '../../packages/core/recovery';
import { C, Icon, Fade, Button, Label, Note, s } from './design';
import { a } from './styles';
import { type RelayModel } from './useRelay';
export function Evidence({ m }: { m: RelayModel }) {
  const draft = m.draft;
  if (!draft) return null;
  const observation = draft.result?.observation,
    front = draft.photos.find((p) => p.view === 'front');
  return (
    <Fade>
      <Label>Observation is the beginning</Label>
      <Text style={[s.title, { marginTop: 12 }]}>Here’s what{'\n'}we can see.</Text>
      <View style={a.evidenceIdentity}>
        <View style={a.identityPhoto}>
          {front && (
            <Image
              source={{ uri: front.uri }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              accessibilityLabel="Your front-view photo"
            />
          )}
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Label>Suggested category</Label>
          <Text style={a.itemTitle}>
            {observation ? categoryLabels[observation.category] : 'Not established'}
          </Text>
          <Text style={s.small}>Model inference · not verified</Text>
        </View>
      </View>
      {observation?.coverage === 'category_only' ? (
        <Note>
          Appearance matching is complete. Local vision has not assessed protective condition, read
          the label or verified the model.
        </Note>
      ) : (
        <Note>
          Visible observations are unverified. They cannot establish internal condition or crash
          history.
        </Note>
      )}
      {observation?.attributes.map((attr, i) => (
        <View style={a.factRow} key={i}>
          <Text style={s.small}>{attr.field}</Text>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <Text style={a.factValue}>“{attr.value}”</Text>
            <Text style={s.small}>
              {attr.kind === 'visible_text'
                ? 'Unverified label transcription'
                : 'Unverified model inference'}
            </Text>
          </View>
        </View>
      ))}
      {observation?.concerns.map((concern, i) => (
        <View style={a.factRow} key={i}>
          <Icon name="info" color={C.ochre} />
          <Text style={[s.body, { flex: 1, color: C.ink }]}>{concernText[concern.kind]}</Text>
        </View>
      ))}
      <View style={a.factRow}>
        <Text style={s.small}>Photo record</Text>
        <Text style={a.factValue}>{draft.photos.length} views collected</Text>
      </View>
      <View style={a.factRow}>
        <Text style={s.small}>Crash history</Text>
        <Text style={a.factValue}>
          {m.answers.crash === 'no'
            ? 'None reported'
            : m.answers.crash === 'yes'
              ? 'Crash reported'
              : 'Unknown'}
        </Text>
      </View>
      <View style={a.factRow}>
        <Text style={s.small}>Protective performance</Text>
        <Text style={a.factValue}>Not established</Text>
      </View>
      {draft.corrections.length > 0 && (
        <View style={{ marginTop: 16 }}>
          <Note>
            {draft.corrections.length} rider correction{draft.corrections.length === 1 ? '' : 's'}{' '}
            preserved for the specialist.
          </Note>
        </View>
      )}
      {!m.editing ? (
        <Button
          label="Correct an item detail"
          kind="quiet"
          icon="plus"
          onPress={() => {
            m.setEditing(true);
            m.setEditCategory(observation?.category ?? 'motorcycle_jacket');
          }}
        />
      ) : (
        <View style={a.editPanel}>
          <Text style={a.questionTitle}>What would you change?</Text>
          <Text style={[s.small, { marginTop: 8 }]}>
            Your correction will stay beside the original observation.
          </Text>
          <View
            style={a.categoryOptions}
            accessibilityRole="radiogroup"
            accessibilityLabel="Corrected gear category"
          >
            {(Object.keys(categoryLabels) as Category[])
              .filter((c) => c !== 'multiple')
              .map((c) => (
                <Pressable
                  key={c}
                  accessibilityRole="radio"
                  accessibilityLabel={'Correct category to ' + categoryLabels[c]}
                  accessibilityState={{ checked: m.editCategory === c }}
                  aria-checked={m.editCategory === c}
                  onPress={() => m.setEditCategory(c)}
                  style={[a.categoryOption, m.editCategory === c && { backgroundColor: C.ink }]}
                >
                  <Text style={[s.small, m.editCategory === c && { color: C.white }]}>
                    {categoryLabels[c]}
                  </Text>
                </Pressable>
              ))}
          </View>
          <Text style={a.inputLabel}>Brand, if known</Text>
          <TextInput
            accessibilityLabel="Corrected brand"
            value={m.editBrand}
            onChangeText={m.setEditBrand}
            maxLength={120}
            style={a.input}
            placeholder="Optional"
            placeholderTextColor={C.muted}
          />
          <Text style={a.inputLabel}>Model, if known</Text>
          <TextInput
            accessibilityLabel="Corrected model"
            value={m.editModel}
            onChangeText={m.setEditModel}
            maxLength={120}
            style={a.input}
            placeholder="Optional"
            placeholderTextColor={C.muted}
          />
          <View style={{ marginTop: 16, gap: 6 }}>
            <Button label="Keep my correction" onPress={m.saveCorrections} icon="check" />
            <Button
              label="Cancel correction"
              kind="quiet"
              icon="close"
              onPress={() => m.setEditing(false)}
            />
          </View>
        </View>
      )}
      <View style={{ marginTop: 24, gap: 10 }}>
        <Button label="See the next step" onPress={() => m.setScreen('result')} />
        <Button
          label="Revisit photographs"
          kind="secondary"
          icon="camera"
          onPress={() => m.setScreen('capture')}
        />
      </View>
    </Fade>
  );
}
export function Result({ m }: { m: RelayModel }) {
  const d = m.decision,
    recovery = recoveryAction(d, m.draft?.photos ?? []);
  return (
    <Fade>
      <View style={a.resultLabel}>
        <View
          style={[
            a.statusLine,
            {
              backgroundColor: m.exclusion
                ? C.red
                : d.state === 'more_information'
                  ? C.ochre
                  : C.forest,
            },
          ]}
        />
        <Label>
          {m.exclusion
            ? 'Offer process closed'
            : d.state === 'more_information'
              ? 'More information needed'
              : 'A person takes it from here'}
        </Label>
      </View>
      <Text style={[s.title, { marginTop: 20 }]}>{d.title}</Text>
      <Text style={[s.body, { marginTop: 18 }]}>{d.summary}</Text>
      <View style={a.reasonList}>
        {d.reasons.map((reason, i) => (
          <View style={a.reason} key={reason.code + '-' + i}>
            <Text style={a.number}>0{i + 1}</Text>
            <Text style={[s.body, { flex: 1, color: C.ink }]}>{reason.text}</Text>
          </View>
        ))}
      </View>
      <View style={a.nextStep}>
        <Label>The next step</Label>
        <Text style={[s.body, { marginTop: 10, color: C.ink }]}>{d.nextAction}</Text>
      </View>
      <View style={{ marginTop: 24, gap: 12 }}>
        <Button
          label={Platform.OS === 'web' ? 'Copy inspection brief' : 'Share inspection brief'}
          icon="share"
          onPress={() => void m.share()}
        />
        {!m.exclusion && (
          <Button
            label={recovery.label}
            kind="secondary"
            icon={recovery.screen === 'history' ? 'back' : 'camera'}
            onPress={() => {
              m.setView(recovery.view);
              m.setScreen(recovery.screen);
            }}
          />
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
export function Settings({ m }: { m: RelayModel }) {
  return (
    <Fade>
      <Label>Your device. Your record.</Label>
      <Text style={[s.heading, { marginTop: 12 }]}>Connection & privacy</Text>
      <Text style={[s.body, { marginTop: 12 }]}>
        Relay is a pre-event experiment. The mobile app connects to a small vision service on your
        computer.
      </Text>
      <Text style={a.inputLabel}>Analysis service</Text>
      <TextInput
        accessibilityLabel="Analysis service URL"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        value={m.settingsUrl}
        onChangeText={m.setSettingsUrl}
        style={a.input}
      />
      <Text style={[s.small, { marginTop: 8 }]}>
        On a phone, use your computer’s LAN address. Localhost points to the phone itself. Remote
        services require HTTPS.
      </Text>
      <Text style={a.inputLabel}>Session access token</Text>
      <TextInput
        accessibilityLabel="Session access token"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        value={m.settingsToken}
        onChangeText={m.setSettingsToken}
        style={a.input}
        placeholder="Required for a LAN service"
        placeholderTextColor={C.muted}
      />
      <Text style={[s.small, { marginTop: 8 }]}>
        Kept in memory for this session. Never enter a vision provider API key here.
      </Text>
      <View style={{ marginTop: 18 }}>
        <Button
          label="Save and check connection"
          icon="check"
          onPress={() => void m.saveSettings()}
        />
      </View>
      {m.connectionStatus && (
        <View accessibilityLiveRegion="polite" style={{ marginTop: 14 }}>
          <Note>{m.connectionStatus}</Note>
        </View>
      )}
      <View style={[a.rule, { marginTop: 28 }]} />
      <Text style={[s.heading, { fontSize: 28, marginTop: 20 }]}>What happens to your photos</Text>
      <Text style={[s.body, { marginTop: 12 }]}>
        Your experimental draft stays on this device. After 24 hours of inactivity, it is removed
        when the app next opens. Images are resized before analysis. The Relay service strips
        metadata, processes images in memory, and caches a result for up to 10 minutes.
      </Text>
      <Text style={[s.body, { marginTop: 12 }]}>
        Local vision does not send your photographs to a model provider. An external provider needs
        a separate choice before upload. Only use images you are permitted to share.
      </Text>
      <Text style={[s.small, { marginTop: 12 }]}>
        For private photos, use a trusted connection with transport encryption. This experimental
        setup is not a public multi-user service.
      </Text>
      {m.draft && (
        <View style={{ marginTop: 24, gap: 8 }}>
          <Button
            label={m.confirmDelete ? 'Confirm removal of this draft' : 'Remove this device’s draft'}
            kind="secondary"
            icon="close"
            onPress={() => void m.discard()}
          />
          {m.confirmDelete && (
            <>
              <Note>
                This removes the saved draft and retained photos from this app. Copies you shared
                and any provider retention are separate.
              </Note>
              <Button
                label="Keep the draft"
                kind="quiet"
                icon="back"
                onPress={() => m.setConfirmDelete(false)}
              />
            </>
          )}
        </View>
      )}
      {m.error && (
        <View style={{ marginTop: 14 }} accessibilityRole="alert">
          <Note tone="error">{m.error}</Note>
        </View>
      )}
      <View style={[a.rule, { marginTop: 24 }]} />
      <Text style={[s.small, { marginTop: 14 }]}>
        Built for research before Reloaded Labs #01. Organizer approval is still required before
        reusing this work in the event. Working name: Relay.
      </Text>
    </Fade>
  );
}
