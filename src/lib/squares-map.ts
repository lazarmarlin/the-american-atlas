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

export const useSquaresOnMap = create<{ id: string | null; rev: number; dealt: { board: string; card: string } | null; finished: { board: string; card: string; place: string } | null }>(() => ({
  id: typeof window === "undefined" ? null : read(),
  rev: 0,
  dealt: null,
  finished: null,
}));

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

/** A modifier card was just dealt to you: the app shows it. */
export function cardDealt(board: string, card: string) {
  useSquaresOnMap.setState((state) => ({ dealt: { board, card }, rev: state.rev + 1 }));
}

export function cardSeen() {
  useSquaresOnMap.setState({ dealt: null, finished: null });
}

/** You got to a card's place: the app says so. */
export function cardFinished(board: string, card: string, place: string) {
  useSquaresOnMap.setState((state) => ({ finished: { board, card, place }, rev: state.rev + 1 }));
}
