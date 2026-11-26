import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useChat } from "@/lib/chat-store";
import { deleteMessage, listThread, loadThreadPhoto, messageBoard, sendToThread, type BoardItem, type ChatMessage, type ChatPlace, type Thread } from "@/lib/messages";
import { milesBetween } from "@/lib/nearby";
import { readGps } from "@/lib/photo-file";
import { categoryName } from "@/lib/place-kinds";
import { pushBack } from "@/lib/sheet-back";
import { cacheBoard, cachePhoto, cacheThread, cachedBoard, cachedPhoto, cachedThread } from "@/lib/chat-cache";
import { savePhoto } from "@/lib/save-photo";
import { Copy, Download, Map as MapIcon, MapPinPlus, Maximize2, Trash2, Undo2, Users, X } from "lucide-react";
import { TripSketch, tripDates } from "@/components/trip-recap";

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
  const [savedNote, setSavedNote] = useState<string | null>(null);
  useEffect(() => setSavedNote(null), [viewing?.id]);
  const [attach, setAttach] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [query, setQuery] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  /** The menu was opened by holding (not right-click): it waits for the finger to lift. */
  const menuHeld = useRef(false);
  const group = thread.kind === "group";
  const threadKey = `${thread.kind}:${thread.id}`;

  useEffect(() => {
    let dead = false;
    useChat.getState().setOpen(thread);
    let offline = false;
    let shown = false;
    const pull = () => {
      listThread({ data: { thread } })
        .then((next) => {
          if (dead) return;
          shown = true;
          setRows(next);
          void cacheThread(meId, thread, next);
          if (offline) setNote(null);
          offline = false;
          void useChat.getState().refresh();
        })
        .catch((err) => {
          if (dead) return;
          // No signal: keep showing the saved messages, and say so.
          offline = true;
          setNote(shown ? "No connection. Showing saved messages." : err instanceof Error ? err.message : "Couldn't load the chat.");
        });
    };
    setRows(null);
    // Saved messages first, so the chat opens straight away (and with no signal).
    void cachedThread(meId, thread).then((saved) => {
      if (dead || !saved?.length) return;
      setRows((cur) => cur ?? saved);
      if (!shown) {
        shown = true;
        if (offline) setNote("No connection. Showing saved messages.");
      }
    });
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
      // Big enough to look sharp on a phone screen (the old 640 px / 200 px ones were blurry).
      let image = await shrinkChatPhoto(file, 1600, 0.82);
      if (image.length > 690000) image = await shrinkChatPhoto(file, 1280, 0.75);
      if (image.length > 690000) throw new Error("Use a smaller photo");
      let thumb = await shrinkChatPhoto(file, 540, 0.75);
      if (thumb.length > 115000) thumb = await shrinkChatPhoto(file, 400, 0.65);
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
    menuHeld.current = false;
    if (event.button !== 0) return;
    const timer = window.setTimeout(() => {
      press.current = null;
      menuHeld.current = true;
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
        {rows?.map((row, index) => {
          const mine = row.fromId === meId;
          const lastMine = [...rows].reverse().find((item) => item.fromId === meId)?.id === row.id;
          const prev = rows[index - 1];
          // A date and time line when the day changes or after a 30-minute gap.
          const stamp = !prev || dayOf(prev.at) !== dayOf(row.at) || row.at - prev.at > 30 * 60 * 1000;
          return (
            <div key={row.id} className={"flex flex-col " + (mine ? "items-end" : "items-start")}>
              {stamp ? <p className="my-1 w-full text-center text-[11px] text-faint">{stampText(row.at)}</p> : null}
              {group && !mine ? <span className="mb-0.5 px-1 text-xs text-faint">{row.fromName}</span> : null}
              <div
                onPointerDown={(event) => holdStart(row, event)}
                onPointerMove={holdMove}
                onPointerUp={holdEnd}
                onPointerCancel={holdEnd}
                onContextMenu={(event) => {
                  event.preventDefault();
                  // Android sends this for a long press too: then a finger is still down.
                  menuHeld.current = press.current != null || menuHeld.current;
                  holdEnd();
                  setMenu(row);
                }}
                className={"max-w-[78%] rounded-2xl px-3 py-1.5 text-[15px] leading-snug select-none " + (row.kind === "text" ? "" : "w-64 ") + (mine ? "rounded-br-md bg-elevated" : "rounded-bl-md border border-line")}
              >
                {row.kind === "photo" && row.thumb ? (
                  <button type="button" onClick={() => view(row)} className="block w-full" aria-label="See the photo">
                    <ChatImage thread={thread} meId={meId} id={row.id} thumb={row.thumb} />
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
                {row.kind === "trip" && row.trip ? (
                  <div className="py-1">
                    <span className="block text-xs tracking-widest text-faint uppercase">{mine ? "My trip" : `${row.fromName}'s trip`}</span>
                    <span className="mt-0.5 block font-serif text-lg leading-tight">{row.trip.name}</span>
                    {row.trip.from ? <span className="block text-xs text-muted">{tripDates(row.trip)}</span> : null}
                    <div className="mt-1.5">
                      <TripSketch lines={row.trip.lines} dots={row.trip.dots} height={130} />
                    </div>
                    <span className="mt-1.5 block text-xs text-muted">
                      {Math.round(row.trip.miles).toLocaleString()} mi · {row.trip.fresh} new {row.trip.fresh === 1 ? "place" : "places"} ·{" "}
                      {row.trip.points.toLocaleString()} pts
                      {row.trip.states.length ? ` · ${row.trip.states.join(", ")}` : ""}
                    </span>
                  </div>
                ) : null}
                {row.kind === "text" ? <p className="break-words">{linkParts(row.body)}</p> : null}
              </div>
              {lastMine ? (
                <span className="mt-0.5 px-1 text-[11px] text-faint">
                  {row.read ? `Read${row.readAt ? ` ${timeText(row.readAt)}` : ""}` : `Sent ${timeText(row.at)}`}
                </span>
              ) : null}
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
        <Sheet label="Message" heldOpen={menuHeld.current} onClose={() => setMenu(null)} bare>
          {/* The message itself, so it's clear which one this is about. */}
          <div className="mb-3 flex items-center gap-3 rounded-xl bg-elevated/60 p-2.5">
            {menu.kind === "photo" && menu.thumb ? <img src={menu.thumb} alt="" className="size-12 shrink-0 rounded-lg object-cover" /> : null}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-faint">
                {menu.fromId === meId ? "You" : menu.fromName} · {stampText(menu.at)}
              </p>
              <p className="truncate text-sm">
                {menu.kind === "photo" ? "Photo" : menu.kind === "place" ? menu.place?.name : menu.kind === "trip" ? menu.trip?.name : menu.body}
              </p>
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-line">
            {menu.kind === "photo" ? (
              <>
                <MenuRow icon={<Maximize2 className="size-[18px]" />} label="See full size" onClick={() => view(menu)} />
                <MenuRow
                  icon={<Download className="size-[18px]" />}
                  label="Save to my phone"
                  onClick={() => {
                    const target = menu;
                    setMenu(null);
                    loadThreadPhoto({ data: { thread, id: target.id } })
                      .then((loaded) => savePhoto(loaded.image || target.thumb))
                      .then(setNote)
                      .catch((err) => setNote(err instanceof Error ? err.message : "Couldn't save it."));
                  }}
                />
                <MenuRow
                  icon={<MapPinPlus className="size-[18px]" />}
                  label="Add to a place on my map"
                  onClick={() => {
                    setQuery("");
                    setPicking(menu);
                    setMenu(null);
                  }}
                />
              </>
            ) : null}
            {menu.kind === "place" && menu.place && onOpenPlace ? (
              <MenuRow
                icon={<MapIcon className="size-[18px]" />}
                label="Show on map"
                onClick={() => {
                  setMenu(null);
                  onOpenPlace(menu.place as ChatPlace);
                }}
              />
            ) : null}
            {menu.kind === "text" || menu.kind === "link" ? (
              <MenuRow
                icon={<Copy className="size-[18px]" />}
                label="Copy"
                onClick={() => {
                  void navigator.clipboard?.writeText(menu.body).catch(() => {});
                  setMenu(null);
                  setNote("Copied.");
                }}
              />
            ) : null}
            <MenuRow
              danger
              icon={menu.fromId === meId ? <Undo2 className="size-[18px]" /> : <Trash2 className="size-[18px]" />}
              label={menu.fromId === meId ? "Unsend for everyone" : "Delete for me"}
              onClick={() => void remove(menu)}
            />
          </div>
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
          <div className="flex items-center justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent px-2 pb-2">
            <button
              type="button"
              onClick={() => setViewing(null)}
              aria-label="Close"
              className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white backdrop-blur"
            >
              <X className="size-5" />
            </button>
            <div className="flex items-center gap-2">
              {savedNote ? <span className="max-w-48 text-right text-xs text-white/80">{savedNote}</span> : null}
              <button
                type="button"
                disabled={!viewing.image}
                onClick={() => {
                  if (!viewing.image) return;
                  setSavedNote(null);
                  savePhoto(viewing.image)
                    .then(setSavedNote)
                    .catch((err) => setSavedNote(err instanceof Error ? err.message : "Couldn't save it."));
                }}
                aria-label="Save the photo"
                className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white backdrop-blur disabled:opacity-40"
              >
                <Download className="size-5" />
              </button>
            </div>
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
export function Sheet({
  label,
  onClose,
  children,
  heldOpen = false,
  bare = false,
}: {
  label: string;
  /** No heading: the content brings its own (the message menu). */
  bare?: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /**
   * Opened by holding a finger down: taps are ignored until that finger lifts,
   * so letting go over a button (Delete, Copy…) doesn't press it.
   */
  heldOpen?: boolean;
}) {
  const armed = useRef(!heldOpen);
  useEffect(() => {
    if (armed.current) return;
    let timer = 0;
    const lift = () => {
      // The tap that follows the lift lands a moment later; let it pass first.
      timer = window.setTimeout(() => {
        armed.current = true;
      }, 120);
    };
    // Capture phase: the sheet itself swallows this lift, so a normal
    // listener on window would never hear it (and the menu would stay locked).
    const opts = { once: true, capture: true } as const;
    window.addEventListener("pointerup", lift, opts);
    window.addEventListener("pointercancel", lift, opts);
    window.addEventListener("touchend", lift, opts);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerup", lift, true);
      window.removeEventListener("pointercancel", lift, true);
      window.removeEventListener("touchend", lift, true);
    };
  }, []);
  const swallow = (event: React.SyntheticEvent) => {
    if (armed.current) return;
    event.stopPropagation();
    event.preventDefault();
  };
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      onClick={onClose}
      onClickCapture={swallow}
      onPointerUpCapture={swallow}
    >
      <div
        role="dialog"
        aria-label={label}
        className={"w-full max-w-sm border border-line bg-surface p-3 " + (bare ? "rounded-2xl shadow-2xl" : "rounded-card")}
        onClick={(event) => event.stopPropagation()}
      >
        {bare ? null : <p className="mb-2 text-xs tracking-widest text-faint uppercase">{label}</p>}
        {children}
        <button type="button" onClick={onClose} className={"mt-2 h-11 w-full text-sm " + (bare ? "rounded-xl text-muted" : "rounded-lg border border-line")}>
          {bare ? "Cancel" : "Close"}
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

/** The mail button's page: every chat, newest first. Tap one to open it. */
export function MessageBoard({
  meId,
  places,
  onAddToMap,
  onOpenPlace,
  onClose,
  initial = null,
}: {
  meId: string;
  places: ChatPlaceOption[];
  onAddToMap: (photo: ChatPhoto, place: ChatPlaceOption) => Promise<void>;
  onOpenPlace?: (place: ChatPlace, from?: Thread) => void;
  onClose: () => void;
  /** Open straight into this chat (back from a place it sent). */
  initial?: Thread | null;
}) {
  const [rows, setRows] = useState<BoardItem[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<BoardItem | null>(null);
  const unread = useChat((state) => state.summary);
  useEffect(
    () =>
      pushBack(() => {
        onClose();
        return true;
      }),
    [onClose],
  );
  // Reload on the way back from a chat, so its preview and new-message count are current.
  const reopened = useRef(false);
  useEffect(() => {
    if (open) return;
    let dead = false;
    void cachedBoard(meId).then((saved) => {
      if (!dead && saved?.length) setRows((cur) => cur ?? saved);
    });
    messageBoard()
      .then((next) => {
        if (dead) return;
        setRows(next);
        setNote(null);
        void cacheBoard(meId, next);
        if (initial && !reopened.current) {
          reopened.current = true;
          const row = next.find((item) => item.thread.kind === initial.kind && item.thread.id === initial.id);
          if (row) setOpen(row);
        }
      })
      .catch((err) => {
        if (dead) return;
        void cachedBoard(meId).then((saved) => {
          if (dead) return;
          if (saved?.length) {
            setRows((cur) => cur ?? saved);
            setNote("No connection. Showing saved messages.");
            if (initial && !reopened.current) {
              reopened.current = true;
              const row = saved.find((item) => item.thread.kind === initial.kind && item.thread.id === initial.id);
              if (row) setOpen(row);
            }
          } else setNote(navigator.onLine === false || /fetch|network/i.test(String(err)) ? "No connection. Messages show here once they've loaded with a signal." : err instanceof Error ? err.message : "Couldn't open messages.");
        });
      });
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (open) {
    return (
      <ChatScreen
        title={open.title}
        onClose={() => setOpen(null)}
        thread={open.thread}
        meId={meId}
        places={places}
        onAddToMap={onAddToMap}
        onOpenPlace={
          onOpenPlace
            ? (place) => {
                setOpen(null);
                onClose();
                onOpenPlace(place, open.thread);
              }
            : undefined
        }
      />
    );
  }
  return createPortal(
    <div role="dialog" aria-label="Messages" className="screen-top fixed inset-0 z-40 flex flex-col bg-bg">
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-2 pb-2">
        <button type="button" onClick={onClose} aria-label="Back" className="grid h-11 w-11 place-items-center rounded-full text-xl text-ink">
          ‹
        </button>
        <p className="font-serif text-xl leading-tight">Messages</p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {note ? <p className="text-sm text-accent">{note}</p> : null}
        {rows === null && !note ? <p className="text-sm text-muted">Loading…</p> : null}
        {rows && rows.length === 0 ? <p className="text-sm text-muted">No friends yet. A chat shows up here once you add one.</p> : null}
        <ul className="grid gap-1">
          {rows?.map((row) => {
            const n = row.thread.kind === "friend" ? unread.friends[row.thread.id] : unread.groups[row.thread.id];
            return (
              <li key={`${row.thread.kind}:${row.thread.id}`}>
                <button
                  type="button"
                  onClick={() => setOpen(row)}
                  className={
                    "flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left transition-colors active:bg-elevated " +
                    (n ? "bg-surface shadow-sm" : "")
                  }
                >
                  <BoardAvatar row={row} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className={"min-w-0 flex-1 truncate text-[15px] " + (n ? "font-semibold" : "font-medium")}>{row.title}</span>
                      {row.at ? <span className={"shrink-0 text-[11px] " + (n ? "text-accent" : "text-faint")}>{agoText(row.at)}</span> : null}
                    </span>
                    <span className="mt-0.5 flex items-center gap-2">
                      <span className={"min-w-0 flex-1 truncate text-[13px] " + (n ? "text-ink" : "text-muted")}>
                        {row.mine && row.preview ? <span className="text-faint">You: </span> : null}
                        {row.preview || (row.thread.kind === "group" ? "Trip chat" : "Say hi 👋")}
                      </span>
                      {n ? (
                        <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-accent px-1.5 text-[10px] font-semibold text-accent-ink">
                          {n > 99 ? "99+" : n}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

function dayOf(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function timeText(ms: number) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "Today 7:52 AM", "Yesterday 9:10 PM", "Mon, Nov 23 · 4:05 PM", or with the year if it's not this year. */
function stampText(ms: number) {
  const d = new Date(ms);
  const now = new Date();
  const today = dayOf(now.getTime());
  const yesterday = dayOf(now.getTime() - 86400000);
  const time = timeText(ms);
  if (dayOf(ms) === today) return `Today ${time}`;
  if (dayOf(ms) === yesterday) return `Yesterday ${time}`;
  const date = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
  return `${date} · ${time}`;
}

/** One action in the message menu: an icon, a label, a divider between rows. */
function MenuRow({ icon, label, onClick, danger = false }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={"flex h-12 w-full items-center gap-3 border-b border-line px-3.5 text-left text-[15px] last:border-b-0 active:bg-elevated " + (danger ? "text-accent" : "")}
    >
      <span className={danger ? "text-accent" : "text-muted"}>{icon}</span>
      {label}
    </button>
  );
}

const sharpCache = new Map<string, string>();

/**
 * A photo in a chat bubble: the small preview straight away, then the full
 * photo (saved on the phone after the first time) once it's on screen, so
 * it isn't blurry.
 */
function ChatImage({ thread, meId, id, thumb }: { thread: Thread; meId: string; id: string; thumb: string }) {
  const [sharp, setSharp] = useState<string | null>(() => sharpCache.get(id) ?? null);
  const box = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (sharp || !box.current) return;
    let dead = false;
    const load = async () => {
      const saved = await cachedPhoto(meId, id);
      const image = saved ?? (await loadThreadPhoto({ data: { thread, id } }).then((row) => row.image).catch(() => null));
      if (!image || dead) return;
      sharpCache.set(id, image);
      if (!saved) void cachePhoto(meId, id, image);
      setSharp(image);
    };
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        seen.disconnect();
        void load();
      }
    }, { rootMargin: "300px" });
    seen.observe(box.current);
    return () => {
      dead = true;
      seen.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return <img ref={box} src={sharp ?? thumb} alt="" className="max-h-72 w-full rounded-md object-cover" />;
}

function initials(name: string) {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** A steady color per person, so the same friend always looks the same. */
function tint(key: string) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 45% 42%)`;
}

function Face({ photo, name, className }: { photo?: string; name: string; className: string }) {
  if (photo) return <img src={photo} alt="" className={"rounded-full object-cover " + className} />;
  return (
    <span className={"grid place-items-center rounded-full font-semibold text-white " + className} style={{ background: tint(name) }}>
      {initials(name)}
    </span>
  );
}

/** The friend's picture, or a little stack of faces for a trip chat. */
function BoardAvatar({ row }: { row: BoardItem }) {
  const photos = row.photos ?? [];
  if (row.thread.kind !== "group") return <Face photo={photos[0]} name={row.title} className="size-12 shrink-0 text-base" />;
  if (photos.length < 2) {
    return (
      <span className="relative size-12 shrink-0" aria-hidden>
        <span className="grid size-12 place-items-center rounded-full text-white" style={{ background: tint(row.title) }}>
          <Users className="size-5" />
        </span>
        {row.members ? (
          <span className="absolute -right-1 -bottom-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-elevated px-1 text-[9px] text-muted ring-2 ring-bg">
            {row.members}
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span className="relative size-12 shrink-0" aria-hidden>
      <Face photo={photos[0]} name={row.title} className="absolute top-0 left-0 size-8 text-xs ring-2 ring-bg" />
      <Face photo={photos[1]} name={`${row.title} 2`} className="absolute right-0 bottom-0 size-8 text-xs ring-2 ring-bg" />
      {row.members && row.members > 2 ? (
        <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-elevated px-1 text-[9px] text-muted ring-2 ring-bg">
          {row.members}
        </span>
      ) : null}
    </span>
  );
}

/** "now", "5m", "3h", "Tue", "Nov 2" — the short times a chat list uses. */
function agoText(ms: number) {
  const gap = Date.now() - ms;
  if (gap < 60000) return "now";
  if (gap < 3600000) return `${Math.floor(gap / 60000)}m`;
  if (dayOf(ms) === dayOf(Date.now())) return timeText(ms);
  if (dayOf(ms) === dayOf(Date.now() - 86400000)) return "Yesterday";
  if (gap < 6 * 86400000) return new Date(ms).toLocaleDateString(undefined, { weekday: "short" });
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", ...(new Date(ms).getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
}
