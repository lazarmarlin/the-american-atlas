/**
 * Finds stops in the tracking fixes: somewhere you stayed within about
 * 150 m for 10 minutes or more (gas, a meal, a job site). While you're
 * parked the location service often sends nothing at all, so a long gap
 * between two nearby fixes counts as time spent there too.
 *
 * Each stop gets a name (a place within ~0.15 mi, else "Near <town>") and is
 * kept with your account; ones that couldn't upload yet wait on the phone.
 */
import type { StateInfo } from "@/lib/atlas-model";
import { milesBetween, placesNear, type Fix } from "@/lib/nearby";
import { saveStops, type GpsStop } from "@/lib/stops";

const RADIUS_M = 150;
const MIN_STOP_MS = 10 * 60_000;
/** For a gap that ends somewhere else: assume you left in time to get there at this speed. */
const DRIVE_MPS = 11; // about 25 mph
const CLUSTER_KEY = "atlas.stop-cluster";
const PENDING_KEY = "atlas.stops-pending";

type Cluster = { lat: number; lon: number; start: number; end: number; n: number };
export type FoundStop = { lat: number; lon: number; start: number; end: number };

function meters(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  return milesBetween(a.lat, a.lon, b.lat, b.lon) * 1609.34;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* fine */
  }
}

/**
 * Pure: run fixes through the cluster, returning the stops that ended and
 * the cluster still open (where you are now). Fixes older than the cluster's
 * end are ignored, so a batch read back twice changes nothing.
 */
export function detectStops(cluster: Cluster | null, fixes: Fix[]): { stops: FoundStop[]; cluster: Cluster | null } {
  const stops: FoundStop[] = [];
  let c = cluster ? { ...cluster } : null;
  const sorted = fixes.filter((f) => typeof f.t === "number").sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  for (const fix of sorted) {
    const t = fix.t as number;
    if (!c) {
      c = { lat: fix.lat, lon: fix.lon, start: t, end: t, n: 1 };
      continue;
    }
    if (t <= c.end) continue;
    const d = meters(c, fix);
    if (d <= RADIUS_M) {
      // Still here: the middle drifts toward where most fixes are.
      c.n += 1;
      c.lat += (fix.lat - c.lat) / c.n;
      c.lon += (fix.lon - c.lon) / c.n;
      c.end = t;
      continue;
    }
    // Moved on. With no fixes in between, you stayed until it was time to drive here.
    const left = Math.max(c.end, Math.min(t, t - (d / DRIVE_MPS) * 1000));
    if (left - c.start >= MIN_STOP_MS) stops.push({ lat: c.lat, lon: c.lon, start: c.start, end: Math.round(left) });
    c = { lat: fix.lat, lon: fix.lon, start: t, end: t, n: 1 };
  }
  return { stops, cluster: c };
}

/** Feed tracking fixes; returns stops that just ended. Remembers where you are across app restarts. */
export function noteStopFixes(fixes: Fix[]): FoundStop[] {
  if (!fixes.length) return [];
  const { stops, cluster } = detectStops(readJson<Cluster | null>(CLUSTER_KEY, null), fixes);
  writeJson(CLUSTER_KEY, cluster);
  return stops;
}

/** Where you've been sitting for 10+ minutes right now, if anywhere. */
export function currentStop(): FoundStop | null {
  const c = readJson<Cluster | null>(CLUSTER_KEY, null);
  if (!c || c.end - c.start < MIN_STOP_MS || Date.now() - c.end > 6 * 3600_000) return null;
  return { lat: c.lat, lon: c.lon, start: c.start, end: c.end };
}

/** A name for the spot: a place on the atlas right there, else the nearest town. */
export async function labelStop(stop: FoundStop, states: StateInfo[]): Promise<{ label: string; state: string; poiId: string | null }> {
  try {
    const near = await placesNear({ lat: stop.lat, lon: stop.lon }, states, 60);
    const spot = near.find((m) => m.category !== "route" && m.category !== "town" && m.category !== "county" && m.miles <= 0.15);
    if (spot) return { label: spot.name, state: spot.state, poiId: spot.id };
    const town = near.find((m) => m.category === "town");
    if (town) return { label: town.miles <= 1 ? town.name : `Near ${town.name}`, state: town.state, poiId: null };
    const any = near.find((m) => m.category !== "route");
    return { label: any ? `Near ${any.name}` : "Stop", state: any?.state ?? "", poiId: null };
  } catch {
    return { label: "Stop", state: "", poiId: null };
  }
}

export function stopId(stop: FoundStop) {
  return `s-${stop.start.toString(36)}`;
}

let flushing = false;

/** Upload stops waiting on the phone. */
export async function flushStops() {
  const pending = readJson<GpsStop[]>(PENDING_KEY, []);
  if (!pending.length || flushing) return;
  flushing = true;
  try {
    await saveStops({ data: { stops: pending } });
    const now = readJson<GpsStop[]>(PENDING_KEY, []);
    writeJson(PENDING_KEY, now.filter((s) => !pending.some((p) => p.id === s.id)));
  } catch {
    /* next time */
  } finally {
    flushing = false;
  }
}

/** Name a found stop, keep it on the phone until it uploads, and try now. Returns it named. */
export async function keepStop(stop: FoundStop, states: StateInfo[]): Promise<GpsStop> {
  const named = await labelStop(stop, states);
  const row: GpsStop = { id: stopId(stop), ...stop, ...named };
  writeJson(PENDING_KEY, [...readJson<GpsStop[]>(PENDING_KEY, []).filter((s) => s.id !== row.id), row].slice(-200));
  void flushStops();
  return row;
}

/** Stops found on this phone that haven't uploaded yet (so they show straight away). */
export function pendingStops(): GpsStop[] {
  return readJson<GpsStop[]>(PENDING_KEY, []);
}

/** A stop removed before it uploaded: don't upload it after all. */
export function forgetPendingStop(id: string) {
  writeJson(PENDING_KEY, readJson<GpsStop[]>(PENDING_KEY, []).filter((s) => s.id !== id));
}
