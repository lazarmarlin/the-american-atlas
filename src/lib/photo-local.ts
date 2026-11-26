/**
 * Photos kept on the phone. In the Android app an added photo is saved here
 * first (full image included) and goes to the account only when uploaded, by
 * hand or by sharing it with friends. Each account has its own set on the
 * device: `setLocalPhotoOwner` picks it, and is called when someone signs in.
 */
import type { PhotoInfo } from "@/lib/photos";

export type LocalPhoto = PhotoInfo & { image: string; uploaded: boolean; uri?: string };

const DB = "atlas-photos";
const STORE = "photos";
let owner: string | null = null;

export function setLocalPhotoOwner(userId: string | null) {
  owner = userId;
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const keyFor = (id: string) => `${owner}:${id}`;

function request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = run(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function listLocalPhotos(): Promise<LocalPhoto[]> {
  if (!owner || typeof indexedDB === "undefined") return [];
  const prefix = `${owner}:`;
  const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
  const rows = await request<LocalPhoto[]>("readonly", (store) => store.getAll(range));
  return rows.sort((a, b) => (b.takenAt ?? 0) - (a.takenAt ?? 0));
}

export async function getLocalPhoto(id: string): Promise<LocalPhoto | null> {
  if (!owner || typeof indexedDB === "undefined") return null;
  return (await request<LocalPhoto | undefined>("readonly", (store) => store.get(keyFor(id)))) ?? null;
}

export async function saveLocalPhoto(photo: LocalPhoto) {
  if (!owner) throw new Error("Sign in to keep photos.");
  await request("readwrite", (store) => store.put(photo, keyFor(photo.id)));
}

export async function markUploaded(id: string) {
  const row = await getLocalPhoto(id);
  if (row) await saveLocalPhoto({ ...row, uploaded: true });
}

export async function setLocalShared(id: string, shared: boolean, sharedWith: string[] = []) {
  const row = await getLocalPhoto(id);
  if (row) await saveLocalPhoto({ ...row, shared, sharedWith });
}

export async function deleteLocalPhoto(id: string) {
  if (!owner || typeof indexedDB === "undefined") return;
  await request("readwrite", (store) => store.delete(keyFor(id)));
}

/* ── Photos from the account, kept after the first time they're opened ──
 * A photo added on this phone already lives above, full size. One added
 * elsewhere (another phone, the website) is downloaded once and kept in its
 * own store, so it isn't fetched again. The account's list is kept too, so
 * the pictures still show with no signal. */

const CACHE_DB = "atlas-photo-cache";

function openCache() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(CACHE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function cacheGet<T>(key: string): Promise<T | null> {
  if (!owner || typeof indexedDB === "undefined") return null;
  try {
    const db = await openCache();
    return await new Promise<T | null>((resolve) => {
      const req = db.transaction("kv", "readonly").objectStore("kv").get(`${owner}:${key}`);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function cachePut(key: string, value: unknown) {
  if (!owner || typeof indexedDB === "undefined") return;
  try {
    const db = await openCache();
    await new Promise<void>((resolve) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(value, `${owner}:${key}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* fine: it's only a cache */
  }
}

/** The full photo: from this phone if it's there, else downloaded once and kept. */
export async function photoImage(id: string, download: () => Promise<string>): Promise<string> {
  const local = await getLocalPhoto(id).catch(() => null);
  if (local?.image) return local.image;
  const kept = await cacheGet<string>(`full:${id}`);
  if (kept) return kept;
  const image = await download();
  if (image) void cachePut(`full:${id}`, image);
  return image;
}

/**
 * Every photo you've added: the ones on this phone and the account's (each
 * once), newest first. `onList` gets what's on the phone straight away, then
 * the full list once the account answers (or stays with the saved one offline).
 */
export async function allPhotos(listAccount: () => Promise<PhotoInfo[]>, onList: (rows: PhotoInfo[]) => void) {
  const merge = (account: PhotoInfo[], local: LocalPhoto[]) => {
    const byId = new Map<string, PhotoInfo>();
    for (const row of local) {
      const { image: _image, uploaded: _uploaded, uri: _uri, ...info } = row;
      byId.set(row.id, info);
    }
    for (const row of account) if (!byId.has(row.id)) byId.set(row.id, row);
    return [...byId.values()].sort((a, b) => (b.takenAt ?? 0) - (a.takenAt ?? 0));
  };
  const local = await listLocalPhotos().catch(() => [] as LocalPhoto[]);
  const saved = (await cacheGet<PhotoInfo[]>("list")) ?? [];
  onList(merge(saved, local));
  try {
    const account = await listAccount();
    void cachePut("list", account);
    onList(merge(account, local));
  } catch {
    /* offline: the saved list stays */
  }
}
