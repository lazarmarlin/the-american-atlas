const DB = "american-atlas-pack";

export const OFFLINE_READY_KEY = "atlas-offline-ready";
export const OFFLINE_PACK_VERSION = "places-v7";
/**
 * Browser cache for /atlas/* files. Bump the suffix (here and in public/sw.js)
 * whenever the atlas data changes so devices drop their stale copies.
 */
export const ATLAS_CACHE = "atlas-files-v7";

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("files")) db.createObjectStore("files");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function readAtlasFile(path: string) {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openDb();
    const text = await new Promise<string | undefined>((resolve, reject) => {
      const req = db.transaction("files").objectStore("files").get(path);
      req.onsuccess = () => resolve(req.result as string | undefined);
      req.onerror = () => reject(req.error);
    });
    return text ?? null;
  } catch {
    return null;
  }
}

export async function writeAtlasFile(path: string, text: string) {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const req = db.transaction("files", "readwrite").objectStore("files").put(text, path);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clearAtlasFiles() {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const req = db.transaction("files", "readwrite").objectStore("files").clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
