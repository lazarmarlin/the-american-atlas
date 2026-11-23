import { create } from "zustand";
import {
  deleteGhostTrail,
  listGhostTrails,
  MAX_TRAILS,
  saveGhostTrail,
  setGhostTrailHidden,
  setGhostTrailShared,
  type PackedPoint,
  type SyncedTrail,
} from "@/lib/ghost-sync";
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
const MAX_SAVED = MAX_TRAILS;
/**
 * The live trail always keeps this much history; the hours slider only
 * changes how much of it is drawn and saved, so lowering it loses nothing.
 */
export const GHOST_KEEP_HOURS = 24;
/** Before trails were stored per account (and synced) they lived under this key. */
const LEGACY_KEY = "ghost-trails";
const keyFor = (userId: string) => `ghost-trails:${userId}`;

/** Saved-trail changes not yet on the server. */
type Pending = { upsert: string[]; remove: string[]; hide: string[]; share: string[] };
const noPending = (): Pending => ({ upsert: [], remove: [], hide: [], share: [] });

type Stored = {
  v: 2;
  live: GhostPoint[];
  saved: SavedGhost[];
  hidden: string[];
  /** Saved trails friends can see. Separate from hidden, which is about your own map. */
  shared?: string[];
  pending: Pending;
  /** True once this account's local trails have been merged with the server at least once. */
  synced: boolean;
};
type StoredV1 = { v: 1; live: GhostPoint[]; saved: SavedGhost[]; hidden: string[] };

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
  /** Account the trails on screen belong to (null when signed out). */
  userId: string | null;
  pending: Pending;
  synced: boolean;
  record: (fixes: Fix[]) => void;
  prune: (hours: number) => void;
  saveLive: (name: string, hours: number) => "short" | "full" | SavedGhost;
  removeSaved: (id: string) => void;
  toggleHidden: (id: string) => void;
  /** Saved trails your friends can see (off until you turn it on). */
  shared: string[];
  toggleShared: (id: string) => void;
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

/** Reads one key from the shared on-device store; resolves null on any failure. */
function readKey<T>(key: string): Promise<T | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return openDb()
    .then(
      (db) =>
        new Promise<T | null>((resolve) => {
          const req = db.transaction("kv").objectStore("kv").get(key);
          req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
          req.onerror = () => resolve(null);
        }),
    )
    .catch(() => null);
}

function writeKey(key: string, value: unknown | undefined): Promise<void> {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  return openDb()
    .then(
      (db) =>
        new Promise<void>((resolve) => {
          const store = db.transaction("kv", "readwrite").objectStore("kv");
          const req = value === undefined ? store.delete(key) : store.put(value, key);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
        }),
    )
    .catch(() => {});
}

async function readStored(userId: string): Promise<Stored | null> {
  const own = await readKey<Stored | StoredV1>(keyFor(userId));
  if (own && own.v === 2) return own;
  // First run after trails moved to per-account storage: adopt the old shared
  // copy for whoever is signed in now, and remove it so no one else sees it.
  const legacy = await readKey<StoredV1>(LEGACY_KEY);
  if (legacy && legacy.v === 1) {
    void writeKey(LEGACY_KEY, undefined);
    return { v: 2, live: legacy.live, saved: legacy.saved, hidden: legacy.hidden, pending: noPending(), synced: false };
  }
  return null;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave() {
  if (typeof indexedDB === "undefined") return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const { live, saved, hidden, shared, pending, synced, userId } = useGhost.getState();
    if (!userId) return; // signed out: nothing is kept on the device
    const payload: Stored = { v: 2, live, saved, hidden, shared, pending, synced };
    void writeKey(keyFor(userId), payload);
  }, 400);
}

const addTo = (list: string[], id: string) => (list.includes(id) ? list : [...list, id]);
const dropFrom = (list: string[], id: string) => list.filter((item) => item !== id);

