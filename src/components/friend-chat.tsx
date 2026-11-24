import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useChat } from "@/lib/chat-store";
import { deleteMessage, listThread, loadThreadPhoto, sendToThread, type ChatMessage, type ChatPlace, type Thread } from "@/lib/messages";
import { milesBetween } from "@/lib/nearby";
import { readGps } from "@/lib/photo-file";
import { categoryName } from "@/lib/place-kinds";
import { pushBack } from "@/lib/sheet-back";

const PHOTO_LINK = /^https?:\/\/(?:photos\.app\.goo\.gl|photos\.google\.com|goo\.gl\/photos)\/\S+$/i;

export type ChatPlaceOption = {
  id: string;
  name: string;
  state?: string;
  category?: string;
  lat: number | null;
  lon: number | null;
  visitedOn?: string | null;
};
export type ChatPhoto = { thumb: string; image: string; lat: number | null; lon: number | null; takenAt: number | null };

function newId() {
  return `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function shrinkChatPhoto(file: File, edge: number, quality: number) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that photo"));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, edge / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const g = canvas.getContext("2d");
        if (!g) {
          reject(new Error("Couldn't read that photo"));
          return;
        }
        g.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Couldn't read that photo"));
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function linkParts(text: string) {
  return text.split(/(https?:\/\/\S+)/g).map((part, index) =>
    /^https?:\/\//.test(part) ? (
      <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="underline">
        {part.replace(/^https?:\/\//, "")}
      </a>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

const shortDate = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Search your places by name ("adams wi" narrows by state). */
function searchPlaces(places: ChatPlaceOption[], query: string) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const parts = q.split(/\s+/).filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  return places
    .filter((place) => {
      const name = place.name.toLowerCase();
      if (name.includes(q)) return true;
      return parts.length >= 2 && (place.state ?? "").toLowerCase() === last && name.includes(parts.slice(0, -1).join(" "));
    })
    .slice(0, 30);
}

/**
 * A conversation with a friend or a trip group. Long-press a message (or tap
 * its ··· button) for what you can do with it; tap a photo to see it full size.
 */
export function ChatThread({
  thread,
  meId,
  places,
  onAddToMap,
  onOpenPlace,
  fill = false,
}: {
  thread: Thread;
  meId: string;
  places: ChatPlaceOption[];
  onAddToMap: (photo: ChatPhoto, place: ChatPlaceOption) => Promise<void>;
  onOpenPlace?: (place: ChatPlace) => void;
  /** Fill a full-screen chat: messages take the space, the box sits at the bottom. */
  fill?: boolean;
}) {
  const [rows, setRows] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<ChatMessage | null>(null);
  const [picking, setPicking] = useState<ChatMessage | null>(null);
  const [viewing, setViewing] = useState<{ id: string; thumb: string; image: string | null } | null>(null);
  const [attach, setAttach] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [query, setQuery] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const group = thread.kind === "group";
  const threadKey = `${thread.kind}:${thread.id}`;

  useEffect(() => {
    let dead = false;
    useChat.getState().setOpen(thread);
    const pull = () => {
      listThread({ data: { thread } })
        .then((next) => {
          if (dead) return;
          setRows(next);
          void useChat.getState().refresh();
        })
        .catch((err) => {
          if (!dead) setNote(err instanceof Error ? err.message : "Couldn't load the chat.");
        });
    };
    setRows(null);
    pull();
    const id = window.setInterval(pull, 8000);
    return () => {
      dead = true;
      window.clearInterval(id);
      useChat.getState().setOpen(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadKey]);

  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [rows?.length]);
  // The keyboard opening shrinks the screen: keep the newest message in view.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const keep = () => {
      const node = scroller.current;
      if (node) node.scrollTop = node.scrollHeight;
    };
    vv.addEventListener("resize", keep);
    return () => vv.removeEventListener("resize", keep);
  }, []);

  // Back closes whatever is on top: the photo, a picker, the menu.
  useEffect(() => {
    if (!viewing && !picking && !menu && !attach && !sharing) return;
    return pushBack(() => {
      if (viewing) setViewing(null);
      else if (picking) setPicking(null);
      else if (sharing) setSharing(false);
      else if (attach) setAttach(false);
      else setMenu(null);
      return true;
    });
  }, [viewing, picking, menu, attach, sharing]);

  function optimistic(row: Omit<ChatMessage, "fromId" | "fromName" | "at">) {
    const full: ChatMessage = { ...row, fromId: meId, fromName: "You", at: Date.now() };
    setRows((prev) => [...(prev ?? []), full]);
    return full.id;
  }
  const drop = (id: string) => setRows((prev) => (prev ?? []).filter((row) => row.id !== id));

  async function sendText() {
    const body = draft.trim();
    if (!body || busy) return;
    const kind = PHOTO_LINK.test(body) ? "link" : "text";
    const id = newId();
    setBusy(true);
    setNote(null);
    setDraft("");
    optimistic({ id, kind, body, thumb: "", lat: null, lon: null, takenAt: null, place: null });
    try {
      await sendToThread({ data: { thread, id, kind, body } });
    } catch (err) {
      drop(id);
      setDraft(body);
      setNote(err instanceof Error ? err.message : "Couldn't send that.");
    } finally {
      setBusy(false);
    }
  }

  async function sendPhoto(file: File) {
    setBusy(true);
    setNote(null);
    try {
      // Where and when it was taken, so whoever adds it to the map gets the place suggested.
      const gps = readGps(await file.arrayBuffer());
      const image = await shrinkChatPhoto(file, 640, 0.7);
      if (image.length > 150000) throw new Error("Use a smaller photo");
      const thumb = await shrinkChatPhoto(file, 200, 0.6);
      if (thumb.length > 38000) throw new Error("Use a smaller photo");
      const id = newId();
      const extra = { lat: gps?.lat ?? null, lon: gps?.lon ?? null, takenAt: gps?.takenAt ?? file.lastModified ?? null };
      optimistic({ id, kind: "photo", body: "", thumb, place: null, ...extra });
      try {
        await sendToThread({ data: { thread, id, kind: "photo", body: "", thumb, image, ...extra } });
      } catch (err) {
        drop(id);
        throw err;
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't send that photo.");
    } finally {
      setBusy(false);
    }
  }

  async function sendPlace(place: ChatPlaceOption) {
    setSharing(false);
    setAttach(false);
    if (!place.state) return;
    const id = newId();
    const card: ChatPlace = {
      id: place.id,
      name: place.name,
      category: place.category ?? "",
      state: place.state,
      lat: place.lat,
      lon: place.lon,
      points: 0,
      visitedOn: place.visitedOn ?? null,
    };
    optimistic({ id, kind: "place", body: "", thumb: "", lat: place.lat, lon: place.lon, takenAt: null, place: card });
    try {
      await sendToThread({ data: { thread, id, kind: "place", place: card } });
    } catch (err) {
      drop(id);
      setNote(err instanceof Error ? err.message : "Couldn't share that place.");
    }
  }

  async function remove(message: ChatMessage) {
    setMenu(null);
    const mine = message.fromId === meId;
    drop(message.id);
    try {
      await deleteMessage({ data: { thread, id: message.id } });
      setNote(mine ? "Unsent." : "Deleted for you.");
    } catch (err) {
      setRows((prev) => [...(prev ?? []), message].sort((a, b) => a.at - b.at));
      setNote(err instanceof Error ? err.message : "Couldn't delete that.");
    }
  }

  function view(message: ChatMessage) {
    setMenu(null);
    setViewing({ id: message.id, thumb: message.thumb, image: null });
    loadThreadPhoto({ data: { thread, id: message.id } })
      .then((row) => setViewing((cur) => (cur?.id === message.id ? { ...cur, image: row.image } : cur)))
      .catch(() => setNote("Couldn't open that photo."));
  }

  async function addPicked(place: ChatPlaceOption) {
    const message = picking;
    if (!message) return;
    setPicking(null);
    setMenu(null);
    setNote(null);
    try {
      const loaded = await loadThreadPhoto({ data: { thread, id: message.id } });
      await onAddToMap({ thumb: message.thumb, image: loaded.image, lat: message.lat, lon: message.lon, takenAt: message.takenAt }, place);
      setNote(`Added to ${place.name}. It stays private until you share it.`);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't add that photo.");
    }
  }

  const hits = useMemo(() => searchPlaces(places, query), [places, query]);
  // A photo with a location: your places nearest to where it was taken.
  const nearby = useMemo(() => {
    if (!picking || picking.lat == null || picking.lon == null) return [];
    const { lat, lon } = picking as { lat: number; lon: number };
    return places
      .filter((place) => place.lat != null && place.lon != null)
      .map((place) => ({ place, miles: milesBetween(lat, lon, place.lat as number, place.lon as number) }))
      .filter((row) => row.miles <= 25)
      .sort((a, b) => a.miles - b.miles)
      .slice(0, 5);
  }, [picking, places]);

  function holdStart(message: ChatMessage, event: React.PointerEvent) {
    const timer = window.setTimeout(() => {
      press.current = null;
      setMenu(message);
    }, 480);
    press.current = { timer, x: event.clientX, y: event.clientY };
  }
  function holdMove(event: React.PointerEvent) {
    const p = press.current;
    if (p && Math.hypot(event.clientX - p.x, event.clientY - p.y) > 10) holdEnd();
  }
  function holdEnd() {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  }

  return (
    <div className={fill ? "flex min-h-0 flex-1 flex-col" : "mt-4"}>
      {fill ? null : (
        <p className="px-2 text-sm text-muted">
          {group ? "Everyone in this chat sees what you send." : "Text, a photo, a place, or a Google Photos link."} Hold a message for options.
        </p>
      )}
      <div ref={scroller} className={"flex flex-col gap-2 overflow-y-auto px-3 " + (fill ? "min-h-0 flex-1 py-3" : "mt-2 max-h-[46dvh]")}>
        {rows === null ? <p className="text-sm text-muted">Loading…</p> : null}
        {rows && rows.length === 0 ? (
          <p className="m-auto max-w-xs text-center text-sm text-muted">
            Nothing yet. Say hi, send a photo, or share a place you've been with the + button. Hold a message for more.
          </p>
        ) : null}
        {rows?.map((row) => {
          const mine = row.fromId === meId;
          return (
            <div key={row.id} className={"flex flex-col " + (mine ? "items-end" : "items-start")}>
              {group && !mine ? <span className="mb-0.5 px-1 text-xs text-faint">{row.fromName}</span> : null}
              <div
                onPointerDown={(event) => holdStart(row, event)}
                onPointerMove={holdMove}
                onPointerUp={holdEnd}
                onPointerCancel={holdEnd}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu(row);
                }}
                className={"max-w-[78%] rounded-2xl px-3 py-1.5 text-[15px] leading-snug select-none " + (row.kind === "text" ? "" : "w-64 ") + (mine ? "rounded-br-md bg-elevated" : "rounded-bl-md border border-line")}
              >
                {row.kind === "photo" && row.thumb ? (
                  <button type="button" onClick={() => view(row)} className="block w-full" aria-label="See the photo">
                    <img src={row.thumb} alt="" className="max-h-48 w-full rounded-md object-cover" />
                  </button>
                ) : null}
                {row.kind === "photo" && row.lat != null ? <span className="mt-1 block text-xs text-faint">Has a location</span> : null}
                {row.kind === "link" ? (
                  <a href={row.body} target="_blank" rel="noopener noreferrer" className="block">
                    <span className="block text-xs tracking-widest text-faint uppercase">Google Photos</span>
                    <span className="mt-1 block break-all underline">{row.body.replace(/^https?:\/\//, "")}</span>
                  </a>
                ) : null}
                {row.kind === "place" && row.place ? (
                  <div>
                    <span className="block text-xs tracking-widest text-faint uppercase">{mine ? "I was here" : `${row.fromName} was here`}</span>
                    <span className="mt-1 block font-serif text-lg leading-tight">{row.place.name}</span>
                    <span className="block text-xs text-muted">
                      {categoryName(row.place.category, row.place.name)} · {row.place.state}
                      {row.place.points ? ` · ${row.place.points} pts` : ""}
                      {row.place.visitedOn ? ` · ${shortDate(row.place.visitedOn)}` : ""}
                    </span>
                    {onOpenPlace ? (
                      <button type="button" onClick={() => onOpenPlace(row.place as ChatPlace)} className="my-1.5 h-10 w-full rounded-lg border border-line text-sm">
                        Show on map
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {row.kind === "text" ? <p className="break-words">{linkParts(row.body)}</p> : null}
              </div>
            </div>
          );
        })}
      </div>
      {note ? <p className="mt-2 px-3 text-sm text-muted">{note}</p> : null}
      <form
        className={"flex items-end gap-2 px-3 " + (fill ? "border-t border-line bg-surface pt-2 safe-bottom" : "mt-2")}
        onSubmit={(event) => {
          event.preventDefault();
          void sendText();
        }}
      >
        <button
          type="button"
          aria-label="Send a photo or a place"
          disabled={busy}
          onClick={() => setAttach(true)}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-line text-lg text-muted"
        >
          +
        </button>
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void sendPhoto(file);
          }}
        />
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value.slice(0, 500))}
          onFocus={() => window.setTimeout(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight }), 300)}
          placeholder="Message"
          enterKeyHint="send"
          className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-base text-ink outline-none placeholder:text-faint"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="h-11 shrink-0 rounded-lg border border-ink bg-elevated px-3 text-sm disabled:border-line disabled:text-faint"
        >
          Send
        </button>
      </form>

      {attach ? (
        <Sheet label="Send" onClose={() => setAttach(false)}>
          <button
            type="button"
            onClick={() => {
              setAttach(false);
              photoInput.current?.click();
            }}
            className="h-11 w-full rounded-lg border border-line text-sm"
          >
            A photo
          </button>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setSharing(true);
              setAttach(false);
            }}
            className="mt-2 h-11 w-full rounded-lg border border-line text-sm"
          >
            A place you've been
          </button>
        </Sheet>
      ) : null}

      {sharing ? (
        <Sheet label="Share a place" onClose={() => setSharing(false)}>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search places you've added"
            className="h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-ink outline-none"
          />
          <PlaceList
            places={query.trim().length >= 2 ? hits : places.filter((p) => p.visitedOn).sort((a, b) => ((a.visitedOn ?? "") < (b.visitedOn ?? "") ? 1 : -1)).slice(0, 8)}
            empty={query.trim().length >= 2 ? "No place named that." : "Type at least two letters."}
            onPick={(place) => void sendPlace(place)}
          />
        </Sheet>
      ) : null}

      {menu ? (
        <Sheet label="Message" onClose={() => setMenu(null)}>
          {menu.kind === "photo" ? (
            <>
              <button type="button" onClick={() => view(menu)} className="h-11 w-full rounded-lg border border-line text-sm">
                See full size
              </button>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setPicking(menu);
                  setMenu(null);
                }}
                className="mt-2 h-11 w-full rounded-lg border border-line text-sm"
              >
                Add to a place on my map
              </button>
            </>
          ) : null}
          {menu.kind === "place" && menu.place && onOpenPlace ? (
            <button
              type="button"
              onClick={() => {
                setMenu(null);
                onOpenPlace(menu.place as ChatPlace);
              }}
              className="h-11 w-full rounded-lg border border-line text-sm"
            >
              Show on map
            </button>
          ) : null}
          {menu.kind === "text" || menu.kind === "link" ? (
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(menu.body).catch(() => {});
                setMenu(null);
                setNote("Copied.");
              }}
              className="h-11 w-full rounded-lg border border-line text-sm"
            >
              Copy
            </button>
          ) : null}
          <button type="button" onClick={() => void remove(menu)} className="mt-2 h-11 w-full rounded-lg border border-line text-sm text-accent">
            {menu.fromId === meId ? "Unsend for everyone" : "Delete for me"}
          </button>
        </Sheet>
      ) : null}

      {picking ? (
        <Sheet label="Add this photo to a place" onClose={() => setPicking(null)}>
          {nearby.length ? (
            <>
              <p className="text-xs text-faint">Near where it was taken</p>
              <ul className="mt-1">
                {nearby.map(({ place, miles }) => (
                  <li key={place.id}>
                    <button type="button" onClick={() => void addPicked(place)} className="flex h-11 w-full items-center gap-2 text-left text-sm">
                      <span className="min-w-0 flex-1 truncate">{place.state ? `${place.name}, ${place.state}` : place.name}</span>
                      <span className="text-xs text-faint">{miles < 0.1 ? "here" : `${miles.toFixed(1)} mi`}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <input
            autoFocus={!nearby.length}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search places you've added"
            className="mt-2 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-ink outline-none"
          />
          {query.trim().length >= 2 ? <PlaceList places={hits} empty="No place named that." onPick={(place) => void addPicked(place)} /> : null}
        </Sheet>
      ) : null}

      {viewing ? createPortal(
        <div className="screen-top fixed inset-0 z-[60] flex flex-col bg-black" role="dialog" aria-label="Photo">
          <div className="flex justify-end p-2">
            <button type="button" onClick={() => setViewing(null)} className="h-11 rounded-lg border border-white/30 px-4 text-sm text-white">
              Close
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-2">
            <img
              src={viewing.image ?? viewing.thumb}
              alt=""
              className={"max-h-full max-w-full object-contain " + (viewing.image ? "" : "opacity-60 blur-sm")}
            />
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

function PlaceList({ places, empty, onPick }: { places: ChatPlaceOption[]; empty: string; onPick: (place: ChatPlaceOption) => void }) {
  if (!places.length) return <p className="mt-3 text-sm text-muted">{empty}</p>;
  return (
    <ul className="mt-2 max-h-64 overflow-y-auto">
      {places.map((place) => (
        <li key={place.id}>
          <button type="button" onClick={() => onPick(place)} className="flex h-11 w-full items-center text-left text-sm">
            <span className="min-w-0 flex-1 truncate">{place.state ? `${place.name}, ${place.state}` : place.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * A small bottom sheet over everything, with a dimmed backdrop. Drawn at the
 * top of the page so the map's menu (or anything else) can't cover it.
 */
export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]" onClick={onClose}>
      <div role="dialog" aria-label={label} className="w-full max-w-sm rounded-card border border-line bg-surface p-3" onClick={(event) => event.stopPropagation()}>
        <p className="mb-2 text-xs tracking-widest text-faint uppercase">{label}</p>
        {children}
        <button type="button" onClick={onClose} className="mt-2 h-11 w-full rounded-lg border border-line text-sm">
          Close
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** The part of the screen not covered by the keyboard (top and height, in px). */
function useVisibleArea() {
  const read = () => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    return vv ? { top: vv.offsetTop, height: vv.height } : { top: 0, height: typeof window !== "undefined" ? window.innerHeight : 0 };
  };
  const [area, setArea] = useState(read);
  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => setArea(read());
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return area;
}

export type ChatAction = { label: string; onClick: () => void; danger?: boolean };

/**
 * A conversation on its own screen: a header with the name, the messages, and
 * the message box at the bottom, which stays just above the keyboard. Back (or
 * the arrow) returns to where you were.
 */
export function ChatScreen({
  title,
  subtitle,
  note,
  actions = [],
  onClose,
  ...chat
}: {
  title: string;
  subtitle?: string;
  note?: string | null;
  actions?: ChatAction[];
  onClose: () => void;
} & React.ComponentProps<typeof ChatThread>) {
  const area = useVisibleArea();
  const [more, setMore] = useState(false);
  useEffect(
    () =>
      pushBack(() => {
        onClose();
        return true;
      }),
    [onClose],
  );
  useEffect(() => {
    if (!more) return;
    return pushBack(() => {
      setMore(false);
      return true;
    });
  }, [more]);
  return createPortal(
    <div
      role="dialog"
      aria-label={`Chat with ${title}`}
      className="fixed inset-x-0 z-40 flex flex-col bg-bg"
      style={{ top: area.top, height: area.height || "100dvh" }}
    >
      <header className="screen-top flex shrink-0 items-center gap-2 border-b border-line bg-surface px-2 pb-2">
        <button type="button" onClick={onClose} aria-label="Back" className="grid h-11 w-11 place-items-center rounded-full text-xl text-ink">
          ‹
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-serif text-xl leading-tight">{title}</p>
          {subtitle ? <p className="truncate text-xs text-muted">{subtitle}</p> : null}
        </div>
        {actions.length ? (
          <button type="button" onClick={() => setMore(true)} aria-label="More" className="grid h-11 w-11 place-items-center rounded-full text-lg text-muted">
            ···
          </button>
        ) : null}
      </header>
      {note ? <p className="shrink-0 border-b border-line px-3 py-2 text-sm text-muted">{note}</p> : null}
      <ChatThread {...chat} fill />
      {more ? (
        <Sheet label={title} onClose={() => setMore(false)}>
          <div className="grid gap-2">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => {
                  setMore(false);
                  action.onClick();
                }}
                className={"h-11 w-full rounded-lg border border-line text-sm " + (action.danger ? "text-accent" : "")}
              >
                {action.label}
              </button>
            ))}
          </div>
        </Sheet>
      ) : null}
    </div>,
    document.body,
  );
}
