import type { Mark } from "@/lib/marks";

export type CountyRec = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  rings: number[][][];
};

export function countyToMark(row: { id: string; name: string; lat: number; lon: number }, state: string): Mark {
  return {
    id: row.id,
    name: row.name,
    category: "county",
    state,
    lat: row.lat,
    lon: row.lon,
    points: 10,
    sys: "",
    paths: [],
    visitedOn: null,
    note: "",
    photo: "",
    visits: [],
  };
}

function insideRing(lon: number, lat: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]?.[0];
    const yi = ring[i]?.[1];
    const xj = ring[j]?.[0];
    const yj = ring[j]?.[1];
    if (xi == null || yi == null || xj == null || yj == null || yj === yi) continue;
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function countyContaining(lat: number, lon: number, rows: CountyRec[]) {
  for (const row of rows) {
    if (row.rings.some((ring) => insideRing(lon, lat, ring))) return row;
  }
  return null;
}
