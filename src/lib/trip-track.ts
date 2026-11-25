/**
 * The route of the trip that's recording, kept for its recap and for friends
 * on a shared trip. Fixes are thinned (one every 150 m), held on the device,
 * and uploaded in batches; a failed upload stays queued and goes with the next.
 */
import { appendTripTrack, type TrackPoint } from "@/lib/trips";
import { milesBetween } from "@/lib/nearby";

const STEP_MILES = 0.093; // about 150 m
const BATCH = 40;
const WAIT_MS = 3 * 60 * 1000;
const KEY = "atlas.trip-track";

type Queue = { tripId: string; points: TrackPoint[] };

let queue: Queue[] = read();
let last: { tripId: string; lat: number; lon: number } | null = null;
let lastSent = Date.now();
let sending: Promise<void> | null = null;

function read(): Queue[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Queue[];
    return Array.isArray(raw) ? raw.filter((row) => row && typeof row.tripId === "string" && Array.isArray(row.points)) : [];
  } catch {
    return [];
  }
}

function keep() {
  try {
    localStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    // Storage full: the points stay in memory until they upload.
  }
}

/** Note fixes for the recording trip. */
export function noteTripFixes(tripId: string | null, fixes: { lat: number; lon: number; t?: number }[]) {
  if (!tripId || !fixes.length) return;
  let row = queue.find((item) => item.tripId === tripId);
  if (!row) {
    row = { tripId, points: [] };
    queue.push(row);
  }
  for (const fix of fixes) {
    if (last && last.tripId === tripId && milesBetween(last.lat, last.lon, fix.lat, fix.lon) < STEP_MILES) continue;
    last = { tripId, lat: fix.lat, lon: fix.lon };
    row.points.push([fix.lon, fix.lat, fix.t ?? Date.now()]);
  }
  keep();
  const waiting = queue.reduce((n, item) => n + item.points.length, 0);
  if (waiting >= BATCH || Date.now() - lastSent > WAIT_MS) void flushTripTrack();
}

/** Upload what's waiting (also when a trip stops, so its recap has the whole route). */
export function flushTripTrack(): Promise<void> {
  if (sending) return sending;
  sending = (async () => {
    lastSent = Date.now();
    for (const row of [...queue]) {
      while (row.points.length) {
        const part = row.points.slice(0, 600);
        try {
          await appendTripTrack({ data: { tripId: row.tripId, points: part } });
        } catch {
          keep();
          return;
        }
        row.points.splice(0, part.length);
        keep();
      }
    }
    queue = queue.filter((row) => row.points.length);
    keep();
  })().finally(() => {
    sending = null;
  });
  return sending;
}

/** Points not uploaded yet, for a recap shown before the upload finishes. */
export function waitingPoints(tripId: string): TrackPoint[] {
  return queue.find((row) => row.tripId === tripId)?.points.slice() ?? [];
}

// ---------------------------------------------------------------- shapes

/** Break the route where the phone lost track for a while (no line across the gap). */
export function trackLines(points: TrackPoint[], gapMs = 45 * 60 * 1000, gapMiles = 25): [number, number][][] {
  const lines: [number, number][][] = [];
  let line: [number, number][] = [];
  let prev: TrackPoint | null = null;
  for (const point of points) {
    if (prev && (point[2] - prev[2] > gapMs || milesBetween(prev[1], prev[0], point[1], point[0]) > gapMiles)) {
      if (line.length > 1) lines.push(line);
      line = [];
    }
    line.push([point[0], point[1]]);
    prev = point;
  }
  if (line.length > 1) lines.push(line);
  return lines;
}

export function trackMiles(points: TrackPoint[]) {
  let miles = 0;
  for (const line of trackLines(points)) {
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1]!;
      const b = line[i]!;
      miles += milesBetween(a[1], a[0], b[1], b[0]);
    }
  }
  return miles;
}

/** At most `max` points per line, keeping the shape (every nth point plus the ends). */
export function thinLines(lines: [number, number][][], max: number): [number, number][][] {
  const total = lines.reduce((n, line) => n + line.length, 0);
  if (total <= max) return lines;
  const step = Math.ceil(total / max);
  return lines.map((line) => line.filter((_, i) => i % step === 0 || i === line.length - 1)).filter((line) => line.length > 1);
}
