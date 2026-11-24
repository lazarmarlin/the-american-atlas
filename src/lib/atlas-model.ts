import { ATLAS_CACHE, OFFLINE_PACK_VERSION, OFFLINE_READY_KEY, readAtlasFile } from "@/lib/atlas-files";
import { nativeApp } from "@/lib/native";

export type System = "I" | "US" | "SR" | "PK";

export type StateInfo = {
  abbr: string;
  name: string;
  w: number;
  s: number;
  e: number;
  n: number;
};

export type CategoryInfo = {
  id: string;
  label: string;
  count: number;
};

export type AtlasMeta = {
  states: StateInfo[];
  categories: CategoryInfo[];
};

export type CatalogPlace = {
  id: string;
  name: string;
  lat: number | null;
  lon: number | null;
  pts: number;
  paths?: number[][][];
};

export type RoadRec = {
  id: string;
  name: string;
  sys: System;
  ref: string;
  lat: number;
  lon: number;
  pts: number;
  paths?: [number, number][][];
};

const placeCache = new Map<string, CatalogPlace[]>();
const roadCache = new Map<string, RoadRec[]>();
const countyCache = new Map<string, { id: string; name: string; lat: number; lon: number; rings: number[][][] }[]>();
const bundleCache = new Map<string, Record<string, CatalogPlace[]>>();
const bundleTasks = new Map<string, Promise<Record<string, CatalogPlace[]> | null>>();

export function forgetAtlasLists() {
  placeCache.clear();
  roadCache.clear();
  countyCache.clear();
  bundleCache.clear();
  bundleTasks.clear();
}

export function tokenColor(name: string, fallback: string) {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function norm(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function refRank(ref: string) {
  const match = /^(\d+)/.exec(ref);
  return match ? Number(match[1]) : 100000;
}

function localFirst() {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  try {
    return localStorage.getItem(OFFLINE_READY_KEY) === OFFLINE_PACK_VERSION;
  } catch {
    return false;
  }
}

async function readStored(url: string) {
  const text = await readAtlasFile(url);
  if (text) return new Response(text, { headers: { "content-type": "application/json" } });
  const cache = typeof caches === "undefined" ? null : await caches.open(ATLAS_CACHE);
  if (!cache) return null;
  return (await cache.match(url)) ?? null;
}

async function cachedFetch(url: string) {
  // The Android app has every atlas file built in and served locally, so it
  // reads them straight from the app, online or not, and never keeps a copy
  // that could go stale after an app update.
  if (nativeApp) return fetch(url);
  if (localFirst()) {
    const stored = await readStored(url);
    if (stored) return stored;
  }
  const cache = typeof caches === "undefined" ? null : await caches.open(ATLAS_CACHE);
  try {
    const res = await fetch(url);
    if (res.ok && cache) await cache.put(url, res.clone());
    if (res.ok) return res;
    const hit = await readStored(url);
    if (hit) return hit;
    return res;
  } catch {
    const hit = await readStored(url);
    if (hit) return hit;
    throw new Error("You're offline and that part of the atlas isn't saved on this device yet.");
  }
}

let registerAlso: Promise<Record<string, string>> | null = null;

/**
 * Places that are also National Register listings: the Register copy was
 * merged into them (scripts/fix-atlas-data.mjs). Place id → Register id.
 */
export function loadRegisterAlso() {
  registerAlso ??= import("@/lib/register-also.json")
    .then((mod) => mod.default as Record<string, string>)
    .catch(() => ({}));
  return registerAlso;
}

export async function loadMeta(): Promise<AtlasMeta> {
  const res = await cachedFetch("/atlas/meta.json");
  if (!res.ok) throw new Error("The atlas didn't load.");
  void cachedFetch("/atlas/states.geojson").catch(() => {});
  return (await res.json()) as AtlasMeta;
}

async function stateBundle(state: string) {
  const saved = bundleCache.get(state);
  if (saved) return saved;
  let task = bundleTasks.get(state);
  if (!task) {
    task = (async () => {
      try {
        const res = await cachedFetch(`/atlas/places/${state}.json`);
        if (!res.ok) return null;
        const data = (await res.json()) as Record<string, CatalogPlace[]>;
        if (!data || typeof data !== "object" || Array.isArray(data)) return null;
        bundleCache.set(state, data);
        return data;
      } catch {
        return null;
      } finally {
        bundleTasks.delete(state);
      }
    })();
    bundleTasks.set(state, task);
  }
  return task;
}

export async function loadPlaces(cat: string, state: string): Promise<CatalogPlace[]> {
  const key = `${cat}/${state}`;
  const hit = placeCache.get(key);
  if (hit) return hit;
  const bundle = await stateBundle(state);
  if (bundle) {
    const rows = Array.isArray(bundle[cat]) ? bundle[cat] : [];
    placeCache.set(key, rows);
    return rows;
  }
  try {
    const res = await cachedFetch(`/atlas/cat/${cat}/${state}.json`);
    if (!res.ok) return [];
    const rows = (await res.json()) as CatalogPlace[];
    if (!Array.isArray(rows)) return [];
    placeCache.set(key, rows);
    return rows;
  } catch {
    return [];
  }
}

export async function loadCounties(state: string) {
  const hit = countyCache.get(state);
  if (hit) return hit;
  try {
    const res = await cachedFetch(`/atlas/counties/${state}.json`);
    if (!res.ok) return [];
    const rows = (await res.json()) as { id: string; name: string; lat: number; lon: number; rings: number[][][] }[];
    if (!Array.isArray(rows)) return [];
    countyCache.set(state, rows);
    return rows;
  } catch {
    return [];
  }
}

export async function loadRoads(state: string): Promise<RoadRec[]> {
  const hit = roadCache.get(state);
  if (hit) return hit;
  try {
    const res = await cachedFetch(`/atlas/roads/${state}.json`);
    if (!res.ok) return [];
    const rows = (await res.json()) as RoadRec[];
    if (!Array.isArray(rows)) return [];
    roadCache.set(state, rows);
    return rows;
  } catch {
    return [];
  }
}

export function roadMatches(road: RoadRec, query: string) {
  const q = norm(query);
  if (!q) return true;
  return norm(road.name).includes(q) || norm(`${road.sys}${road.ref}`).includes(q) || norm(road.ref).includes(q);
}

export function placeMatches(place: CatalogPlace, query: string) {
  const q = norm(query);
  if (!q) return true;
  return norm(place.name).includes(q);
}
