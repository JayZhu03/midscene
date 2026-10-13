import { getDebug } from '@midscene/shared/logger';

const DATABASE = 'midscene-studio-preferences';
const STORE = 'preferences';
const debug = getDebug('studio:preferences-backup', { console: true });
let database: IDBDatabase | undefined;
let pending: Promise<void> = Promise.resolve();
const isPreference = (key: string) =>
  key.startsWith('studio.') || key.startsWith('studio:');

function persist(entries: Array<[string, string]>): Promise<void> {
  if (!database) return Promise.resolve();
  const db = database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    for (const [key, value] of entries) tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error || new Error('Preference backup was aborted.'));
    tx.onerror = () => reject(tx.error);
  });
}

/** Restore before loading UI modules, which otherwise initialize empty defaults. */
export async function initializeStudioPreferences(): Promise<void> {
  database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Preference backup is locked.'));
  });
  const saved = await new Promise<Array<[string, string]>>(
    (resolve, reject) => {
      const tx = database!.transaction(STORE);
      const entries: Array<[string, string]> = [];
      const request = tx.objectStore(STORE).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (
          typeof cursor.key === 'string' &&
          isPreference(cursor.key) &&
          typeof cursor.value === 'string'
        ) {
          entries.push([cursor.key, cursor.value]);
        }
        cursor.continue();
      };
      tx.oncomplete = () => resolve(entries);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    },
  );
  for (const [key, value] of saved) {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
  }
  const entries: Array<[string, string]> = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    if (isPreference(key)) entries.push([key, localStorage.getItem(key)!]);
  }
  await persist(entries);
}

/** Keep intentional empty values too, so removed scenarios are not resurrected. */
export function saveStudioPreference(key: string, value: string): void {
  localStorage.setItem(key, value);
  if (!isPreference(key) || !database) return;
  pending = pending
    .then(() => persist([[key, value]]))
    .catch(() => {
      debug(
        'Unable to back up local preferences. Existing backup was retained.',
      );
    });
}

export function flushStudioPreferences(): Promise<void> {
  return pending;
}
