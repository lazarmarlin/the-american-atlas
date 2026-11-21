import { loadCounties, loadPlaces, loadRoads, type StateInfo } from "@/lib/atlas-model";
import { countyContaining, countyToMark } from "@/lib/counties";
import type { Mark } from "@/lib/marks";
import { milesBetween, placeToMark, roadToMark, type Fix } from "@/lib/nearby";

/** Sites worth adding because you are standing at them. Chains and towns are skipped. */
const PASS_CATS = [
  "park",
  "roadside",
  "beach",
  "stadium",
  "museum",
  "zoo",
  "brewery",
  "garden",
  "amusement",
  "capitol",
  "lighthouse",
  "bridge",
  "span",
  "airport",
  "refuge",
  "forest",
  "highpoint",
  "seashore",
  "battlefield",
  "drive",
  "waterfall",
  "cave",
  "president",
  "fort",
  "winery",
  "distillery",
  "drivein",
  "diner",
  "food",
];

const PLACE_MILES = 0.25;
const ROAD_MILES = 0.35;
const QUEUE_KEY = "atlas-native-fixes";

export function statesTouching(fix: Fix, states: StateInfo[]) {
  return states.filter(
    (state) => fix.lon >= state.w - 0.5 && fix.lon <= state.e + 0.5 && fix.lat >= state.s - 0.5 && fix.lat <= state.n + 0.5,
  );
}

function milesToSegment(lat: number, lon: number, aLat: number, aLon: number, bLat: number, bLon: number) {
  const mid = (((aLat + bLat) / 2) * Math.PI) / 180;
  const kx = 69.172 * Math.cos(mid);
  const ky = 69;
  const ax = aLon * kx;
  const ay = aLat * ky;
  const bx = bLon * kx;
  const by = bLat * ky;
  const px = lon * kx;
  const py = lat * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function milesToPaths(lat: number, lon: number, paths: number[][][]) {
  let best = 99;
  for (const line of paths) {
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1];
      const b = line[i];
      if (!a || !b) continue;
      const miles = milesToSegment(lat, lon, a[1], a[0], b[1], b[0]);
      if (miles < best) best = miles;
      if (best <= ROAD_MILES) return best;
    }
  }
  return best;
}

/** Roads you are on, and sites within a quarter mile. */
export async function collectPassed(fix: Fix, states: StateInfo[], saved: Set<string>): Promise<Mark[]> {
  const here = statesTouching(fix, states);
  const found: { miles: number; mark: Mark }[] = [];
  const countyRows = await Promise.all(here.map(async (state) => ({ state: state.abbr, rows: await loadCounties(state.abbr) })));
  for (const group of countyRows) {
    const hit = countyContaining(fix.lat, fix.lon, group.rows);
    if (!hit || saved.has(hit.id)) continue;
    found.push({ miles: 0, mark: countyToMark(hit, group.state) });
  }
  const places = await Promise.all(
    here.flatMap((state) =>
      PASS_CATS.map(async (cat) => {
        const rows = await loadPlaces(cat, state.abbr);
        return rows.map((row) => ({ row, cat, state: state.abbr }));
      }),
    ),
  );
  for (const batch of places) {
    for (const item of batch) {
      if (item.row.lat == null || item.row.lon == null || saved.has(item.row.id)) continue;
      const miles =
        item.cat === "drive" && item.row.paths?.length
          ? milesToPaths(fix.lat, fix.lon, item.row.paths)
          : milesBetween(fix.lat, fix.lon, item.row.lat, item.row.lon);
      const limit = item.cat === "drive" ? ROAD_MILES : PLACE_MILES;
      if (miles > limit) continue;
      found.push({ miles, mark: placeToMark(item.row, item.cat, item.state) });
    }
  }
  const roads = await Promise.all(here.map(async (state) => ({ state: state.abbr, rows: await loadRoads(state.abbr) })));
  for (const group of roads) {
    for (const road of group.rows) {
      if (saved.has(road.id)) continue;
      if (milesBetween(fix.lat, fix.lon, road.lat, road.lon) > 40) continue;
      const miles = road.paths?.length ? milesToPaths(fix.lat, fix.lon, road.paths) : milesBetween(fix.lat, fix.lon, road.lat, road.lon);
      if (miles > ROAD_MILES) continue;
      found.push({ miles, mark: roadToMark(road, group.state) });
    }
  }
  found.sort((a, b) => a.miles - b.miles || b.mark.points - a.mark.points);
  const out: Mark[] = [];
  const seen = new Set<string>();
  let roadsTaken = 0;
  for (const item of found) {
    if (seen.has(item.mark.id)) continue;
    const road = item.mark.category === "route";
    if (road) {
      if (roadsTaken >= 3) continue;
      roadsTaken += 1;
    } else if (out.length - roadsTaken >= 6) continue;
    seen.add(item.mark.id);
    out.push(item.mark);
    if (out.length >= 8) break;
  }
  return out;
}

export function queueNativeFixes(fixes: Fix[]) {
  if (typeof localStorage === "undefined") return;
  const current = readNativeFixes();
  const next = [...current, ...fixes].slice(-200);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(next));
}

export function takeNativeFixes(): Fix[] {
  if (typeof localStorage === "undefined") return [];
  const fixes = readNativeFixes();
  localStorage.removeItem(QUEUE_KEY);
  return fixes;
}

function readNativeFixes(): Fix[] {
  try {
    const raw = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((row) => {
        const item = row as { lat?: unknown; lon?: unknown };
        const lat = Number(item.lat);
        const lon = Number(item.lon);
        return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
      })
      .filter((fix): fix is Fix => fix != null);
  } catch {
    return [];
  }
}
