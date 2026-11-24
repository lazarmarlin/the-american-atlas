/**
 * Unread messages and thumbs-up, checked every so often while the app runs
 * (also in the background while tracking keeps it awake). New ones get a
 * phone notification unless you're looking at that conversation.
 */
import { create } from "zustand";
import { notifyMessage } from "@/lib/live-notify";
import { unreadSummary, type Thread, type UnreadSummary } from "@/lib/messages";

const SEEN_KEY = "atlas-notified-messages";
const EMPTY: UnreadSummary = { friends: {}, groups: {}, likes: 0, latest: [] };

type ChatState = {
  summary: UnreadSummary;
  /** The conversation on screen, if any ("friend:<id>" / "group:<id>"). */
  open: string | null;
  setOpen: (thread: Thread | null) => void;
  refresh: () => Promise<void>;
  total: () => number;
};

const keyOf = (thread: Thread) => `${thread.kind}:${thread.id}`;

function seenIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function saveSeen(ids: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-100)));
  } catch {
    /* fine */
  }
}

let lastLikes = -1;

export const useChat = create<ChatState>((set, get) => ({
  summary: EMPTY,
  open: null,
  setOpen: (thread) => set({ open: thread ? keyOf(thread) : null }),
  total: () => {
    const s = get().summary;
    return Object.values(s.friends).reduce((a, b) => a + b, 0) + Object.values(s.groups).reduce((a, b) => a + b, 0) + s.likes;
  },
  refresh: async () => {
    let summary: UnreadSummary;
    try {
      summary = await unreadSummary();
    } catch {
      return;
    }
    const { open } = get();
    // Whatever is on screen right now counts as read.
    if (open) {
      const [kind, id] = open.split(":") as ["friend" | "group", string];
      const bucket = kind === "group" ? summary.groups : summary.friends;
      if (bucket[id]) summary = { ...summary, [kind === "group" ? "groups" : "friends"]: { ...bucket, [id]: 0 } };
    }
    set({ summary });
    const seen = seenIds();
    const fresh = summary.latest.filter((m) => !seen.has(m.id) && keyOf(m.thread) !== open);
    for (const m of fresh.slice(0, 3).reverse()) void notifyMessage(m.from, m.preview);
    for (const m of summary.latest) seen.add(m.id);
    saveSeen(seen);
    if (lastLikes >= 0 && summary.likes > lastLikes) void notifyMessage("New thumbs-up", "A friend liked one of your badges or check-ins.");
    lastLikes = summary.likes;
  },
}));

let timer = 0;
/** Start checking (once, after sign-in). Returns a stop function. */
export function startChatChecks() {
  window.clearInterval(timer);
  void useChat.getState().refresh();
  const tick = () => void useChat.getState().refresh();
  timer = window.setInterval(tick, 45_000);
  const onShow = () => {
    if (document.visibilityState === "visible") tick();
  };
  document.addEventListener("visibilitychange", onShow);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onShow);
  };
}
