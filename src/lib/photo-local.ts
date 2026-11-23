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

export async function setLocalShared(id: string, shared: boolean) {
  const row = await getLocalPhoto(id);
  if (row) await saveLocalPhoto({ ...row, shared });
}

export async function deleteLocalPhoto(id: string) {
  if (!owner || typeof indexedDB === "undefined") return;
  await request("readwrite", (store) => store.delete(keyFor(id)));
}
