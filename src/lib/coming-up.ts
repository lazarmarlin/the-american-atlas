/**
 * What's coming up ahead: places you haven't been to yet, roughly in the
 * direction you're driving (within 35° either side), the nearest first.
 * Worked out at most every half mile or minute, so it stays cheap.
 */
import type { StateInfo } from "@/lib/atlas-model";
import { bearing, turnBetween } from "@/lib/motion";
import { placesNear, type Fix, type NearMark } from "@/lib/nearby";

export type Ahead = NearMark & { ahead: true };

const CONE = 35;
const MAX_MILES = 25;

export async function comingUp(fix: Fix, going: number, states: StateInfo[], saved: Set<string>): Promise<Ahead[]> {
  const near = await placesNear(fix, states, 400);
  const out: Ahead[] = [];
  for (const place of near) {
    if (saved.has(place.id) || place.category === "route" || place.category === "county") continue;
    if (place.lat == null || place.lon == null || place.miles > MAX_MILES || place.miles < 0.2) continue;
    if (turnBetween(bearing(fix, { lat: place.lat, lon: place.lon }), going) > CONE) continue;
    out.push({ ...place, ahead: true });
    if (out.length >= 3) break;
  }
  return out;
}
