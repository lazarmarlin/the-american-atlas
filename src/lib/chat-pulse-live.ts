/**
 * The open chat's heartbeat: every few seconds (and right away when you start
 * typing) it tells the server you're here, and hears who else is and how the
 * streak stands. Leaving the chat, or the app going to the background, says
 * you've gone, so your avatar leaves their screen straight away.
 */
import { useEffect, useRef } from "react";
import { create } from "zustand";
import { chatPulse, myZone, type ChatPulse } from "@/lib/chat-pulse";
import type { Thread } from "@/lib/messages";

type PulseState = { key: string | null; pulse: ChatPulse | null };

export const usePulse = create<PulseState>(() => ({ key: null, pulse: null }));

const keyOf = (thread: Thread) => `${thread.kind}:${thread.id}`;

/** This chat's pulse, if it's the one open. */
export function usePulseFor(thread: Thread) {
  const key = keyOf(thread);
  return usePulse((state) => (state.key === key ? state.pulse : null));
}

const EVERY_MS = 4000;
/** Typing counts for this long after the last key. */
const TYPING_MS = 5000;

export function useChatPulse(thread: Thread, draft: string) {
  const typedAt = useRef(0);
  const sentTyping = useRef(false);
  const kick = useRef<() => void>(() => undefined);
  const key = keyOf(thread);

  useEffect(() => {
    if (!draft.trim()) {
      typedAt.current = 0;
      if (sentTyping.current) kick.current();
      return;
    }
    typedAt.current = Date.now();
    // Started typing: say so now, not at the next check.
    if (!sentTyping.current) kick.current();
  }, [draft]);

  useEffect(() => {
    let dead = false;
    let inFlight = false;
    let misses = 0;
    let timer = 0;
    usePulse.setState({ key, pulse: null });
    const zone = myZone();
    const typing = () => typedAt.current > 0 && Date.now() - typedAt.current < TYPING_MS;
    const beat = () => {
      window.clearTimeout(timer);
      if (dead) return;
      if (document.visibilityState !== "visible") return;
      if (inFlight) {
        timer = window.setTimeout(beat, 300);
        return;
      }
      inFlight = true;
      const now = typing();
      chatPulse({ data: { thread, typing: now, zone } })
        .then((pulse) => {
          misses = 0;
          sentTyping.current = now;
          if (!dead) usePulse.setState({ key, pulse });
        })
        .catch(() => {
          // A server from before this (or no signal): try less and less often.
          misses += 1;
        })
        .finally(() => {
          inFlight = false;
          if (!dead) timer = window.setTimeout(beat, misses ? Math.min(60000, EVERY_MS * 2 ** misses) : EVERY_MS);
        });
    };
    kick.current = beat;
    const gone = () => {
      void chatPulse({ data: { thread, gone: true, zone } }).catch(() => undefined);
    };
    const seen = () => {
      if (document.visibilityState === "visible") beat();
      else gone();
    };
    beat();
    document.addEventListener("visibilitychange", seen);
    return () => {
      dead = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", seen);
      kick.current = () => undefined;
      gone();
      if (usePulse.getState().key === key) usePulse.setState({ key: null, pulse: null });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
