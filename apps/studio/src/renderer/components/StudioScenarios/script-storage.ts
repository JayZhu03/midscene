import {
  SCENARIO_SCRIPT_NAME_MAX_LENGTH,
  type ScenarioScreenshotField,
  type ScenarioScript,
  type ScenarioScriptAssetRef,
  validateScenarioIdentifier,
  validateScenarioScript,
} from './script-model';

export const SCENARIO_SCRIPTS_DATABASE = 'midscene-studio-scenario-scripts';
const SCRIPT_STORE = 'scripts';
const ASSET_STORE = 'assets';
const ASSET_PREFIX = 'scenario-asset:';

export async function renameScenarioScript(
  id: string,
  name: string,
): Promise<ScenarioScript> {
  validateScenarioIdentifier(id);
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > SCENARIO_SCRIPT_NAME_MAX_LENGTH)
    throw new Error('Please enter a script name.');
  return transaction<ScenarioScript>(
    [SCRIPT_STORE],
    'readwrite',
    (tx, setResult) => {
      const store = tx.objectStore(SCRIPT_STORE);
      const request = store.get(id);
      request.onsuccess = () => {
        if (!request.result) {
          tx.abort();
          return;
        }
        try {
          const updated = validateScenarioScript({
            ...request.result,
            name: trimmed,
            updatedAt: Date.now(),
          });
          store.put(updated);
          setResult(updated);
        } catch {
          tx.abort();
        }
      };
    },
  );
}

export async function deleteScenarioScript(id: string): Promise<void> {
  validateScenarioIdentifier(id);
  return transaction<void>([SCRIPT_STORE, ASSET_STORE], 'readwrite', (tx) => {
    const scripts = tx.objectStore(SCRIPT_STORE);
    const request = scripts.get(id);
    request.onsuccess = () => {
      try {
        for (const asset of request.result?.assets || [])
          tx.objectStore(ASSET_STORE).delete(asset.id);
        scripts.delete(id);
      } catch {
        tx.abort();
      }
    };
  });
}

export type ScenarioScriptAssetLoader = (
  assetId: string,
) => Promise<string | Blob | null>;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Scenario script storage is unavailable.'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SCENARIO_SCRIPTS_DATABASE, 1);
    let failed = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(SCRIPT_STORE, { keyPath: 'id' }).createIndex(
        'scenarioId',
        'scenarioId',
      );
      db.createObjectStore(ASSET_STORE, { keyPath: 'id' });
    };
    request.onerror = () =>
      reject(new Error('Unable to open scenario script storage.'));
    request.onblocked = () => {
      failed = true;
      reject(
        new Error(
          'Scenario script storage is blocked. Close other Studio windows and retry.',
        ),
      );
    };
    request.onsuccess = () => {
      if (failed) request.result.close();
      else resolve(request.result);
    };
  });
}

async function transaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  run: (transaction: IDBTransaction, setResult: (value: T) => void) => void,
): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    let result: T;
    let failure: Error | undefined;
    try {
      tx = db.transaction(stores, mode);
    } catch {
      db.close();
      reject(new Error('Scenario script storage is unavailable.'));
      return;
    }
    tx.oncomplete = () => {
      db.close();
      if (failure) reject(failure);
      else resolve(result);
    };
    tx.onerror = () => {
      // Request success is not durability: only transaction completion resolves.
      failure = new Error('Unable to save or read scenario scripts.');
    };
    tx.onabort = () => {
      db.close();
      reject(
        failure ||
          new Error('Scenario script storage transaction was aborted.'),
      );
    };
    try {
      run(tx, (value) => {
        result = value;
      });
    } catch {
      failure = new Error('Unable to save or read scenario scripts.');
      tx.abort();
    }
  });
}

