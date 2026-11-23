import { mergeTransitions, preserveExclusions } from '../../packages/core/v2/replacement';
import { historicalReason, withHistoricalAreas } from '../../packages/core/v2/historical-areas';
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
  persistDraftWithCleanup,
  photoBase64,
  preparePhoto,
  allDraftPhotos,
  retainedReceipts,
  replacementNotes,
  changePhoto,
  retainFinding,
  rememberedExclusion,
  historicReceipts,
  removePhoto,
  removeCaptureCache,
  SETTINGS_KEY,
  type Draft,
  type LocalPhoto,
} from './session';
import {
  analyzeDraft,
  clearAnalysisMemory,
  serviceHealth,
  validateServiceUrl,
  isOnDevice,
  type Connection,
} from './api';
import {
  assessWithCount as assessV2,
  scorePhoto,
  serviceHealthV2,
  ServiceError,
  type HealthV2,
} from './api-v2';
import { briefV2, categoryLabels2, replacementBriefLines } from './brief-v2';
/** Which engine the connected service runs. Unknown until the service has been asked. */
type Engine = { kind: 'v1' } | { kind: 'v2'; health: HealthV2 };
type V2Photo = NonNullable<LocalPhoto['v2']>;
function currentRecord(photo: LocalPhoto, health: HealthV2) {
  const record = photo.v2;
  return record?.signed.scores.batteryVersion === health.batteryVersion &&
    record.scoreContext === health.scoreContext
    ? record
    : undefined;
}
/** React Native's AbortSignal has no timeout() on every engine; this works everywhere. */
function deadline(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}
const EXTERNAL_SCORERS = ['decisions', 'verbal'];
/** Retries for a photograph checked in the background that failed for a passing reason. */
const BACKGROUND_RETRY_MS = [5_000, 20_000];
export type Screen =
  'home' | 'history' | 'capture' | 'evidence' | 'result' | 'settings' | 'records';
