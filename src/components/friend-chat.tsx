import { useEffect, useMemo, useRef, useState } from "react";
import { listMessages, loadMessagePhoto, sendMessage, type ChatMessage } from "@/lib/messages";
import { pushBack } from "@/lib/sheet-back";

const PHOTO_LINK =
  /^https?:\/\/(?:photos\.app\.goo\.gl|photos\.google\.com|goo\.gl\/photos)\/\S+$/i;

type Place = { id: string; name: string; state?: string; lat: number | null; lon: number | null };

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
  const parts = text.split(/(https?:\/\/\S+)/g);
  return parts.map((part, index) =>
    /^https?:\/\//.test(part) ? (
      <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="underline">
        {part.replace(/^https?:\/\//, "")}
      </a>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

export function FriendChat({
  friendId,
  meId,
  places,
  onAddToMap,
}: {
  friendId: string;
  meId: string;
  places: Place[];
  onAddToMap: (photo: { thumb: string; image: string }, place: Place) => Promise<void>;
}) {
  const [rows, setRows] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [picking, setPicking] = useState<ChatMessage | null>(null);
  const [query, setQuery] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let dead = false;
    const pull = () => {
      listMessages({ data: { id: friendId } })
        .then((next) => {
          if (!dead) setRows(next);
        })
        .catch((err) => {
          if (!dead) setNote(err instanceof Error ? err.message : "Couldn't load the chat.");
        });
    };
    pull();
    const id = window.setInterval(pull, 8000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [friendId]);

  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [rows?.length]);

  useEffect(() => {
    if (!picking && !menuId) return;
    return pushBack(() => {
      if (picking) setPicking(null);
      else setMenuId(null);
      return true;
    });
  }, [picking, menuId]);

  async function sendText() {
    const body = draft.trim();
    if (!body || busy) return;
    const kind = PHOTO_LINK.test(body) ? "link" : "text";
    const id = newId();
    setBusy(true);
    setNote(null);
    setDraft("");
    setRows((prev) => [
      ...(prev ?? []),
      { id, fromId: meId, kind, body, thumb: "", at: Date.now() },
    ]);
    try {
      await sendMessage({ data: { friendId, id, kind, body } });
    } catch (err) {
      setRows((prev) => (prev ?? []).filter((row) => row.id !== id));
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
      const image = await shrinkChatPhoto(file, 640, 0.7);
      if (image.length > 140000) throw new Error("Use a smaller photo");
      const thumb = await shrinkChatPhoto(file, 160, 0.6);
      if (thumb.length > 38000) throw new Error("Use a smaller photo");
      const id = newId();
      setRows((prev) => [
        ...(prev ?? []),
        { id, fromId: meId, kind: "photo", body: "", thumb, at: Date.now() },
      ]);
      try {
        await sendMessage({ data: { friendId, id, kind: "photo", body: "", thumb, image } });
      } catch (err) {
        setRows((prev) => (prev ?? []).filter((row) => row.id !== id));
        throw err;
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't send that photo.");
    } finally {
      setBusy(false);
    }
  }

  async function addPicked(place: Place) {
    const message = picking;
    if (!message) return;
    setPicking(null);
    setMenuId(null);
    setNote(null);
    try {
      const loaded = await loadMessagePhoto({ data: { id: message.id } });
      await onAddToMap({ thumb: message.thumb, image: loaded.image }, place);
      setNote("Added to the map. It stays private until you share it.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't add that photo.");
    }
  }

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return places
      .filter((place) => {
        const name = place.name.toLowerCase();
        if (name.includes(q)) return true;
        const parts = q.split(/\s+/).filter(Boolean);
        const state = (place.state ?? "").toLowerCase();
        const last = parts[parts.length - 1] ?? "";
        return parts.length >= 2 && state === last && name.includes(parts.slice(0, -1).join(" "));
      })
      .slice(0, 30);
  }, [places, query]);

  return (
    <div className="mt-4">
      <p className="px-2 text-sm text-muted">
        Text, a photo, or a Google Photos link. A photo stays in the chat until you add it to the map.
      </p>
      <div ref={scroller} className="mt-2 flex max-h-[46dvh] flex-col gap-2 overflow-y-auto px-2">
        {rows === null ? <p className="text-sm text-muted">Loading…</p> : null}
        {rows && rows.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet. Paste a Google Photos link to send one.</p>
        ) : null}
        {rows?.map((row) => {
          const mine = row.fromId === meId;
          return (
            <div key={row.id} className={"flex " + (mine ? "justify-end" : "justify-start")}>
              <div className={"max-w-[85%] rounded-lg px-3 py-2 text-sm " + (mine ? "bg-elevated" : "border border-line")}>
                {row.kind === "photo" && row.thumb ? (
                  <img src={row.thumb} alt="" className="max-h-48 w-full rounded-md object-cover" />
                ) : null}
                {row.kind === "link" ? (
                  <a href={row.body} target="_blank" rel="noopener noreferrer" className="block">
                    <span className="block text-xs tracking-widest text-faint uppercase">Google Photos</span>
                    <span className="mt-1 block break-all underline">{row.body.replace(/^https?:\/\//, "")}</span>
                  </a>
                ) : null}
                {row.kind === "text" ? <p className="break-words">{linkParts(row.body)}</p> : null}
                {row.kind === "photo" ? (
                  <button
                    type="button"
                    aria-label="Photo options"
                    onClick={() => setMenuId(menuId === row.id ? null : row.id)}
                    className="mt-1 h-11 px-1 text-xs text-muted"
                  >
                    ···
                  </button>
                ) : null}
                {menuId === row.id ? (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setPicking(row);
                    }}
                    className="mb-1 h-11 w-full rounded-lg border border-line text-sm"
                  >
                    Add to map
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {note ? <p className="mt-2 px-2 text-sm text-muted">{note}</p> : null}
      <form
        className="mt-2 flex items-end gap-2 px-2"
        onSubmit={(event) => {
          event.preventDefault();
          void sendText();
        }}
      >
        <label className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg border border-line text-sm text-muted">
          +
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void sendPhoto(file);
            }}
          />
        </label>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value.slice(0, 500))}
          placeholder="Text or a Google Photos link"
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
      {picking ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-3 pb-6" onClick={() => setPicking(null)}>
          <div
            role="dialog"
            aria-label="Add this photo to a place"
            className="w-full max-w-sm rounded-card border border-line bg-surface p-3"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-xs tracking-widest text-faint uppercase">Add to map</p>
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search places you've added"
              className="mt-2 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-ink outline-none"
            />
            {query.trim().length < 2 ? <p className="mt-3 text-sm text-muted">Type at least two letters.</p> : null}
            {query.trim().length >= 2 && hits.length === 0 ? <p className="mt-3 text-sm text-muted">No place named that.</p> : null}
            {hits.length ? (
              <ul className="mt-2 max-h-64 overflow-y-auto">
                {hits.map((place) => (
                  <li key={place.id}>
                    <button type="button" onClick={() => void addPicked(place)} className="flex h-11 w-full items-center text-left text-sm">
                      <span className="min-w-0 flex-1 truncate">{place.state ? `${place.name}, ${place.state}` : place.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <button type="button" onClick={() => setPicking(null)} className="mt-2 h-11 w-full rounded-lg border border-line text-sm">
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
