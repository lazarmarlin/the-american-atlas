/**
 * Town outlines for the map's faint town layer.
 *
 * public/atlas/overlays/towns.json is built by scripts/build-towns-overlay.py
 * from Census TIGER place boundaries in a packed form (integer deltas), about
 * a quarter the size of the same shapes as GeoJSON. This turns it back into a
 * GeoJSON FeatureCollection for MapLibre.
 */
import type { FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";

type Packed = {
  v: number;
  scale: number;
  towns: [name: string, st: string, geoid: string, polygons: number[][][]][];
};

export const TOWNS_FILE = "/atlas/overlays/towns.json";

function ring(flat: number[], scale: number): Position[] {
  const out: Position[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    x += flat[i] ?? 0;
    y += flat[i + 1] ?? 0;
    out.push([x / scale, y / scale]);
  }
  return out;
}

export function decodeTowns(
  packed: Packed,
): FeatureCollection<Polygon | MultiPolygon, { name: string; st: string; geoid: string }> {
  const { scale } = packed;
  return {
    type: "FeatureCollection",
    features: packed.towns.map(([name, st, geoid, polygons]) => {
      const coords = polygons.map((poly) => poly.map((flat) => ring(flat, scale)));
      return {
        type: "Feature",
        properties: { name, st, geoid },
        geometry:
          coords.length === 1
            ? { type: "Polygon", coordinates: coords[0] ?? [] }
            : { type: "MultiPolygon", coordinates: coords },
      };
    }),
  };
}

export async function loadTowns() {
  const res = await fetch(TOWNS_FILE);
  if (!res.ok) throw new Error(`towns overlay: ${res.status}`);
  return decodeTowns((await res.json()) as Packed);
}
