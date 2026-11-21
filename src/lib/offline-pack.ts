import { create } from "zustand";
import { clearAtlasFiles, OFFLINE_PACK_VERSION, OFFLINE_READY_KEY, readAtlasFile, writeAtlasFile } from "@/lib/atlas-files";
import { forgetAtlasLists } from "@/lib/atlas-model";

const READY_KEY = OFFLINE_READY_KEY;

type OfflinePack = {
  running: boolean;
  done: number;
  total: number;
  error: string | null;
  ready: boolean;
  start: () => Promise<string | null>;
  refresh: () => Promise<string | null>;
  clear: () => Promise<void>;
};

let control: AbortController | null = null;

function savedReady() {
  return typeof localStorage !== "undefined" && localStorage.getItem(READY_KEY) === OFFLINE_PACK_VERSION;
}

async function saveFile(cache: Cache, path: string, signal: AbortSignal, force: boolean) {
  if (!force) {
    const saved = await readAtlasFile(path);
    if (saved && /^[\[{]/.test(saved.trimStart())) return true;
  }
  const url = force ? `${path}?fresh=${Date.now()}` : path;
  const res = await fetch(url, { signal, cache: force ? "no-store" : "default" });
  if (!res.ok) return false;
  const text = await res.text();
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  const keys = await cache.keys();
  await Promise.all(
    keys.map((key) => {
      try {
        return new URL(key.url).pathname === path ? cache.delete(key) : Promise.resolve(false);
      } catch {
        return Promise.resolve(false);
      }
    }),
  );
  await cache.put(path, new Response(text, { headers: { "content-type": "application/json" } }));
  await writeAtlasFile(path, text);
  return true;
}

async function saveAll(files: string[], signal: AbortSignal, force: boolean, onDone: (done: number) => void) {
  const cache = await caches.open("atlas-files");
  let cursor = 0;
  let done = 0;
  const failed: string[] = [];
  async function worker() {
    while (!signal.aborted) {
      const index = cursor;
      cursor += 1;
      if (index >= files.length) return;
      const path = files[index];
      let ok = false;
      if (typeof path === "string" && path.startsWith("/atlas/")) {
        try {
          ok = await saveFile(cache, path, signal, force);
        } catch {
          ok = false;
        }
      }
      if (signal.aborted) return;
      if (!ok && typeof path === "string") failed.push(path);
      done += 1;
      if (done === files.length || done % 2 === 0) onDone(done);
    }
  }
  await Promise.all(Array.from({ length: 4 }, () => worker()));
  return failed;
}

function download(
  set: (partial: Partial<OfflinePack>) => void,
  get: () => OfflinePack,
  force: boolean,
): Promise<string | null> {
  if (get().running) return Promise.resolve("Already updating the atlas.");
  if (typeof caches === "undefined") {
    const error = "This device can't store the atlas.";
    set({ error });
    return Promise.resolve(error);
  }
  control?.abort();
  const current = new AbortController();
  control = current;
  const { signal } = current;
  const keepReady = force && get().ready;
  set({ running: true, error: null, done: 0, total: 0, ready: keepReady });
  return (async () => {
    try {
      const list = await fetch(`/atlas/pack.json?fresh=${Date.now()}`, { signal, cache: "no-store" });
      if (!list.ok) throw new Error("Couldn't read the atlas list.");
      const files = (await list.json()) as string[];
      if (!Array.isArray(files) || !files.length) throw new Error("The atlas list was empty.");
      set({ total: files.length });
      let failed = await saveAll(files, signal, force, (done) => set({ done }));
      for (let attempt = 0; attempt < 2 && failed.length && !signal.aborted; attempt += 1) {
        const again = failed;
        failed = await saveAll(again, signal, true, () => {});
      }
      if (signal.aborted || control !== current) return null;
      if (failed.length) throw new Error(`Couldn't save ${failed.length} lists. Try again to finish.`);
      localStorage.setItem(READY_KEY, OFFLINE_PACK_VERSION);
      forgetAtlasLists();
      if (typeof window !== "undefined") window.dispatchEvent(new Event("atlas-pack"));
      set({ running: false, ready: true, done: files.length, total: files.length, error: null });
      return null;
    } catch (err) {
      if (signal.aborted || control !== current) return null;
      const error = err instanceof Error ? err.message : "The download stopped. Try again.";
      set({ running: false, ready: keepReady, error });
      return error;
    }
  })();
}

export const useOfflinePack = create<OfflinePack>((set, get) => ({
  running: false,
  done: 0,
  total: 0,
  error: null,
  ready: savedReady(),
  start: () => download(set, get, false),
  refresh: () => download(set, get, true),
  clear: async () => {
    control?.abort();
    control = null;
    if (typeof caches !== "undefined") await caches.delete("atlas-files");
    await clearAtlasFiles();
    forgetAtlasLists();
    if (typeof window !== "undefined") window.dispatchEvent(new Event("atlas-pack"));
    if (typeof localStorage !== "undefined") localStorage.removeItem(READY_KEY);
    set({ running: false, ready: false, done: 0, total: 0, error: null });
  },
}));