import { readBriefs, saveBrief, type SavedBrief } from './briefs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Platform, Share } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Crypto from 'expo-crypto';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Questions,
  type Answer,
  type Category,
  type PhotoEvidence,
  type PhotoView,
} from '../../packages/core/schema';
import {
  currentAnswers,
  decide,
  inspectionBrief,
  categoryLabels,
} from '../../packages/core/policy';
import {
  forgetDraft,
  loadDraft,
  newDraft,
  persistDraft,
  preparePhoto,
  removePhoto,
  removeCaptureCache,
  SETTINGS_KEY,
  type Draft,
  type LocalPhoto,
} from './session';
import { analyzeDraft, serviceHealth, validateServiceUrl, type Connection } from './api';
export type Screen =
  'home' | 'history' | 'capture' | 'evidence' | 'result' | 'settings' | 'records';
export const guide: Record<PhotoView, { title: string; body: string }> = {
  front: {
    title: 'The whole front',
    body: 'Lay the jacket flat. Include both sleeves, the hem and the collar.',
  },
  back: { title: 'Turn it over', body: 'Show the entire back and both sleeves in even light.' },
  label: {
    title: 'Get close to the label',
    body: 'Fill the frame with the brand, size and markings. If it is missing, photograph where it belongs.',
  },
  detail: {
    title: 'The part that needs a look',
    body: 'Show the area and its surrounding seams. A photo cannot establish internal condition.',
  },
};
const message = (e: unknown) =>
  e instanceof Error ? e.message : 'Something interrupted this step. Please try again.';
