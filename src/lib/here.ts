/**
 * What to call the spot you're standing in, for "I'm here": a place on your
 * map right there, else a place on the atlas right there, else the nearest
 * town ("Near Guymon").
 */
import type { StateInfo } from "@/lib/atlas-model";
import type { ChatHere } from "@/lib/messages";
import { closestPlace, type Fix } from "@/lib/nearby";
import { labelStop } from "@/lib/stop-detect";

let states: StateInfo[] = [];

/** The atlas's states, once loaded (the town lookup needs them). */
export function setHereStates(next: StateInfo[]) {
  states = next;
}

type Spot = { id: string; name: string; state?: string; lat: number | null; lon: number | null };

export async function nameHere(fix: Fix, yourPlaces: Spot[]): Promise<ChatHere> {
  const mine = closestPlace(fix, yourPlaces, 0.3);
  if (mine?.state) return { label: mine.name, lat: mine.lat ?? fix.lat, lon: mine.lon ?? fix.lon, state: mine.state, placeId: mine.id };
  const named = await labelStop({ lat: fix.lat, lon: fix.lon, start: 0, end: 0 }, states);
  return { label: named.label === "Stop" ? "Here" : named.label, lat: fix.lat, lon: fix.lon, state: named.state, placeId: named.poiId };
}
