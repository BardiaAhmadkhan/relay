import { blankDraft, type Draft, type Mode, type RecordData } from './domain';
let opening: Promise<IDBDatabase> | undefined;
function database() {
  if (!opening)
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('relay-web-notebook', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('records');
      r.onsuccess = () => {
        r.result.onversionchange = () => {
          r.result.close();
          opening = undefined;
        };
        resolve(r.result);
      };
      r.onerror = () => {
        opening = undefined;
        reject(new Error('Device storage is unavailable.'));
      };
    });
  return opening;
}
export async function read<T>(key: string): Promise<T | undefined> {
  const db = await database();
  return new Promise((ok, no) => {
    const req = db.transaction('records').objectStore('records').get(key);
    req.onsuccess = () => ok(req.result);
    req.onerror = () => no(req.error);
  });
}
export async function write<T>(key: string, value: T | undefined) {
  const db = await database();
  return new Promise<void>((ok, no) => {
    const tx = db.transaction('records', 'readwrite');
    if (value === undefined) tx.objectStore('records').delete(key);
    else tx.objectStore('records').put(value, key);
    tx.oncomplete = () => ok();
    tx.onerror = tx.onabort = () =>
      no(new Error('This device could not save the change. Storage may be full.'));
  });
}
export async function amend<T>(key: string, fallback: T, update: (v: T) => T): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite'),
      store = tx.objectStore('records'),
      req = store.get(key);
    let changed: T;
    req.onsuccess = () => {
      try {
        changed = update(req.result ?? structuredClone(fallback));
        store.put(changed, key);
      } catch (e) {
        tx.abort();
        reject(e);
      }
    };
    tx.oncomplete = () => resolve(changed);
    tx.onerror = tx.onabort = () => reject(new Error('Device storage could not save this change.'));
  });
}
export async function removePersonalRecord(id: string) {
  if (!/^LOCAL-[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/i.test(id))
    throw Error('Only a personal intake can be removed here.');
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    const records = tx.objectStore('records');
    records.delete('item:' + id);
    records.delete('stock:' + id);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(new Error('This browser could not remove the intake.'));
  });
}
export async function examples(): Promise<RecordData[]> {
  const db = await database();
  return new Promise((ok, no) => {
    const q = db
      .transaction('records')
      .objectStore('records')
      .getAll(IDBKeyRange.bound('item:', 'item:\uffff'));
    q.onsuccess = () => ok(q.result);
    q.onerror = () => no(q.error);
  });
}
export const getDraft = async (mode: Mode) => (await read<Draft>('draft:' + mode)) ?? blankDraft();
export const saveDraft = (mode: Mode, draft: Draft) =>
  write('draft:' + mode, { ...draft, updated: Date.now() });
export const clearDraft = (mode: Mode) => write('draft:' + mode, undefined);
export function preference(key: string, defaultValue: string) {
  try {
    return localStorage.getItem('relay.view.' + key) ?? defaultValue;
  } catch {
    return defaultValue;
  }
}
export function setPreference(key: string, v: string) {
  try {
    localStorage.setItem('relay.view.' + key, v);
  } catch {
    /* Optional display preference. */
  }
}