function provisionalPhotos(photos: LocalPhoto[]): PhotoEvidence[] {
  return photos.map((p) => ({
    id: p.id,
    view: p.view,
    quality: p.quality,
    sha256: '0'.repeat(64),
    byteLength: 1,
  }));
}
export function useRelay() {
  const [savedBriefs, setSavedBriefs] = useState<SavedBrief[]>([]);
  const archiving = useRef(false);
  const [removedPhoto, setRemovedPhoto] = useState<{ draftId: string; photo: LocalPhoto } | null>(
    null,
  );
  useEffect(() => {
    void readBriefs()
      .then(setSavedBriefs)
      .catch(() =>
        setNotice('Saved briefs could not be read. Existing records have been left in place.'),
      );
  }, []);
  const [loaded, setLoaded] = useState(false),
    [screen, setScreen] = useState<Screen>('home'),
    [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [analyzing, setAnalyzing] = useState(false),
    [phase, setPhase] = useState('');
  const [view, setView] = useState<PhotoView>('front'),
    [cameraOpen, setCameraVisible] = useState(false),
    [permission, requestPermission] = useCameraPermissions(),
    [cameraReady, setCameraReady] = useState(false);
  const camera = useRef<CameraView>(null);
  const cameraIntent = useRef(false),
    cameraPermissionPending = useRef(false);
  function setCameraOpen(open: boolean) {
    cameraIntent.current = open;
    setCameraVisible(open && (Platform.OS === 'web' || AppState.currentState === 'active'));
    if (!open) setCameraReady(false);
  }
  useEffect(() => {
    if (screen !== 'capture') setCameraOpen(false);
  }, [screen]);
  const [connection, setConnection] = useState<Connection>({
      url: 'http://127.0.0.1:8787',
      token: '',
    }),
    [settingsUrl, setSettingsUrl] = useState(connection.url),
    [settingsToken, setSettingsToken] = useState(''),
    [connectionStatus, setConnectionStatus] = useState('');
  const [returnScreen, setReturnScreen] = useState<Screen>('home'),
    [consent, setConsent] = useState(false),
    [externalConsent, setExternalConsent] = useState(false),
    [externalProvider, setExternalProvider] = useState<string | null>(null);
  const [editing, setEditing] = useState(false),
    [editCategory, setEditCategory] = useState<Category>('motorcycle_jacket'),
    [editBrand, setEditBrand] = useState(''),
    [editModel, setEditModel] = useState(''),
    [confirmDelete, setConfirmDelete] = useState(false);
  const settingsOperation = useRef(0),
    operation = useRef(0),
    captureSerial = useRef(0),
    activeDraftId = useRef<string | null>(null),
    abort = useRef<AbortController | null>(null);
  const [pendingTarget, setPendingTarget] = useState<string | null>(null),
    [approvedTarget, setApprovedTarget] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const restored = await loadDraft(),
          saved = await AsyncStorage.getItem(SETTINGS_KEY);
        if (!active) return;
        activeDraftId.current = restored.draft?.id ?? null;
        setDraft(restored.draft);
        if (restored.notice) setNotice(restored.notice);
        if (saved) {
          try {
            const url = validateServiceUrl(JSON.parse(saved).url);
            setConnection({ url, token: '' });
            setSettingsUrl(url);
          } catch {}
        }
      } catch {
        if (active) setNotice('A previous draft could not be restored. Start a new assessment.');
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => {
      active = false;
      abort.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (loaded)
      void persistDraft(draft).catch(() =>
        setNotice(
          'This draft could not be saved. Keep the app open until you finish or share the brief.',
        ),
      );
  }, [draft, loaded]);
  useEffect(() => {
    setError('');
  }, [screen]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        // Android permission dialogs temporarily background the activity. Preserve
        // this explicit camera intent until the permission request resolves.
        if (!cameraPermissionPending.current) cameraIntent.current = false;
        setCameraVisible(false);
        setCameraReady(false);
      } else if (cameraIntent.current) {
        setCameraVisible(true);
      }
    });
    return () => sub.remove();
  }, []);
  const back = useCallback(() => {
    if (analyzing) {
      operation.current++;
      abort.current?.abort();
      setAnalyzing(false);
      setPhase('');
      setNotice('Analysis cancelled. Your photographs are still here.');
      return true;
    }
    if (cameraOpen) {
      setCameraOpen(false);
      return true;
    }
    const previous: Partial<Record<Screen, Screen>> = {
      settings: returnScreen,
      capture: 'history',
      evidence: 'capture',
      result: draft?.result ? 'evidence' : 'history',
      history: 'home',
      records: 'home',
    };
    if (previous[screen]) {
      setScreen(previous[screen]!);
      return true;
    }
    return false;
  }, [analyzing, cameraOpen, screen, returnScreen, draft?.result]);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', back);
    return () => sub.remove();
  }, [back]);
  function cancelAnalysis() {
    operation.current++;
    const controller = abort.current;
    abort.current = null;
    controller?.abort();
    setAnalyzing(false);
    setPhase('');
  }
  function patch(change: Partial<Draft>) {
    if (change.photos || change.disclosures || change.corrections) cancelAnalysis();
    setDraft((d) => (d ? { ...d, ...change, updatedAt: new Date().toISOString() } : d));
  }
  function start() {
    setView('front');
    setRemovedPhoto(null);
    cancelAnalysis();
    captureSerial.current++;
    setBusy(false);
    setApprovedTarget(null);
    setPendingTarget(null);
    const next = newDraft();
    activeDraftId.current = next.id;
    setDraft(next);
    setConsent(false);
    setExternalConsent(false);
    setExternalProvider(null);
    setNotice('');
    setScreen('capture');
  }
  function answer(question: (typeof Questions)[number], value: Answer) {
    if (draft)
      patch({
        disclosures: [
          ...draft.disclosures,
          {
            id: Crypto.randomUUID(),
            question,
            answer: value,
            recordedAt: new Date().toISOString(),
          },
        ],
        result: null,
      });
  }
  const answers = currentAnswers(draft?.disclosures ?? []);
  const decision = decide({
    disclosures: draft?.disclosures ?? [],
    photos: draft?.result?.photos ?? provisionalPhotos(draft?.photos ?? []),
    observation: draft?.result?.observation,
    corrections: draft?.corrections ?? [],
  });
  const allAnswered = Questions.every((q) => answers[q] !== undefined),
    exclusion = decision.state === 'not_eligible',
    currentPhoto = draft?.photos.find((p) => p.view === view),
    completeViews = (['front', 'back', 'label'] as const).filter((v) =>
      draft?.photos.some((p) => p.view === v),
    ).length;
  function removeCurrentPhoto() {
    if (!draft || !currentPhoto || busy || analyzing) return;
    captureSerial.current++;
    setRemovedPhoto({ draftId: draft.id, photo: currentPhoto });
    patch({ photos: draft.photos.filter((p) => p.id !== currentPhoto.id), result: null });
    setNotice('');
    // Keep the owned file for Undo. Normal startup cleanup later removes
    // unreferenced files; saved notebook references remain protected.
  }
  function undoPhotoRemoval() {
    if (!draft || !removedPhoto || removedPhoto.draftId !== draft.id || busy || analyzing) return;
    if (!draft.photos.some((p) => p.view === removedPhoto.photo.view)) {
      patch({ photos: [...draft.photos, removedPhoto.photo], result: null });
      setView(removedPhoto.photo.view);
    }
    setRemovedPhoto(null);
  }
  function settings() {
    setReturnScreen(screen);
    setSettingsUrl(connection.url);
    setSettingsToken(connection.token);
    setConnectionStatus('');
    setScreen('settings');
  }
  async function addPhoto(uri: string, width: number, height: number) {
    if (!draft || activeDraftId.current !== draft.id) {
      await removeCaptureCache(uri).catch(() => undefined);
      return;
    }
    const draftId = draft.id,
      serial = ++captureSerial.current;
    setBusy(true);
    setError('');
    try {
      const photo = await preparePhoto(uri, view, width, height);
      if (activeDraftId.current !== draftId || captureSerial.current !== serial) {
        await removePhoto(photo);
        return;
      }
      const previous = draft.photos.find((p) => p.view === view),
        photos = [...draft.photos.filter((p) => p.view !== view), photo];
      setRemovedPhoto(null);
      patch({ photos, result: null });
      if (previous) void removePhoto(previous).catch(() => undefined);
      // Keep the photograph just captured visible; the rider chooses the next view.
      setNotice(
        photo.quality.warnings.some((w) => ['dark', 'bright', 'low_resolution'].includes(w))
          ? 'That photograph may need replacing. Check the guidance below its thumbnail.'
          : '',
      );
      setCameraOpen(false);
    } catch (e) {
      if (captureSerial.current === serial) setError(message(e));
    } finally {
      if (captureSerial.current === serial) setBusy(false);
    }
  }
  async function chooseImage() {
    if (busy) return;
    setError('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
        exif: false,
      });
      if (!result.canceled && result.assets[0]) {
        const p = result.assets[0];
        await addPhoto(p.uri, p.width, p.height);
      }
    } catch (e) {
      setError('The photograph could not be opened. ' + message(e));
    }
  }
  async function openCamera() {
    setError('');
    setCameraReady(false);
    setCameraOpen(true);
    if (!permission?.granted) {
      cameraPermissionPending.current = true;
      try {
        await requestPermission();
      } catch {
        setError('Camera access could not be requested. Choose an existing photograph.');
      } finally {
        cameraPermissionPending.current = false;
        if (cameraIntent.current) setCameraOpen(true);
      }
    }
  }
  async function takePhoto() {
    if (!camera.current || !cameraReady || busy) return;
    const expectedDraftId = activeDraftId.current;
    const expectedSerial = captureSerial.current;
    setBusy(true);
    try {
      const p = await camera.current.takePictureAsync({
        quality: 0.9,
        exif: false,
        skipProcessing: false,
      });
      if (!p) throw new Error('No photograph was captured.');
      await addPhoto(p.uri, p.width, p.height);
    } catch (e) {
      if (activeDraftId.current === expectedDraftId && captureSerial.current === expectedSerial) {
        setError(message(e));
      }
    } finally {
      // addPhoto owns its newer processing state; a discarded camera request must not clear it.
      if (activeDraftId.current === expectedDraftId && captureSerial.current === expectedSerial) {
        setBusy(false);
      }
    }
  }
  async function analyze() {
    if (!draft || !consent || analyzing || busy) return;
    const generation = ++operation.current;
    setError('');
    setAnalyzing(true);
    setPhase('Connecting to the analysis service');
    const controller = new AbortController();
    abort.current = controller;
    const timer = setTimeout(() => controller.abort(), 70_000);
    try {
      const health = await serviceHealth(connection, controller.signal);
      if (generation !== operation.current) return;
      const target = JSON.stringify([connection.url, health.provider, health.model]);
      if (health.externalProvider && (!externalConsent || approvedTarget !== target)) {
        setExternalConsent(false);
        setApprovedTarget(null);
        setPendingTarget(target);
        setExternalProvider(health.provider);
        setError(
          'This service uses ' +
            health.provider +
            '. Review the additional image-sharing choice below.',
        );
        return;
      }
      setPhase(
        health.coverage === 'category_only'
          ? 'Identifying the type of gear'
          : 'Inspecting surfaces, seams and wear',
      );
      const result = await analyzeDraft(
        draft,
        connection,
        externalConsent,
        controller.signal,
        health,
      );
      if (generation !== operation.current) return;
      patch({ result });
      setScreen(result.observation ? 'evidence' : 'result');
    } catch (e) {
      if (generation === operation.current)
        setError(
          e instanceof Error && e.name === 'AbortError'
            ? 'Analysis timed out. No completed assessment was received. Your photographs are still here.'
            : message(e),
        );
    } finally {
      clearTimeout(timer);
      if (generation === operation.current) {
        setAnalyzing(false);
        setPhase('');
      }
      if (abort.current === controller) abort.current = null;
    }
  }
  async function share() {
    if (!draft) return;
    const text = inspectionBrief({
      id: draft.id,
      disclosures: draft.disclosures,
      photos: draft.result?.photos ?? [],
      observation: draft.result?.observation ?? null,
      corrections: draft.corrections,
    });
    try {
      if (Platform.OS === 'web') {
        await Clipboard.setStringAsync(text);
        setNotice('Inspection brief copied. It includes sources, unknowns and the next step.');
      } else await Share.share({ message: text, title: 'Relay inspection brief' });
    } catch {
      setError('The brief could not be shared. Please try again.');
    }
  }
  async function archiveAndNext() {
    if (!draft || archiving.current || (!draft.result && !exclusion)) return;
    archiving.current = true;
    setBusy(true);
    setError('');
    try {
      const text = inspectionBrief({
        id: draft.id,
        disclosures: draft.disclosures,
        photos: draft.result?.photos ?? [],
        observation: draft.result?.observation ?? null,
        corrections: draft.corrections,
      });
      const updated = await saveBrief({
        id: draft.id,
        savedAt: new Date().toISOString(),
        title: decision.title,
        category: categoryLabels[draft.result?.observation?.category ?? 'unknown'],
        text,
        photos: draft.photos,
      });
      setSavedBriefs(updated);
      start();
      setNotice('Brief and photographs saved in your notebook. Ready for the next item.');
    } catch (e) {
      setError(message(e));
    } finally {
      archiving.current = false;
      setBusy(false);
    }
  }
  async function saveSettings() {
    const generation = ++settingsOperation.current;
    cancelAnalysis();
    try {
      const url = validateServiceUrl(settingsUrl.trim()),
        next = { url, token: settingsToken.trim() };
      setConnectionStatus('Checking connection…');
      const health = await serviceHealth(next);
      if (generation !== settingsOperation.current) return;
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ url }));
      setConnection(next);
      setExternalConsent(false);
      setApprovedTarget(null);
      setPendingTarget(JSON.stringify([url, health.provider, health.model]));
      setExternalProvider(health.externalProvider ? health.provider : null);
      setConnectionStatus('Connected · ' + health.provider + ' · ' + health.model);
    } catch (e) {
      if (generation === settingsOperation.current) setConnectionStatus(message(e));
    }
  }
  function saveCorrections() {
    if (!draft) return;
    const recordedAt = new Date().toISOString(),
      additions = [
        { field: 'category' as const, value: editCategory, recordedAt },
        ...(editBrand.trim()
          ? [{ field: 'brand' as const, value: editBrand.trim(), recordedAt }]
          : []),
        ...(editModel.trim()
          ? [{ field: 'model' as const, value: editModel.trim(), recordedAt }]
          : []),
      ];
    patch({ corrections: [...draft.corrections, ...additions].slice(-30) });
    setEditing(false);
    setNotice('Your correction is kept alongside the original observation for specialist review.');
  }
  async function discard() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      cancelAnalysis();
      captureSerial.current++;
      activeDraftId.current = null;
      setBusy(false);
      await forgetDraft(draft);
      setDraft(null);
      setConsent(false);
      setConfirmDelete(false);
      setScreen('home');
      setNotice('This device’s draft and retained photographs have been removed.');
    } catch {
      activeDraftId.current = draft?.id ?? null;
      setError('Some local files could not be removed. Please try again.');
    }
  }
  function toggleExternalConsent() {
    cancelAnalysis();
    const approved = !externalConsent;
    setExternalConsent(approved);
    setApprovedTarget(approved ? pendingTarget : null);
  }
  return {
    removedPhoto,
    removeCurrentPhoto,
    undoPhotoRemoval,
    savedBriefs,
    setSavedBriefs,
    archiveAndNext,
    toggleExternalConsent,
    loaded,
    screen,
    setScreen,
    draft,
    notice,
    setNotice,
    error,
    setError,
    busy,
    analyzing,
    phase,
    view,
    setView,
    cameraOpen,
    setCameraOpen,
    permission,
    requestPermission,
    camera,
    cameraReady,
    setCameraReady,
    connection,
    settingsUrl,
    setSettingsUrl,
    settingsToken,
    setSettingsToken,
    connectionStatus,
    consent,
    setConsent,
    externalConsent,
    setExternalConsent,
    externalProvider,
    editing,
    setEditing,
    editCategory,
    setEditCategory,
    editBrand,
    setEditBrand,
    editModel,
    setEditModel,
    confirmDelete,
    setConfirmDelete,
    back,
    start,
    answer,
    answers,
    decision,
    allAnswered,
    exclusion,
    currentPhoto,
    completeViews,
    settings,
    chooseImage,
    openCamera,
    takePhoto,
    analyze,
    share,
    saveSettings,
    saveCorrections,
    discard,
  };
}
export type RelayModel = ReturnType<typeof useRelay>;