export const guide: Record<PhotoView, { title: string; body: string }> = {
  front: {
    title: 'The whole front',
    // Item-neutral since 2026-11-18: the tip used to say "Lay the jacket flat" for boots, gloves and
    // helmets too. E19 (experiment report): 29 of 32 photographs of gear being worn, and every scene, are
    // asked for a retake, so the tip says so before the photograph is taken.
    body: 'Lay the item flat or hang it up, not while wearing it, with nothing else in the frame. Show all of it: for a jacket, both sleeves, the hem and the collar.',
  },
  back: {
    title: 'Turn it over',
    body: 'Show the entire back in even light, with nothing else in the frame.',
  },
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
  const [removedPhoto, setRemovedPhoto] = useState<{
    draftId: string;
    photo: LocalPhoto;
  } | null>(null);
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
  const retiredPhotos = useRef(new Set<string>());
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
  const [connection, setConnection] = useState<Connection>(() => ({
      url: isOnDevice
        ? 'local://relay-device'
        : validateServiceUrl(process.env.EXPO_PUBLIC_RELAY_API_URL || 'http://127.0.0.1:8788'),
      token: '',
    })),
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
  // Backend v2 (work package 11): photographs are checked as they are taken, once the rider has
  // allowed processing; the decision is asked for when the rider wants the result.
  const [engine, setEngine] = useState<Engine | null>(null),
    [scoringIds, setScoringIds] = useState<string[]>([]);
  const scoring = useRef(new Map<string, Promise<V2Photo>>()),
    draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;
  // Read by timers and background work, which must never act on a choice the rider has withdrawn.
  const live = useRef({ consent, externalConsent, connection });
  live.current = { consent, externalConsent, connection };
  const photoKey = draft?.photos.map((p) => p.id).join(',') ?? '';
  useEffect(() => {
    if (!consent || isOnDevice || !photoKey) return;
    const controller = new AbortController();
    void (async () => {
      try {
        if (!engine) {
          const found = await detectEngine(connection, controller.signal);
          if (!controller.signal.aborted) setEngine(found); // the effect runs again with it
        } else if (engine.kind === 'v2') scoreInBackground(engine.health);
      } catch {
        // Not reachable now. "Review the evidence" asks again and reports the problem.
      }
    })();
    return () => controller.abort();
  }, [consent, externalConsent, engine, connection, photoKey]);
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
      void persistDraftWithCleanup(draft, retiredPhotos.current, () => draftRef.current).catch(() =>
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
      // v2 has no separate evidence screen: back from its result returns to the photographs.
      result: draft?.result ? 'evidence' : draft?.decision2 ? 'capture' : 'history',
      history: 'home',
      records: 'home',
    };
    if (previous[screen]) {
      setScreen(previous[screen]!);
      return true;
    }
    return false;
  }, [analyzing, cameraOpen, screen, returnScreen, draft?.result, draft?.decision2]);
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
    // A v2 decision belongs to exactly the photographs and answers it was made from.
    const stale = (change.photos || change.disclosures) && !('decision2' in change);
    setDraft((d) =>
      d
        ? {
            ...d,
            ...change,
            ...(stale ? { decision2: null } : {}),
            updatedAt: new Date().toISOString(),
          }
        : d,
    );
  }
  /** Attach a v2 record to one photograph without touching anything else (no cancellation: a record
   * arriving for a photograph is not a change the rider made). */
  function attachScore(draftId: string, photoId: string, record: V2Photo) {
    setDraft((d) =>
      d && d.id === draftId
        ? {
            ...d,
            photos: d.photos.map((p) => (p.id === photoId ? { ...p, v2: record } : p)),
            replacedOverviews: d.replacedOverviews?.flatMap((e) => {
              if (e.photo.id !== photoId) return [e];
              if (record.retainOnReplacement === false && !e.photo.finding && !e.legacyAssessment)
                return [];
              return [{ ...e, photo: { ...e.photo, v2: record }, status: undefined }];
            }),
            updatedAt: new Date().toISOString(),
          }
        : d,
    );
  }
  async function detectEngine(c: Connection, signal: AbortSignal): Promise<Engine> {
    if (isOnDevice) return { kind: 'v1' };
    const health = await serviceHealthV2(c, signal);
    return health ? { kind: 'v2', health } : { kind: 'v1' };
  }
  /** Check one photograph with the v2 service. Concurrent requests for the same photograph share one
   * request, so a check started in the background is reused when the rider asks for the result. */
  function scoreOne(
    photo: LocalPhoto,
    draftId: string,
    c: Connection,
    external: boolean,
    health: HealthV2,
    signal?: AbortSignal,
  ): Promise<V2Photo> {
    const key = JSON.stringify([draftId, photo.id, c.url, health.scoreContext]);
    const running = scoring.current.get(key);
    if (running) return running;
    const job = (async () => {
      setScoringIds((ids) => [...ids, photo.id]);
      const timeout = deadline(130_000),
        onAbort = () => timeout.clear();
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const result = await scorePhoto(
          c,
          {
            assessmentId: draftId,
            photoId: photo.id,
            view: photo.view,
            base64: await photoBase64(photo),
            consent: { externalProvider: external },
          },
          signal ?? timeout.signal,
        );
        const record: V2Photo = {
          record: result.photo,
          scoreContext: health.scoreContext,
          signed: result.signed,
          feedback: result.feedback,
          retainOnReplacement: result.retainOnReplacement,
        };
        if (
          activeDraftId.current === draftId &&
          live.current.connection.url === c.url &&
          live.current.connection.token === c.token
        )
          attachScore(draftId, photo.id, record);
        return record;
      } finally {
        timeout.clear();
        signal?.removeEventListener('abort', onAbort);
        scoring.current.delete(key);
        setScoringIds((ids) => ids.filter((id) => id !== photo.id));
      }
    })();
    scoring.current.set(key, job);
    return job;
  }
  /** Check, in the background, every photograph of the current draft that has no current record. */
  function scoreInBackground(health: HealthV2, attempt = 0) {
    const d = draftRef.current,
      now = live.current;
    if (!d || !now.consent || (health.externalProcessing && !now.externalConsent)) return;
    for (const p of d.photos) {
      if (currentRecord(p, health)) continue;
      void scoreOne(p, d.id, now.connection, now.externalConsent, health).catch((e) => {
        // A busy or unreachable service is retried; anything else waits for "Review the evidence".
        if (e instanceof ServiceError && e.retryable && attempt < BACKGROUND_RETRY_MS.length)
          setTimeout(() => {
            if (activeDraftId.current === d.id) scoreInBackground(health, attempt + 1);
          }, BACKGROUND_RETRY_MS[attempt]);
      });
    }
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
    currentPhoto = draft?.photos.find((p) => p.view === view && !p.fromOverview),
    completeViews = (['front', 'back', 'label'] as const).filter((v) =>
      draft?.photos.some((p) => p.view === v),
    ).length;
  function changeCapturedPhoto(old: LocalPhoto | undefined, next: LocalPhoto | null) {
    if (!draft) return;
    const draftId = draft.id,
      pending =
        !!old &&
        [...scoring.current.keys()].some((k) => {
          const [owner, id] = JSON.parse(k);
          return owner === draftId && id === old.id;
        });
    cancelAnalysis();
    setDraft((cur) => {
      if (!cur || cur.id !== draftId) return cur;
      const prior = old && cur.photos.find((p) => p.id === old.id);
      const restore = next && cur.replacedOverviews?.find((e) => e.photo.id === next.id)?.photo;
      return changePhoto(cur, prior, restore ?? next, pending);
    });
  }
  function removeCurrentPhoto() {
    if (!draft || !currentPhoto || busy || analyzing) return;
    captureSerial.current++;
    setRemovedPhoto({ draftId: draft.id, photo: currentPhoto });
    changeCapturedPhoto(currentPhoto, null);
    setNotice('');
    // Keep the owned file for Undo. Normal startup cleanup later removes
    // unreferenced files; saved notebook references remain protected.
  }
  function undoPhotoRemoval() {
    if (!draft || !removedPhoto || removedPhoto.draftId !== draft.id || busy || analyzing) return;
    if (!draft.photos.some((p) => p.view === removedPhoto.photo.view && !p.fromOverview)) {
      changeCapturedPhoto(undefined, removedPhoto.photo);
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
      const photo = await preparePhoto(
        uri,
        view,
        width,
        height,
        !isOnDevice && (view === 'front' || view === 'back'),
      );
      if (activeDraftId.current !== draftId || captureSerial.current !== serial) {
        await removePhoto(photo);
        return;
      }
      const livePhotos = draftRef.current?.photos ?? draft.photos;
      const previous = livePhotos.find((p) => p.view === view && !p.fromOverview);
      setRemovedPhoto(null);
      changeCapturedPhoto(previous, photo);
      if (previous) retiredPhotos.current.add(previous.uri);
      // Keep the photograph just captured visible; the rider chooses the next view.
      setNotice(
        photo.quality.warnings.some((w) => ['dark', 'bright', 'low_resolution'].includes(w))
          ? 'That photograph may need replacing. Check the guidance below its thumbnail.'
          : '',
      );
      setCameraOpen(false);
    } catch (e) {
      await removeCaptureCache(uri).catch(() => undefined);
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
    setNotice((current) =>
      current === 'Analysis cancelled. Your photographs are still here.' ? '' : current,
    );
    setAnalyzing(true);
    setPhase(isOnDevice ? 'Preparing the offline engine' : 'Connecting to the analysis service');
    const controller = new AbortController();
    abort.current = controller;
    let timer = setTimeout(
      () => controller.abort(),
      isOnDevice ? Math.min(600_000, 180_000 * (draft.photos.length + 1)) : 70_000,
    );
    try {
      const found = await detectEngine(connection, controller.signal);
      if (generation !== operation.current) return;
      setEngine(found);
      if (found.kind === 'v2') {
        // Photographs still to check get time of their own: a local model takes several seconds each.
        const pending = draft.photos.filter((p) => !p.v2).length;
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(), 60_000 + 30_000 * pending);
        await analyzeV2(found.health, generation, controller.signal);
        return;
      }
      const earlier = rememberedExclusion(draft, []);
      if (earlier) {
        patch({ result: null, decision2: earlier });
        setScreen('result');
        return;
      }
      if (draft.historicalAreas?.length)
        throw new Error(
          'This check contains earlier photo evidence. Connect to the Relay assessment service to include it in the result.',
        );
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
        (phase) => {
          if (generation === operation.current) setPhase(phase);
        },
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
  /** v2 result: check any photograph without a current record, then ask the service for the decision.
   * The service applies the calibrated thresholds; safetyFloor() in assess() refuses any decision the
   * device can prove wrong (a reported exclusion that is not "no offer", an offer without a record
   * for every photograph, one picture used for two views). */
  async function analyzeV2(health: HealthV2, generation: number, signal: AbortSignal) {
    const d0 = draftRef.current;
    if (!d0) return;
    if (health.externalProcessing) {
      // The same separate choice as v1: never upload to an outside provider without it.
      const target = JSON.stringify([
        connection.url,
        'v2',
        health.scorers.map((s) => s.id + ':' + s.model),
      ]);
      if (!externalConsent || approvedTarget !== target) {
        const names =
          health.scorers
            .filter((s) => EXTERNAL_SCORERS.includes(s.id))
            .map((s) => s.model)
            .join(', ') || 'an external provider';
        setExternalConsent(false);
        setApprovedTarget(null);
        setPendingTarget(target);
        setExternalProvider(names);
        setError(
          'This service sends photos to ' +
            names +
            '. Review the additional image-sharing choice below.',
        );
        return;
      }
    }
    const records = new Map<string, V2Photo>();
    for (const p of d0.photos) {
      const record = currentRecord(p, health);
      if (record) records.set(p.id, record);
    }
    const missing = d0.photos.filter((p) => !records.has(p.id));
    for (const [i, p] of missing.entries()) {
      setPhase('Checking photo ' + (i + 1) + ' of ' + missing.length);
      records.set(p.id, await scoreOne(p, d0.id, connection, externalConsent, health, signal));
      if (generation !== operation.current) return;
    }
    setPhase('Working out the result');
    const historic = historicReceipts(d0);
    // Settle a request already in flight when its source was replaced. No third-party upload is initiated here.
    const latest = draftRef.current;
    if (latest?.id !== d0.id || generation !== operation.current) return;
    const previousJobs = (latest.replacedOverviews ?? []).map((e) =>
      scoring.current.get(JSON.stringify([d0.id, e.photo.id, connection.url, health.scoreContext])),
    );
    const pendingChecks = await Promise.all(previousJobs.map((j) => j?.catch(() => undefined)));
    if (generation !== operation.current) return;
    const previous = retainedReceipts(latest).flatMap((e, i) => {
      const settled = pendingChecks[i];
      if (!settled) return [e];
      if (settled.retainOnReplacement === false && !e.finding && !e.legacyAssessment) return [];
      return [{ ...e, record: settled.record, signed: settled.signed }];
    });
    // Older v2 servers cannot reconcile a displaced record. A previously issued exclusion is
    // already known to this phone. Ordinary observations remain available in its notebook.
    const fallbackStatuses = !health.retainedEvidence
      ? (latest.replacedOverviews ?? []).map((e) => ({
          photoId: e.photo.id,
          view: e.photo.view as 'front' | 'back',
          replacementId: e.replacementId,
          sha256: e.photo.v2?.record.sha256,
          status:
            e.originalExclusion || e.photo.finding?.finding.kind === 'exclusion'
              ? ('unverified_exclusion' as const)
              : ('unverified' as const),
          codes: e.photo.finding?.finding.codes ?? [],
        }))
      : [];
    const previousCount = d0.countReceipt;
    const countStillBound =
      health.processingNotice === 'terms' &&
      previousCount?.check.assessmentId === d0.id &&
      d0.photos.some(
        (p) =>
          p.id === previousCount.check.photoId &&
          records.get(p.id)?.record.sha256 === previousCount.check.sha256,
      );
    const {
      decision: received,
      findings,
      replacements: verifiedReplacements,
      transitions,
      countReceipt,
    } = await assessV2(
      connection,
      {
        assessmentId: d0.id,
        disclosures: d0.disclosures,
        photos: d0.photos.map((p) => records.get(p.id)!.record),
        signedScores: d0.photos.map((p) => records.get(p.id)!.signed),
        closeUpsRequested: d0.closeUps ?? 0,
        ...(historic.length && health.historicalAreas ? { historicalAreas: historic } : {}),
        ...(previous.length && health.retainedEvidence ? { replacedOverviews: previous } : {}),
        ...(countStillBound ? { countReceipt: previousCount } : {}),
      },
      signal,
      health.processingNotice === 'terms',
      (id) => photoBase64(d0.photos.find((p) => p.id === id)!),
    );
    if (generation !== operation.current) return;
    const replacements = health.retainedEvidence ? verifiedReplacements : fallbackStatuses;
    const currentDecision = withHistoricalAreas(
      preserveExclusions(received, replacements),
      historic.map((a) => historicalReason(a, false)),
    );
    const decision =
      currentDecision.outcome === 'offer'
        ? (rememberedExclusion(latest, replacements) ?? currentDecision)
        : currentDecision;
    // A request for a close-up, or for the label again, uses up one of the allowed extra photographs.
    const extraPhoto =
      decision.outcome === 'retake' &&
      !!decision.requestPhoto &&
      (decision.requestPhoto.view === 'detail' ||
        decision.reasons.some((r) => r.code === 'label_unreadable'));
    setDraft((cur) =>
      cur && cur.id === d0.id
        ? {
            ...cur,
            decision2: decision,
            countReceipt,
            photos: findings.length
              ? cur.photos.map((p) => {
                  const next = findings.find(
                    (f) => f.finding.photoId === p.id && f.finding.sha256 === p.v2?.record.sha256,
                  );
                  return next ? { ...p, finding: retainFinding(p.finding, next) } : p;
                })
              : cur.photos,
            replacedOverviews: cur.replacedOverviews?.flatMap((e) => {
              const status = replacements.find((r) => r.photoId === e.photo.id);
              if (status?.status === 'clear') return [];
              return [{ ...e, status: status ?? e.status }];
            }),
            replacementTransitions:
              decision.outcome === 'offer' && transitions.length
                ? mergeTransitions(cur.replacementTransitions ?? [], transitions)
                : cur.replacementTransitions,
            closeUps: Math.min(3, (cur.closeUps ?? 0) + (extraPhoto ? 1 : 0)),
            updatedAt: new Date().toISOString(),
          }
        : cur,
    );
    setScreen('result');
  }
  async function share() {
    if (!draft) return;
    if (draft.decision2 && !exclusion) {
      const text = briefV2({
        id: draft.id,
        disclosures: draft.disclosures,
        photos: allDraftPhotos(draft).map((p) => ({
          id: p.id,
          view: p.view,
          signed: p.v2?.signed,
          fromOverview: p.fromOverview,
        })),
        decision: draft.decision2,
        replacedOverviews: replacementNotes(draft),
        checkedAt: new Date(draft.updatedAt).toLocaleString(),
      });
      try {
        if (Platform.OS === 'web') {
          await Clipboard.setStringAsync(text);
          setNotice(
            'Inspection brief copied. It includes the result, the reasons and the photo checks.',
          );
        } else await Share.share({ message: text, title: 'Relay inspection brief' });
      } catch {
        setError('The brief could not be shared. Please try again.');
      }
      return;
    }
    const text = [
      inspectionBrief({
        id: draft.id,
        disclosures: draft.disclosures,
        photos: draft.result?.photos ?? [],
        observation: draft.result?.observation ?? null,
        corrections: draft.corrections,
      }),
      ...replacementBriefLines(replacementNotes(draft)),
    ].join('\n');
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
    if (!draft || archiving.current || (!draft.result && !draft.decision2 && !exclusion)) return;
    archiving.current = true;
    setBusy(true);
    setError('');
    try {
      const v2 = draft.decision2 && !exclusion ? draft.decision2 : null;
      const text = v2
        ? briefV2({
            id: draft.id,
            disclosures: draft.disclosures,
            photos: allDraftPhotos(draft).map((p) => ({
              id: p.id,
              view: p.view,
              signed: p.v2?.signed,
              fromOverview: p.fromOverview,
            })),
            decision: v2,
            replacedOverviews: replacementNotes(draft),
            checkedAt: new Date(draft.updatedAt).toLocaleString(),
          })
        : [
            inspectionBrief({
              id: draft.id,
              disclosures: draft.disclosures,
              photos: draft.result?.photos ?? [],
              observation: draft.result?.observation ?? null,
              corrections: draft.corrections,
            }),
            ...replacementBriefLines(replacementNotes(draft)),
          ].join('\n');
      const updated = await saveBrief({
        id: draft.id,
        savedAt: new Date().toISOString(),
        title: v2 ? v2.title : decision.title,
        category: v2
          ? categoryLabels2[v2.category]
          : categoryLabels[draft.result?.observation?.category ?? 'unknown'],
        text,
        ...(draft.countReceipt ? { countReceipt: draft.countReceipt } : {}),
        ...(draft.replacedOverviews?.length
          ? {
              replacedOverviews: replacementNotes(draft),
              replacementTransitions: draft.replacementTransitions ?? [],
            }
          : {}),
        // The saved brief keeps the photographs, never the service's score records.
        photos: allDraftPhotos(draft).map(({ v2: _record, ...photo }) => photo),
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
      setConnectionStatus(isOnDevice ? 'Checking offline engine' : 'Checking connection…');
      const found = await detectEngine(next, new AbortController().signal);
      if (generation !== settingsOperation.current) return;
      if (found.kind === 'v2') {
        const h = found.health,
          external = h.scorers.filter((s) => EXTERNAL_SCORERS.includes(s.id));
        await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ url }));
        setConnection(next);
        setEngine(found);
        setExternalConsent(false);
        setApprovedTarget(null);
        setPendingTarget(JSON.stringify([url, 'v2', h.scorers.map((s) => s.id + ':' + s.model)]));
        setExternalProvider(
          h.externalProcessing
            ? external.map((s) => s.model).join(', ') || 'an external provider'
            : null,
        );
        setConnectionStatus(
          'Connected · Relay v2 · photo check ' +
            h.batteryVersion +
            ' · thresholds ' +
            h.thresholdsVersion +
            (h.externalProcessing
              ? ' · uses an external provider'
              : h.processingNotice === 'terms'
                ? ' · processed by the Relay assessment service'
                : ' · processed on that computer'),
        );
        return;
      }
      setEngine(found);
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
      void clearAnalysisMemory().catch(() => undefined);
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
    isOnDevice,
    /** The v2 decision for the current photographs and answers, or null. */
    decision2: draft?.decision2 ?? null,
    engineKind: engine?.kind ?? null,
    processingUnderTerms: engine?.kind === 'v2' && engine.health.processingNotice === 'terms',
    scoringIds,
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
