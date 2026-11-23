import { Notebook } from './src/notebook';
import { CaptureFooter } from './src/capture-footer';
import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { DMSans_400Regular } from '@expo-google-fonts/dm-sans/400Regular';
import { DMSans_500Medium } from '@expo-google-fonts/dm-sans/500Medium';
import { DMSans_600SemiBold } from '@expo-google-fonts/dm-sans/600SemiBold';
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif/400Regular';
import { CameraView } from 'expo-camera';
import { C, F, Icon, RelayMark, JacketArt, Button, Note, s, useReducedMotion } from './src/design';
import { a } from './src/styles';
import { guide, useRelay } from './src/useRelay';
import { Home, History, Capture } from './src/screens-intake';
import { Evidence, Result, Settings } from './src/screens-review';
function RelayApp() {
  const m = useRelay(),
    scroll = useRef<ScrollView>(null),
    reducedMotion = useReducedMotion();
  const [fontsLoaded, fontError] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    InstrumentSerif_400Regular,
  });
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [m.screen]);
  if (!m.loaded || (!fontsLoaded && !fontError))
    return (
      <SafeAreaView style={a.safe}>
        <View style={a.loading}>
          <RelayMark size={40} />
          <ActivityIndicator color={C.orange} />
          <Text style={s.small}>Opening your gear notebook</Text>
        </View>
      </SafeAreaView>
    );
  const titles = {
    home: '',
    history: 'Your gear’s story',
    capture: 'The photo record',
    evidence: 'Photo inspection',
    result: 'Inspection brief',
    settings: 'Connection & privacy',
    records: 'Your notebook',
  };
  return (
    <SafeAreaView style={a.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={a.frame}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={a.header}>
          {m.screen === 'home' ? (
            <View style={a.brand}>
              <RelayMark size={30} />
              <Text style={a.wordmark}>relay</Text>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              onPress={m.back}
              style={a.iconButton}
            >
              <Icon name="back" />
            </Pressable>
          )}
          {m.screen !== 'home' && <Text style={a.headerTitle}>{titles[m.screen]}</Text>}
          {m.screen === 'settings' ? (
            <View style={a.iconButton} />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                m.isOnDevice ? 'Offline and privacy settings' : 'Connection and privacy settings'
              }
              onPress={m.settings}
              style={a.iconButton}
              disabled={m.analyzing}
            >
              <Icon name="settings" />
            </Pressable>
          )}
        </View>
        <ScrollView
          ref={scroll}
          style={{ flex: 1 }}
          contentContainerStyle={a.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {m.notice ? (
            <View accessibilityLiveRegion="polite" style={{ marginBottom: 16 }}>
              <Note>{m.notice}</Note>
            </View>
          ) : null}
          {m.screen === 'home' ? (
            <Home m={m} />
          ) : m.screen === 'history' ? (
            <History m={m} />
          ) : m.screen === 'capture' ? (
            <Capture m={m} />
          ) : m.screen === 'evidence' ? (
            <Evidence m={m} />
          ) : m.screen === 'result' ? (
            <Result m={m} />
          ) : m.screen === 'records' ? (
            <Notebook m={m} />
          ) : (
            <Settings m={m} />
          )}
        </ScrollView>
        {m.screen === 'capture' && <CaptureFooter m={m} />}
      </KeyboardAvoidingView>
      <Modal
        visible={m.cameraOpen}
        animationType={reducedMotion ? 'none' : 'fade'}
        onRequestClose={() => m.setCameraOpen(false)}
      >
        <SafeAreaView style={a.cameraScreen}>
          <StatusBar style="light" />
          <View style={a.cameraHeader}>
            <Text style={[a.headerTitle, { color: C.paper }]}>{guide[m.view].title}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close camera"
              style={a.iconButton}
              onPress={() => m.setCameraOpen(false)}
            >
              <Icon name="close" color={C.paper} />
            </Pressable>
          </View>
          {m.permission?.granted ? (
            <View style={a.cameraPreview}>
              <CameraView
                ref={m.camera}
                style={StyleSheet.absoluteFill}
                facing="back"
                onCameraReady={() => m.setCameraReady(true)}
                onMountError={() =>
                  m.setError(
                    'The camera could not start. Choose a photograph or reopen the camera.',
                  )
                }
              >
                <View pointerEvents="none" style={a.cameraOverlay}>
                  {m.view === 'front' || m.view === 'back' ? (
                    <JacketArt back={m.view === 'back'} ghost />
                  ) : (
                    <View style={a.labelFrame} />
                  )}
                </View>
              </CameraView>
            </View>
          ) : (
            <View style={a.cameraDenied}>
              <Icon name="camera" size={42} color={C.paper} />
              <Text style={[s.heading, { color: C.paper, textAlign: 'center' }]}>
                Your camera,{'\n'}when you’re ready.
              </Text>
              <Text style={[s.body, { color: '#C4CBBF', textAlign: 'center' }]}>
                Allow camera access to photograph your gear, or choose a photo you already have.
              </Text>
              <Button
                label={m.permission?.canAskAgain ? 'Allow camera access' : 'Open device settings'}
                icon="camera"
                onPress={() => {
                  if (m.permission?.canAskAgain) void m.requestPermission();
                  else if (Platform.OS === 'web')
                    m.setError(
                      'Allow camera access in your browser’s site settings, then reopen the camera.',
                    );
                  else void Linking.openSettings();
                }}
              />
            </View>
          )}
          <View style={a.cameraControls}>
            <Text style={[s.small, { color: '#D4D5C9', textAlign: 'center', marginBottom: 20 }]}>
              {guide[m.view].body}
            </Text>
            {m.error && (
              <Text
                accessibilityRole="alert"
                style={[s.small, { color: '#F3C4AF', textAlign: 'center', marginBottom: 16 }]}
              >
                {m.error}
              </Text>
            )}
            {m.permission?.granted && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Capture photograph"
                accessibilityState={{ disabled: !m.cameraReady || m.busy }}
                disabled={!m.cameraReady || m.busy}
                onPress={() => void m.takePhoto()}
                style={[a.shutter, (!m.cameraReady || m.busy) && { opacity: 0.4 }]}
              >
                {m.busy ? <ActivityIndicator color={C.ink} /> : <View style={a.shutterInner} />}
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose a photograph instead"
              onPress={() => void m.chooseImage()}
              disabled={m.busy}
              style={{
                minHeight: 48,
                justifyContent: 'center',
                alignItems: 'center',
                marginTop: 16,
              }}
            >
              <Text style={[s.small, { color: C.paper, fontFamily: F.bold }]}>
                Choose a photograph instead
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <RelayApp />
    </SafeAreaProvider>
  );
}
