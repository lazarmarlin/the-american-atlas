import { create } from "zustand";
import { milesBetween, type Fix } from "@/lib/nearby";

/** One sample of where you were. `brk` starts a new wisp so a long jump is not a line across the map. */
export type GhostPoint = { lat: number; lon: number; t: number; brk?: boolean };

export type SavedGhost = {
  id: string;
  name: string;
  savedAt: number;
  startedAt: number;
  points: GhostPoint[];
};

export type GhostLines = [number, number][][];

const MIN_METERS = 28;
const BREAK_MILES = 25;
const MAX_SAVED = 30;
const KEY = "ghost-trails";

type Stored = { v: 1; live: GhostPoint[]; saved: SavedGhost[]; hidden: string[] };

type GhostState = {
  live: GhostPoint[];
  saved: SavedGhost[];
  hidden: string[];
  /** "live" or a saved trail id. Session only. */
  focusId: string | null;
  /** Bumps when the user asks the map to frame a trail. */
  look: number;
  dirty: boolean;
  ready: boolean;
  record: (fixes: Fix[]) => void;
  prune: (hours: number) => void;
  saveLive: (name: string, hours: number) => "short" | "full" | SavedGhost;
  removeSaved: (id: string) => void;
  toggleHidden: (id: string) => void;
  lookAt: (id: string | null) => void;
};

function meters(a: GhostPoint, b: { lat: number; lon: number }) {
  return milesBetween(a.lat, a.lon, b.lat, b.lon) * 1609.344;
}

function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δλ = ((b.lon - a.lon) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function sharp(a: GhostPoint, b: GhostPoint, c: GhostPoint) {
  let turn = Math.abs(bearing(a, b) - bearing(b, c));
  if (turn > 180) turn = 360 - turn;
  return turn > 28;
}

export function thinTrail(points: GhostPoint[], minMeters: number): GhostPoint[] {
  if (points.length < 3) return points;
  const kept: GhostPoint[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const cur = points[i]!;
    if (cur.brk) {
      kept.push(cur);
      continue;
    }
    const prev = kept[kept.length - 1]!;
    if (prev.brk || meters(prev, cur) >= minMeters || sharp(prev, cur, points[i + 1]!)) kept.push(cur);
  }
  const last = points[points.length - 1]!;
  if (kept[kept.length - 1] !== last) kept.push(last);
  if (kept.length > 4000 && minMeters < 180) return thinTrail(kept, minMeters * 1.5);
  return kept;
}

function validFix(lat: number, lon: number) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

export function appendTrail(points: GhostPoint[], fixes: Fix[], now = Date.now()): GhostPoint[] {
  let next = points;
  for (const fix of fixes) {
    if (!validFix(fix.lat, fix.lon)) continue;
    const last = next[next.length - 1];
    if (!last) {
      next = [{ lat: fix.lat, lon: fix.lon, t: now }];
      continue;
    }
    const miles = milesBetween(last.lat, last.lon, fix.lat, fix.lon);
    if (miles * 1609.344 < MIN_METERS) continue;
    const point: GhostPoint = miles > BREAK_MILES ? { lat: fix.lat, lon: fix.lon, t: now, brk: true } : { lat: fix.lat, lon: fix.lon, t: now };
    next = next.length > 3400 ? thinTrail([...next, point], 55) : [...next, point];
  }
  return next;
}

function joinTrail(base: GhostPoint[], extra: GhostPoint[]) {
  let next = base;
  for (const point of extra) {
    const last = next[next.length - 1];
    if (!last) {
      next = [point];
      continue;
    }
    if (!point.brk && meters(last, point) < MIN_METERS) continue;
    next = next.length > 3400 ? thinTrail([...next, point], 55) : [...next, point];
  }
  return next;
}

export function freshPoints(points: GhostPoint[], hours: number, now = Date.now()) {
  const cutoff = now - hours * 3_600_000;
  return points.filter((point) => point.t >= cutoff);
}

export function trailLines(points: GhostPoint[]): GhostLines {
  const lines: GhostLines = [];
  let cur: [number, number][] = [];
  for (const point of points) {
    if (point.brk && cur.length) {
      if (cur.length >= 2) lines.push(cur);
      cur = [];
    }
    cur.push([point.lon, point.lat]);
  }
  if (cur.length >= 2) lines.push(cur);
  return lines;
}

export function trailMiles(points: GhostPoint[]) {
  let miles = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i]?.brk) continue;
    const prev = points[i - 1];
    const cur = points[i];
    if (!prev || !cur) continue;
    miles += milesBetween(prev.lat, prev.lon, cur.lat, cur.lon);
  }
  return miles;
}

