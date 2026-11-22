import { loadPlaces, loadRoads, type RoadRec, type StateInfo } from "@/lib/atlas-model";
import type { Mark } from "@/lib/marks";

export type Fix = { lat: number; lon: number };

const NEAR_CATS = [
  "beach",
  "stadium",
  "chain",
  "park",
  "reservation",
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
  "market",
  "mall",
  "roadside",
  "town",
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
];

export function milesBetween(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Device GPS via the browser geolocation API. Native wrappers expose the same call. */
export function readDeviceLocation(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("This device can't share a location."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => {
        if (err.code === 1) {
          reject(new Error("Location is blocked. Allow it for The American Atlas in the app or browser settings."));
          return;
        }
        reject(new Error("Couldn't read a location. Step outside or try again."));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  });
}

function statesNear(fix: Fix, states: StateInfo[]) {
  return states
    .filter((st) => fix.lat >= st.s - 0.6 && fix.lat <= st.n + 0.6 && fix.lon >= st.w - 0.6 && fix.lon <= st.e + 0.6)
    .sort((a, b) => {
      const ac = milesBetween(fix.lat, fix.lon, (a.s + a.n) / 2, (a.w + a.e) / 2);
      const bc = milesBetween(fix.lat, fix.lon, (b.s + b.n) / 2, (b.w + b.e) / 2);
      return ac - bc;
    })
    .slice(0, 2);
}

export async function placesNear(fix: Fix, states: StateInfo[], limit = 40): Promise<NearMark[]> {
  const nearbyStates = statesNear(fix, states);
  const placeRows = await Promise.all(
    nearbyStates.flatMap((st) =>
      NEAR_CATS.map(async (cat) => {
        const rows = await loadPlaces(cat, st.abbr);
        return rows.map((row) => ({ row, st: st.abbr, cat }));
      }),
    ),
  );
  const roadRows = await Promise.all(
    nearbyStates.map((st) => loadRoads(st.abbr).then((rows) => ({ st: st.abbr, rows }))),
  );

  const ranked: { mark: Mark; miles: number }[] = [];
  for (const batch of placeRows) {
    for (const item of batch) {
      if (item.row.lat == null || item.row.lon == null) continue;
      if (item.cat === "town" && item.row.pts < 20) continue;
      const miles = milesBetween(fix.lat, fix.lon, item.row.lat, item.row.lon);
      if (miles > 80) continue;
      ranked.push({
        miles,
        mark: {
          id: item.row.id,
          name: item.row.name,
          category: item.cat,
          state: item.st,
          lat: item.row.lat,
          lon: item.row.lon,
          points: item.row.pts,
          sys: item.cat === "drive" ? "PK" : "",
          paths: item.row.paths ?? [],
          visitedOn: null,
          note: "",
          photo: "",
          visits: [],
        },
      });
    }
  }
  for (const group of roadRows) {
    for (const road of group.rows) {
      const miles = milesBetween(fix.lat, fix.lon, road.lat, road.lon);
      if (miles > 30) continue;
      ranked.push({ miles, mark: roadToMark(road, group.st) });
    }
  }
  ranked.sort((a, b) => a.miles - b.miles);
  const seen = new Set<string>();
  const out: NearMark[] = [];
  for (const item of ranked) {
    if (seen.has(item.mark.id)) continue;
    seen.add(item.mark.id);
    out.push({ ...item.mark, miles: Math.round(item.miles * 10) / 10 });
    if (out.length >= limit) break;
  }
  return out;
}

export type NearMark = Mark & { miles: number };

export function roadToMark(road: RoadRec, state: string): Mark {
  return {
    id: road.id,
    name: road.name,
    category: "route",
    state,
    lat: road.lat,
    lon: road.lon,
    points: road.pts,
    sys: road.sys,
    paths: road.paths ?? [],
    visitedOn: null,
    note: "",
    photo: "",
    visits: [],
  };
}

export function stateToMark(state: { abbr: string; name: string; w: number; s: number; e: number; n: number }): Mark {
  return {
    id: `state:${state.abbr}`,
    name: state.name,
    category: "state",
    state: state.abbr,
    lat: Math.round(((state.s + state.n) / 2) * 1e4) / 1e4,
    lon: Math.round(((state.w + state.e) / 2) * 1e4) / 1e4,
    points: 50,
    sys: "",
    paths: [],
    visitedOn: null,
    note: "",
    photo: "",
    visits: [],
  };
}

export function placeToMark(
  place: { id: string; name: string; lat: number | null; lon: number | null; pts: number; paths?: number[][][] },
  category: string,
  state: string,
): Mark {
  return {
    id: place.id,
    name: place.name,
    category,
    state,
    lat: place.lat,
    lon: place.lon,
    points: place.pts,
    sys: category === "drive" ? "PK" : "",
    paths: place.paths ?? [],
    visitedOn: null,
    note: "",
    photo: "",
    visits: [],
  };
}

const ALONG_CATS = ["park", "town", "roadside", "waterfall", "cave", "diner", "drivein", "highpoint", "seashore", "battlefield", "fort", "lighthouse"];

/** Places within 12 miles of a road or scenic drive. */
export async function stopsAlong(mark: Mark, limit = 10): Promise<Mark[]> {
  const samples: [number, number][] = [];
  for (const line of mark.paths) {
    const step = Math.max(1, Math.floor(line.length / 30));
    for (let i = 0; i < line.length; i += step) {
      const point = line[i];
      if (point && point.length >= 2) samples.push([point[0], point[1]]);
    }
  }
  if (!samples.length || !mark.state) return [];
  const groups = await Promise.all(
    ALONG_CATS.map(async (cat) => {
      const rows = await loadPlaces(cat, mark.state);
      return rows.map((row) => ({ row, cat }));
    }),
  );
  const ranked: { mark: Mark; miles: number }[] = [];
  for (const batch of groups) {
    for (const item of batch) {
      if (item.row.lat == null || item.row.lon == null || item.row.id === mark.id) continue;
      if (item.cat === "town" && item.row.pts < 25) continue;
      let best = 99;
      for (const [lon, lat] of samples) {
        const miles = milesBetween(item.row.lat, item.row.lon, lat, lon);
        if (miles < best) best = miles;
      }
      if (best > 12) continue;
      ranked.push({ miles: best, mark: placeToMark(item.row, item.cat, mark.state) });
    }
  }
  ranked.sort((a, b) => a.miles - b.miles || b.mark.points - a.mark.points);
  const seen = new Set<string>();
  const out: Mark[] = [];
  for (const item of ranked) {
    if (seen.has(item.mark.id)) continue;
    seen.add(item.mark.id);
    out.push(item.mark);
    if (out.length >= limit) break;
  }
  return out;
}
