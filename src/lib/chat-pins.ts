/**
 * Pinned chats (kept at the top of the list) and removed ones (out of the list
 * until something new comes in). Kept on this phone, per account.
 */
import { create } from "zustand";

type Saved = { pinned: string[]; hidden: Record<string, number> };
type PinState = Saved & {
  owner: string | null;
  load: (meId: string) => void;
  togglePin: (key: string) => void;
  hide: (key: string) => void;
  unhide: (key: string) => void;
};

const storeKey = (meId: string) => `atlas.chat-pins.${meId}`;

function read(meId: string): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(storeKey(meId)) ?? "{}") as Partial<Saved>;
    return { pinned: Array.isArray(raw.pinned) ? raw.pinned.filter((k) => typeof k === "string") : [], hidden: raw.hidden && typeof raw.hidden === "object" ? raw.hidden : {} };
  } catch {
    return { pinned: [], hidden: {} };
  }
}

export const useChatPins = create<PinState>((set, get) => {
  const save = (next: Saved) => {
    const owner = get().owner;
    if (owner) {
      try {
        localStorage.setItem(storeKey(owner), JSON.stringify(next));
      } catch {
        /* storage blocked */
      }
    }
    set(next);
  };
  return {
    pinned: [],
    hidden: {},
    owner: null,
    load: (meId) => {
      if (get().owner === meId) return;
      set({ owner: meId, ...read(meId) });
    },
    togglePin: (key) => {
      const { pinned, hidden } = get();
      const rest = { ...hidden };
      delete rest[key];
      save({ pinned: pinned.includes(key) ? pinned.filter((k) => k !== key) : [...pinned, key], hidden: rest });
    },
    hide: (key) => {
      const { pinned, hidden } = get();
      save({ pinned: pinned.filter((k) => k !== key), hidden: { ...hidden, [key]: Date.now() } });
    },
    unhide: (key) => {
      const { pinned, hidden } = get();
      const rest = { ...hidden };
      delete rest[key];
      save({ pinned, hidden: rest });
    },
  };
});

/** Removed chats out (back once there's something newer), pinned ones first in the order pinned. */
export function arrangeChats<T>(rows: T[], keyOf: (row: T) => string, atOf: (row: T) => number, _unreadOf: (row: T) => number, pins: Saved) {
  const showing = rows.filter((row) => {
    const gone = pins.hidden[keyOf(row)];
    // Back only for a message newer than when it was removed.
    return !gone || atOf(row) > gone;
  });
  const pinned = pins.pinned.map((key) => showing.find((row) => keyOf(row) === key)).filter((row): row is T => row != null);
  return [...pinned, ...showing.filter((row) => !pins.pinned.includes(keyOf(row)))];
}
