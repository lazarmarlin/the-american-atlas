/**
 * Your friends' map avatars in a row along the bottom of the map, like chat
 * heads: tap one to open your chat with them, hold it to see them (on the map
 * if they're sharing where they are). A face with new messages bounces and
 * carries the count; a streak shows as a little flame.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { YouMarkerFace } from "@/components/you-marker-face";
import { friendFaces, myStreaks, myZone, STREAK_HURRY_MS, type FriendFace, type Streak } from "@/lib/chat-pulse";
import { useChat } from "@/lib/chat-store";
import { nickOf } from "@/lib/chat-look";
import { useChatPins } from "@/lib/chat-pins";

const HOLD_MS = 480;

export function FriendFaces({
  meId,
  onOpen,
  onHold,
  onCount,
  lead,
}: {
  meId: string;
  /** Round buttons before the faces (Ghost trail, Drive). */
  lead?: ReactNode;
  onOpen: (id: string, name: string) => void;
  onHold: (id: string, name: string) => void;
  /** How many faces are showing (0 hides the row), so the map's buttons can make room. */
  onCount?: (n: number) => void;
}) {
  const [faces, setFaces] = useState<FriendFace[] | null>(null);
  const [streaks, setStreaks] = useState<Record<string, Streak>>({});
  const pinned = useChatPins((state) => state.pinned);
  const loadPins = useChatPins((state) => state.load);
  useEffect(() => loadPins(meId), [loadPins, meId]);
  const unread = useChat((state) => state.summary.friends);
  const unreadKey = Object.entries(unread)
    .map(([id, n]) => `${id}:${n}`)
    .join(",");

  useEffect(() => {
    let dead = false;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      friendFaces()
        .then((rows) => {
          if (!dead) setFaces(rows);
        })
        .catch(() => {
          // A server from before the faces: no row.
          if (!dead) setFaces((cur) => cur ?? []);
        });
      myStreaks({ data: { zone: myZone() } })
        .then((next) => {
          if (!dead) setStreaks(next);
        })
        .catch(() => undefined);
    };
    load();
    const id = window.setInterval(load, 90_000);
    document.addEventListener("visibilitychange", load);
    return () => {
      dead = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", load);
    };
    // New messages: the order (and the streaks) may have changed.
  }, [unreadKey]);

  // New messages first, then whoever you talked to last.
  const shown = useMemo(() => {
    if (!faces) return [];
    // New messages first, then pinned chats, then whoever you talked to last.
    const pin = (id: string) => (pinned.includes(`friend:${id}`) ? 1 : 0);
    return [...faces].sort((a, b) => Math.sign(unread[b.id] ?? 0) - Math.sign(unread[a.id] ?? 0) || pin(b.id) - pin(a.id) || (b.lastAt ?? 0) - (a.lastAt ?? 0));
  }, [faces, unread, pinned]);

  useEffect(() => {
    onCount?.(shown.length);
  }, [onCount, shown.length]);

  const hold = useRef<{ timer: number; fired: boolean; x: number; y: number } | null>(null);

  if (!shown.length && !lead) return null;
  return (
    <div className="pointer-events-auto -mx-1 flex h-16 max-w-[calc(100%+0.5rem)] items-start gap-1 overflow-x-auto px-1 pt-1.5 [scrollbar-width:none]" aria-label="Friends">
      {lead}
      {shown.map((face) => {
        const n = unread[face.id] ?? 0;
        const streak = streaks[face.id];
        const name = nickOf(meId, "friend", face.id, face.name) || face.name;
        const first = name.split(" ")[0];
        const hurry = streak?.endsAt != null && streak.endsAt - Date.now() < STREAK_HURRY_MS;
        return (
          <button
            key={face.id}
            type="button"
            aria-label={`Chat with ${name}${n ? `, ${n} new` : ""}${streak ? `, ${streak.days}-day streak` : ""}`}
            onPointerDown={(event) => {
              const start = { x: event.clientX, y: event.clientY };
              const timer = window.setTimeout(() => {
                if (hold.current) hold.current.fired = true;
                navigator.vibrate?.(12);
                onHold(face.id, name);
              }, HOLD_MS);
              hold.current = { timer, fired: false, ...start };
            }}
            onPointerMove={(event) => {
              const h = hold.current;
              // Scrolling the row isn't a hold.
              if (h && Math.hypot(event.clientX - h.x, event.clientY - h.y) > 8) window.clearTimeout(h.timer);
            }}
            onPointerUp={() => {
              if (hold.current) window.clearTimeout(hold.current.timer);
            }}
            onPointerCancel={() => {
              if (hold.current) window.clearTimeout(hold.current.timer);
              hold.current = null;
            }}
            onContextMenu={(event) => event.preventDefault()}
            onClick={() => {
              const h = hold.current;
              hold.current = null;
              if (h?.fired) return;
              onOpen(face.id, name);
            }}
            className="relative flex w-14 shrink-0 flex-col items-center select-none"
          >
            <span className={"grid size-11 place-items-center rounded-full border bg-surface/95 shadow-sm backdrop-blur-sm " + (n ? "face-bounce border-accent" : "border-line")}>
              <YouMarkerFace icon={face.icon} color={face.color} size={36} />
            </span>
            {n ? (
              <span className="absolute -top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink">{n > 99 ? "99+" : n}</span>
            ) : null}
            {streak ? (
              <span className="absolute top-7 -right-0.5 rounded-full border border-line bg-surface px-1 text-[9px] leading-[14px] font-semibold text-ink tabular-nums">
                {streak.days === 100 ? "💯" : "🔥"}
                {streak.days}
                {hurry ? "⏳" : ""}
              </span>
            ) : null}
            <span className="mt-0.5 max-w-full truncate rounded-full bg-surface/90 px-1.5 text-[10px] leading-4 text-ink">{first}</span>
          </button>
        );
      })}
    </div>
  );
}
