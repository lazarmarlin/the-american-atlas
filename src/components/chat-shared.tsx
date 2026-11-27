/**
 * Everything a chat has passed around: photos, links, places, trails, trips,
 * pins, and day cards. Both people see the same list.
 */
import { ScreenHeader } from "@/components/screen-header";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cachedThread } from "@/lib/chat-cache";
import { listThread, type ChatMessage, type ChatPlace, type Thread } from "@/lib/messages";
import { useBackClose } from "@/lib/sheet-back";
import { TripSketch } from "@/components/trip-recap";

const TABS = ["All", "Photos", "Links", "Places", "Trails", "Trips", "Pins"] as const;
type Tab = (typeof TABS)[number];

function isLink(row: ChatMessage) {
  return row.kind === "link" || (row.kind === "text" && /https?:\/\//.test(row.body));
}

function matches(row: ChatMessage, tab: Tab) {
  if (tab === "All") return row.kind !== "text" || isLink(row) || row.pinned || (row.reactions?.pin ?? 0) > 0;
  if (tab === "Photos") return row.kind === "photo";
  if (tab === "Links") return isLink(row);
  if (tab === "Places") return row.kind === "place" || row.kind === "here";
  if (tab === "Trails") return row.kind === "trail" || row.kind === "day";
  if (tab === "Trips") return row.kind === "trip";
  return Boolean(row.pinned) || (row.reactions?.pin ?? 0) > 0;
}

export function SharedInChat({
  meId,
  thread,
  onClose,
  onOpenPlace,
  onOpenTrail,
  onOpenHere,
  onOpenBoard,
}: {
  meId: string;
  thread: Thread;
  onClose: () => void;
  onOpenPlace?: (place: ChatPlace) => void;
  onOpenTrail?: (lines: [number, number][][]) => void;
  onOpenHere?: (lat: number, lon: number, label?: string) => void;
  onOpenBoard?: (id: string) => void;
}) {
  const [rows, setRows] = useState<ChatMessage[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("All");
  useBackClose(onClose);
  useEffect(() => {
    let dead = false;
    void cachedThread(meId, thread).then((saved) => {
      if (!dead && saved?.length) setRows((cur) => cur ?? saved);
    });
    listThread({ data: { thread } })
      .then((next) => {
        if (!dead) setRows(next);
      })
      .catch(() => {
        if (!dead) setNote("No connection. Showing what's saved on this phone.");
      });
    return () => {
      dead = true;
    };
  }, [meId, thread]);
  const shown = (rows ?? []).filter((row) => matches(row, tab));
  return createPortal(
    <div role="dialog" aria-label="Shared in this chat" className="screen-top fixed inset-0 z-[70] flex flex-col bg-bg">
      <ScreenHeader title="Shared" subtitle="Photos, links, places, and trails in this chat" onBack={onClose} backLabel="Back to the chat" />
      <div className="flex shrink-0 gap-1 overflow-x-auto px-3 py-2">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={"h-9 shrink-0 rounded-full px-3 text-sm " + (tab === item ? "bg-elevated text-ink" : "text-faint")}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        {note ? <p className="mb-2 text-sm text-muted">{note}</p> : null}
        {rows === null && !note ? <p className="text-sm text-muted">Loading…</p> : null}
        {rows && !shown.length ? <p className="text-sm text-muted">Nothing here yet.</p> : null}
        <ul className="grid gap-2">
          {shown.map((row) => (
            <SharedRow key={row.id} row={row} onOpenPlace={onOpenPlace} onOpenTrail={onOpenTrail} onOpenHere={onOpenHere} onOpenBoard={onOpenBoard} onClose={onClose} />
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

function SharedRow({
  row,
  onOpenPlace,
  onOpenTrail,
  onOpenHere,
  onOpenBoard,
  onClose,
}: {
  row: ChatMessage;
  onOpenPlace?: (place: ChatPlace) => void;
  onOpenTrail?: (lines: [number, number][][]) => void;
  onOpenHere?: (lat: number, lon: number, label?: string) => void;
  onOpenBoard?: (id: string) => void;
  onClose: () => void;
}) {
  const title =
    row.kind === "photo"
      ? row.body || "Photo"
      : row.kind === "place"
        ? row.place?.name || "A place"
        : row.kind === "here"
          ? row.here?.label || "I'm here"
          : row.kind === "trail"
            ? row.trail?.name || "A trail"
            : row.kind === "trip"
              ? row.trip?.name || "A trip"
              : row.kind === "day"
                ? row.day?.day || "A day"
                : row.kind === "voice"
                  ? "Voice note"
                  : row.kind === "board"
                    ? row.board?.title || "A board"
                    : row.kind === "poll"
                      ? row.poll ? `Poll: ${row.poll.q}` : "A poll"
                      : row.body.slice(0, 140);
  const open = () => {
    if (row.kind === "place" && row.place && onOpenPlace) {
      onClose();
      onOpenPlace(row.place);
    } else if (row.kind === "trail" && row.trail && onOpenTrail) {
      onClose();
      onOpenTrail(row.trail.lines);
    } else if (row.kind === "day" && row.day?.trail && onOpenTrail) {
      onClose();
      onOpenTrail(row.day.trail.lines);
    } else if (row.kind === "here" && row.here) {
      onClose();
      if (row.here.placeId && onOpenPlace) {
        onOpenPlace({
          id: row.here.placeId,
          name: row.here.label,
          category: "",
          state: row.here.state,
          lat: row.here.lat,
          lon: row.here.lon,
          points: 0,
          visitedOn: null,
          visited: false,
        });
      } else onOpenHere?.(row.here.lat, row.here.lon, `${row.fromName} was here · ${row.here.label}`);
    } else if (row.kind === "board" && row.board && onOpenBoard) {
      onClose();
      onOpenBoard(row.board.id);
    } else if (row.kind === "link") {
      window.open(row.body, "_blank", "noopener");
    }
  };
  return (
    <li>
      <button type="button" onClick={open} className="flex w-full items-center gap-3 rounded-xl border border-line px-2 py-2 text-left">
        {row.kind === "photo" && row.thumb ? <img src={row.thumb} alt="" className="size-14 shrink-0 rounded-lg object-cover" /> : null}
        {row.kind === "trail" && row.trail ? (
          <span className="w-20 shrink-0">
            <TripSketch lines={row.trail.lines} dots={[]} height={52} />
          </span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] tracking-widest text-faint uppercase">{row.kind === "text" ? "Link" : row.kind}</span>
          <span className="block truncate text-sm">{title}</span>
          <span className="block truncate text-xs text-faint">{row.fromName}</span>
        </span>
      </button>
    </li>
  );
}