export function formatMiles(miles: number) {
  if (miles < 0.1) return "Just started";
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles).toLocaleString()} mi`;
}

export function suggestTrailName(t: number) {
  const when = new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `Trail · ${when}`.slice(0, 40);
}

function asPoint(value: unknown): GhostPoint | null {
  if (!value || typeof value !== "object") return null;
  const row = value as GhostPoint;
  if (!validFix(row.lat, row.lon) || !Number.isFinite(row.t)) return null;
  return row.brk ? { lat: row.lat, lon: row.lon, t: row.t, brk: true } : { lat: row.lat, lon: row.lon, t: row.t };
}

function asSaved(value: unknown): SavedGhost | null {
  if (!value || typeof value !== "object") return null;
  const row = value as SavedGhost;
  if (typeof row.id !== "string" || typeof row.name !== "string") return null;
  const points = Array.isArray(row.points) ? row.points.map(asPoint).filter((point): point is GhostPoint => point !== null) : [];
  if (points.length < 2) return null;
  return {
    id: row.id.slice(0, 40),
    name: row.name.trim().slice(0, 40) || "Trail",
    savedAt: Number.isFinite(row.savedAt) ? row.savedAt : points[0]!.t,
    startedAt: Number.isFinite(row.startedAt) ? row.startedAt : points[0]!.t,
    points,
  };
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("american-atlas", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readStored(): Promise<Stored | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return openDb().then(
    (db) =>
      new Promise((resolve) => {
        const req = db.transaction("kv").objectStore("kv").get(KEY);
        req.onsuccess = () => {
          const raw = req.result as Stored | undefined;
          if (!raw || raw.v !== 1) {
            resolve(null);
            return;
          }
          resolve(raw);
        };
        req.onerror = () => resolve(null);
      }),
  );
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave() {
  if (typeof indexedDB === "undefined") return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const { live, saved, hidden } = useGhost.getState();
    const payload: Stored = { v: 1, live, saved, hidden };
    void openDb()
      .then(
        (db) =>
          new Promise<void>((resolve) => {
            const req = db.transaction("kv", "readwrite").objectStore("kv").put(payload, KEY);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
          }),
      )
      .catch(() => {});
  }, 400);
}

export const useGhost = create<GhostState>((set, get) => ({
  live: [],
  saved: [],
  hidden: [],
  focusId: null,
  look: 0,
  dirty: false,
  ready: false,
  record: (fixes) => {
    if (!fixes.length) return;
    set((state) => {
      const live = appendTrail(state.live, fixes);
      if (live === state.live) return state;
      scheduleSave();
      return { live, dirty: true };
    });
  },
  prune: (hours) => {
    set((state) => {
      const live = freshPoints(state.live, hours);
      if (live.length === state.live.length) return state;
      scheduleSave();
      return { live, dirty: true };
    });
  },
  saveLive: (name, hours) => {
    const state = get();
    const live = thinTrail(freshPoints(state.live, hours), 40);
    if (!trailLines(live).length) return "short";
    if (state.saved.length >= MAX_SAVED) return "full";
    const trail: SavedGhost = {
      id: `g-${Date.now().toString(36)}`,
      name: name.trim().slice(0, 40) || suggestTrailName(live[0]?.t ?? Date.now()),
      savedAt: Date.now(),
      startedAt: live[0]?.t ?? Date.now(),
      points: live,
    };
    set({
      saved: [trail, ...state.saved.filter((item) => item.id !== trail.id)],
      focusId: trail.id,
      look: state.look + 1,
      dirty: true,
    });
    scheduleSave();
    return trail;
  },
  removeSaved: (id) => {
    set((state) => ({
      saved: state.saved.filter((item) => item.id !== id),
      hidden: state.hidden.filter((item) => item !== id),
      focusId: state.focusId === id ? null : state.focusId,
      dirty: true,
    }));
    scheduleSave();
  },
  toggleHidden: (id) => {
    set((state) => ({
      hidden: state.hidden.includes(id) ? state.hidden.filter((item) => item !== id) : [...state.hidden, id],
      dirty: true,
    }));
    scheduleSave();
  },
  lookAt: (id) => set((state) => ({ focusId: id, look: state.look + 1 })),
}));

let loading = false;

export function loadGhost(hours: number) {
  if (loading || typeof indexedDB === "undefined") return;
  loading = true;
  void readStored().then((data) => {
    useGhost.setState((state) => {
      if (!data) return { ready: true };
      const diskLive = freshPoints(
        (Array.isArray(data.live) ? data.live : []).map(asPoint).filter((point): point is GhostPoint => point !== null),
        hours,
      );
      const diskSaved = (Array.isArray(data.saved) ? data.saved : [])
        .map(asSaved)
        .filter((item): item is SavedGhost => item !== null)
        .slice(0, MAX_SAVED);
      const diskHidden = (Array.isArray(data.hidden) ? data.hidden : []).filter((id) => typeof id === "string");
      if (!state.dirty) {
        return { live: diskLive, saved: diskSaved, hidden: diskHidden, ready: true };
      }
      const known = new Set(state.saved.map((item) => item.id));
      return {
        live: joinTrail(diskLive, state.live),
        saved: [...state.saved, ...diskSaved.filter((item) => !known.has(item.id))],
        hidden: state.hidden.length ? state.hidden : diskHidden,
        ready: true,
        dirty: true,
      };
    });
  });
}
