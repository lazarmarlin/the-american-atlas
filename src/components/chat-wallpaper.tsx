/**
 * The wallpaper screen: a picture from this phone or from photos already on
 * the atlas, a few simple filters, and a switch that shows the same picture
 * on the other person's phone.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cacheWall, cachedWall } from "@/lib/chat-cache";
import type { Thread } from "@/lib/messages";
import { allPhotos, photoImage } from "@/lib/photo-local";
import { listPhotos, loadPhoto, type PhotoInfo } from "@/lib/photos";
import { useBackClose } from "@/lib/sheet-back";
import { loadWallpaper, saveWallpaper, type Wallpaper } from "@/lib/wallpaper";

const FILTERS = [
  { id: "none", label: "None" },
  { id: "soft", label: "Soft" },
  { id: "blur", label: "Blur" },
  { id: "pixel", label: "Pixel" },
  { id: "gray", label: "Gray" },
  { id: "warm", label: "Warm" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't read that picture"));
    img.src = src;
  });
}

/** The picture as a small JPEG with the filter baked in, so both phones match. */
export async function bakeWallpaper(src: string, filter: FilterId) {
  const img = await loadImage(src);
  const max = 900;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't prepare that picture");
  if (filter === "pixel") {
    const pw = Math.max(8, Math.round(w / 32));
    const ph = Math.max(8, Math.round(h / 32));
    const tiny = document.createElement("canvas");
    tiny.width = pw;
    tiny.height = ph;
    const tctx = tiny.getContext("2d");
    if (!tctx) throw new Error("Couldn't prepare that picture");
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(img, 0, 0, pw, ph);
    canvas.width = w;
    canvas.height = h;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tiny, 0, 0, w, h);
  } else {
    canvas.width = w;
    canvas.height = h;
    ctx.filter =
      filter === "blur" ? "blur(12px)" : filter === "soft" ? "blur(5px) brightness(0.82)" : filter === "gray" ? "grayscale(1)" : filter === "warm" ? "sepia(0.7)" : "none";
    const pad = filter === "blur" || filter === "soft" ? 24 : 0;
    ctx.drawImage(img, -pad, -pad, w + pad * 2, h + pad * 2);
  }
  let quality = 0.72;
  let url = canvas.toDataURL("image/jpeg", quality);
  while (url.length > 200000 && quality > 0.4) {
    quality -= 0.08;
    url = canvas.toDataURL("image/jpeg", quality);
  }
  if (url.length > 210000) throw new Error("Use a smaller picture");
  return url;
}

/** What this phone should show: your own picture, or a shared one if you haven't set one just for yourself. */
export async function wallpaperFor(meId: string, thread: Thread): Promise<string | null> {
  const local = await cachedWall(meId, thread);
  let shared: Wallpaper | null = null;
  try {
    const remote = await loadWallpaper({ data: { thread } });
    shared = newestShared(remote.mine, remote.shared);
  } catch {
    /* offline: the saved picture still shows */
  }
  if (local?.image && !local.sync) return local.image;
  if (shared) return shared.image;
  return local?.image || null;
}

function newestShared(mine: Wallpaper | null, theirs: Wallpaper | null) {
  const rows = [mine?.shared ? mine : null, theirs?.shared ? theirs : null].filter((row): row is Wallpaper => !!row);
  rows.sort((a, b) => b.at - a.at);
  return rows[0] ?? null;
}

