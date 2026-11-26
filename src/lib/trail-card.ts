/**
 * A ghost trail as a chat card. The first and last 500 meters are left off,
 * the same way a trail shared from your page doesn't point at home.
 */
import { milesBetween } from "@/lib/nearby";

export type ChatTrail = {
  name: string;
  miles: number;
  day: string | null;
  lines: [number, number][][];
};

type Point = { lat: number; lon: number; brk?: boolean };

const TRIM_M = 500;

function meters(a: Point, b: Point) {
  return milesBetween(a.lat, a.lon, b.lat, b.lon) * 1609.344;
}

function trimEnds(points: Point[]) {
  if (points.length < 2) return [];
  const along: number[] = [0];
  for (let i = 1; i < points.length; i += 1) {
    const hop = points[i]?.brk ? 0 : meters(points[i - 1] as Point, points[i] as Point);
    along.push((along[i - 1] ?? 0) + hop);
  }
  const total = along[along.length - 1] ?? 0;
  if (total <= TRIM_M * 2) return [];
  return points.filter((_, i) => (along[i] ?? 0) >= TRIM_M && (along[i] ?? 0) <= total - TRIM_M);
}

/** Build the card a friend is allowed to see. Throws if trimming leaves nothing. */
export function trailCard(name: string, raw: unknown, day: string | null): ChatTrail {
  const title = name.trim().slice(0, 40);
  if (!title) throw new Error("Name the trail");
  const points: Point[] = [];
  for (const item of Array.isArray(raw) ? raw.slice(0, 800) : []) {
    if (!Array.isArray(item)) continue;
    const lat = Number(item[0]);
    const lon = Number(item[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    points.push({ lat, lon, brk: item[2] === 1 || item[2] === true });
  }
  const kept = trimEnds(points);
  if (kept.length < 2) throw new Error("That trail is too short to share. The ends are left off.");
  let miles = 0;
  const lines: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (let i = 0; i < kept.length; i += 1) {
    const point = kept[i] as Point;
    const prev = kept[i - 1];
    if (point.brk && cur.length) {
      if (cur.length > 1) lines.push(cur);
      cur = [];
    } else if (prev && !point.brk) {
      miles += milesBetween(prev.lat, prev.lon, point.lat, point.lon);
    }
    cur.push([Math.round(point.lon * 1e4) / 1e4, Math.round(point.lat * 1e4) / 1e4]);
  }
  if (cur.length > 1) lines.push(cur);
  if (!lines.length) throw new Error("That trail is too short to share. The ends are left off.");
  const when = /^\d{4}-\d{2}-\d{2}$/.test(day ?? "") ? day : null;
  return { name: title, miles: Math.round(miles * 10) / 10, day: when, lines: lines.slice(0, 40) };
}
