const DB_NAME = "traceway";
const DB_VERSION = 1;
export const OUTBOX_STORE = "outbox";
export const BUFFER_STORE = "buffer";

export interface StoredBatch {
  id?: number | string;
  token: string;
  kind: "logs" | "traces";
  /** An OTLP/HTTP JSON request body. */
  body: string;
  createdAtMs: number;
  attempts: number;
  /** Buffer entries only: when the newest record in the body happened, its signal and its session. */
  timeMs?: number;
  signal?: string;
  sessionId?: string;
}

let opened: IDBDatabase | null = null;
let opening: Promise<IDBDatabase | null> | null = null;

/** Opens the SDK's database; resolves to null wherever IndexedDB is missing or refused (private modes, sandboxes). */
export function openDatabase(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of [OUTBOX_STORE, BUFFER_STORE]) {
          if (!db.objectStoreNames.contains(store)) {
            db.createObjectStore(store, {
              keyPath: "id",
              autoIncrement: true,
            }).createIndex("token", "token");
          }
        }
      };
      request.onsuccess = () => {
        opened = request.result;
        resolve(request.result);
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

/** For tests: forget the open connection so a fresh fake database is used. */
export function resetDatabase(): void {
  opened = null;
  opening = null;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function putAll(
  store: string,
  batches: StoredBatch[],
): Promise<void> {
  const db = await openDatabase();
  if (!db || batches.length === 0) return;
  const tx = db.transaction(store, "readwrite");
  for (const batch of batches) tx.objectStore(store).put(batch);
  await done(tx);
}

export async function listByToken(
  store: string,
  token: string,
): Promise<StoredBatch[]> {
  const db = await openDatabase();
  if (!db) return [];
  const tx = db.transaction(store, "readonly");
  const request = tx.objectStore(store).index("token").getAll(token);
  await done(tx);
  return (request.result as StoredBatch[]).sort(
    (a, b) => a.createdAtMs - b.createdAtMs,
  );
}

export async function deleteIds(
  store: string,
  ids: Array<number | string>,
): Promise<void> {
  const db = await openDatabase();
  if (!db || ids.length === 0) return;
  const tx = db.transaction(store, "readwrite");
  for (const id of ids) tx.objectStore(store).delete(id);
  await done(tx);
}

export async function replaceForToken(
  store: string,
  token: string,
  batches: StoredBatch[],
): Promise<void> {
  await updateToken(store, token, (existing) => ({
    remove: existing.map((batch) => batch.id!),
    put: batches,
  }));
}

/** Reads and replaces a token's rows in one transaction, including during pagehide. */
export async function updateToken(
  store: string,
  token: string,
  update: (batches: StoredBatch[]) => {
    remove: Array<number | string>;
    put: StoredBatch[];
  },
): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  const tx = db.transaction(store, "readwrite");
  const objectStore = tx.objectStore(store);
  const request = objectStore.index("token").getAll(token);
  request.onsuccess = () => {
    const changes = update(request.result as StoredBatch[]);
    for (const id of changes.remove) objectStore.delete(id);
    for (const batch of changes.put) objectStore.put(batch);
  };
  await done(tx);
}

/** Starts the transaction synchronously when open, so pagehide does not wait on a read request. */
export function writeSessionSnapshot(
  token: string,
  sessionId: string,
  batches: StoredBatch[],
): Promise<void> {
  const write = (db: IDBDatabase | null): Promise<void> => {
    if (!db) return Promise.resolve();
    const prefix = `${token}:${sessionId}:`;
    const tx = db.transaction(BUFFER_STORE, "readwrite");
    const store = tx.objectStore(BUFFER_STORE);
    store.delete(IDBKeyRange.bound(prefix, prefix + "\uffff"));
    batches.forEach((batch, index) =>
      store.put({ ...batch, id: prefix + index }),
    );
    return done(tx);
  };
  return opened ? write(opened) : openDatabase().then(write);
}
