/**
 * While tracking: the closest county you haven't been to, how far its nearest
 * edge is, and which way. Counts from the county line, not its middle, since
 * crossing the line is what adds it.
 */
import { loadCounties, type StateInfo } from "@/lib/atlas-model";
import { countyContaining, type CountyRec } from "@/lib/counties";

export type NextCounty = { id: string; name: string; state: string; lat: number; lon: number; miles: number; toward: string };

/** How far to look (miles). Beyond this the chip just isn't shown. */
export const NEXT_COUNTY_MILES = 60;

const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function toward(fromLat: number, fromLon: number, lat: number, lon: number) {
  const dx = (lon - fromLon) * Math.cos((((fromLat + lat) / 2) * Math.PI) / 180);
  const dy = lat - fromLat;
  const deg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return DIRS[Math.round(deg / 45) % 8] as string;
}

/** Miles from a point to the nearest edge of a county, and that edge point. */
function nearestEdge(lat: number, lon: number, county: CountyRec) {
  const kx = 69.172 * Math.cos((lat * Math.PI) / 180);
  const ky = 69;
  let best = Infinity;
  let at: [number, number] = [county.lon, county.lat];
  for (const ring of county.rings) {
    for (let i = 1; i < ring.length; i += 1) {
      const a = ring[i - 1];
      const b = ring[i];
      if (!a || !b) continue;
      const ax = ((a[0] ?? 0) - lon) * kx;
      const ay = ((a[1] ?? 0) - lat) * ky;
      const bx = ((b[0] ?? 0) - lon) * kx;
      const by = ((b[1] ?? 0) - lat) * ky;
      const dx = bx - ax;
      const dy = by - ay;
      const len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
      const px = ax + t * dx;
      const py = ay + t * dy;
      const d = Math.hypot(px, py);
      if (d < best) {
        best = d;
        at = [lon + px / kx, lat + py / ky];
      }
    }
  }
  return { miles: best, at };
}

/** The nearest county not in `saved`, within NEXT_COUNTY_MILES, or null. */
export async function nextCounty(lat: number, lon: number, states: StateInfo[], saved: Set<string>): Promise<NextCounty | null> {
  const pad = NEXT_COUNTY_MILES / 55;
  const near = states.filter((s) => lon >= s.w - pad && lon <= s.e + pad && lat >= s.s - pad && lat <= s.n + pad);
  let best: NextCounty | null = null;
  const lists = await Promise.all(near.map(async (state) => ({ state: state.abbr, rows: await loadCounties(state.abbr) })));
  for (const { state, rows } of lists) {
    // The county you're in is about to be added by tracking anyway.
    const here = countyContaining(lat, lon, rows as CountyRec[])?.id;
    for (const county of rows) {
      if (saved.has(county.id) || county.id === here) continue;
      // Quick skip: middle far beyond reach (big western counties still get checked).
      const roughMiles = Math.hypot((county.lon - lon) * 53, (county.lat - lat) * 69);
      if (roughMiles > NEXT_COUNTY_MILES + 120) continue;
      const edge = nearestEdge(lat, lon, county as CountyRec);
      if (edge.miles > NEXT_COUNTY_MILES || (best && edge.miles >= best.miles)) continue;
      best = {
        id: county.id,
        name: county.name,
        state,
        lat: county.lat,
        lon: county.lon,
        miles: edge.miles,
        toward: toward(lat, lon, edge.at[1], edge.at[0]),
      };
    }
  }
  return best;
}
