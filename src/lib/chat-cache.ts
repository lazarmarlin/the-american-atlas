/**
 * The last messages of each conversation (and the message list), kept on the
 * phone so chats open with no signal. Kept per signed-in person.
 */
import type { BoardItem, ChatMessage, Thread } from "@/lib/messages";

const DB = "atlas-chat-cache";
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb() {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

async function read<T>(key: string): Promise<T | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  try {
    const db = await openDb();
    return await new Promise<T | undefined>((resolve, reject) => {
      const req = db.transaction("kv").objectStore("kv").get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

async function write(key: string, value: unknown) {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* no cache, then */
  }
}

const threadKey = (me: string, thread: Thread) => `${me}:${thread.kind}:${thread.id}`;

export function cachedThread(me: string, thread: Thread) {
  return read<ChatMessage[]>(threadKey(me, thread));
}

export function cacheThread(me: string, thread: Thread, rows: ChatMessage[]) {
  return write(threadKey(me, thread), rows.slice(-100));
}

export function cachedBoard(me: string) {
  return read<BoardItem[]>(`${me}:board`);
}

export function cacheBoard(me: string, rows: BoardItem[]) {
  return write(`${me}:board`, rows);
}
