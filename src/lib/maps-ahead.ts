/**
 * Maps saved ahead: the base map for the state you're in, and states close
 * by or the one you're heading into, saves itself (on Wi-Fi unless set to any
 * connection), so a dead zone on the next drive still has a map. At most
 * MAX_AUTO states are kept this way; the oldest of those make room. States
 * saved by hand are never removed.
 */
import type { StateInfo } from "@/lib/atlas-model";
import type { MapsAhead } from "@/lib/drive-settings";
import { useOfflineMaps } from "@/lib/offline-maps";
import { bigDownloadOk } from "@/lib/power";

type Point = { lat: number; lon: number };

/** States whose outline box is this close count as close by. */
const NEAR_MILES = 30;
/** Heading somewhere: also the states around this far ahead. */
const AHEAD_MILES = 40;
/** At most this many states saved at a time this way. */
const MAX_AUTO = 6;
/** At most three per look. */
const PER_LOOK = 3;
const LOOK_EVERY_MS = 10 * 60_000;

let lastLook = 0;
let looking = false;

function milesToBox(at: Point, box: StateInfo) {
  const dx = Math.max(box.w - at.lon, 0, at.lon - box.e) * 69 * Math.cos((at.lat * Math.PI) / 180);
  const dy = Math.max(box.s - at.lat, 0, at.lat - box.n) * 69;
  return Math.hypot(dx, dy);
}

function ahead(from: Point, bearing: number, miles: number): Point {
  const rad = (bearing * Math.PI) / 180;
  return {
    lat: from.lat + (miles * Math.cos(rad)) / 69,
    lon: from.lon + (miles * Math.sin(rad)) / (69 * Math.cos((from.lat * Math.PI) / 180)),
  };
}

/** The states to have saved for here (nearest first), and the way you're going if known. */
export function statesAhead(fix: Point, heading: number | null, states: StateInfo[]): StateInfo[] {
  const anchors = heading == null ? [fix] : [fix, ahead(fix, heading, AHEAD_MILES)];
  return states
    .filter((box) => box.w < box.e)
    .map((box) => ({ box, miles: Math.min(...anchors.map((at) => milesToBox(at, box))) }))
    .filter((row) => row.miles <= NEAR_MILES)
    .sort((a, b) => a.miles - b.miles || (a.box.e - a.box.w) * (a.box.n - a.box.s) - (b.box.e - b.box.w) * (b.box.n - b.box.s))
    .slice(0, PER_LOOK)
    .map((row) => row.box);
}

/** Oldest saved-ahead states go once there are too many (never ones for here, never ones saved by hand). */
async function makeRoom(keep: Set<string>) {
  const regions = useOfflineMaps.getState().regions;
  let extra = regions.filter((region) => region.auto).length - MAX_AUTO;
  const old = regions.filter((region) => region.auto && !keep.has(region.abbr)).sort((a, b) => a.savedAt - b.savedAt);
  for (const region of old) {
    if (extra <= 0) break;
    await useOfflineMaps.getState().remove(region.abbr);
    extra -= 1;
  }
}

/**
 * Saves what's missing for where you are (at most every 10 minutes unless
 * `now`). Quietly does nothing when off, on mobile data in Wi-Fi mode, or
 * when a save is already running.
 */
export async function saveMapsAhead(fix: Point, heading: number | null, states: StateInfo[], mode: MapsAhead, now = false) {
  if (mode === "off" || looking || !states.length) return;
  if (!now && Date.now() - lastLook < LOOK_EVERY_MS) return;
  lastLook = Date.now();
  looking = true;
  try {
    await useOfflineMaps.getState().load();
    const wanted = statesAhead(fix, heading, states);
    const keep = new Set(wanted.map((box) => box.abbr));
    const have = new Set(useOfflineMaps.getState().regions.map((region) => region.abbr));
    for (const box of wanted) {
      if (have.has(box.abbr)) continue;
      if (useOfflineMaps.getState().saving) break;
      if (!(await bigDownloadOk(mode === "any"))) break;
      if (!(await useOfflineMaps.getState().save(box, true))) break;
      await makeRoom(keep);
    }
  } catch {
    // Next look tries again.
  } finally {
    looking = false;
  }
}
