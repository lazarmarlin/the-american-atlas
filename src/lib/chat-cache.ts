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

/** Full-size chat photos already loaded, so they show sharp straight away next time. */
export function cachedPhoto(me: string, id: string) {
  return read<string>(`${me}:photo:${id}`);
}

export function cachePhoto(me: string, id: string, image: string) {
  return write(`${me}:photo:${id}`, image);
}

/** Messages waiting to go out (see chat-outbox.ts). */
export function cachedOutbox<T>(me: string) {
  return read<T[]>(`${me}:outbox`);
}

export function cacheOutbox(me: string, rows: unknown[]) {
  return write(`${me}:outbox`, rows);
}

export function cachedFriends<T>(me: string) {
  return read<T[]>(`${me}:friends`);
}

export function cacheFriends(me: string, rows: unknown[]) {
  return write(`${me}:friends`, rows);
}

export function cachedFriendPage<T>(me: string, id: string) {
  return read<T>(`${me}:friend:${id}`);
}

export function cacheFriendPage(me: string, id: string, page: unknown) {
  return write(`${me}:friend:${id}`, page);
}

export function cachedGroups<T>(me: string) {
  return read<T[]>(`${me}:groups`);
}

export function cacheGroups(me: string, rows: unknown[]) {
  return write(`${me}:groups`, rows);
}

export function cachedWall(me: string, thread: Thread) {
  return read<{ image: string; filter: string; sync: boolean }>(`${me}:wall:${thread.kind}:${thread.id}`);
}

export function cacheWall(me: string, thread: Thread, wall: { image: string; filter: string; sync: boolean } | null) {
  return write(`${me}:wall:${thread.kind}:${thread.id}`, wall);
}
