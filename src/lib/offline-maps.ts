/**
 * Offline maps: save the base map for a state so it still draws with no
 * signal (rural dead zones on a drive). The map's tiles, fonts and icons all
 * load through an "atlas://" protocol: anything saved on the device is used
 * first, otherwise it comes from the network as usual.
 *
 * Tiles are kept by z/x/y, not by the tile server's dated folder, so a saved
 * state keeps working after the server moves to a new build of the map.
 * The style, its tile list, fonts and icons are kept whenever they load, so
 * an offline start still has a style to draw with.
 */
import { create } from "zustand";
import type { StateInfo } from "@/lib/atlas-model";

export const BASE_STYLE = "https://tiles.openfreemap.org/styles/dark";
const DB = "atlas-map-tiles";
/** At most this many tiles per state: the deepest zoom that fits is chosen. */
const TILE_BUDGET = 3000;
/** Never deeper than this for a saved state (street names show from here). */
const MAX_SAVE_ZOOM = 12;

// ---------------------------------------------------------------- storage

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb() {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ["tiles", "assets", "regions"]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

async function get<T>(store: string, key: string): Promise<T | undefined> {
  try {
    const db = await openDb();
    return await new Promise<T | undefined>((resolve, reject) => {
      const req = db.transaction(store).objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

async function put(store: string, key: string, value: unknown) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function del(store: string, keys: string[]) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    for (const key of keys) tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function all<T>(store: string): Promise<T[]> {
  try {
    const db = await openDb();
    return await new Promise<T[]>((resolve, reject) => {
      const req = db.transaction(store).objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- tiles

const TILE_RE = /\/(\d{1,2})\/(\d+)\/(\d+)\.(pbf|mvt|png|jpg|webp)(\?.*)?$/;

/** The key a tile is saved under: z/x/y, whatever dated folder it came from. */
function tileKey(url: string) {
  const m = TILE_RE.exec(url);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : null;
}

export function toAtlas(url: string) {
  return url.replace(/^https?:\/\//, "atlas://");
}

function fromAtlas(url: string) {
  return url.replace(/^atlas:\/\//, "https://");
}

async function fetchBytes(url: string, signal?: AbortSignal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

/**
 * The "atlas://" loader for MapLibre. Saved tiles first; fonts, icons and the
 * like are saved as they load (they're small) so an offline start can use them.
 */
export async function loadAtlasResource(params: { url: string; type?: string }, abort: AbortController) {
  const url = fromAtlas(params.url);
  const key = tileKey(url);
  let data: ArrayBuffer | undefined;
  if (key) {
    data = await get<ArrayBuffer>("tiles", key);
    // Not saved: from the network. If that fails (a weak signal, no signal), the
    // error lets the map keep drawing the zoomed-out tile it already has, stretched,
    // instead of a blank square; it asks again when you move.
    if (!data) data = await fetchBytes(url, abort.signal);
  } else {
    try {
      data = await fetchBytes(url, abort.signal);
      void put("assets", url, data).catch(() => {});
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      data = await get<ArrayBuffer>("assets", url);
      if (!data) throw err;
    }
  }
  if (params.type === "json") return { data: JSON.parse(new TextDecoder().decode(data)) };
  if (params.type === "string") return { data: new TextDecoder().decode(data) };
  return { data };
}

type Style = {
  sources?: Record<string, { type?: string; url?: string; tiles?: string[]; [k: string]: unknown }>;
  glyphs?: string;
  sprite?: string | { id: string; url: string }[];
  [k: string]: unknown;
};

async function jsonWithCopy(url: string) {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    void put("assets", url, new TextEncoder().encode(text).buffer).catch(() => {});
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const saved = await get<ArrayBuffer>("assets", url);
    if (!saved) return null;
    return JSON.parse(new TextDecoder().decode(saved)) as Record<string, unknown>;
  }
}

/**
 * The base style with its tiles, fonts and icons pointed at "atlas://".
 * Returns the plain style URL if neither the network nor a saved copy has it.
 */
export async function offlineReadyStyle(): Promise<Style | string> {
  const style = (await jsonWithCopy(BASE_STYLE)) as Style | null;
  if (!style) return BASE_STYLE;
  const out: Style = { ...style, sources: { ...(style.sources ?? {}) } };
  for (const [id, source] of Object.entries(out.sources ?? {})) {
    if (source.url && /^https?:/.test(source.url)) {
      const tilejson = await jsonWithCopy(source.url);
      if (!tilejson || !Array.isArray(tilejson.tiles)) continue;
      const { url: _url, ...rest } = source;
      out.sources![id] = {
        ...rest,
        tiles: (tilejson.tiles as string[]).map(toAtlas),
        minzoom: (tilejson.minzoom as number | undefined) ?? 0,
        maxzoom: (tilejson.maxzoom as number | undefined) ?? 14,
        ...(tilejson.bounds ? { bounds: tilejson.bounds } : {}),
        ...(tilejson.attribution ? { attribution: tilejson.attribution } : {}),
      };
    } else if (Array.isArray(source.tiles)) {
      out.sources![id] = { ...source, tiles: source.tiles.map(toAtlas) };
    }
  }
  if (typeof out.glyphs === "string") out.glyphs = toAtlas(out.glyphs);
  if (typeof out.sprite === "string") out.sprite = toAtlas(out.sprite);
  else if (Array.isArray(out.sprite)) out.sprite = out.sprite.map((s) => ({ ...s, url: toAtlas(s.url) }));
  return out;
}

// ---------------------------------------------------------------- saving a state

export type SavedRegion = { abbr: string; zoom: number; tiles: number; bytes: number; savedAt: number; keys?: string[] };

function lon2x(lon: number, z: number) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function lat2y(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

/** Every tile covering a box, from zoom 0 down to the deepest zoom within the budget. */
export function tilesFor(box: { w: number; s: number; e: number; n: number }, budget = TILE_BUDGET) {
  const list: [number, number, number][] = [];
  let zoom = 0;
  for (let z = 0; z <= MAX_SAVE_ZOOM; z += 1) {
    const x0 = lon2x(box.w, z);
    const x1 = lon2x(box.e, z);
    const y0 = lat2y(box.n, z);
    const y1 = lat2y(box.s, z);
    const count = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (list.length + count > budget && z > 6) break;
    for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) list.push([z, x, y]);
    zoom = z;
  }
  return { zoom, list };
}

type OfflineMaps = {
  regions: SavedRegion[];
  /** The state being saved right now, and how far along. */
  saving: { abbr: string; done: number; total: number } | null;
  error: string | null;
  load: () => Promise<void>;
  save: (state: StateInfo) => Promise<void>;
  cancel: () => void;
  remove: (abbr: string) => Promise<void>;
};

let control: AbortController | null = null;

export const useOfflineMaps = create<OfflineMaps>((set, getState) => ({
  regions: [],
  saving: null,
  error: null,
  load: async () => {
    const regions = await all<SavedRegion>("regions");
    set({ regions: regions.sort((a, b) => a.abbr.localeCompare(b.abbr)) });
  },
  save: async (state) => {
    if (getState().saving) return;
    set({ error: null });
    // The style first: it says where tiles come from, and saves fonts and icons' addresses.
    const style = await offlineReadyStyle();
    const template = typeof style === "string" ? null : Object.values(style.sources ?? {}).find((s) => s.type === "vector" && Array.isArray(s.tiles))?.tiles?.[0];
    if (!template) {
      set({ error: "Couldn't reach the map server. Try again with a signal." });
      return;
    }
    const { zoom, list } = tilesFor(state);
    control = new AbortController();
    const signal = control.signal;
    set({ saving: { abbr: state.abbr, done: 0, total: list.length } });
    let bytes = 0;
    let failed = 0;
    const keys: string[] = [];
    let next = 0;
    let done = 0;
    async function worker() {
      while (next < list.length && !signal.aborted) {
        const [z, x, y] = list[next++]!;
        const key = `${z}/${x}/${y}`;
        try {
          let data = await get<ArrayBuffer>("tiles", key);
          if (!data) {
            data = await fetchBytes(fromAtlas(template!).replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)), signal);
            await put("tiles", key, data);
          }
          bytes += data.byteLength;
          keys.push(key);
        } catch {
          if (signal.aborted) return;
          failed += 1;
        }
        done += 1;
        if (done % 10 === 0 || done === list.length) set({ saving: { abbr: state.abbr, done, total: list.length } });
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker));
    control = null;
    if (signal.aborted) {
      set({ saving: null });
      return;
    }
    if (failed > list.length * 0.1) {
      set({ saving: null, error: `${failed} of ${list.length} pieces didn't download. Try again with a better signal.` });
      return;
    }
    const region: SavedRegion = { abbr: state.abbr, zoom, tiles: keys.length, bytes, savedAt: Date.now(), keys };
    await put("regions", state.abbr, region);
    set({ saving: null });
    await getState().load();
  },
  cancel: () => {
    control?.abort();
  },
  remove: async (abbr) => {
    const regions = await all<SavedRegion>("regions");
    const gone = regions.find((r) => r.abbr === abbr);
    if (!gone) return;
    // Keep tiles another saved state also uses (neighbors share their edges).
    const kept = new Set(regions.filter((r) => r.abbr !== abbr).flatMap((r) => r.keys ?? []));
    await del("tiles", (gone.keys ?? []).filter((key) => !kept.has(key)));
    await del("regions", [abbr]);
    await getState().load();
  },
}));

export function formatBytes(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
