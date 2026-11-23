/**
 * A park on the atlas is one point, often the middle. A photo of the sign can
 * be miles from that point and still be inside the park. Match those to a park
 * the user has already added, by the park's outline.
 */
import { pointInPolygons } from "@/lib/geo-hit";

const FILE = "/atlas/overlays/parks.geojson";
/** A sign just outside the gate still belongs to the park. */
const GATE_MILES = 1.25;

type Geom = { type?: string; coordinates?: number[][][] | number[][][][] };

type Shape = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  polygons: number[][][][];
};

function polygonsOf(geom: Geom | undefined): number[][][][] {
  if (!geom) return [];
  if (geom.type === "Polygon") return [geom.coordinates as number[][][]];
  if (geom.type === "MultiPolygon") return geom.coordinates as number[][][][];
  return [];
}

function toShape(geom: Geom | undefined): Shape | null {
  const polygons = polygonsOf(geom);
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
  if (!Number.isFinite(minLon)) return null;
  return { minLon, minLat, maxLon, maxLat, polygons };
}

let shapesPromise: Promise<Map<string, Shape>> | null = null;

export function loadParkShapes() {
  shapesPromise ??= fetch(FILE)
    .then((res) => {
      if (!res.ok) throw new Error(`parks: ${res.status}`);
      return res.json() as Promise<{ features?: { properties?: { id?: unknown }; geometry?: Geom }[] }>;
    })
    .then((data) => {
      const shapes = new Map<string, Shape>();
      for (const feature of data.features ?? []) {
        const id = feature.properties?.id;
        if (typeof id !== "string") continue;
        const shape = toShape(feature.geometry);
        if (shape) shapes.set(id, shape);
      }
      return shapes;
    });
  return shapesPromise;
}

function milesToSegment(lat: number, lon: number, a: number[], b: number[]) {
  const ax = a[0];
  const ay = a[1];
  const bx = b[0];
  const by = b[1];
  if (ax == null || ay == null || bx == null || by == null) return Infinity;
  const mlon = 69 * Math.cos((lat * Math.PI) / 180);
  const px = (lon - ax) * mlon;
  const py = (lat - ay) * 69;
  const dx = (bx - ax) * mlon;
  const dy = (by - ay) * 69;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
  return Math.hypot(px - t * dx, py - t * dy);
}

function milesToShape(lat: number, lon: number, shape: Shape) {
  let best = Infinity;
  for (const rings of shape.polygons) {
    for (const ring of rings) {
      for (let i = 0; i + 1 < ring.length; i += 1) {
        const a = ring[i];
        const b = ring[i + 1];
        if (!a || !b) continue;
        const miles = milesToSegment(lat, lon, a, b);
        if (miles < best) best = miles;
      }
    }
  }
  return best;
}

/** The visited park this photo sits in, or just outside. Null when none is close. */
export function matchPark<T extends { id: string; category: string }>(
  lat: number,
  lon: number,
  marks: T[],
  shapes: Map<string, Shape>,
): { mark: T; miles: number } | null {
  const pad = GATE_MILES / 69;
  let inside: { mark: T; area: number } | null = null;
  let gate: { mark: T; miles: number } | null = null;
  for (const mark of marks) {
    if (mark.category !== "park") continue;
    const shape = shapes.get(mark.id);
    if (!shape) continue;
    if (lon < shape.minLon - pad || lon > shape.maxLon + pad || lat < shape.minLat - pad || lat > shape.maxLat + pad) continue;
    if (pointInPolygons(lon, lat, shape.polygons)) {
      const area = (shape.maxLon - shape.minLon) * (shape.maxLat - shape.minLat);
      if (!inside || area < inside.area) inside = { mark, area };
      continue;
    }
    const miles = milesToShape(lat, lon, shape);
    if (miles <= GATE_MILES && (!gate || miles < gate.miles)) gate = { mark, miles };
  }
  if (inside) return { mark: inside.mark, miles: 0 };
  return gate;
}

/** A photo inside a park you've added is that park, even if a town pin is nearer the middle. */
export function choosePhotoPlace<T extends { id: string; lat: number | null; lon: number | null }>(
  lat: number,
  lon: number,
  byPoint: T | null,
  park: { mark: T; miles: number } | null,
): T | null {
  if (!park) return byPoint;
  if (park.miles === 0 || !byPoint || byPoint.id === park.mark.id) return park.mark;
  if (byPoint.lat == null || byPoint.lon == null) return park.mark;
  const mlon = 69 * Math.cos((lat * Math.PI) / 180);
  const away = Math.hypot((lon - byPoint.lon) * mlon, (lat - byPoint.lat) * 69);
  return away <= park.miles ? byPoint : park.mark;
}
