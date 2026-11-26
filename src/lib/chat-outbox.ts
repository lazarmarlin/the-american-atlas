/**
 * Messages that couldn't go out yet. A message sent with no signal stays in
 * the chat marked "Sending…" and is sent on its own once there's a
 * connection, even if the chat or the app was closed in the meantime (it's
 * kept on the phone). Messages go out in the order they were written, and
 * sending the same one twice is harmless (the server ignores a repeat id).
 */
import { create } from "zustand";
import { cacheOutbox, cachedOutbox } from "@/lib/chat-cache";
import { sendToThread, type ChatMessage, type Thread } from "@/lib/messages";

/** What sendToThread takes (checked on the server). */
type SendData = { id: string; thread: Thread; kind: string; [field: string]: unknown };

export type OutboxEntry = {
  id: string;
  thread: Thread;
  data: SendData;
  /** What the chat shows meanwhile. */
  message: ChatMessage;
  /** Sending: waiting for a connection. Failed: the server said no (it won't retry). */
  state: "sending" | "failed";
  error?: string;
};

type OutboxState = {
  me: string | null;
  entries: OutboxEntry[];
};

export const useOutbox = create<OutboxState>(() => ({ me: null, entries: [] }));

const keyOf = (thread: Thread) => `${thread.kind}:${thread.id}`;

function save() {
  const { me, entries } = useOutbox.getState();
  if (me) void cacheOutbox(me, entries);
}

function setEntries(next: OutboxEntry[]) {
  useOutbox.setState({ entries: next });
  save();
}

/** No connection (as opposed to the server refusing the message). */
export function isConnectionError(err: unknown) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (err instanceof TypeError) return true;
  const text = err instanceof Error ? err.message : String(err ?? "");
  return /failed to fetch|network|load failed|timed? ?out|aborted|offline|connection|502|503|504/i.test(text);
}

/** A send that hasn't answered in this long counts as no connection (it may still land; a repeat is harmless). */
function withTimeout<T>(work: Promise<T>, ms: number) {
  return Promise.race([work, new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("timed out")), ms))]);
}

let flushing = false;
let again = false;

/** Try to send everything waiting, oldest first. Stops at the first message that still can't go. */
export async function flushOutbox() {
  if (flushing) {
    again = true;
    return;
  }
  flushing = true;
  try {
    do {
      again = false;
      for (const entry of useOutbox.getState().entries.filter((e) => e.state === "sending")) {
        try {
          await withTimeout(sendToThread({ data: entry.data }), 20_000);
          setEntries(useOutbox.getState().entries.filter((e) => e.id !== entry.id));
          for (const fn of sentListeners) fn(entry);
        } catch (err) {
          if (isConnectionError(err)) return;
          setEntries(
            useOutbox.getState().entries.map((e) =>
              e.id === entry.id ? { ...e, state: "failed", error: err instanceof Error ? err.message : "Couldn't send it." } : e,
            ),
          );
        }
      }
    } while (again);
  } finally {
    flushing = false;
  }
}

const sentListeners = new Set<(entry: OutboxEntry) => void>();

/** Called whenever a waiting message goes out. Returns a stop function. */
export function onOutboxSent(fn: (entry: OutboxEntry) => void) {
  sentListeners.add(fn);
  return () => void sentListeners.delete(fn);
}

/**
 * Send a message now if possible, otherwise keep it for later. "sent" when
 * it went out, "queued" when it's waiting for a connection, or the server's
 * reason when it refused (then it isn't kept).
 */
export async function sendOrQueue(thread: Thread, data: SendData, message: ChatMessage): Promise<"sent" | "queued" | { error: string }> {
  // Something older is still waiting: keep the order.
  const waiting = useOutbox.getState().entries.some((e) => e.state === "sending");
  if (!waiting) {
    try {
      await withTimeout(sendToThread({ data }), 8_000);
      return "sent";
    } catch (err) {
      if (!isConnectionError(err)) return { error: err instanceof Error ? err.message : "Couldn't send that." };
    }
  }
  setEntries([...useOutbox.getState().entries, { id: data.id, thread, data, message, state: "sending" }]);
  if (waiting) void flushOutbox();
  return "queued";
}

/** Waiting messages for one chat, oldest first. */
export function outboxFor(thread: Thread) {
  const key = keyOf(thread);
  return useOutbox.getState().entries.filter((e) => keyOf(e.thread) === key);
}

export function dropFromOutbox(id: string) {
  setEntries(useOutbox.getState().entries.filter((e) => e.id !== id));
}

export function retryFromOutbox(id: string) {
  setEntries(useOutbox.getState().entries.map((e) => (e.id === id ? { ...e, state: "sending", error: undefined } : e)));
  void flushOutbox();
}

let timer = 0;

/** Load this account's waiting messages and keep trying to send them. Returns a stop function. */
export function startOutbox(me: string) {
  window.clearInterval(timer);
  useOutbox.setState({ me, entries: [] });
  void cachedOutbox<OutboxEntry>(me).then((saved) => {
    if (useOutbox.getState().me !== me || !saved?.length) return;
    const known = new Set(useOutbox.getState().entries.map((e) => e.id));
    useOutbox.setState({ entries: [...saved.filter((e) => !known.has(e.id)), ...useOutbox.getState().entries] });
    void flushOutbox();
  });
  const tick = () => {
    if (useOutbox.getState().entries.some((e) => e.state === "sending")) void flushOutbox();
  };
  timer = window.setInterval(tick, 15_000);
  const onShow = () => {
    if (document.visibilityState === "visible") tick();
  };
  window.addEventListener("online", tick);
  document.addEventListener("visibilitychange", onShow);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("online", tick);
    document.removeEventListener("visibilitychange", onShow);
  };
}