export function WallpaperScreen({
  meId,
  thread,
  onClose,
  onSaved,
}: {
  meId: string;
  thread: Thread;
  onClose: () => void;
  onSaved: (image: string | null) => void;
}) {
  const [source, setSource] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterId>("none");
  const [sync, setSync] = useState(false);
  const [photos, setPhotos] = useState<PhotoInfo[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useBackClose(onClose);

  useEffect(() => {
    void cachedWall(meId, thread).then((saved) => {
      if (!saved) return;
      setSource(saved.image);
      setPreview(saved.image);
      setFilter((FILTERS.some((item) => item.id === saved.filter) ? saved.filter : "none") as FilterId);
      setSync(saved.sync);
    });
  }, [meId, thread]);

  useEffect(() => {
    if (!source) return;
    let dead = false;
    void bakeWallpaper(source, filter)
      .then((url) => {
        if (!dead) setPreview(url);
      })
      .catch((err) => {
        if (!dead) setNote(err instanceof Error ? err.message : "Couldn't use that picture");
      });
    return () => {
      dead = true;
    };
  }, [source, filter]);

  async function fromFile(file: File) {
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Couldn't read that picture"));
      reader.readAsDataURL(file);
    });
    setNote(null);
    setFilter("none");
    setSource(url);
  }

  async function fromAtlas(photo: PhotoInfo) {
    setPicking(false);
    setBusy(true);
    setNote(null);
    try {
      const image = await photoImage(photo.id, () => loadPhoto({ data: photo.id }).then((row) => row.image));
      setFilter("none");
      setSource(image);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't open that photo");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!preview) return;
    setBusy(true);
    setNote(null);
    try {
      await cacheWall(meId, thread, { image: preview, filter, sync });
      await saveWallpaper({ data: { thread, image: preview, filter, shared: sync } });
      onSaved(preview);
      onClose();
    } catch (err) {
      await cacheWall(meId, thread, { image: preview, filter, sync: false });
      onSaved(preview);
      setNote(err instanceof Error ? err.message : "Saved on this phone. It couldn't be shared.");
      setSync(false);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await cacheWall(meId, thread, null);
      await saveWallpaper({ data: { thread, image: "", filter: "none", shared: false } }).catch(() => undefined);
      onSaved(null);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div role="dialog" aria-label="Chat wallpaper" className="screen-top fixed inset-0 z-[70] flex flex-col bg-bg">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-2">
        <button type="button" onClick={onClose} className="h-11 px-2 text-sm text-muted">
          ‹ Chat
        </button>
        <p className="min-w-0 flex-1 truncate text-right font-serif text-lg">Wallpaper</p>
      </header>
      <div
        className="relative min-h-0 flex-1 bg-elevated"
        style={preview ? { backgroundImage: `linear-gradient(rgba(10,10,10,0.45), rgba(10,10,10,0.62)), url(${preview})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
      >
        <div className="absolute inset-x-0 bottom-0 p-4">
          <p className="font-serif text-2xl">This chat</p>
          <p className="mt-1 max-w-xs text-sm text-white/80">The picture sits behind the messages. A filter is part of the picture, so it looks the same on their phone.</p>
        </div>
      </div>
      <div className="shrink-0 border-t border-line px-3 pt-3 safe-bottom">
        <div className="flex gap-2 overflow-x-auto pb-2">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={!source}
              onClick={() => setFilter(item.id)}
              className={"h-10 shrink-0 rounded-full border px-3 text-sm " + (filter === item.id ? "border-ink bg-elevated" : "border-line text-muted")}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="mt-1 flex gap-2">
          <label className="flex h-11 flex-1 items-center justify-center rounded-lg border border-line text-sm">
            Upload
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void fromFile(file);
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setPicking(true);
              // Photos on this phone and on your account, the phone's first (no signal needed).
              if (!photos) void allPhotos(() => listPhotos(), setPhotos).catch(() => setPhotos((cur) => cur ?? []));
            }}
            className="h-11 flex-1 rounded-lg border border-line text-sm"
          >
            Your photos
          </button>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={sync}
          onClick={() => setSync((on) => !on)}
          className="mt-2 flex h-12 w-full items-center gap-3 rounded-lg border border-line px-3 text-left"
        >
          <span className={"grid h-6 w-10 place-items-center rounded-full " + (sync ? "bg-accent" : "bg-line")}>
            <span className={"size-5 rounded-full bg-bg " + (sync ? "translate-x-2" : "-translate-x-2")} />
          </span>
          <span className="min-w-0">
            <span className="block text-sm">Same on their phone</span>
            <span className="block text-xs text-faint">{thread.kind === "group" ? "Everyone in this chat" : "Only this friend"}</span>
          </span>
        </button>
        {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
        <div className="mt-3 mb-2 flex gap-2">
          <button type="button" disabled={busy || !preview} onClick={() => void save()} className="h-11 flex-1 rounded-lg border border-ink bg-elevated text-sm disabled:border-line disabled:text-faint">
            {busy ? "Saving…" : "Use this"}
          </button>
          <button type="button" disabled={busy || !preview} onClick={() => void clear()} className="h-11 rounded-lg border border-line px-4 text-sm text-muted">
            Remove
          </button>
        </div>
      </div>
      {picking ? (
        <div className="screen-top fixed inset-0 z-[80] flex flex-col bg-bg" role="dialog" aria-label="Choose a photo">
          <header className="flex items-center gap-2 border-b border-line px-2 py-2">
            <button type="button" onClick={() => setPicking(false)} className="h-11 px-2 text-sm text-muted">
              ‹ Wallpaper
            </button>
            <p className="font-serif text-lg">Your photos</p>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {photos === null ? <p className="text-sm text-muted">Loading…</p> : null}
            {photos && !photos.length ? <p className="text-sm text-muted">No photos on your atlas yet.</p> : null}
            <ul className="grid grid-cols-3 gap-2">
              {(photos ?? []).map((photo) => (
                <li key={photo.id}>
                  <button type="button" onClick={() => void fromAtlas(photo)} className="block aspect-square w-full overflow-hidden rounded-md bg-elevated">
                    {photo.thumb ? <img src={photo.thumb} alt="" className="size-full object-cover" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
