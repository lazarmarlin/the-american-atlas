/**
 * Which City squares game (if any) is drawn on the main map. Kept on this
 * phone; the board's "Show on the map" switch sets it.
 */
import { create } from "zustand";

const KEY = "atlas.squares-on-map";

function read() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export const useSquaresOnMap = create<{ id: string | null; rev: number }>(() => ({ id: typeof window === "undefined" ? null : read(), rev: 0 }));

export function setSquaresOnMap(id: string | null) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // Kept for this visit only.
  }
  useSquaresOnMap.setState({ id });
}

/** Squares changed (tracking added some, someone skipped one): the map draws them again. */
export function squaresChanged() {
  useSquaresOnMap.setState((state) => ({ rev: state.rev + 1 }));
}