export const useGhost = create<GhostState>((set, get) => ({
  live: [],
  saved: [],
  hidden: [],
  shared: [],
  focusId: null,
  look: 0,
  dirty: false,
  ready: false,
  userId: null,
  pending: noPending(),
  synced: false,
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
      // Time plus a random tail, so two devices saving at once can't collide.
      id: `g-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
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
      pending: { ...state.pending, upsert: addTo(state.pending.upsert, trail.id) },
    });
    scheduleSave();
    scheduleSync();
    return trail;
  },
  removeSaved: (id) => {
    set((state) => ({
      saved: state.saved.filter((item) => item.id !== id),
      hidden: state.hidden.filter((item) => item !== id),
      shared: state.shared.filter((item) => item !== id),
      focusId: state.focusId === id ? null : state.focusId,
      dirty: true,
      pending: {
        upsert: dropFrom(state.pending.upsert, id),
        hide: dropFrom(state.pending.hide, id),
        share: dropFrom(state.pending.share, id),
        remove: addTo(state.pending.remove, id),
      },
    }));
    scheduleSave();
    scheduleSync();
  },
  toggleHidden: (id) => {
    set((state) => ({
      hidden: state.hidden.includes(id) ? state.hidden.filter((item) => item !== id) : [...state.hidden, id],
      dirty: true,
      pending: { ...state.pending, hide: addTo(state.pending.hide, id) },
    }));
    scheduleSave();
    scheduleSync();
  },
  toggleShared: (id) => {
    set((state) => ({
      shared: state.shared.includes(id) ? state.shared.filter((item) => item !== id) : [...state.shared, id],
      dirty: true,
      pending: { ...state.pending, share: addTo(state.pending.share, id) },
    }));
    scheduleSave();
    scheduleSync();
  },
  lookAt: (id) => set((state) => ({ focusId: id, look: state.look + 1 })),
}));

// ---------------------------------------------------------------- loading, sync, sign-out

let loadingFor: string | null = null;

/**
 * Load the signed-in account's trails from the device, then merge with the
 * server. Call again when the account changes; signed out (null) shows none.
 */
export function loadGhost(userId: string | null) {
  const state = useGhost.getState();
  if (userId === loadingFor && (state.ready || userId === null)) return;
  if (state.userId !== userId) {
    // Another account's trails never stay on screen.
    useGhost.setState({ live: [], saved: [], hidden: [], shared: [], focusId: null, dirty: false, ready: false, userId, pending: noPending(), synced: false });
  }
  loadingFor = userId;
  if (!userId) {
    useGhost.setState({ ready: true });
    return;
  }
  void readStored(userId).then((data) => {
    if (useGhost.getState().userId !== userId) return; // switched accounts meanwhile
    useGhost.setState((cur) => {
      if (!data) return { ready: true };
      const diskLive = freshPoints(
        (Array.isArray(data.live) ? data.live : []).map(asPoint).filter((point): point is GhostPoint => point !== null),
        GHOST_KEEP_HOURS,
      );
      const diskSaved = (Array.isArray(data.saved) ? data.saved : [])
        .map(asSaved)
        .filter((item): item is SavedGhost => item !== null)
        .slice(0, MAX_SAVED);
      const diskHidden = (Array.isArray(data.hidden) ? data.hidden : []).filter((id) => typeof id === "string");
      const diskPending: Pending = {
        upsert: (data.pending?.upsert ?? []).filter((id) => typeof id === "string"),
        remove: (data.pending?.remove ?? []).filter((id) => typeof id === "string"),
        hide: (data.pending?.hide ?? []).filter((id) => typeof id === "string"),
        share: (data.pending?.share ?? []).filter((id) => typeof id === "string"),
      };
      const diskShared = (Array.isArray(data.shared) ? data.shared : []).filter((id) => typeof id === "string");
      if (!cur.dirty) {
        return {
          live: diskLive,
          saved: diskSaved,
          hidden: diskHidden,
          shared: diskShared,
          pending: diskPending,
          synced: Boolean(data.synced),
          ready: true,
        };
      }
      const known = new Set(cur.saved.map((item) => item.id));
      return {
        live: joinTrail(diskLive, cur.live),
        saved: [...cur.saved, ...diskSaved.filter((item) => !known.has(item.id))],
        hidden: cur.hidden.length ? cur.hidden : diskHidden,
        shared: cur.shared.length ? cur.shared : diskShared,
        pending: {
          upsert: [...new Set([...diskPending.upsert, ...cur.pending.upsert])],
          remove: [...new Set([...diskPending.remove, ...cur.pending.remove])],
          hide: [...new Set([...diskPending.hide, ...cur.pending.hide])],
          share: [...new Set([...diskPending.share, ...cur.pending.share])],
        },
        synced: Boolean(data.synced),
        ready: true,
        dirty: true,
      };
    });
    void syncGhost();
  });
}

const pack = (points: GhostPoint[]): PackedPoint[] => points.map((p) => (p.brk ? [p.lat, p.lon, p.t, 1] : [p.lat, p.lon, p.t]));
const unpack = (points: PackedPoint[]): GhostPoint[] =>
  points.map((p) => (p[3] === 1 ? { lat: p[0], lon: p[1], t: p[2], brk: true } : { lat: p[0], lon: p[1], t: p[2] }));

let syncing: Promise<void> | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void syncGhost();
  }, 800);
}

/**
 * Push queued saves, deletes and show/hide changes, then pull the account's
 * trails. Safe to call any time; it does nothing offline or signed out, and
 * whatever fails stays queued for next time.
 */
export function syncGhost(): Promise<void> {
  syncing ??= runSync().finally(() => {
    syncing = null;
  });
  return syncing;
}

async function runSync() {
  const start = useGhost.getState();
  const userId = start.userId;
  if (!userId || !start.ready) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const still = () => useGhost.getState().userId === userId;

  // Trails saved on this device before syncing existed get uploaded once.
  if (!start.synced) {
    useGhost.setState((s) => ({ pending: { ...s.pending, upsert: [...new Set([...s.pending.upsert, ...s.saved.map((t) => t.id)])] } }));
  }

  try {
    for (const id of [...useGhost.getState().pending.remove]) {
      await deleteGhostTrail({ data: id });
      if (!still()) return;
      useGhost.setState((s) => ({ pending: { ...s.pending, remove: dropFrom(s.pending.remove, id) } }));
    }
    for (const id of [...useGhost.getState().pending.upsert]) {
      const cur = useGhost.getState();
      const trail = cur.saved.find((t) => t.id === id);
      if (trail && trail.points.length >= 2) {
        try {
          await saveGhostTrail({
            data: {
              id: trail.id,
              name: trail.name,
              startedAt: trail.startedAt,
              savedAt: trail.savedAt,
              hidden: cur.hidden.includes(trail.id),
              shared: cur.shared.includes(trail.id),
              points: pack(trail.points),
            },
          });
        } catch (err) {
          // A trail the server refuses (over the limit, unreadable) stays on
          // this device only rather than retrying forever.
          if (!/limit|up to|too (short|long)|Bad trail|Unknown trail/i.test(String((err as Error)?.message ?? err))) throw err;
        }
      }
      if (!still()) return;
      useGhost.setState((s) => ({ pending: { ...s.pending, upsert: dropFrom(s.pending.upsert, id) } }));
    }
    for (const id of [...useGhost.getState().pending.hide]) {
      await setGhostTrailHidden({ data: { id, hidden: useGhost.getState().hidden.includes(id) } });
      if (!still()) return;
      useGhost.setState((s) => ({ pending: { ...s.pending, hide: dropFrom(s.pending.hide, id) } }));
    }
    for (const id of [...useGhost.getState().pending.share]) {
      await setGhostTrailShared({ data: { id, shared: useGhost.getState().shared.includes(id) } });
      if (!still()) return;
      useGhost.setState((s) => ({ pending: { ...s.pending, share: dropFrom(s.pending.share, id) } }));
    }

    const remote: SyncedTrail[] = await listGhostTrails();
    if (!still()) return;
    useGhost.setState((s) => {
      // The server is the record; anything still queued here wins over it.
      const queued = new Set([...s.pending.upsert]);
      const gone = new Set(s.pending.remove);
      const fromServer: SavedGhost[] = remote
        .filter((t) => !gone.has(t.id) && !queued.has(t.id))
        .map((t) => ({ id: t.id, name: t.name, savedAt: t.savedAt, startedAt: t.startedAt, points: unpack(t.points) }));
      const localOnly = s.saved.filter((t) => queued.has(t.id));
      const saved = [...localOnly, ...fromServer].sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_SAVED);
      const ids = new Set(saved.map((t) => t.id));
      const hidePending = new Set(s.pending.hide);
      const sharePending = new Set(s.pending.share);
      const hidden = [
        ...remote.filter((t) => t.hidden && ids.has(t.id) && !hidePending.has(t.id)).map((t) => t.id),
        ...s.hidden.filter((id) => ids.has(id) && (hidePending.has(id) || queued.has(id))),
      ];
      return {
        saved,
        hidden: [...new Set(hidden)],
        shared: [
          ...new Set([
            ...remote.filter((t) => t.shared && ids.has(t.id) && !sharePending.has(t.id)).map((t) => t.id),
            ...s.shared.filter((id) => ids.has(id) && (sharePending.has(id) || queued.has(id))),
          ]),
        ],
        focusId: s.focusId && s.focusId !== "live" && !ids.has(s.focusId) ? null : s.focusId,
        synced: true,
      };
    });
  } catch {
    // Offline or the server is unreachable: keep the queue for next time.
  }
  scheduleSave();
}

/** Remove this account's trails from the device (they are on the account). Use before signing out. */
export async function clearGhostLocal(): Promise<void> {
  const { userId } = useGhost.getState();
  try {
    await Promise.race([syncGhost(), new Promise((resolve) => setTimeout(resolve, 3000))]);
  } catch {
    /* sign-out goes ahead regardless */
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  loadingFor = null;
  useGhost.setState({ live: [], saved: [], hidden: [], shared: [], focusId: null, dirty: false, ready: true, userId: null, pending: noPending(), synced: false });
  if (userId) await writeKey(keyFor(userId), undefined);
}

// ---------------------------------------------------------------- drawing

type XY = [number, number];

/** Meters between two [lon, lat] points (flat approximation, fine at trail scale). */
function metersXY(a: XY, b: XY) {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  const dx = (b[0] - a[0]) * 111_320 * k;
  const dy = (b[1] - a[1]) * 110_540;
  return Math.hypot(dx, dy);
}

/** How sharply the path turns at b, in degrees (0 = straight on, 180 = straight back). */
function turnAt(a: XY, b: XY, c: XY) {
  const k = Math.cos((b[1] * Math.PI) / 180);
  const ux = (b[0] - a[0]) * k;
  const uy = b[1] - a[1];
  const vx = (c[0] - b[0]) * k;
  const vy = c[1] - b[1];
  const lu = Math.hypot(ux, uy);
  const lv = Math.hypot(vx, vy);
  if (!lu || !lv) return 0;
  const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * GPS wanders a few meters at low speed (lights, parking lots), which shows up
 * as needle-thin spikes. Drop points that double back sharply over a short
 * hop; real turns at intersections are kept.
 */
function dropSpikes(line: XY[]): XY[] {
  let pts = line;
  for (let pass = 0; pass < 4 && pts.length > 2; pass++) {
    const out: XY[] = [pts[0]!];
    let changed = false;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = out[out.length - 1]!;
      const b = pts[i]!;
      const c = pts[i + 1]!;
      const turn = turnAt(a, b, c);
      const short = Math.min(metersXY(a, b), metersXY(b, c));
      if ((turn > 100 && short < 150) || (turn > 55 && short < 35)) {
        changed = true;
        continue;
      }
      out.push(b);
    }
    out.push(pts[pts.length - 1]!);
    pts = out;
    if (!changed) break;
  }
  return pts;
}

/** Douglas–Peucker in meters: removes wobble smaller than `tol`. */
function simplify(line: XY[], tol: number): XY[] {
  if (line.length < 3) return line;
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const a = line[s]!;
    const b = line[e]!;
    const ab = metersXY(a, b);
    let worst = -1;
    let at = -1;
    for (let i = s + 1; i < e; i++) {
      const p = line[i]!;
      // Distance from p to segment ab via the triangle's area.
      const d =
        ab === 0
          ? metersXY(a, p)
          : (() => {
              const pa = metersXY(p, a);
              const pb = metersXY(p, b);
              const sp = (pa + pb + ab) / 2;
              const area = Math.sqrt(Math.max(0, sp * (sp - pa) * (sp - pb) * (sp - ab)));
              return (2 * area) / ab;
            })();
      if (d > worst) [worst, at] = [d, i];
    }
    if (worst > tol && at > 0) {
      keep[at] = 1;
      stack.push([s, at], [at, e]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

/** Chaikin corner cutting: rounds the corners so the trail reads as a soft path. */
function rounded(line: XY[], passes: number): XY[] {
  let pts = line;
  for (let n = 0; n < passes && pts.length > 2; n++) {
    const out: XY[] = [pts[0]!];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i]!;
      const [x1, y1] = pts[i + 1]!;
      out.push(
        [x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25],
        [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75],
      );
    }
    out.push(pts[pts.length - 1]!);
    pts = out;
  }
  return pts;
}

/**
 * The shape the map draws for one trail line: GPS spikes removed, small
 * wobble flattened, corners softened. Stored points are never changed.
 */
export function displayLine(line: XY[]): XY[] {
  if (line.length < 3) return line;
  return rounded(simplify(dropSpikes(line), 6), 2);
}
