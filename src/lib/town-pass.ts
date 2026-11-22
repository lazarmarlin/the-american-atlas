import { pointInPolygons } from "@/lib/geo-hit";
import { TOWNS_FILE } from "@/lib/towns-overlay";

type Packed = {
  scale: number;
  towns: [name: string, st: string, geoid: string, polygons: number[][][]][];
};

type TownRec = {
  name: string;
  st: string;
  geoid: string;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  polygons: number[][][];
};

export type TownIndex = {
  cells: Map<string, number[]>;
  wide: number[];
  towns: TownRec[];
  scale: number;
};

export type TownHit = { name: string; st: string; geoid: string };

function ringBox(flat: number[], scale: number) {
  let x = 0;
  let y = 0;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    x += flat[i] ?? 0;
    y += flat[i + 1] ?? 0;
    const lon = x / scale;
    const lat = y / scale;
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLon, minLat, maxLon, maxLat };
}

function decodeRing(flat: number[], scale: number) {
  const out: number[][] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    x += flat[i] ?? 0;
    y += flat[i + 1] ?? 0;
    out.push([x / scale, y / scale]);
  }
  return out;
}

export function buildTownIndex(packed: Packed): TownIndex {
  const cells = new Map<string, number[]>();
  const wide: number[] = [];
  const towns: TownRec[] = [];
  const { scale } = packed;
  for (const [name, st, geoid, polygons] of packed.towns) {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    for (const poly of polygons) {
      for (const flat of poly) {
        const box = ringBox(flat, scale);
        if (box.minLon < minLon) minLon = box.minLon;
        if (box.minLat < minLat) minLat = box.minLat;
        if (box.maxLon > maxLon) maxLon = box.maxLon;
        if (box.maxLat > maxLat) maxLat = box.maxLat;
      }
    }
    if (!Number.isFinite(minLon)) continue;
    const id = towns.length;
    towns.push({ name, st, geoid, minLon, minLat, maxLon, maxLat, polygons });
    if (maxLon - minLon > 3 || maxLat - minLat > 3) {
      wide.push(id);
      continue;
    }
    for (let x = Math.floor(minLon); x <= Math.floor(maxLon); x += 1) {
      for (let y = Math.floor(minLat); y <= Math.floor(maxLat); y += 1) {
        const key = `${x},${y}`;
        const list = cells.get(key);
        if (list) list.push(id);
        else cells.set(key, [id]);
      }
    }
  }
  return { cells, wide, towns, scale };
}

export function townsTouching(index: TownIndex, lat: number, lon: number): TownHit[] {
  const ids = index.cells.get(`${Math.floor(lon)},${Math.floor(lat)}`) ?? [];
  const hits: TownHit[] = [];
  const seen = new Set<number>();
  for (const id of ids.concat(index.wide)) {
    if (seen.has(id)) continue;
    seen.add(id);
    const town = index.towns[id];
    if (!town) continue;
    if (lon < town.minLon || lon > town.maxLon || lat < town.minLat || lat > town.maxLat) continue;
    const polygons = town.polygons.map((poly) => poly.map((flat) => decodeRing(flat, index.scale)));
    if (!pointInPolygons(lon, lat, polygons)) continue;
    hits.push({ name: town.name, st: town.st, geoid: town.geoid });
  }
  return hits;
}

let indexPromise: Promise<TownIndex> | null = null;

export function townsAt(lat: number, lon: number) {
  indexPromise ??= fetch(TOWNS_FILE)
    .then((res) => {
      if (!res.ok) throw new Error(`towns: ${res.status}`);
      return res.json() as Promise<Packed>;
    })
    .then(buildTownIndex);
  return indexPromise.then((index) => townsTouching(index, lat, lon));
}
