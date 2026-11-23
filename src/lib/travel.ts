import { loadCounties, loadPlaces, loadRoads, type CatalogPlace, type StateInfo } from "@/lib/atlas-model";
import { countyContaining, countyToMark } from "@/lib/counties";
import type { Mark } from "@/lib/marks";
import { milesBetween, placeToMark, roadToMark, type Fix } from "@/lib/nearby";
import { reservationsAt } from "@/lib/reservation-pass";
import { townsAt } from "@/lib/town-pass";

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

/** Roads you are on, sites within a quarter mile, and the town, city, or reservation you are inside.
 * `visited` collects places already on the atlas that this fix is passing, for a trip that is recording. */
export async function collectPassed(fix: Fix, states: StateInfo[], saved: Set<string>, visited?: Mark[]): Promise<Mark[]> {
  const here = statesTouching(fix, states);
  const found: { miles: number; mark: Mark }[] = [];
  const countyRows = await Promise.all(here.map(async (state) => ({ state: state.abbr, rows: await loadCounties(state.abbr) })));
  for (const group of countyRows) {
    const hit = countyContaining(fix.lat, fix.lon, group.rows);
    if (!hit || saved.has(hit.id)) {
      if (hit && saved.has(hit.id)) remember(visited, countyToMark(hit, group.state));
      continue;
    }
    found.push({ miles: 0, mark: countyToMark(hit, group.state) });
  }
  found.push(...(await passedTowns(fix, saved, visited)));
  found.push(...(await passedReservations(fix, saved, here, visited)));
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
      if (item.row.lat == null || item.row.lon == null) continue;
      const miles =
        item.cat === "drive" && item.row.paths?.length
          ? milesToPaths(fix.lat, fix.lon, item.row.paths)
          : milesBetween(fix.lat, fix.lon, item.row.lat, item.row.lon);
      const limit = item.cat === "drive" ? ROAD_MILES : PLACE_MILES;
      if (miles > limit) continue;
      if (saved.has(item.row.id)) {
        remember(visited, placeToMark(item.row, item.cat, item.state));
        continue;
      }
      found.push({ miles, mark: placeToMark(item.row, item.cat, item.state) });
    }
  }
  const roads = await Promise.all(here.map(async (state) => ({ state: state.abbr, rows: await loadRoads(state.abbr) })));
  for (const group of roads) {
    for (const road of group.rows) {
      if (milesBetween(fix.lat, fix.lon, road.lat, road.lon) > 40) continue;
      const miles = road.paths?.length ? milesToPaths(fix.lat, fix.lon, road.paths) : milesBetween(fix.lat, fix.lon, road.lat, road.lon);
      if (miles > ROAD_MILES) continue;
      if (saved.has(road.id)) {
        remember(visited, roadToMark(road, group.state));
        continue;
      }
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

function remember(visited: Mark[] | undefined, mark: Mark) {
  if (!visited || visited.length >= 6 || visited.some((item) => item.id === mark.id)) return;
  visited.push(mark);
}

function geoidIndex(rows: CatalogPlace[]) {
  const map = new Map<string, CatalogPlace>();
  for (const row of rows) {
    const geo = row.id.split(":").pop();
    if (!geo) continue;
    map.set(geo, row);
    map.set(geo.padStart(7, "0"), row);
  }
  return map;
}

async function passedTowns(fix: Fix, saved: Set<string>, visited?: Mark[]) {
  const hits = await townsAt(fix.lat, fix.lon).catch(() => []);
  const states = [...new Set(hits.map((hit) => hit.st))];
  const lists = await Promise.all(states.map(async (st) => ({ st, rows: geoidIndex(await loadPlaces("town", st)) })));
  const byState = new Map(lists.map((item) => [item.st, item.rows]));
  const out: { miles: number; mark: Mark }[] = [];
  for (const hit of hits) {
    const row = byState.get(hit.st)?.get(hit.geoid) ?? byState.get(hit.st)?.get(hit.geoid.replace(/^0+/, ""));
    if (!row || saved.has(row.id)) {
      if (row && saved.has(row.id)) remember(visited, placeToMark(row, "town", hit.st));
      continue;
    }
    out.push({ miles: 0, mark: placeToMark(row, "town", hit.st) });
  }
  return out;
}

async function passedReservations(fix: Fix, saved: Set<string>, states: StateInfo[], visited?: Mark[]) {
  const hits = await reservationsAt(fix.lat, fix.lon).catch(() => []);
  return hits
    .filter((hit) => {
      if (!hit.id) return false;
      if (!saved.has(hit.id)) return true;
      remember(
        visited,
        placeToMark({ id: hit.id, name: hit.name, lat: hit.lat, lon: hit.lon, pts: hit.pts }, "reservation", reservationState(hit, fix, states)),
      );
      return false;
    })
    .map((hit) => ({
      miles: 0,
      mark: placeToMark(
        { id: hit.id, name: hit.name, lat: hit.lat, lon: hit.lon, pts: hit.pts },
        "reservation",
        reservationState(hit, fix, states),
      ),
    }));
}

function reservationState(
  hit: { st: string; states: string },
  fix: Fix,
  states: StateInfo[],
) {
  const listed = new Set(hit.states.split(",").filter(Boolean));
  const inside = states.filter(
    (state) => listed.has(state.abbr) && fix.lon >= state.w && fix.lon <= state.e && fix.lat >= state.s && fix.lat <= state.n,
  );
  inside.sort((a, b) => (a.e - a.w) * (a.n - a.s) - (b.e - b.w) * (b.n - b.s));
  return inside[0]?.abbr || hit.st;
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
