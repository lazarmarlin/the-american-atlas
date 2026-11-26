/**
 * Speed and heading from the tracking fixes, for driving: Drive mode turning
 * itself on, a map that faces the way you're going and zooms out at highway
 * speed, and what's coming up ahead. Kept to the last few minutes.
 */
import { milesBetween, type Fix } from "@/lib/nearby";

type Point = { lat: number; lon: number; t: number };
const KEEP_MS = 6 * 60_000;
let points: Point[] = [];

export function noteMotion(fixes: Fix[]) {
  for (const fix of fixes) {
    if (typeof fix.t !== "number" || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) continue;
    const last = points[points.length - 1];
    if (last && fix.t <= last.t) continue;
    points.push({ lat: fix.lat, lon: fix.lon, t: fix.t });
  }
  const newest = points[points.length - 1]?.t ?? 0;
  points = points.filter((p) => newest - p.t <= KEEP_MS);
}

/** Points covering the last `ms` (with one before it, so the span is whole). */
function window(ms: number) {
  const newest = points[points.length - 1];
  if (!newest) return [];
  let start = points.length - 1;
  while (start > 0 && newest.t - points[start].t < ms) start--;
  return points.slice(start);
}

/**
 * Average speed over the last `ms`, along the path driven (mph), or null
 * if there isn't enough to tell. `whole` asks for the full span to be covered.
 */
export function speedMph(ms = 45_000, whole = false): number | null {
  const span = window(ms);
  if (span.length < 2) return null;
  const hours = (span[span.length - 1].t - span[0].t) / 3_600_000;
  if (hours <= 0) return null;
  if (whole && hours * 3_600_000 < ms * 0.9) return null;
  // A fix older than 3 minutes means it hasn't heard from the GPS lately.
  if (Date.now() - span[span.length - 1].t > 3 * 60_000) return 0;
  let miles = 0;
  for (let i = 1; i < span.length; i++) miles += milesBetween(span[i - 1].lat, span[i - 1].lon, span[i].lat, span[i].lon);
  return miles / hours;
}

/** Which way you're going (degrees, 0 = north), from at least 40 m back, or null when (nearly) still. */
export function heading(): number | null {
  const newest = points[points.length - 1];
  if (!newest) return null;
  for (let i = points.length - 2; i >= 0; i--) {
    const back = points[i];
    if (newest.t - back.t > 90_000) break;
    if (milesBetween(back.lat, back.lon, newest.lat, newest.lon) * 1609 < 40) continue;
    return bearing(back, newest);
  }
  return null;
}

export function bearing(from: { lat: number; lon: number }, to: { lat: number; lon: number }) {
  const rad = Math.PI / 180;
  const y = Math.sin((to.lon - from.lon) * rad) * Math.cos(to.lat * rad);
  const x = Math.cos(from.lat * rad) * Math.sin(to.lat * rad) - Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos((to.lon - from.lon) * rad);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}

/** How far apart two headings are (0–180°). */
export function turnBetween(a: number, b: number) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Map zoom for the speed: closer in town, further out on the highway (with a little give, so it doesn't flicker). */
export function zoomForSpeed(mph: number | null, current: number | undefined) {
  const steps: [number, number][] = [
    [0, 15],
    [22, 14],
    [42, 13.3],
    [62, 12.6],
  ];
  const v = mph ?? 0;
  let pick = 0;
  for (let i = 0; i < steps.length; i++) if (v >= steps[i][0]) pick = i;
  const now = current == null ? -1 : steps.findIndex(([, zoom]) => Math.abs(zoom - current) < 0.01);
  // Next to the line between this zoom and the one beside it: stay put until clearly past it (3 mph).
  if (now >= 0 && Math.abs(pick - now) === 1) {
    const line = steps[Math.max(pick, now)][0];
    if (Math.abs(v - line) < 3) return steps[now][1];
  }
  return steps[pick][1];
}

/** For tests. */
export function resetMotion() {
  points = [];
}
