/** Even-odd point test. A ring is [lon, lat][]. A point in a hole is outside. */
export function pointInRings(lon: number, lat: number, rings: number[][][]): boolean {
  let inside = false;
  for (const ring of rings) {
    if (ringContains(lon, lat, ring)) inside = !inside;
  }
  return inside;
}

/** True when the point is inside any polygon. Each polygon is a list of rings. */
export function pointInPolygons(lon: number, lat: number, polygons: number[][][][]): boolean {
  for (const rings of polygons) {
    if (pointInRings(lon, lat, rings)) return true;
  }
  return false;
}

function ringContains(lon: number, lat: number, ring: number[][]) {
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
