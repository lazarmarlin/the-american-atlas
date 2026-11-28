import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ScreenHeader } from "@/components/screen-header";
import { createPortal } from "react-dom";
import { useChat } from "@/lib/chat-store";
import { deleteMessage, emptyReactions, guessWhere, listThread, votePoll, loadThreadPhoto, messageBoard, searchChats, sendToThread, setThreadPin, toggleReaction, type BoardItem, type ChatDay, type ChatHere, type ChatHit, type ChatMessage, type ChatPlace, type ChatPoll, type ChatTrail, type ChatWhere, type ReactionMark, type Thread } from "@/lib/messages";
import { StateTiles, TILE_NAMES } from "@/components/state-tiles";
import { loadMeta } from "@/lib/atlas-model";
import { milesBetween, readDeviceLocation, type Fix } from "@/lib/nearby";
import { readGps } from "@/lib/photo-file";
import { categoryName } from "@/lib/place-kinds";
import { pushBack, useBackClose } from "@/lib/sheet-back";
import { nameHere } from "@/lib/here";
import { dropFromOutbox, isConnectionError, onOutboxSent, retryFromOutbox, sendOrQueue, useOutbox } from "@/lib/chat-outbox";
import { cacheBoard, cachePhoto, cacheThread, cachedBoard, cachedPhoto, cachedThread } from "@/lib/chat-cache";
import { savePhoto } from "@/lib/save-photo";
import { freshPoints, thinTrail, useGhost, type GhostPoint } from "@/lib/ghost-trail";
import { useSettings } from "@/lib/atlas-settings";
import { trailCard } from "@/lib/trail-card";
import { Clock, Copy, Download, LogOut, Map as MapIcon, MapPinPlus, Maximize2, MoreHorizontal, Pin, Reply, Trash2, Undo2, Users, X } from "lucide-react";
import { TripSketch, tripDates } from "@/components/trip-recap";
import { Images, ImageIcon, Settings } from "lucide-react";
import { WallpaperScreen, wallpaperFor } from "@/components/chat-wallpaper";
import { ArrowUp, Camera, Check, HelpCircle, ListTodo, LocateFixed, MapPinned, Mic, Plus, Route, Send, Vote } from "lucide-react";
import { allowMic } from "@/lib/mic";
import { BoardsPage } from "@/components/boards-page";
import { BoardKindIcon, KIND_LOOK } from "@/components/board-ui";
import { ChatLookScreen, applyShared } from "@/components/chat-look";
import { LOOK_DEFAULT, nickOf, readLook, useLookVersion, wallVeil, withAlpha, type ChatLook } from "@/lib/chat-look";
import { loadTheme } from "@/lib/chat-theme";
import { SharedInChat } from "@/components/chat-shared";
import { ChatStickerView, StickerTray } from "@/components/chat-stickers";
import { ChatCamera } from "@/components/chat-camera";
import { YouMarkerFace } from "@/components/you-marker-face";
import { stickerText, type StickerInfo } from "@/lib/stickers";
import { useChatPulse, usePulseFor } from "@/lib/chat-pulse-live";
import { STREAK_HURRY_MS, STREAK_SHOWS, myStreaks, myZone, type Streak } from "@/lib/chat-pulse";
import { Sticker } from "lucide-react";
import { chatPhotoData } from "@/lib/chat-photo";

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

function blurb(row: ChatMessage) {
  if (row.kind === "photo") return "Photo";
  if (row.kind === "voice") return "Voice note";
  if (row.kind === "link") return "Google Photos";
  if (row.kind === "place") return row.place?.name || "A place";
  if (row.kind === "trip") return row.trip?.name || "A trip";
  if (row.kind === "trail") return row.trail?.name || "A trail";
  if (row.kind === "here") return row.here?.label || "I'm here";
  if (row.kind === "day") return row.day ? `A day · ${row.day.day}` : "A day";
  if (row.kind === "board") return row.board?.title || "A board";
  if (row.kind === "poll") return row.poll ? `Poll: ${row.poll.q}` : "A poll";
  if (row.kind === "where") return "Where am I?";
  if (row.kind === "sticker") return stickerText(row.sticker?.id ?? "");
  return row.body;
}

