import React, { useState } from 'react';
import { Image, Platform, Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Button, C, Fade, F, Icon, Note, s } from './design';
import { removeBrief } from './briefs';
import { allDraftPhotos, removePhoto } from './session';
import type { RelayModel } from './useRelay';
export function Notebook({ m }: { m: RelayModel }) {
  const [confirm, setConfirm] = useState<string | null>(null),
    [error, setError] = useState('');
  return (
    <Fade>
      <Text style={s.title}>Your notebook.</Text>
      <Text style={[s.body, { marginTop: 12, marginBottom: 24 }]}>
        Saved inspection briefs and their photographs. Kept on this device for your next
        conversation.
      </Text>
      {!m.savedBriefs.length && (
        <Note>No saved briefs yet. Finish a gear check to save its inspection record.</Note>
      )}
      {m.savedBriefs.map((brief) => (
        <View
          key={brief.id}
          style={{
            padding: 20,
            borderRadius: 20,
            backgroundColor: C.white,
            borderWidth: 1,
            borderColor: C.line,
            marginBottom: 14,
          }}
        >
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <Icon name="file" size={18} color={C.forest} />
            <Text style={s.small}>
              {new Date(brief.savedAt).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}{' '}
              · {brief.category}
            </Text>
          </View>
          <Text style={{ fontFamily: F.bold, fontSize: 20, lineHeight: 26, color: C.ink }}>
            {brief.title}
          </Text>
          {brief.photos.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
              {brief.photos.map((p, i) => {
                const prior = brief.replacedOverviews?.find((e) => e.photoId === p.id);
                const image = (
                  <Image
                    key={p.id}
                    source={{ uri: p.uri }}
                    resizeMode="contain"
                    style={{ width: 64, height: 76, borderRadius: 8, backgroundColor: C.wash }}
                    accessibilityLabel={
                      prior
                        ? 'Superseded ' + prior.view + ' photograph'
                        : 'Saved inspection photograph ' + (i + 1)
                    }
                  />
                );
                return prior ? (
                  <View key={p.id} style={{ width: 80 }}>
                    {image}
                    <Text style={s.small}>Earlier {prior.view}</Text>
                  </View>
                ) : (
                  image
                );
              })}
            </View>
          )}
          <Button
            label={Platform.OS === 'web' ? 'Copy saved brief' : 'Share saved brief'}
            kind="quiet"
            icon="share"
            onPress={() => {
              void (async () => {
                try {
                  if (Platform.OS === 'web') {
                    await Clipboard.setStringAsync(brief.text);
                    m.setNotice('Saved inspection brief copied.');
                  } else
                    await Share.share({ message: brief.text, title: 'Relay inspection brief' });
                } catch {
                  setError('The brief could not be shared. Please try again.');
                }
              })();
            }}
          />
          {confirm === brief.id ? (
            <>
              <Note tone="error">
                Permanently remove this saved brief and the photographs retained only by this
                record? This cannot be undone.
              </Note>
              <Button
                label="Confirm permanent removal"
                kind="quiet"
                icon="close"
                onPress={() => {
                  void (async () => {
                    try {
                      const next = await removeBrief(brief.id);
                      m.setSavedBriefs(next);
                      for (const p of brief.photos)
                        if (!(
                          m.draft &&
                          allDraftPhotos(m.draft).some((current) => current.uri === p.uri)
                        ))
                          await removePhoto(p);
                      setConfirm(null);
                    } catch {
                      setError('Some saved data could not be removed. Please try again.');
                    }
                  })();
                }}
              />
              <Button
                label="Keep saved brief"
                kind="quiet"
                icon={null}
                onPress={() => setConfirm(null)}
              />
            </>
          ) : (
            <Button
              label="Remove saved brief"
              kind="quiet"
              icon={null}
              onPress={() => setConfirm(brief.id)}
            />
          )}
        </View>
      ))}
      {error && <Note tone="error">{error}</Note>}
      <Text style={s.small}>
        This notebook stays on this device. Copy or share important briefs to your business records.
      </Text>
    </Fade>
  );
}