export async function listScenarioScripts(
  scenarioId: string,
): Promise<ScenarioScript[]> {
  validateScenarioIdentifier(scenarioId);
  const records = await transaction<unknown[]>(
    [SCRIPT_STORE],
    'readonly',
    (tx, setResult) => {
      const request = tx
        .objectStore(SCRIPT_STORE)
        .index('scenarioId')
        .getAll(scenarioId);
      request.onsuccess = () => setResult(request.result);
    },
  );
  return records
    .map(validateScenarioScript)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export async function getScenarioScript(
  id: string,
): Promise<ScenarioScript | null> {
  validateScenarioIdentifier(id);
  const record = await transaction<unknown>(
    [SCRIPT_STORE],
    'readonly',
    (tx, setResult) => {
      const request = tx.objectStore(SCRIPT_STORE).get(id);
      request.onsuccess = () => setResult(request.result);
    },
  );
  return record === undefined ? null : validateScenarioScript(record);
}

export async function getScenarioScriptAsset(id: string): Promise<Blob | null> {
  validateScenarioIdentifier(id);
  const record = await transaction<{ id: string; blob: Blob } | undefined>(
    [ASSET_STORE],
    'readonly',
    (tx, setResult) => {
      const request = tx.objectStore(ASSET_STORE).get(id);
      request.onsuccess = () => setResult(request.result);
    },
  );
  if (record === undefined) return null;
  if (!(record.blob instanceof Blob) || !record.blob.type.startsWith('image/'))
    throw new Error('Invalid scenario screenshot data.');
  return record.blob;
}

function screenshotBlob(value: string | Blob): Blob {
  if (value instanceof Blob) {
    if (!value.type.startsWith('image/') || !value.size)
      throw new Error('Invalid scenario screenshot data.');
    return value;
  }
  // Decode existing inline screenshots locally; never fetch arbitrary URLs.
  const match =
    /^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\s]+)$/.exec(value);
  if (!match) throw new Error('Invalid scenario screenshot data.');
  const binary = atob(match[2]);
  if (!binary.length) throw new Error('Invalid scenario screenshot data.');
  return new Blob(
    [Uint8Array.from(binary, (character) => character.charCodeAt(0))],
    { type: match[1] },
  );
}

export async function saveScenarioScript(
  input: ScenarioScript,
  assetLoader?: ScenarioScriptAssetLoader,
): Promise<ScenarioScript> {
  const script = validateScenarioScript(input);
  // All async screenshot loading happens before opening the write transaction.
  // Otherwise IndexedDB can auto-commit while awaiting the recorder bridge.
  const blobs: Array<{ id: string; blob: Blob }> = [];
  const refs: ScenarioScriptAssetRef[] = [];
  for (const event of script.sourceSession.events) {
    for (const field of [
      'screenshotAsset',
      'screenshotBefore',
      'screenshotAfter',
      'screenshotWithBox',
    ] as const) {
      const value = event[field];
      if (!value) continue;
      const priorRef = script.assets.find(
        (ref) => ref.eventHashId === event.hashId && ref.field === field,
      );
      let screenshot: string | Blob | null;
      if (priorRef) {
        const referenceId =
          field === 'screenshotAsset'
            ? event.screenshotAsset?.id
            : String(value).slice(ASSET_PREFIX.length);
        if (referenceId !== priorRef.id)
          throw new Error(
            'Scenario screenshot reference does not match its source.',
          );
        screenshot = await getScenarioScriptAsset(priorRef.id);
      } else if (field === 'screenshotAsset') {
        screenshot = assetLoader
          ? await assetLoader(event.screenshotAsset!.id)
          : null;
      } else screenshot = value as string;
      if (!screenshot)
        throw new Error(
          'A recorded screenshot is unavailable. The script was not saved.',
        );
      const blob = screenshotBlob(screenshot);
      const id = priorRef?.id ?? crypto.randomUUID();
      refs.push({
        id,
        eventHashId: event.hashId,
        field: field as ScenarioScreenshotField,
        mimeType: blob.type,
        bytes: blob.size,
      });
      blobs.push({ id, blob });
      if (field === 'screenshotAsset')
        event.screenshotAsset = { id, mimeType: blob.type, bytes: blob.size };
      else event[field] = `${ASSET_PREFIX}${id}`;
    }
  }
  for (const step of script.steps) {
    if ('sourceEvent' in step) {
      step.sourceEvent = script.sourceSession.events.find(
        (event) => event.hashId === step.sourceEvent.hashId,
      )!;
    }
  }
  const durable = validateScenarioScript({ ...script, assets: refs });
  await transaction<void>([SCRIPT_STORE, ASSET_STORE], 'readwrite', (tx) => {
    const scripts = tx.objectStore(SCRIPT_STORE);
    const assets = tx.objectStore(ASSET_STORE);
    const previous = scripts.get(durable.id);
    previous.onsuccess = () => {
      try {
        if (
          previous.result &&
          previous.result.scenarioId !== durable.scenarioId
        ) {
          tx.abort();
          return;
        }
        for (const ref of previous.result?.assets || []) {
          if (!refs.some((current) => current.id === ref.id))
            assets.delete(ref.id);
        }
        for (const blob of blobs) assets.put(blob);
        scripts.put(durable);
      } catch {
        tx.abort();
      }
    };
  });
  return durable;
}
