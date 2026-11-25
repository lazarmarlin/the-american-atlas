/**
 * Every location fix while tracking, for the map's "you" dot. The app only
 * re-renders with a new position every few seconds; the map listens here so
 * the dot (and the camera, while driving) glide along with the ghost trail
 * instead of jumping to catch up.
 */
import type { Fix } from "@/lib/nearby";

type Listener = (fix: Fix) => void;
const listeners = new Set<Listener>();
let latest: Fix | null = null;

export function noteLiveFix(fix: Fix) {
  // Locations read back from the phone's log (after the app was in the background)
  // can be older than where you are now: the dot never goes back to them.
  if (latest?.t && fix.t && fix.t < latest.t) return;
  latest = fix;
  for (const listener of listeners) listener(fix);
}

export function latestLiveFix() {
  return latest;
}

export function onLiveFix(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
