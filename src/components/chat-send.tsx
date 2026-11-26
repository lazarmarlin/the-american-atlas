import { useEffect, useState } from "react";
import { Sheet } from "@/components/friend-chat";
import { listGroups, type ChatGroup } from "@/lib/chat-groups";
import { listFriends } from "@/lib/friends";
import type { Mark } from "@/lib/marks";
import { sendToThread, type Thread } from "@/lib/messages";
import { useBackClose } from "@/lib/sheet-back";

/** Send a place card ("I was here") to a friend or a trip chat, from a place card. */
export function SendPlaceSheet({ mark, onClose }: { mark: Mark; onClose: () => void }) {
  const [friends, setFriends] = useState<{ id: string; name: string }[] | null>(null);
  const [groups, setGroups] = useState<ChatGroup[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listFriends()
      .then((rows) => setFriends(rows.map((row) => ({ id: row.id, name: row.name }))))
      .catch(() => setFriends([]));
    listGroups()
      .then(setGroups)
      .catch(() => setGroups([]));
  }, []);
  useBackClose(onClose);

  const lastVisit = [...mark.visits].map((visit) => visit.visitedOn).filter(Boolean).sort().at(-1) ?? null;

  async function send(thread: Thread, name: string) {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      await sendToThread({
        data: {
          thread,
          id: `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          kind: "place",
          place: { id: mark.id, state: mark.state, lat: mark.lat, lon: mark.lon, visitedOn: lastVisit },
        },
      });
      setNote(`Sent to ${name}.`);
      window.setTimeout(onClose, 900);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't send it.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet label={`Send ${mark.name}`} onClose={onClose}>
      {friends === null ? <p className="text-sm text-muted">Loading…</p> : null}
      {friends && !friends.length && !groups.length ? <p className="text-sm text-muted">Add a friend first, from the Friends tab.</p> : null}
      <ul className="grid max-h-72 gap-1 overflow-y-auto">
        {groups.map((g) => (
          <li key={g.id}>
            <button type="button" disabled={busy} onClick={() => void send({ kind: "group", id: g.id }, g.name)} className="flex h-11 w-full items-center rounded-lg border border-line px-3 text-left text-sm">
              <span className="min-w-0 flex-1 truncate">{g.name}</span>
              <span className="text-xs text-faint">trip chat</span>
            </button>
          </li>
        ))}
        {(friends ?? []).map((f) => (
          <li key={f.id}>
            <button type="button" disabled={busy} onClick={() => void send({ kind: "friend", id: f.id }, f.name)} className="flex h-11 w-full items-center rounded-lg border border-line px-3 text-left text-sm">
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
    </Sheet>
  );
}

/** A JPEG data URL of the image, at most `max` px on its longer side. */
async function jpegOf(blob: Blob, max: number, quality: number) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Couldn't read the card."));
      el.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const g = canvas.getContext("2d");
    if (!g) throw new Error("Couldn't read the card.");
    g.fillStyle = "#14160f";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Send a picture (a recap card) to a friend or a trip chat, as a photo message. */
export function SendImageSheet({ label, makeImage, onClose }: { label: string; makeImage: () => Promise<Blob>; onClose: () => void }) {
  const [friends, setFriends] = useState<{ id: string; name: string }[] | null>(null);
  const [groups, setGroups] = useState<ChatGroup[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    listFriends()
      .then((rows) => setFriends(rows.map((row) => ({ id: row.id, name: row.name }))))
      .catch(() => setFriends([]));
    listGroups()
      .then(setGroups)
      .catch(() => setGroups([]));
  }, []);
  useBackClose(onClose);

  async function send(thread: Thread, name: string) {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const blob = await makeImage();
      let image = await jpegOf(blob, 1600, 0.85);
      if (image.length > 690000) image = await jpegOf(blob, 1200, 0.75);
      let thumb = await jpegOf(blob, 540, 0.78);
      if (thumb.length > 115000) thumb = await jpegOf(blob, 400, 0.65);
      await sendToThread({
        data: {
          thread,
          id: `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          kind: "photo",
          body: "",
          thumb,
          image,
          lat: null,
          lon: null,
          takenAt: Date.now(),
        },
      });
      setNote(`Sent to ${name}.`);
      window.setTimeout(onClose, 900);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't send it.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet label={label} onClose={onClose}>
      {friends === null ? <p className="text-sm text-muted">Loading…</p> : null}
      {friends && !friends.length && !groups.length ? <p className="text-sm text-muted">Add a friend first, from the Friends tab.</p> : null}
      <ul className="grid max-h-72 gap-1 overflow-y-auto">
        {groups.map((g) => (
          <li key={g.id}>
            <button type="button" disabled={busy} onClick={() => void send({ kind: "group", id: g.id }, g.name)} className="flex h-11 w-full items-center rounded-lg border border-line px-3 text-left text-sm">
              <span className="min-w-0 flex-1 truncate">{g.name}</span>
              <span className="text-xs text-faint">trip chat</span>
            </button>
          </li>
        ))}
        {(friends ?? []).map((f) => (
          <li key={f.id}>
            <button type="button" disabled={busy} onClick={() => void send({ kind: "friend", id: f.id }, f.name)} className="flex h-11 w-full items-center rounded-lg border border-line px-3 text-left text-sm">
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {busy ? <p className="mt-2 text-sm text-muted">Sending the card…</p> : null}
      {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
    </Sheet>
  );
}
