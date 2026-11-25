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