const MARKS: [ReactionMark, string][] = [
  ["up", "👍"],
  ["heart", "❤️"],
  ["pin", "📌"],
  ["wave", "👋"],
  ["been", "🏕️"],
  ["car", "🚗"],
];

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
  onOpenTrail,
  onOpenHere,
  onOpenBoard,
  you = null,
  wallpaper = null,
  look = LOOK_DEFAULT,
  focusId,
  fill = false,
}: {
  thread: Thread;
  meId: string;
  places: ChatPlaceOption[];
  onAddToMap: (photo: ChatPhoto, place: ChatPlaceOption) => Promise<void>;
  onOpenPlace?: (place: ChatPlace) => void;
  onOpenTrail?: (lines: [number, number][][]) => void;
  onOpenHere?: (lat: number, lon: number, label?: string) => void;
  onOpenBoard?: (id: string) => void;
  /** Where you are, so "I'm here" can send the place you're in. */
  you?: Fix | null;
  /** A picture behind the messages. */
  wallpaper?: string | null;
  /** Colors, text size, and wallpaper strength for this phone. */
  look?: ChatLook;
  /** Scroll this message into view once, from a search. */
  focusId?: string | null;
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
  const [captionFor, setCaptionFor] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [trailsOpen, setTrailsOpen] = useState(false);
  const [boardsOpen, setBoardsOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const markerIcon = useSettings((state) => state.markerIcon);
  const markerColor = useSettings((state) => state.markerColor);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [query, setQuery] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const draftBox = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const box = draftBox.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 144)}px`;
  }, [draft]);
  // Who else has this chat open (their avatar peeks in the corner), and the streak.
  useChatPulse(thread, draft);
  const pulse = usePulseFor(thread);
  const here = pulse?.here ?? [];
  const streakDays = pulse?.streak?.days ?? null;
  const lastStreak = useRef<number | null>(null);
  const [cheer, setCheer] = useState<number | null>(null);
  useEffect(() => {
    if (streakDays == null) return;
    const before = lastStreak.current;
    lastStreak.current = streakDays;
    // The streak just went up while you're looking: make a fuss.
    if (before != null && streakDays > before && streakDays >= STREAK_SHOWS) {
      setCheer(streakDays);
      const id = window.setTimeout(() => setCheer(null), 2800);
      return () => window.clearTimeout(id);
    }
  }, [streakDays]);
  useEffect(() => {
    // Someone came in: keep the newest message clear of their avatar.
    const node = scroller.current;
    if (!node || !here.length) return;
    if (node.scrollHeight - node.scrollTop - node.clientHeight < 140) node.scrollTop = node.scrollHeight;
  }, [here.length]);
  const clips = useRef(new Map<string, string>());
  const recorder = useRef<MediaRecorder | null>(null);
  const recordToken = useRef(0);
  const recordStarted = useRef(0);
  const [recording, setRecording] = useState(false);
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  /** The menu was opened by holding (not right-click): it waits for the finger to lift. */
  const menuHeld = useRef(false);
  const group = thread.kind === "group";
  const threadKey = `${thread.kind}:${thread.id}`;

  /** Messages being sent right now: kept on screen even if a check comes back without them yet. */
  const sending = useRef(new Set<string>());
  const rowsRef = useRef<ChatMessage[] | null>(null);
  rowsRef.current = rows;
  const pullNow = useRef<() => void>(() => {});

  useEffect(() => {
    let dead = false;
    useChat.getState().setOpen(thread);
    let offline = false;
    let shown = false;
    let inFlight = false;
    let again = false;
    const pull = () => {
      // One check at a time, so an older answer can't land after a newer one.
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      const known = new Map((rowsRef.current ?? []).filter((row) => row.thumb).map((row) => [row.id, row.thumb]));
      listThread({ data: { thread, have: [...known.keys()] } })
        .then((fresh) => {
          if (dead) return;
          shown = true;
          setRows((cur) => {
            const keep = new Map((cur ?? []).filter((row) => row.thumb).map((row) => [row.id, row.thumb]));
            const next = fresh.map((row) => (row.thumb ? row : { ...row, thumb: keep.get(row.id) ?? known.get(row.id) ?? "" }));
            const have = new Set(next.map((row) => row.id));
            // On the server now: no longer needs keeping by hand.
            for (const id of have) sending.current.delete(id);
            const pending = (cur ?? []).filter((row) => sending.current.has(row.id) && !have.has(row.id));
            const merged = pending.length ? [...next, ...pending].sort((a, b) => a.at - b.at) : next;
            void cacheThread(meId, thread, merged);
            return merged;
          });
          if (offline) setNote(null);
          offline = false;
          void useChat.getState().refresh();
        })
        .catch((err) => {
          if (dead) return;
          // No signal: keep showing the saved messages, and say so.
          offline = true;
          if (isConnectionError(err)) {
            // Nothing saved for this chat yet: open it empty, so messages waiting to go out still show.
            setRows((cur) => cur ?? []);
            setNote(shown ? "No connection. Showing saved messages." : "No connection.");
          } else setNote(err instanceof Error ? err.message : "Couldn't load the chat.");
        })
        .finally(() => {
          inFlight = false;
          if (again && !dead) {
            again = false;
            pull();
          }
        });
    };
    pullNow.current = pull;
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
    const tick = () => {
      if (document.visibilityState === "visible") pull();
    };
    const id = window.setInterval(tick, 4000);
    // Back in the app (a notification tapped, the screen turned on): check right away.
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      dead = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
      useChat.getState().setOpen(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadKey]);

  useEffect(() => {
    const node = scroller.current;
    if (!node || focusId) return;
    node.scrollTop = node.scrollHeight;
  }, [rows?.length, focusId]);
  useEffect(() => {
    if (!focusId || !rows?.some((row) => row.id === focusId)) return;
    document.getElementById(`chat-${focusId}`)?.scrollIntoView({ block: "center" });
  }, [focusId, rows]);
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
    if (!viewing && !picking && !menu && !attach && !sharing && !trailsOpen && !captionFor && !boardsOpen && !pollOpen && !stickersOpen) return;
    return pushBack(() => {
      if (viewing) setViewing(null);
      else if (stickersOpen) setStickersOpen(false);
      else if (picking) setPicking(null);
      else if (sharing) setSharing(false);
      else if (trailsOpen) setTrailsOpen(false);
      else if (boardsOpen) setBoardsOpen(false);
      else if (pollOpen) setPollOpen(false);
      else if (captionFor) setCaptionFor(null);
      else if (attach) setAttach(false);
      else setMenu(null);
      return true;
    });
  }, [viewing, picking, menu, attach, sharing, trailsOpen, captionFor, boardsOpen, pollOpen, stickersOpen]);

  function optimistic(row: Omit<ChatMessage, "fromId" | "fromName" | "at">) {
    const full: ChatMessage = { ...row, fromId: meId, fromName: "You", at: Date.now() };
    sending.current.add(full.id);
    setRows((prev) => [...(prev ?? []), full]);
    return full;
  }
  /**
   * Send it, or keep it in the outbox until there's signal (it stays on
   * screen marked "Sending…"). Only a message the server refuses is taken
   * back; then `refused` gets the reason.
   */
  async function deliver(message: ChatMessage, data: Parameters<typeof sendOrQueue>[1], refused: (reason: string) => void) {
    const result = await sendOrQueue(thread, data, message);
    if (result === "sent") sent(message.id);
    else if (result !== "queued") {
      drop(message.id);
      refused(result.error);
    }
  }
  // Messages still waiting to go out: shown in the chat (also after the app was closed).
  const waiting = useOutbox((state) => state.entries);
  const loaded = rows !== null;
  const waitingHere = useMemo(() => new Map(waiting.filter((e) => e.thread.kind === thread.kind && e.thread.id === thread.id).map((e) => [e.id, e])), [waiting, thread.kind, thread.id]);
  useEffect(() => {
    if (!waitingHere.size) return;
    setRows((cur) => {
      if (cur === null) return cur;
      const have = new Set(cur.map((row) => row.id));
      const add = [...waitingHere.values()].filter((e) => !have.has(e.id)).map((e) => e.message);
      for (const e of waitingHere.values()) sending.current.add(e.id);
      return add.length ? [...cur, ...add].sort((a, b) => a.at - b.at) : cur;
    });
  }, [waitingHere, loaded]);
  // One went out from the outbox: show it from the server.
  useEffect(() => onOutboxSent(() => pullNow.current()), []);
  const drop = (id: string) => {
    sending.current.delete(id);
    setRows((prev) => (prev ?? []).filter((row) => row.id !== id));
  };
  /** The send went through: the next check shows it from the server, so look now. */
  const sent = (id: string) => {
    void id;
    pullNow.current();
  };

  async function sendText() {
    const body = draft.trim();
    if (!body || busy) return;
    const kind = PHOTO_LINK.test(body) ? "link" : "text";
    const id = newId();
    const quoting = replyTo;
    setBusy(true);
    setNote(null);
    setDraft("");
    setReplyTo(null);
    draftBox.current?.focus();
    const message = optimistic({
      id,
      kind,
      body,
      thumb: "",
      lat: null,
      lon: null,
      takenAt: null,
      place: null,
      reply: quoting ? { id: quoting.id, name: quoting.fromId === meId ? "You" : quoting.fromName, text: blurb(quoting) } : null,
    });
    try {
      await deliver(message, { thread, id, kind, body, replyTo: quoting?.id }, (reason) => {
        setDraft(body);
        setNote(reason);
      });
    } finally {
      setBusy(false);
      const box = draftBox.current;
      box?.focus();
      window.setTimeout(() => box?.focus(), 30);
    }
  }

  async function sendPhoto(file: File, at: { lat: number; lon: number } | null = null, text = caption.trim()) {
    setBusy(true);
    setNote(null);
    try {
      // Where and when it was taken, so whoever adds it to the map gets the place suggested.
      // (A picture taken in the app has no GPS in it: then where you are, if you chose to send it.)
      const gps = at ? { ...at, takenAt: Date.now() } : readGps(await file.arrayBuffer());
      const { image, thumb } = await chatPhotoData(file);
      const id = newId();
      const extra = { lat: gps?.lat ?? null, lon: gps?.lon ?? null, takenAt: gps?.takenAt ?? file.lastModified ?? null };
      const words = text.slice(0, 140);
      const message = optimistic({ id, kind: "photo", body: words, thumb, place: null, ...extra });
      await deliver(message, { thread, id, kind: "photo", body: words, thumb, image, ...extra }, setNote);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't send that photo.");
    } finally {
      setBusy(false);
    }
  }

  async function sendVoice(audio: string, seconds: number) {
    const id = newId();
    clips.current.set(id, audio);
    const message = optimistic({ id, kind: "voice", body: String(seconds), thumb: "", lat: null, lon: null, takenAt: null, place: null });
    await deliver(message, { thread, id, kind: "voice", body: String(seconds), image: audio }, setNote);
  }

  async function sendSticker(sticker: StickerInfo) {
    setStickersOpen(false);
    const id = newId();
    const quoting = replyTo;
    setReplyTo(null);
    const card = { id: sticker.id, icon: markerIcon, color: markerColor };
    const message = optimistic({
      id,
      kind: "sticker",
      body: "",
      thumb: "",
      lat: null,
      lon: null,
      takenAt: null,
      place: null,
      sticker: card,
      reply: quoting ? { id: quoting.id, name: quoting.fromId === meId ? "You" : quoting.fromName, text: blurb(quoting) } : null,
    });
    // The body is what a server from before stickers keeps instead: "🌮 Hangry".
    await deliver(message, { thread, id, kind: "sticker", body: stickerText(sticker.id), sticker: card, replyTo: quoting?.id }, setNote);
  }

  async function beginVoice(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (busy || recording) return;
    const token = ++recordToken.current;
    event.currentTarget.setPointerCapture(event.pointerId);
    try {
      await allowMic();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (recordToken.current !== token) {
        stream.getTracks().forEach((track) => track.stop());
        setNote("Hold the mic and keep holding while it starts.");
        return;
      }
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      let rec: MediaRecorder;
      try {
        rec = mime ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 24000 }) : new MediaRecorder(stream);
      } catch {
        stream.getTracks().forEach((track) => track.stop());
        setNote("This phone can't record a voice note.");
        return;
      }
      const chunks: Blob[] = [];
      rec.ondataavailable = (item) => {
        if (item.data.size) chunks.push(item.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const send = recordToken.current === token;
        recorder.current = null;
        setRecording(false);
        if (!send) return;
        const seconds = Math.min(30, Math.max(1, Math.round((Date.now() - recordStarted.current) / 1000)));
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 800) {
          setNote("Hold a little longer.");
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const audio = String(reader.result ?? "");
          if (audio.length > 400000) {
            setNote("That voice note is too long.");
            return;
          }
          void sendVoice(audio, seconds);
        };
        reader.readAsDataURL(blob);
      };
      recorder.current = rec;
      recordStarted.current = Date.now();
      rec.start();
      setRecording(true);
      window.setTimeout(() => {
        if (recorder.current === rec && rec.state === "recording") rec.stop();
      }, 30_000);
    } catch (err) {
      const denied = err instanceof DOMException ? err.name === "NotAllowedError" || err.name === "SecurityError" : err instanceof Error && /denied|permission/i.test(err.message);
      setNote(denied ? "The mic needs permission. Allow the microphone for Atlas, then hold the button again." : "Couldn't start the microphone.");
    }
  }

  function endVoice(send: boolean) {
    const rec = recorder.current;
    if (!rec || rec.state !== "recording") {
      recordToken.current += 1;
      setRecording(false);
      return;
    }
    if (!send || Date.now() - recordStarted.current < 400) recordToken.current += 1;
    rec.stop();
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
      // Picked from your own places; the server checks it's on your map.
      visited: true,
    };
    const message = optimistic({ id, kind: "place", body: "", thumb: "", lat: place.lat, lon: place.lon, takenAt: null, place: card });
    await deliver(message, { thread, id, kind: "place", place: card }, setNote);
  }

  /** The name of the spot you're in, worked out when the + menu opens. */
  const [hereName, setHereName] = useState<ChatHere | null>(null);
  useEffect(() => {
    if (!attach || !you) {
      if (!attach) setHereName(null);
      return;
    }
    let live = true;
    void nameHere(you, places).then((spot) => live && setHereName(spot));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attach]);

  async function sendHere() {
    setAttach(false);
    if (!you) {
      setNote("Location isn't on.");
      return;
    }
    const id = newId();
    const card: ChatHere = hereName ?? (await nameHere(you, places));
    const message = optimistic({ id, kind: "here", body: "", thumb: "", lat: you.lat, lon: you.lon, takenAt: null, place: null, here: card });
    await deliver(message, { thread, id, kind: "here", here: card }, setNote);
  }

  async function sendTrail(name: string, points: GhostPoint[], day: string | null) {
    setTrailsOpen(false);
    setAttach(false);
    const packed = points.map((point) => [point.lat, point.lon, point.brk ? 1 : 0]);
    let card: ChatTrail;
    try {
      card = trailCard(name, packed, day);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "That trail is too short to share.");
      return;
    }
    const id = newId();
    const quoting = replyTo;
    setReplyTo(null);
    const message = optimistic({
      id,
      kind: "trail",
      body: "",
      thumb: "",
      lat: null,
      lon: null,
      takenAt: null,
      place: null,
      trail: card,
      reply: quoting ? { id: quoting.id, name: quoting.fromId === meId ? "You" : quoting.fromName, text: blurb(quoting) } : null,
    });
    await deliver(message, { thread, id, kind: "trail", trail: { name, points: packed, day }, replyTo: quoting?.id }, setNote);
  }

  /** "Where am I?": the spot you're in, hidden until each friend has guessed the state. */
  async function sendWhere() {
    setAttach(false);
    let fix = you;
    if (!fix) {
      try {
        fix = await readDeviceLocation();
      } catch (err) {
        setNote(err instanceof Error ? err.message : "Location isn't on.");
        return;
      }
    }
    const spot = (you && hereName) || (await nameHere(fix, places));
    if (!spot.state) {
      setNote("Can't tell which state you're in yet.");
      return;
    }
    const id = newId();
    const where: ChatWhere = { spot: { label: spot.label, state: spot.state, lat: spot.lat, lon: spot.lon }, mine: null, guesses: [] };
    const message = optimistic({ id, kind: "where", body: "", thumb: "", lat: null, lon: null, takenAt: null, place: null, where });
    await deliver(message, { thread, id, kind: "where", where: { label: spot.label, state: spot.state, lat: spot.lat, lon: spot.lon } }, setNote);
  }

  async function guess(message: ChatMessage, state: string) {
    try {
      const meta = await loadMeta();
      const info = meta.states.find((row) => row.abbr === state);
      if (!info) throw new Error("Pick a state");
      const result = await guessWhere({ data: { thread, id: message.id, state, lat: (info.s + info.n) / 2, lon: (info.w + info.e) / 2 } });
      setRows((prev) =>
        (prev ?? []).map((row) =>
          row.id === message.id
            ? { ...row, where: { spot: result.spot, mine: { state: result.state, miles: result.miles }, guesses: [...(row.where?.guesses ?? []), { name: "You", state: result.state, miles: result.miles }].sort((a, b) => a.miles - b.miles) } }
            : row,
        ),
      );
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't send that guess.");
    }
  }

  async function sendPoll(q: string, options: string[]) {
    setPollOpen(false);
    const id = newId();
    const poll: ChatPoll = { q, options, votes: options.map(() => 0), voters: options.map(() => []), mine: -1 };
    const message = optimistic({ id, kind: "poll", body: "", thumb: "", lat: null, lon: null, takenAt: null, place: null, poll });
    await deliver(message, { thread, id, kind: "poll", poll: { q, options } }, setNote);
  }

  /** Tap a choice to vote; tap it again to take the vote back. */
  async function vote(message: ChatMessage, choice: number) {
    const poll = message.poll;
    if (!poll || sending.current.has(message.id)) return;
    const next = poll.mine === choice ? -1 : choice;
    setRows((prev) =>
      (prev ?? []).map((row) => {
        if (row.id !== message.id || !row.poll) return row;
        const votes = row.poll.votes.slice();
        const voters = row.poll.voters.map((names) => names.filter((who) => who !== "You"));
        if (row.poll.mine >= 0) votes[row.poll.mine] = Math.max(0, votes[row.poll.mine] - 1);
        if (next >= 0) {
          votes[next] += 1;
          voters[next] = [...voters[next], "You"];
        }
        return { ...row, poll: { ...row.poll, votes, voters, mine: next } };
      }),
    );
    try {
      await votePoll({ data: { thread, id: message.id, choice: next } });
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't vote.");
    }
  }

  async function react(message: ChatMessage, mark: ReactionMark) {
    setMenu(null);
    setRows((prev) =>
      (prev ?? []).map((row) => {
        if (row.id !== message.id) return row;
        const current = row.reactions ?? emptyReactions();
        const on = current.mine.includes(mark);
        return {
          ...row,
          reactions: {
            ...current,
            [mark]: Math.max(0, current[mark] + (on ? -1 : 1)),
            mine: on ? current.mine.filter((item) => item !== mark) : [...current.mine, mark],
          },
        };
      }),
    );
    try {
      await toggleReaction({ data: { thread, id: message.id, mark } });
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't react.");
    }
  }

  async function pinMessage(message: ChatMessage) {
    const on = !message.pinned;
    setMenu(null);
    setRows((prev) => (prev ?? []).map((row) => ({ ...row, pinned: on && row.id === message.id })));
    try {
      await setThreadPin({ data: { thread, id: on ? message.id : "" } });
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't pin that.");
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

  const veil = wallVeil(look.dim);
  const textClass = look.text === "lg" ? "text-lg" : look.text === "sm" ? "text-[13px]" : "text-[15px]";
  const ground = look.plain
    ? { backgroundColor: look.plain }
    : wallpaper
      ? {
          backgroundImage: `linear-gradient(rgba(10,10,10,${veil.top}), rgba(10,10,10,${veil.bottom})), url(${wallpaper})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }
      : undefined;

  return (
    <div className={fill ? "relative flex min-h-0 flex-1 flex-col" : "relative mt-4"} style={ground}>
      {fill ? null : (
        <p className="px-2 text-sm text-muted">
          {group ? "Everyone in this chat sees what you send." : "Text, a photo, a place, or a Google Photos link."} Hold a message for options.
        </p>
      )}
      {rows?.find((row) => row.pinned) ? (
        <button
          type="button"
          onClick={() => document.getElementById(`chat-${rows.find((row) => row.pinned)?.id}`)?.scrollIntoView({ block: "center" })}
          className="mx-3 mt-2 flex h-11 items-center gap-2 rounded-lg border border-line px-3 text-left text-sm"
        >
          <Pin className="size-4 shrink-0 text-faint" />
          <span className="min-w-0 flex-1 truncate">{blurb(rows.find((row) => row.pinned) as ChatMessage)}</span>
          <span
            role="button"
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              const pinned = rows.find((row) => row.pinned);
              if (pinned) void pinMessage(pinned);
            }}
            className="shrink-0 text-xs text-faint"
          >
            Unpin
          </span>
        </button>
      ) : null}
      <div ref={scroller} className={"flex flex-col gap-2 overflow-y-auto px-3 " + (fill ? "min-h-0 flex-1 py-3" : "mt-2 max-h-[46dvh]") + (here.length ? " pb-16" : "")}>
        {rows === null ? <p className="text-sm text-muted">Loading…</p> : null}
        {rows && rows.length === 0 ? (
          <p className="m-auto max-w-xs text-center text-sm text-muted">
            No messages yet. Say hi 👋
          </p>
        ) : null}
        {rows?.map((row, index) => {
          const mine = row.fromId === meId;
          const lastMine = [...rows].reverse().find((item) => item.fromId === meId)?.id === row.id;
          const prev = rows[index - 1];
          // A date and time line when the day changes or after a 30-minute gap.
          const stamp = !prev || dayOf(prev.at) !== dayOf(row.at) || row.at - prev.at > 30 * 60 * 1000;
          return (
            <div key={row.id} id={`chat-${row.id}`} className={"flex flex-col " + (mine ? "items-end" : "items-start")}>
              {stamp ? <p className="my-1 w-full text-center text-[11px] text-faint">{stampText(row.at)}</p> : null}
              {group && !mine ? <span className="mb-0.5 px-1 text-xs text-faint">{nickOf(meId, "friend", row.fromId, row.fromName)}</span> : null}
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
                className={
                  row.kind === "sticker"
                    ? "max-w-[78%] select-none " + textClass
                    : "max-w-[78%] rounded-2xl px-3 py-1.5 leading-snug select-none " + textClass + (row.kind === "text" ? "" : " w-64") + (mine ? " rounded-br-md bg-elevated" : " rounded-bl-md border border-line")
                }
                style={row.kind === "sticker" ? undefined : bubblePaint(mine, look)}
              >
                {row.reply ? (
                  <p className="mb-1 truncate border-l-2 border-line pl-2 text-xs text-faint">
                    {row.reply.name ? `${row.reply.name}: ` : ""}
                    {row.reply.text}
                  </p>
                ) : null}
                {row.kind === "photo" && row.thumb ? (
                  <button type="button" onClick={() => view(row)} className="block w-full" aria-label="See the photo">
                    <ChatImage thread={thread} meId={meId} id={row.id} thumb={row.thumb} />
                  </button>
                ) : null}
                {row.kind === "photo" && row.body ? <span className="mt-1 block text-sm">{row.body}</span> : null}
                {row.kind === "photo" && row.lat != null ? <span className="mt-1 block text-xs text-faint">Has a location</span> : null}
                {row.kind === "link" ? (
                  <a href={row.body} target="_blank" rel="noopener noreferrer" className="block">
                    <span className="block text-xs tracking-widest text-faint uppercase">Google Photos</span>
                    <span className="mt-1 block break-all underline">{row.body.replace(/^https?:\/\//, "")}</span>
                  </a>
                ) : null}
                {row.kind === "place" && row.place ? (
                  <div>
                    <span className="block text-xs tracking-widest text-faint uppercase">{row.place.visited ? (mine ? "I was here" : `${row.fromName} was here`) : mine ? "I shared a place" : `${row.fromName} shared a place`}</span>
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
                {row.kind === "trail" && row.trail ? (
                  <div className="py-1">
                    <span className="block text-xs tracking-widest text-faint uppercase">{mine ? "My trail" : `${row.fromName}'s trail`}</span>
                    <span className="mt-0.5 block font-serif text-lg leading-tight">{row.trail.name}</span>
                    <div className="mt-1.5">
                      <TripSketch lines={row.trail.lines} dots={[]} height={110} />
                    </div>
                    <span className="mt-1.5 block text-xs text-muted">
                      {row.trail.miles.toLocaleString()} mi{row.trail.day ? ` · ${shortDate(row.trail.day)}` : ""}
                    </span>
                    {onOpenTrail ? (
                      <button type="button" onClick={() => onOpenTrail(row.trail?.lines ?? [])} className="my-1.5 h-10 w-full rounded-lg border border-line text-sm">
                        On the map
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {row.kind === "here" && row.here ? (
                  <div className="py-1">
                    <span className="flex items-center gap-1.5 text-xs tracking-widest text-faint uppercase">
                      <LocateFixed className="size-3.5 text-accent" aria-hidden="true" />
                      {mine ? "I'm here" : `${row.fromName} is here`}
                    </span>
                    <span className="mt-1 block font-serif text-lg leading-tight">{row.here.label}</span>
                    <span className="block text-xs text-muted">
                      {[row.here.state, timeText(row.at)].filter(Boolean).join(" · ")}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const here = row.here as ChatHere;
                        if (here.placeId && onOpenPlace) {
                          onOpenPlace({
                            id: here.placeId,
                            name: here.label,
                            category: "",
                            state: here.state,
                            lat: here.lat,
                            lon: here.lon,
                            points: 0,
                            visitedOn: null,
                            visited: false,
                          });
                        } else onOpenHere?.(here.lat, here.lon, `${mine ? "You were" : `${row.fromName} was`} here · ${here.label} · ${timeText(row.at)}`);
                      }}
                      className="my-1.5 h-10 w-full rounded-lg border border-line text-sm"
                    >
                      Show on map
                    </button>
                  </div>
                ) : null}
                {row.kind === "day" && row.day ? (
                  <div className="py-1">
                    <span className="block text-xs tracking-widest text-faint uppercase">{mine ? "My day" : `${row.fromName}'s day`}</span>
                    <span className="mt-0.5 block font-serif text-lg leading-tight">{shortDate(row.day.day)}</span>
                    {row.day.trail ? (
                      <div className="mt-1.5">
                        <TripSketch lines={row.day.trail.lines} dots={[]} height={100} />
                      </div>
                    ) : null}
                    <span className="mt-1.5 block text-xs text-muted">
                      {row.day.places.length ? `${row.day.places.length} ${row.day.places.length === 1 ? "place" : "places"}` : ""}
                      {row.day.places.length && row.day.stops.length ? " · " : ""}
                      {row.day.stops.length ? `${row.day.stops.length} ${row.day.stops.length === 1 ? "stop" : "stops"}` : ""}
                      {row.day.trail ? ` · ${row.day.trail.miles.toLocaleString()} mi` : ""}
                    </span>
                    {row.day.places.slice(0, 4).map((place) => (
                      <span key={place.id} className="block truncate text-sm">
                        {place.name}
                      </span>
                    ))}
                    {row.day.trail && onOpenTrail ? (
                      <button type="button" onClick={() => onOpenTrail(row.day?.trail?.lines ?? [])} className="my-1.5 h-10 w-full rounded-lg border border-line text-sm">
                        On the map
                      </button>
                    ) : onOpenHere && (row.day.places.find((p) => p.lat != null) || row.day.stops[0]) ? (
                      <button
                        type="button"
                        onClick={() => {
                          const place = row.day?.places.find((p) => p.lat != null && p.lon != null);
                          const stop = row.day?.stops[0];
                          const lat = place?.lat ?? stop?.lat;
                          const lon = place?.lon ?? stop?.lon;
                          if (lat != null && lon != null) onOpenHere(lat, lon);
                        }}
                        className="my-1.5 h-10 w-full rounded-lg border border-line text-sm"
                      >
                        On the map
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {row.kind === "voice" ? <VoiceNote thread={thread} id={row.id} seconds={Number(row.body) || 1} local={clips.current.get(row.id) ?? ""} /> : null}
                {row.kind === "board" && row.board ? (
                  <button type="button" onClick={() => onOpenBoard?.(row.board?.id ?? "")} className="flex w-full min-w-48 items-center gap-3 py-1 text-left">
                    <BoardKindIcon kind={row.board.kind} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] tracking-[0.14em] text-faint uppercase">{KIND_LOOK[row.board.kind].label}</span>
                      <span className="block truncate font-serif text-lg leading-tight">{row.board.title}</span>
                      <span className="mt-0.5 block text-xs text-muted">Tap to open</span>
                    </span>
                  </button>
                ) : null}
                {row.kind === "where" && row.where ? <WhereCard where={row.where} mine={mine} from={row.fromName} onGuess={(state) => guess(row, state)} onOpen={onOpenHere} /> : null}
                {row.kind === "poll" && row.poll ? <PollCard poll={row.poll} mine={mine} pending={sending.current.has(row.id)} onVote={(choice) => void vote(row, choice)} /> : null}
                {row.kind === "text" ? <p className="break-words">{linkParts(row.body)}</p> : null}
                {row.kind === "sticker" && row.sticker ? <ChatStickerView id={row.sticker.id} icon={row.sticker.icon} color={row.sticker.color} /> : null}
              </div>
              {row.reactions && MARKS.some(([mark]) => row.reactions?.[mark]) ? (
                <div className="mt-0.5 flex gap-1 px-1">
                  {MARKS.map(([mark, glyph]) =>
                    row.reactions?.[mark] ? (
                      <button
                        key={mark}
                        type="button"
                        onClick={() => void react(row, mark)}
                        className={"h-7 rounded-full border px-2 text-xs " + (row.reactions.mine.includes(mark) ? "border-ink bg-elevated" : "border-line")}
                      >
                        {glyph} {row.reactions[mark]}
                      </button>
                    ) : null,
                  )}
                </div>
              ) : null}
              {waitingHere.get(row.id)?.state === "failed" ? (
                <span className="mt-0.5 flex items-center gap-2 px-1 text-[11px]">
                  <span className="text-accent">Not sent{waitingHere.get(row.id)?.error ? `: ${waitingHere.get(row.id)?.error}` : ""}</span>
                  <button type="button" onClick={() => retryFromOutbox(row.id)} className="text-ink underline">
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      dropFromOutbox(row.id);
                      drop(row.id);
                    }}
                    className="text-muted underline"
                  >
                    Delete
                  </button>
                </span>
              ) : waitingHere.has(row.id) ? (
                <span className="mt-0.5 flex items-center gap-1 px-1 text-[11px] text-faint">
                  <Clock className="size-3" aria-hidden />
                  Sending…
                </span>
              ) : lastMine ? (
                <span className="mt-0.5 px-1 text-[11px] text-faint">
                  {row.read ? `Read${row.readAt ? ` ${timeText(row.readAt)}` : ""}` : `Sent ${timeText(row.at)}`}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {here.length ? (
        <div className="pointer-events-none relative h-0">
          <div className="absolute bottom-2 left-3 flex items-end gap-1.5">
            {here.map((who, index) => (
              <div key={who.id} className="chat-peek relative" style={{ animationDelay: `${index * 120}ms` }}>
                <div className="chat-bob" style={{ animationDelay: `${index * 400}ms` }}>
                  <YouMarkerFace icon={who.icon} color={who.color} size={here.length > 2 ? 38 : 48} />
                </div>
                {who.typing ? (
                  <span className="chat-typing absolute -top-2.5 left-[70%] flex h-6 items-center gap-1 rounded-full border border-line bg-surface px-2 shadow-sm">
                    <i />
                    <i />
                    <i />
                  </span>
                ) : (
                  <span className="chat-hello absolute -top-2.5 left-[70%] rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] whitespace-nowrap text-ink shadow-sm">
                    👀 {(nickOf(meId, "friend", who.id, who.name) || who.name).split(" ")[0]}
                  </span>
                )}
                <span className="sr-only">
                  {who.name} is in the chat{who.typing ? " and typing" : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {cheer ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/3 z-10 flex flex-col items-center" role="status">
          <span className="streak-pop text-7xl leading-none">🔥</span>
          <span className="streak-pop mt-2 rounded-full bg-surface/95 px-4 py-1.5 font-serif text-xl shadow-sm" style={{ animationDelay: "120ms" }}>
            {cheer}-day streak!
          </span>
        </div>
      ) : null}
      {note ? <p className="mt-2 px-3 text-sm text-muted">{note}</p> : null}
      {replyTo ? (
        <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg border border-line px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-faint">Reply to {replyTo.fromId === meId ? "yourself" : replyTo.fromName}</p>
            <p className="truncate text-sm">{blurb(replyTo)}</p>
          </div>
          <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply" className="grid h-11 w-11 place-items-center text-muted">
            <X className="size-4" />
          </button>
        </div>
      ) : null}
      {recording ? <p className="px-3 pt-2 text-center text-xs text-accent">Recording… release to send. Up to 30 seconds.</p> : null}
      {/* One rounded box: + on the left, the text in the middle, and the mic (or
          Send once there's text) on the right, so the text gets nearly the full width. */}
      <form
        className={"flex items-end gap-1 px-2 " + (fill ? "border-t border-line bg-surface pt-2 safe-bottom" : "mt-2")}
        onSubmit={(event) => {
          event.preventDefault();
          void sendText();
          draftBox.current?.focus();
        }}
      >
        <button
          type="button"
          aria-label="Send a photo or a place"
          disabled={busy}
          onClick={() => setAttach(true)}
          className="grid h-11 w-10 shrink-0 place-items-center rounded-full text-muted active:bg-elevated"
        >
          <Plus className="size-6" strokeWidth={1.75} />
        </button>
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) {
              setCaption("");
              setCaptionFor(file);
            }
          }}
        />
        <div className="relative min-w-0 flex-1">
        <textarea
          ref={draftBox}
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value.slice(0, 500))}
          onFocus={() => window.setTimeout(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight }), 300)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            if (!draft.trim() || busy) return;
            void sendText();
            draftBox.current?.focus();
          }}
          placeholder="Message"
          enterKeyHint="send"
          className={"block max-h-36 min-h-11 w-full resize-none overflow-y-auto rounded-[22px] border border-line bg-bg py-2.5 pl-4 pr-11 leading-snug text-ink outline-none placeholder:text-faint focus:border-muted/60 " + textClass}
        />
          {/* Stickers, inside the box on the right. */}
          <button
            type="button"
            aria-label="Stickers"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => setStickersOpen(true)}
            className="absolute right-0.5 bottom-0 grid size-11 place-items-center rounded-full text-muted active:text-ink"
          >
            <Sticker className="size-5" strokeWidth={1.9} />
          </button>
        </div>
        {draft.trim() ? (
          <button
            type="submit"
            aria-label="Send"
            disabled={busy}
            onPointerDown={(event) => event.preventDefault()}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-ink text-bg disabled:opacity-50"
          >
            <ArrowUp className="size-5" strokeWidth={2.25} />
          </button>
        ) : (
          <>
          <button
            type="button"
            aria-label="Take a picture"
            disabled={busy || recording}
            onClick={() => setCameraOpen(true)}
            className="grid size-11 shrink-0 place-items-center rounded-full text-muted active:bg-elevated"
          >
            <Camera className="size-5" />
          </button>
          <button
            type="button"
            aria-label={recording ? "Release to send the voice note" : "Hold to record a voice note"}
            disabled={busy}
            onPointerDown={(event) => void beginVoice(event)}
            onPointerUp={() => endVoice(true)}
            onPointerCancel={() => endVoice(false)}
            className={"grid size-11 shrink-0 touch-none place-items-center rounded-full " + (recording ? "bg-accent/15 text-accent" : "text-muted active:bg-elevated")}
          >
            <Mic className="size-5" />
          </button>
          </>
        )}
      </form>
      {stickersOpen ? (
        <Sheet label="Stickers" onClose={() => setStickersOpen(false)} bare>
          <StickerTray icon={markerIcon} color={markerColor} onPick={(sticker) => void sendSticker(sticker)} />
        </Sheet>
      ) : null}
      {cameraOpen ? (
        <ChatCamera
          icon={markerIcon}
          color={markerColor}
          canPlace={Boolean(you)}
          onClose={() => setCameraOpen(false)}
          onSend={(file, withPlace) => sendPhoto(file, withPlace && you ? { lat: you.lat, lon: you.lon } : null, "")}
        />
      ) : null}

      {pollOpen ? (
        <Sheet label="Quick poll" onClose={() => setPollOpen(false)}>
          <PollMaker onSend={(q, options) => void sendPoll(q, options)} />
        </Sheet>
      ) : null}
      {boardsOpen ? (
        <BoardsPage
          thread={thread}
          onClose={() => setBoardsOpen(false)}
          onSent={() => {
            setBoardsOpen(false);
            pullNow.current();
          }}
        />
      ) : null}

      {attach ? (
        <Sheet label="Send" onClose={() => setAttach(false)} bare>
          {/* Where you are, sent in one tap. */}
          <button
            type="button"
            disabled={!you}
            onClick={() => void sendHere()}
            className="flex w-full items-center gap-3 rounded-xl border border-line bg-elevated/70 p-3 text-left disabled:opacity-60 active:bg-elevated"
          >
            <span className="relative grid size-11 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
              {you ? <span className="absolute inset-0 animate-ping rounded-full bg-accent/20" aria-hidden="true" /> : null}
              <LocateFixed className="relative size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium">I'm here</span>
              <span className="block truncate text-xs text-muted">
                {!you ? "Turn on location to send where you are" : hereName ? hereName.label + (hereName.state ? `, ${hereName.state}` : "") : "Finding where you are…"}
              </span>
            </span>
            <Send className="size-4 shrink-0 text-muted" aria-hidden="true" />
          </button>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {(
              [
                [
                  "Camera",
                  <Camera key="i" className="size-5" />,
                  () => {
                    setAttach(false);
                    setCameraOpen(true);
                  },
                ],
                [
                  "Gallery",
                  <Images key="i" className="size-5" />,
                  () => {
                    setAttach(false);
                    photoInput.current?.click();
                  },
                ],
                [
                  "Stickers",
                  <Sticker key="i" className="size-5" />,
                  () => {
                    setAttach(false);
                    setStickersOpen(true);
                  },
                ],
                [
                  "Place",
                  <MapPinned key="i" className="size-5" />,
                  () => {
                    setQuery("");
                    setSharing(true);
                    setAttach(false);
                  },
                ],
                [
                  "Trail",
                  <Route key="i" className="size-5" />,
                  () => {
                    setAttach(false);
                    setTrailsOpen(true);
                  },
                ],
                [
                  "Board",
                  <ListTodo key="i" className="size-5" />,
                  () => {
                    setAttach(false);
                    setBoardsOpen(true);
                  },
                ],
                [
                  "Poll",
                  <Vote key="i" className="size-5" />,
                  () => {
                    setAttach(false);
                    setPollOpen(true);
                  },
                ],
                ["Where am I?", <HelpCircle key="i" className="size-5" />, () => void sendWhere()],
              ] as const
            ).map(([label, icon, onClick]) => (
              <button
                key={label}
                type="button"
                onClick={onClick}
                className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border border-line px-1 text-center text-xs leading-tight active:bg-elevated"
              >
                <span className="grid size-10 place-items-center rounded-full bg-elevated text-ink">{icon}</span>
                {label}
              </button>
            ))}
          </div>
        </Sheet>
      ) : null}

      {captionFor ? (
        <Sheet
          label="Add a caption"
          onClose={() => setCaptionFor(null)}
        >
          <input
            autoFocus
            value={caption}
            onChange={(event) => setCaption(event.target.value.slice(0, 140))}
            placeholder="A line about this photo"
            className="h-11 w-full rounded-lg border border-line bg-bg px-3 text-base text-ink outline-none placeholder:text-faint"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const file = captionFor;
              setCaptionFor(null);
              void sendPhoto(file);
            }}
            className="mt-2 h-11 w-full rounded-lg border border-ink bg-elevated text-sm"
          >
            {caption.trim() ? "Send" : "Send without a caption"}
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

      {trailsOpen ? (
        <TrailSheet
          onClose={() => setTrailsOpen(false)}
          onPick={(name, points, day) => void sendTrail(name, points, day)}
        />
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
                {menu.kind === "photo" ? (menu.body ? menu.body : "Photo") : menu.kind === "voice" ? "Voice note" : menu.kind === "place" ? menu.place?.name : menu.kind === "trip" ? menu.trip?.name : menu.kind === "trail" ? menu.trail?.name : menu.kind === "here" ? menu.here?.label : menu.kind === "day" ? "A day" : menu.kind === "board" ? menu.board?.title || "A board" : menu.kind === "poll" ? menu.poll?.q || "A poll" : menu.kind === "where" ? "Where am I?" : menu.kind === "sticker" ? stickerText(menu.sticker?.id ?? "") : menu.body}
              </p>
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-line">
            <div className="grid grid-cols-6 border-b border-line">
              {MARKS.map(([mark, glyph]) => (
                <button key={mark} type="button" onClick={() => void react(menu, mark)} className="h-12 flex-1 text-lg">
                  {glyph}
                </button>
              ))}
            </div>
            <MenuRow
              icon={<Reply className="size-[18px]" />}
              label="Reply"
              onClick={() => {
                setReplyTo(menu);
                setMenu(null);
              }}
            />
            <MenuRow
              icon={<Pin className="size-[18px]" />}
              label={menu.pinned ? "Unpin" : "Pin to the top"}
              onClick={() => void pinMessage(menu)}
            />
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

function VoiceNote({ thread, id, seconds, local }: { thread: Thread; id: string; seconds: number; local: string }) {
  const [src, setSrc] = useState(local);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const label = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  async function toggle() {
    const el = audio.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }
    let url = src;
    if (!url) {
      try {
        const loaded = await loadThreadPhoto({ data: { thread, id } });
        url = loaded.image;
        setSrc(url);
      } catch {
        return;
      }
    }
    el.src = url;
    void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }
  return (
    <span className="flex items-center gap-2 py-1">
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          void toggle();
        }}
        aria-label={playing ? "Pause the voice note" : "Play the voice note"}
        className="grid size-9 place-items-center rounded-full border border-line text-sm text-accent"
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <span className="text-sm">{label}</span>
      <audio ref={audio} onEnded={() => setPlaying(false)} className="hidden" />
    </span>
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-3 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      onClick={onClose}
      onClickCapture={swallow}
      onPointerUpCapture={swallow}
    >
      <div
        role="dialog"
        aria-label={label}
        className={"max-h-full w-full max-w-sm overflow-y-auto border border-line bg-surface p-3 " + (bare ? "rounded-2xl shadow-2xl" : "rounded-card")}
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

function bubblePaint(mine: boolean, look: ChatLook): CSSProperties | undefined {
  const color = mine ? look.mine : look.their;
  const fade = mine ? look.mineFade : look.theirFade;
  if (!color && fade >= 100) return undefined;
  const base = color || (mine ? "#262a22" : "#1c1f18");
  const painted = withAlpha(base, fade);
  return { backgroundColor: painted, borderColor: painted };
}

const BUBBLE_COLORS = ["#243044", "#1c3d36", "#1e3a5f", "#3a2748", "#4a2430", "#3d3218", "#16383a", "#3a2a22"];

function bubbleKey(meId: string, thread: Thread) {
  return `atlas.bubble.${meId}.${thread.kind}.${thread.id}`;
}

export function readBubble(meId: string, thread: Thread) {
  try {
    const value = localStorage.getItem(bubbleKey(meId, thread)) ?? "";
    return /^#[0-9a-fA-F]{6}$/.test(value) ? value : "";
  } catch {
    return "";
  }
}

function writeBubble(meId: string, thread: Thread, color: string) {
  try {
    const key = bubbleKey(meId, thread);
    if (color) localStorage.setItem(key, color);
    else localStorage.removeItem(key);
  } catch {
    /* this phone keeps the default */
  }
}

/** Their bubble color, on this phone only. The swatches, without a screen of their own. */
export function TheirBubbles({
  meId,
  thread,
  name,
  color,
  onChange,
}: {
  meId: string;
  thread: Thread;
  name: string;
  color: string;
  onChange: (color: string) => void;
}) {
  const pick = (next: string) => {
    const color = /^#[0-9a-fA-F]{6}$/.test(next) ? next : "";
    writeBubble(meId, thread, color);
    onChange(color);
  };
  return (
    <div>
      <p className="font-serif text-2xl leading-tight">Their bubbles</p>
      <p className="mt-1 text-sm text-muted">Only on this phone. {name} still sees the usual bubbles.</p>
      <div className="mt-4 flex justify-start">
        <div
          className="max-w-[70%] rounded-2xl rounded-bl-md border border-line px-3 py-2 text-[15px]"
          style={color ? { backgroundColor: color, borderColor: color } : undefined}
        >
          Like this
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          aria-label="Default"
          aria-pressed={!color}
          onClick={() => pick("")}
          className={"h-11 rounded-full border px-3 text-sm " + (!color ? "border-ink bg-elevated" : "border-line")}
        >
          Default
        </button>
        {BUBBLE_COLORS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            aria-label={swatch}
            aria-pressed={color.toLowerCase() === swatch}
            onClick={() => pick(swatch)}
            className={"size-11 rounded-full border-2 " + (color.toLowerCase() === swatch ? "border-ink" : "border-transparent")}
            style={{ backgroundColor: swatch }}
          />
        ))}
        <label className="relative grid size-11 cursor-pointer place-items-center overflow-hidden rounded-full border border-line text-xs text-muted">
          +
          <input
            type="color"
            aria-label="Custom color"
            value={color || "#243044"}
            onChange={(event) => pick(event.target.value)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
      </div>
    </div>
  );
}

/** Their bubble color, on this phone only. */
function BubbleSettings({
  meId,
  thread,
  name,
  color,
  onClose,
  onChange,
}: {
  meId: string;
  thread: Thread;
  name: string;
  color: string;
  onClose: () => void;
  onChange: (color: string) => void;
}) {
  useBackClose(onClose);
  return createPortal(
    <div role="dialog" aria-label="Chat settings" className="screen-top fixed inset-0 z-[70] flex flex-col bg-bg">
      <ScreenHeader title="Settings" onBack={onClose} backLabel="Back to the chat" />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <TheirBubbles meId={meId} thread={thread} name={name} color={color} onChange={onChange} />
      </div>
    </div>,
    document.body,
  );
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
  const [wallOpen, setWallOpen] = useState(false);
  const [sharedOpen, setSharedOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wallpaper, setWallpaper] = useState<string | null>(null);
  const [look, setLook] = useState<ChatLook>(LOOK_DEFAULT);
  const [streakOpen, setStreakOpen] = useState(false);
  const streak = usePulseFor(chat.thread)?.streak ?? null;
  useBackClose(onClose);
  const threadKey = `${chat.thread.kind}:${chat.thread.id}`;
  useEffect(() => {
    let dead = false;
    void wallpaperFor(chat.meId, chat.thread).then((image) => {
      if (!dead) setWallpaper(image);
    });
    return () => {
      dead = true;
    };
  }, [chat.meId, chat.thread, threadKey]);
  useEffect(() => {
    let dead = false;
    const local = readLook(chat.meId, chat.thread);
    setLook(local);
    const own = Boolean(local.mine || local.their || local.mineFade < 100 || local.theirFade < 100);
    if (own && !local.shared) return;
    void loadTheme({ data: { thread: chat.thread } })
      .then((theme) => {
        if (!dead && theme) setLook(applyShared(local, theme, chat.meId));
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [chat.meId, chat.thread, threadKey]);
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
      <ScreenHeader
        className="screen-top"
        title={
          streak && streak.days >= STREAK_SHOWS ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate">{nickOf(chat.meId, chat.thread.kind, chat.thread.id, title)}</span>
              <StreakChip streak={streak} onClick={() => setStreakOpen(true)} />
            </span>
          ) : (
            nickOf(chat.meId, chat.thread.kind, chat.thread.id, title)
          )
        }
        subtitle={subtitle || undefined}
        onBack={onClose}
        right={
          <button type="button" onClick={() => setMore(true)} aria-label="More" className="grid h-11 w-11 place-items-center rounded-full text-[1.7rem] leading-none tracking-widest text-ink active:bg-elevated">
            ···
          </button>
        }
      />
      {note ? <p className="shrink-0 border-b border-line px-3 py-2 text-sm text-muted">{note}</p> : null}
      <ChatThread {...chat} wallpaper={wallpaper} look={look} fill />
      {more ? (
        <Sheet label={title} onClose={() => setMore(false)}>
          <div className="overflow-hidden rounded-xl border border-line">
            <MenuRow
              icon={<Images className="size-[18px]" />}
              label="Shared in this chat"
              onClick={() => {
                setMore(false);
                setSharedOpen(true);
              }}
            />
            <MenuRow
              icon={<ImageIcon className="size-[18px]" />}
              label="Wallpaper"
              onClick={() => {
                setMore(false);
                setWallOpen(true);
              }}
            />
            <MenuRow
              icon={<Settings className="size-[18px]" />}
              label="Chat settings"
              onClick={() => {
                setMore(false);
                setSettingsOpen(true);
              }}
            />
          </div>
          {actions.length ? (
            <div className="mt-2 overflow-hidden rounded-xl border border-line">
              {actions.map((action) => (
                <MenuRow
                  key={action.label}
                  danger={action.danger}
                  icon={action.danger ? <LogOut className="size-[18px]" /> : <MoreHorizontal className="size-[18px]" />}
                  label={action.label}
                  onClick={() => {
                    setMore(false);
                    action.onClick();
                  }}
                />
              ))}
            </div>
          ) : null}
        </Sheet>
      ) : null}
      {streakOpen && streak ? <StreakSheet streak={streak} name={nickOf(chat.meId, chat.thread.kind, chat.thread.id, title)} onClose={() => setStreakOpen(false)} /> : null}
      {settingsOpen ? (
        <ChatLookScreen
          meId={chat.meId}
          thread={chat.thread}
          name={title}
          look={look}
          onClose={() => setSettingsOpen(false)}
          onChange={setLook}
        />
      ) : null}
      {sharedOpen ? (
        <SharedInChat
          meId={chat.meId}
          thread={chat.thread}
          onClose={() => setSharedOpen(false)}
          onOpenPlace={chat.onOpenPlace}
          onOpenTrail={chat.onOpenTrail}
          onOpenHere={chat.onOpenHere}
          onOpenBoard={chat.onOpenBoard}
        />
      ) : null}
      {wallOpen ? (
        <WallpaperScreen
          meId={chat.meId}
          thread={chat.thread}
          onClose={() => setWallOpen(false)}
          onSaved={(image) => {
            setWallpaper(image);
            setWallOpen(false);
          }}
        />
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
  onOpenTrail,
  onOpenHere,
  onOpenBoard,
  you = null,
  onClose,
  initial = null,
  tabbed = false,
}: {
  meId: string;
  places: ChatPlaceOption[];
  onAddToMap: (photo: ChatPhoto, place: ChatPlaceOption) => Promise<void>;
  onOpenPlace?: (place: ChatPlace, from?: Thread) => void;
  onOpenTrail?: (lines: [number, number][][]) => void;
  onOpenHere?: (lat: number, lon: number, label?: string) => void;
  onOpenBoard?: (id: string) => void;
  you?: Fix | null;
  onClose: () => void;
  /** Open straight into this chat (back from a place it sent). */
  initial?: Thread | null;
  /** Opened from the tab bar: stop above it, so it stays in view. */
  tabbed?: boolean;
}) {
  const [rows, setRows] = useState<BoardItem[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<BoardItem | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ChatHit[] | null>(null);
  const unread = useChat((state) => state.summary);
  const [streaks, setStreaks] = useState<Record<string, Streak>>({});
  useLookVersion();
  useBackClose(onClose);
  useEffect(() => {
    if (open) return;
    let dead = false;
    myStreaks({ data: { zone: myZone() } })
      .then((next) => {
        if (!dead) setStreaks(next);
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [open]);
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
        title={nickOf(meId, open.thread.kind, open.thread.id, open.title)}
        onClose={() => setOpen(null)}
        thread={open.thread}
        meId={meId}
        places={places}
        focusId={focusId}
        onAddToMap={onAddToMap}
        onOpenTrail={onOpenTrail}
        onOpenHere={onOpenHere}
        onOpenBoard={onOpenBoard}
        you={you}
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
    <div role="dialog" aria-label="Messages" className={(tabbed ? "tab-screen " : "") + "screen-top fixed inset-0 z-40 flex flex-col bg-bg"}>
      <ScreenHeader title="Messages" onBack={onClose} />
      <form
        className="px-3 pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          const text = q.trim();
          if (text.length < 2) {
            setHits(null);
            return;
          }
          searchChats({ data: { q: text } })
            .then(setHits)
            .catch((err) => setNote(err instanceof Error ? err.message : "Couldn't search."));
        }}
      >
        <input
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            if (event.target.value.trim().length < 2) setHits(null);
          }}
          placeholder="Search messages and places"
          className="h-11 w-full rounded-lg border border-line bg-bg px-3 text-base text-ink outline-none placeholder:text-faint"
        />
      </form>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-3">
        {note ? <p className="mb-2 text-sm text-muted">{note}</p> : null}
        {hits ? (
          hits.length ? (
            <ul className="mb-3 grid grid-cols-[minmax(0,1fr)] gap-1">
              {hits.map((hit) => (
                <li key={hit.messageId}>
                  <button
                    type="button"
                    onClick={() => {
                      setFocusId(hit.messageId);
                      setOpen({ thread: hit.thread, title: hit.title, preview: hit.preview, at: hit.at, mine: false });
                    }}
                    className="w-full rounded-lg border border-line px-3 py-2 text-left"
                  >
                    <span className="block truncate text-sm">{nickOf(meId, hit.thread.kind, hit.thread.id, hit.title)}</span>
                    <span className="block truncate text-xs text-faint">{hit.preview}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-sm text-muted">Nothing in your chats matches that.</p>
          )
        ) : null}
        {rows === null && !note ? <p className="text-sm text-muted">Loading…</p> : null}
        {rows && rows.length === 0 ? <p className="text-sm text-muted">No friends yet. A chat shows up here once you add one.</p> : null}
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
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
                      <span className={"min-w-0 truncate text-[15px] " + (n ? "font-semibold" : "font-medium")}>{nickOf(meId, row.thread.kind, row.thread.id, row.title)}</span>
                      {row.thread.kind === "friend" && streaks[row.thread.id] ? <StreakChip streak={streaks[row.thread.id]} small /> : null}
                      <span className="flex-1" />
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
function TrailSheet({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (name: string, points: GhostPoint[], day: string | null) => void;
}) {
  const saved = useGhost((state) => state.saved);
  const live = useGhost((state) => state.live);
  const hours = useSettings((state) => state.ghostHours);
  const today = thinTrail(freshPoints(live, hours), 40);
  const day = (t: number) => new Date(t).toLocaleDateString("en-CA");
  return (
    <Sheet label="Share a trail" onClose={onClose}>
      <p className="text-xs text-muted">Start and end are hidden.</p>
      <ul className="mt-2">
        {today.length >= 2 ? (
          <li>
            <button type="button" onClick={() => onPick("Today's drive", today, day(today[0]?.t ?? Date.now()))} className="flex h-11 w-full items-center text-left text-sm">
              Today's drive
            </button>
          </li>
        ) : null}
        {saved.map((trail) => (
          <li key={trail.id}>
            <button type="button" onClick={() => onPick(trail.name, trail.points, day(trail.startedAt))} className="flex h-11 w-full items-center text-left text-sm">
              <span className="min-w-0 flex-1 truncate">{trail.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {!saved.length && today.length < 2 ? <p className="mt-2 text-sm text-muted">No saved trail, and today's drive is too short.</p> : null}
    </Sheet>
  );
}

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
  // The whole picture at its own shape (a tall camera shot isn't cut off); very tall ones get narrower, not cropped.
  return <img ref={box} src={sharp ?? thumb} alt="" className="mx-auto block h-auto max-h-[60dvh] w-auto max-w-full rounded-md" />;
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

/** "Where am I?": pick a state to guess; then the spot, and everyone's guesses. */
function WhereCard({ where, mine, from, onGuess, onOpen }: { where: ChatWhere; mine: boolean; from: string; onGuess: (state: string) => Promise<void>; onOpen?: (lat: number, lon: number, label?: string) => void }) {
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const spot = where.spot;
  return (
    <div className="w-60 max-w-full py-1">
      <span className="flex items-center gap-1.5 text-xs tracking-widest text-faint uppercase">
        <HelpCircle className="size-3.5" aria-hidden="true" />
        {mine ? "Your spot · they guess" : `Where's ${from}?`}
      </span>
      {!spot ? (
        <>
          <p className="mt-1 text-sm text-muted">Pick the state you think they're in.</p>
          <div className="mt-2">
            <StateTiles onTap={setPick} look={(abbr) => ({ on: abbr === pick })} />
          </div>
          <button
            type="button"
            disabled={!pick || busy}
            onClick={() => {
              if (!pick) return;
              setBusy(true);
              void onGuess(pick).finally(() => setBusy(false));
            }}
            className="mt-2 h-10 w-full rounded-lg bg-ink text-sm text-bg disabled:bg-elevated disabled:text-faint"
          >
            {busy ? "Guessing…" : pick ? `Guess ${TILE_NAMES[pick] ?? pick}` : "Pick a state"}
          </button>
        </>
      ) : (
        <>
          {where.mine ? <p className="mt-1 font-serif text-2xl leading-tight">{where.mine.miles === 0 ? "Right state!" : `${where.mine.miles.toLocaleString()} miles off`}</p> : null}
          <button type="button" onClick={() => onOpen?.(spot.lat, spot.lon, spot.label)} className="mt-1 block text-left">
            <span className="block font-serif text-lg leading-tight">{spot.label}</span>
            <span className="block text-xs text-muted">{TILE_NAMES[spot.state] ?? spot.state}{onOpen ? " · on the map" : ""}</span>
          </button>
          {where.guesses.length ? (
            <ul className="mt-2 grid gap-0.5 text-sm">
              {where.guesses.map((g, i) => (
                <li key={`${g.name}${i}`} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{g.name}</span>
                  <span className="text-xs text-faint">{g.state}</span>
                  <span className="tabular-nums">{g.miles === 0 ? "Right" : `${g.miles.toLocaleString()} mi`}</span>
                </li>
              ))}
            </ul>
          ) : mine ? (
            <p className="mt-2 text-xs text-faint">No guesses yet.</p>
          ) : null}
        </>
      )}
    </div>
  );
}

/** A poll in a chat: each choice is a bar that fills with the votes; tap to vote, tap again to take it back. */
function PollCard({ poll, mine, pending, onVote }: { poll: ChatPoll; mine: boolean; pending: boolean; onVote: (choice: number) => void }) {
  const total = poll.votes.reduce((sum, n) => sum + n, 0);
  const top = Math.max(0, ...poll.votes);
  return (
    <div className="min-w-56 py-1">
      <span className="flex items-center gap-1.5 text-[11px] tracking-[0.14em] text-faint uppercase">
        <Vote className="size-3.5" />
        {mine ? "Your poll" : "Poll"}
      </span>
      <p className="mt-0.5 font-serif text-lg leading-tight">{poll.q}</p>
      <div className="mt-2 grid gap-1.5">
        {poll.options.map((option, index) => {
          const n = poll.votes[index] ?? 0;
          const share = total ? n / total : 0;
          const picked = poll.mine === index;
          const leading = total > 0 && n === top;
          return (
            <button
              key={option}
              type="button"
              disabled={pending}
              aria-pressed={picked}
              onClick={() => onVote(index)}
              className={"relative overflow-hidden rounded-lg border text-left " + (picked ? "border-ink" : "border-line")}
            >
              <span className="absolute inset-y-0 left-0 rounded-r-md bg-ink/10 transition-[width] duration-300" style={{ width: `${Math.round(share * 100)}%` }} aria-hidden="true" />
              <span className="relative flex min-h-10 items-center gap-2 px-3 py-1.5">
                <span className={"grid size-5 shrink-0 place-items-center rounded-full border " + (picked ? "border-ink bg-ink text-bg" : "border-line")}>
                  {picked ? <Check className="size-3" strokeWidth={3} /> : null}
                </span>
                <span className={"min-w-0 flex-1 text-sm " + (leading ? "font-medium" : "")}>{option}</span>
                {total ? <span className="shrink-0 text-xs text-muted tabular-nums">{n}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-faint">
        {total ? `${total} ${total === 1 ? "vote" : "votes"}` : "No votes yet. Tap one."}
        {total && poll.voters.some((names) => names.length) ? ` · ${poll.options.map((option, i) => (poll.voters[i]?.length ? `${option}: ${poll.voters[i].join(", ")}` : "")).filter(Boolean).join(" · ")}` : ""}
      </p>
    </div>
  );
}

/** Ask a question with 2–6 choices. */
function PollMaker({ onSend }: { onSend: (q: string, options: string[]) => void }) {
  const [q, setQ] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const ideas = [
    ["Where are we eating?", ["Diner", "Tacos", "BBQ"]],
    ["Stop for the night?", ["Keep driving", "Next town", "Here"]],
    ["Scenic route or fast?", ["Scenic", "Fast"]],
  ] as const;
  const filled = options.map((option) => option.trim()).filter(Boolean);
  return (
    <div>
      <input autoFocus value={q} onChange={(event) => setQ(event.target.value.slice(0, 140))} placeholder="Ask something" className="h-12 w-full rounded-lg border border-line bg-bg px-3 font-serif text-lg outline-none placeholder:text-faint" />
      {!q && filled.length === 0 ? (
        <div className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1">
          {ideas.map(([question, choices]) => (
            <button
              key={question}
              type="button"
              onClick={() => {
                setQ(question);
                setOptions([...choices]);
              }}
              className="h-9 shrink-0 rounded-full border border-line px-3 text-sm text-muted active:bg-elevated"
            >
              {question}
            </button>
          ))}
        </div>
      ) : null}
      <div className="mt-3 grid gap-2">
        {options.map((option, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              value={option}
              onChange={(event) => setOptions((cur) => cur.map((row, i) => (i === index ? event.target.value.slice(0, 60) : row)))}
              placeholder={`Choice ${index + 1}`}
              className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-base outline-none placeholder:text-faint"
            />
            {options.length > 2 ? (
              <button type="button" aria-label={`Remove choice ${index + 1}`} onClick={() => setOptions((cur) => cur.filter((_, i) => i !== index))} className="grid size-11 shrink-0 place-items-center text-faint">
                <X className="size-4" />
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {options.length < 6 ? (
        <button type="button" onClick={() => setOptions((cur) => [...cur, ""])} className="mt-2 flex h-10 items-center gap-1 px-1 text-sm text-muted">
          <Plus className="size-4" />
          Add a choice
        </button>
      ) : null}
      <button
        type="button"
        disabled={!q.trim() || filled.length < 2}
        onClick={() => onSend(q.trim(), filled)}
        className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-ink text-sm text-bg disabled:bg-elevated disabled:text-faint"
      >
        <Send className="size-4" />
        Send poll
      </button>
    </div>
  );
}

/** "🔥 12": days in a row you've both sent something. An hourglass when it's about to run out. */
function StreakChip({ streak, small = false, onClick }: { streak: Streak; small?: boolean; onClick?: () => void }) {
  const hurry = streak.endsAt != null && streak.endsAt - Date.now() < STREAK_HURRY_MS;
  const inner = (
    <>
      <span aria-hidden="true">{streak.days === 100 ? "💯" : "🔥"}</span>
      <span className="tabular-nums">{streak.days}</span>
      {hurry ? <span aria-hidden="true">⏳</span> : null}
    </>
  );
  const label = `${streak.days}-day streak${hurry ? ", ends soon" : ""}`;
  const look = "inline-flex shrink-0 items-center gap-0.5 rounded-full font-sans font-semibold text-ink " + (small ? "text-xs" : "bg-elevated px-2 py-0.5 text-sm");
  return onClick ? (
    <button type="button" onClick={onClick} aria-label={label} className={look + " active:scale-95"}>
      {inner}
    </button>
  ) : (
    <span aria-label={label} className={look}>
      {inner}
    </span>
  );
}

const STREAK_GOALS = [3, 7, 14, 30, 50, 100, 150, 200, 365, 500, 1000];

function StreakSheet({ streak, name, onClose }: { streak: Streak; name: string; onClose: () => void }) {
  const first = name.split(" ")[0] || name;
  const left = streak.endsAt != null ? Math.max(0, streak.endsAt - Date.now()) : null;
  const hours = left != null ? Math.floor(left / 3_600_000) : 0;
  const minutes = left != null ? Math.floor((left % 3_600_000) / 60_000) : 0;
  const next = STREAK_GOALS.find((goal) => goal > streak.days);
  const waiting = !streak.today.me && !streak.today.them ? "you both" : !streak.today.me ? "you" : !streak.today.them ? first : null;
  return (
    <Sheet label="Streak" onClose={onClose}>
      <div className="flex flex-col items-center pt-1 pb-2 text-center">
        <span className="streak-flame text-6xl leading-none">{streak.days === 100 ? "💯" : "🔥"}</span>
        <p className="mt-2 font-serif text-3xl leading-tight">{streak.days} days</p>
        <p className="mt-1 text-sm text-muted">
          You and {first} have both sent something {streak.days} days in a row.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ["You", streak.today.me],
            [first, streak.today.them],
          ] as const
        ).map(([who, done]) => (
          <div key={who} className={"rounded-xl border p-3 text-center " + (done ? "border-ink bg-elevated" : "border-line")}>
            <p className="truncate text-xs tracking-widest text-faint uppercase">{who} today</p>
            <p className="mt-1 text-lg">{done ? "✓ Sent" : "Not yet"}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-center text-sm text-muted">
        {waiting && left != null
          ? `Waiting on ${waiting}. Send something in the next ${hours ? `${hours} h ` : ""}${minutes} min to keep it going${left < STREAK_HURRY_MS ? " ⏳" : ""}.`
          : "Today counts. Come back tomorrow to keep it going."}
        {next ? ` Next up: 🔥 ${next}.` : ""}
      </p>
    </Sheet>
  );
}
