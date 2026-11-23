import * as React from 'react';
import { Image, Text, View, StyleSheet, Pressable } from 'react-native';
import * as Picker from 'expo-image-picker';
import { Button, C, F } from '../design';
import { desk, origin, type DeskRecord } from './api';
import { prepareRegion } from './prepare-region';
import { EvidenceViewer } from './photo-viewer';
import type { ViewSource } from './viewer-entries';
export function RequestedPhoto({
  id,
  scenario,
  prompt,
  inspection,
  done,
}: {
  id: string;
  scenario: string;
  prompt: string;
  inspection: string;
  done: () => void;
}) {
  const [error, setError] = React.useState(''),
    [busy, setBusy] = React.useState(false);
  const lock = React.useRef(false);
  const choose = async (camera: boolean) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (camera && !(await Picker.requestCameraPermissionsAsync()).granted)
        throw Error('Allow camera access or choose a saved photo.');
      const get = camera ? Picker.launchCameraAsync : Picker.launchImageLibraryAsync;
      const r = await get({
        mediaTypes: ['images'],
        quality: 1,
        exif: false,
        allowsEditing: false,
      });
      if (r.canceled) return;
      const photo = r.assets[0];
      if (!photo || photo.width * photo.height > 50000000)
        throw Error('Choose a photograph under 50 megapixels.');
      const { base64 } = await prepareRegion(photo.uri, [0, 0, 1, 1]);
      await desk('/v4/items/' + id + '/requested-photo', { scenario, inspection, base64 });
      done();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not attach that photograph.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <View style={s.card}>
      <Text style={s.heading}>Requested photo</Text>
      <Text style={s.body}>{prompt}</Text>
      <Button
        label={busy ? 'Saving photograph…' : 'Take requested photo'}
        disabled={busy}
        icon="camera"
        onPress={() => void choose(true)}
      />
      <Button
        label="Choose requested photo"
        kind="secondary"
        disabled={busy}
        icon="image"
        onPress={() => void choose(false)}
      />
      {!!error && <Text style={s.error}>{error}</Text>}
    </View>
  );
}
export function SubmittedPhotos({
  record,
  scenario,
}: {
  record: DeskRecord['value'];
  scenario: string;
}) {
  const id = record.id,
    [photos, setPhotos] = React.useState<
      { photo: string; request: string; width: number; height: number }[]
    >([]),
    [error, setError] = React.useState(''),
    [selected, setSelected] = React.useState('');
  React.useEffect(() => {
    let live = true;
    setSelected('');
    setPhotos([]);
    setError('');
    desk<{ items: typeof photos }>('/v4/items/' + id + '/requested-photos?scenario=' + scenario)
      .then((r) => {
        if (live) setPhotos(r.items);
      })
      .catch(() => {
        if (live) setError('The requested photographs could not be loaded.');
      });
    return () => {
      live = false;
    };
  }, [id, scenario]);
  const gallery = React.useMemo<ViewSource[]>(
    () =>
      photos.map((p) => ({
        key: 'follow:' + p.photo,
        triggerPhoto: p.photo,
        photo: {
          id: p.photo,
          hash: p.photo,
          role: 'requested_photo',
          attachment: 'submitted',
          width: p.width,
          height: p.height,
          regions: [],
        },
        box: null,
        crop: null,
        cropWidth: p.width,
        cropHeight: p.height,
        kind: 'Rider follow-up',
        location: 'Signed attachment to this request',
        finding: p.request,
        group: 'evidence',
        initialFull: true,
        wholeUri:
          origin + '/v4/items/' + id + '/requested-photos/' + p.photo + '?scenario=' + scenario,
      })),
    [photos, id, scenario],
  );
  if (!photos.length && !error) return null;
  return (
    <View style={s.card}>
      <Text style={s.heading}>Photos from the rider</Text>
      {error ? (
        <Text style={s.error}>{error}</Text>
      ) : (
        gallery.map((g, i) => (
          <View key={g.key} style={{ gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={'Enlarge rider follow-up ' + (i + 1)}
              onPress={() => setSelected(g.triggerPhoto)}
              style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
            >
              <Image
                source={{ uri: g.wholeUri }}
                style={{
                  width: '100%',
                  height: 185,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: C.line,
                }}
                resizeMode="contain"
                accessibilityLabel="Photo received for this request"
              />
            </Pressable>
            <Text style={s.body}>{g.finding}</Text>
          </View>
        ))
      )}
      {selected && (
        <EvidenceViewer
          item={record}
          additional={gallery}
          photo={selected}
          close={() => setSelected('')}
        />
      )}
    </View>
  );
}
const s = StyleSheet.create({
  card: {
    padding: 14,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 12,
    backgroundColor: C.paper,
    gap: 9,
  },
  heading: { fontFamily: F.serif, fontSize: 23, color: C.ink },
  body: { fontFamily: F.body, fontSize: 14, lineHeight: 20, color: C.ink },
  error: { color: C.red, fontFamily: F.medium },
});
