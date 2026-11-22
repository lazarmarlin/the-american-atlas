import { pointInPolygons } from "@/lib/geo-hit";

const FILE = "/atlas/overlays/reservations.geojson";

export type ReservationHit = {
  id: string;
  name: string;
  st: string;
  states: string;
  lat: number;
  lon: number;
  pts: number;
};

type Geom = { type: string; coordinates: number[][][] | number[][][][] };

type Feature = {
  properties?: {
    id?: unknown;
    name?: unknown;
    st?: unknown;
    states?: unknown;
    lat?: unknown;
    lon?: unknown;
    pts?: unknown;
  };
  geometry?: Geom;
};

type Rec = ReservationHit & {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  polygons: number[][][][];
};

type Index = { cells: Map<string, number[]>; wide: number[]; rows: Rec[] };

function polygonsOf(geom: Geom | undefined): number[][][][] {
  if (!geom) return [];
  if (geom.type === "Polygon") return [geom.coordinates as number[][][]];
  if (geom.type === "MultiPolygon") return geom.coordinates as number[][][][];
  return [];
}

function build(features: Feature[]): Index {
  const cells = new Map<string, number[]>();
  const wide: number[] = [];
  const rows: Rec[] = [];
  for (const feature of features) {
    const props = feature.properties ?? {};
    const id = typeof props.id === "string" ? props.id : "";
    const name = typeof props.name === "string" ? props.name : "";
    const st = typeof props.st === "string" ? props.st : "";
    const states = typeof props.states === "string" && props.states ? props.states : st;
    const lat = Number(props.lat);
    const lon = Number(props.lon);
    const pts = Number(props.pts);
    if (!id || !name || !st) continue;
    const polygons = polygonsOf(feature.geometry);
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    for (const rings of polygons) {
      for (const ring of rings) {
        for (const pt of ring) {
          const x = pt[0];
          const y = pt[1];
          if (x == null || y == null) continue;
          if (x < minLon) minLon = x;
          if (y < minLat) minLat = y;
          if (x > maxLon) maxLon = x;
          if (y > maxLat) maxLat = y;
        }
      }
    }
    if (!Number.isFinite(minLon)) continue;
    const index = rows.length;
    rows.push({
      id,
      name,
      st,
      states,
      lat: Number.isFinite(lat) ? lat : (minLat + maxLat) / 2,
      lon: Number.isFinite(lon) ? lon : (minLon + maxLon) / 2,
      pts: Number.isFinite(pts) ? pts : 15,
      minLon,
      minLat,
      maxLon,
      maxLat,
      polygons,
    });
    if (maxLon - minLon > 4 || maxLat - minLat > 4) {
      wide.push(index);
      continue;
    }
    for (let x = Math.floor(minLon); x <= Math.floor(maxLon); x += 1) {
      for (let y = Math.floor(minLat); y <= Math.floor(maxLat); y += 1) {
        const key = `${x},${y}`;
        const list = cells.get(key);
        if (list) list.push(index);
        else cells.set(key, [index]);
      }
    }
  }
  return { cells, wide, rows };
}

export function reservationsTouching(index: Index, lat: number, lon: number): ReservationHit[] {
  const ids = index.cells.get(`${Math.floor(lon)},${Math.floor(lat)}`) ?? [];
  const hits: ReservationHit[] = [];
  const seen = new Set<number>();
  for (const id of ids.concat(index.wide)) {
    if (seen.has(id)) continue;
    seen.add(id);
    const row = index.rows[id];
    if (!row) continue;
    if (lon < row.minLon || lon > row.maxLon || lat < row.minLat || lat > row.maxLat) continue;
    if (!pointInPolygons(lon, lat, row.polygons)) continue;
    hits.push({ id: row.id, name: row.name, st: row.st, states: row.states, lat: row.lat, lon: row.lon, pts: row.pts });
  }
  return hits;
}

let indexPromise: Promise<Index> | null = null;

export function reservationsAt(lat: number, lon: number) {
  indexPromise ??= fetch(FILE)
    .then((res) => {
      if (!res.ok) throw new Error(`reservations: ${res.status}`);
      return res.json() as Promise<{ features?: Feature[] }>;
    })
    .then((data) => build(data.features ?? []));
  return indexPromise.then((index) => reservationsTouching(index, lat, lon));
}
