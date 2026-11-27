/**
 * Culling for the map's big GeoJSON layers (your places and roads, a state's
 * catalog, town outlines): the map is only handed what's in or near the view.
 *
 * MapLibre already skips drawing tiles that are off screen, but it keeps the
 * whole data set in its tile worker and cuts all of it into tiles again every
 * time it changes. On a slow phone that's the expensive part. Here each set
 * is kept in full on this side, with a bounding box per feature, and only the
 * features that touch the "culled area" (the view, plus half a screen all
 * round) are sent. Panning within that area changes nothing; the area is
 * moved when the view leaves it, and shrunk when you've zoomed well in.
 */
import type { Feature } from "geojson";

/** [west, south, east, north] */
export type Box = [number, number, number, number];

function walk(coords: unknown, box: Box) {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number") {
    const x = coords[0] as number;
    const y = coords[1] as number;
    if (x < box[0]) box[0] = x;
    if (y < box[1]) box[1] = y;
    if (x > box[2]) box[2] = x;
    if (y > box[3]) box[3] = y;
    return;
  }
  for (const part of coords) walk(part, box);
}

export function boxOf(feature: Feature): Box | null {
  const geometry = feature.geometry;
  if (!geometry) return null;
  const box: Box = [Infinity, Infinity, -Infinity, -Infinity];
  if (geometry.type === "GeometryCollection") for (const part of geometry.geometries) walk("coordinates" in part ? part.coordinates : null, box);
  else walk(geometry.coordinates, box);
  return box[0] === Infinity ? null : box;
}

/** The box, bigger by `k` of its own width and height on every side. */
export function grow(box: Box, k: number): Box {
  const w = (box[2] - box[0]) * k;
  const h = (box[3] - box[1]) * k;
  return [box[0] - w, Math.max(-90, box[1] - h), box[2] + w, Math.min(90, box[3] + h)];
}

export function touches(a: Box, b: Box) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function within(inner: Box, outer: Box) {
  return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
}

const size = (box: Box) => (box[2] - box[0]) * (box[3] - box[1]);

type Set = { features: Feature[]; boxes: (Box | null)[] };

export function makeCuller(margin = 0.5) {
  const sets = new Map<string, Set>();
  let area: Box | null = null;
  return {
    /** Keep a whole set (call again when it changes). */
    set(id: string, features: Feature[]) {
      sets.set(id, { features, boxes: features.map(boxOf) });
    },
    has(id: string) {
      return sets.has(id);
    },
    /** What to hand the map for a set now. */
    pick(id: string): Feature[] {
      const set = sets.get(id);
      if (!set) return [];
      const at = area;
      if (!at) return set.features;
      const out: Feature[] = [];
      for (let i = 0; i < set.features.length; i++) {
        const box = set.boxes[i];
        // No shape, or one that wraps the date line (the far Aleutians): always in.
        if (!box || box[2] - box[0] > 180 || touches(box, at)) out.push(set.features[i]);
      }
      return out;
    },
    /**
     * The view moved: true if the culled area had to move (or shrink), so the
     * sets need handing to the map again.
     */
    view(view: Box): boolean {
      const next = grow(view, margin);
      if (area && within(view, area) && size(area) <= size(next) * 4) return false;
      area = next;
      return true;
    },
    ids() {
      return [...sets.keys()];
    },
    /** For tests. */
    area() {
      return area;
    },
  };
}
