import { useEffect, useMemo, useRef, useState } from "react";
import { matchPlace, readPhotoFile, tripFor, type RecordingTrip } from "@/lib/photo-file";
import { loadParkShapes, matchPark, choosePhotoPlace } from "@/lib/park-photo";
import { deletePhoto, loadPhoto, savePhoto, setPhotoShared, type PhotoInfo } from "@/lib/photos";
import { canScanLibrary, forgetAdded, lastScanAt, loadLibraryPhoto, rememberAdded, scanAllowed, scanLibrary } from "@/lib/photo-scan";
import { nativeApp } from "@/lib/native";
import { deleteLocalPhoto, getLocalPhoto, listLocalPhotos, markUploaded, saveLocalPhoto, setLocalShared, type LocalPhoto } from "@/lib/photo-local";
import { pushBack } from "@/lib/sheet-back";

/** A phone photo as a JPEG data URL under `limit` characters, trying lower quality if needed. */
async function phonePhoto(uri: string, edge: number, limit: number) {
  for (const quality of [78, 64, 50]) {
    const url = await loadLibraryPhoto(uri, edge, quality);
    if (url.length <= limit) return url;
  }
  throw new Error("That photo is too large to add.");
}

type Place = { id: string; name: string; lat: number | null; lon: number | null; category: string; state?: string };

function placeLabel(place: Place) {
  return place.state ? `${place.name}, ${place.state}` : place.name;
}

function matchesPlace(place: Place, query: string) {
  const name = place.name.toLowerCase();
  if (name.includes(query)) return true;
  const parts = query.split(/\s+/).filter(Boolean);
  const state = (place.state ?? "").toLowerCase();
  const last = parts[parts.length - 1] ?? "";
  if (parts.length < 2 || !state || state !== last) return false;
  return name.includes(parts.slice(0, -1).join(" "));
}

function PlacePick({
  place,
  empty,
  marks,
  onPick,
  label,
  className,
}: {
  place: Place | null;
  empty: string;
  marks: Place[];
  onPick: (place: Place) => void;
  /** Button text instead of the place name. */
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) return;
    return pushBack(() => {
      setOpen(false);
      return true;
    });
  }, [open]);
  const choices = useMemo(() => [...marks].sort((a, b) => placeLabel(a).localeCompare(placeLabel(b))), [marks]);
  const q = query.trim().toLowerCase();
  const hits = q.length < 2 ? [] : choices.filter((mark) => matchesPlace(mark, q)).slice(0, 30);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => {
          setQuery("");
          setOpen(true);
        }}
        className={className ?? "block h-9 w-full max-w-full min-w-0 truncate rounded-md border border-line bg-bg px-2 text-left text-sm text-ink"}
      >
        {label ?? (place ? placeLabel(place) : empty)}
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-3 pb-6"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Pick a place"
            className="w-full max-w-sm rounded-card border border-line bg-surface p-3"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-xs tracking-widest text-faint uppercase">Place</p>
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search places you've added"
              className="mt-2 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-ink outline-none"
            />
            {q.length < 2 ? <p className="mt-3 text-sm text-muted">Type at least two letters.</p> : null}
            {q.length >= 2 && hits.length === 0 ? <p className="mt-3 text-sm text-muted">No place named that.</p> : null}
            {hits.length ? (
              <ul className="mt-2 max-h-64 overflow-y-auto">
                {hits.map((mark) => (
                  <li key={mark.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onPick(mark);
                        setOpen(false);
                      }}
                      className="flex h-11 w-full items-center text-left text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">{placeLabel(mark)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <button type="button" onClick={() => setOpen(false)} className="mt-2 h-11 w-full rounded-lg border border-line text-sm">
              Close
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

type Candidate = {
  key: string;
  thumb: string;
  /** Empty for a camera-roll photo until it's added; read from `uri` then. */
  image: string;
  uri?: string;
  lat: number | null;
  lon: number | null;
  takenAt: number | null;
  place: Place | null;
  /** Matched from the photo's location, not picked by hand. */
  matched: boolean;
  /** The place isn't on the atlas yet; adding the photo adds it too. */
  isNew?: boolean;
  /** The saved photo's id once added, so it can be taken back out. */
  savedId?: string;
  added: boolean;
};

const PAGE = 36;

/** One photo in the review grid. Its thumbnail loads when it scrolls into view. */
function ReviewTile({
  row,
  busy,
  marks,
  onThumb,
  onToggle,
  onPick,
}: {
  row: Candidate;
  busy: boolean;
  marks: Place[];
  onThumb: (row: Candidate, thumb: string) => void;
  onToggle: (row: Candidate) => void;
  onPick: (row: Candidate, place: Place) => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (row.thumb || !row.uri || !ref.current) return;
    const uri = row.uri;
    const watch = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        watch.disconnect();
        void phonePhoto(uri, 280, 80000)
          .then((thumb) => onThumb(row, thumb))
          .catch(() => undefined);
      },
      { rootMargin: "300px" },
    );
    watch.observe(ref.current);
    return () => watch.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.key, row.thumb]);

  return (
    <li ref={ref} className="min-w-0">
      <button
        type="button"
        aria-pressed={row.added}
        aria-label={row.added ? "Added. Tap to take it back out" : row.place ? "Add this photo" : "Pick a place first"}
        disabled={busy || !row.place}
        onClick={() => onToggle(row)}
        className={
          "relative block aspect-square w-full overflow-hidden rounded-md border-2 bg-elevated disabled:opacity-60 " +
          (row.added ? "border-accent" : "border-transparent")
        }
      >
        {row.thumb ? <img src={row.thumb} alt="" className="size-full object-cover" /> : null}
        <span
          className={
            "absolute right-1 bottom-1 rounded-full px-2 py-0.5 text-[11px] " +
            (row.added ? "bg-accent text-bg" : "bg-black/60 text-white")
          }
        >
          {row.added ? "Added ✓" : "Add"}
        </span>
      </button>
      <span className="mt-0.5 flex min-w-0 items-center justify-between gap-1">
        <span className="truncate text-[11px] text-faint">
          {row.takenAt ? new Date(row.takenAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "No date"}
        </span>
        {!row.added ? (
          <PlacePick
            place={row.place}
            empty=""
            label="Move"
            marks={marks}
            onPick={(place) => onPick(row, place)}
            className="shrink-0 px-1 text-[11px] text-muted underline"
          />
        ) : null}
      </span>
    </li>
  );
}

/**
 * The photos a scan found, on their own screen: grouped by place, a grid of
 * thumbnails, more loading as you scroll. Tap a photo to add it, tap again to
 * take it back out.
 */
function PhotoReview({
  rows,
  marks,
  busy,
  note,
  onClose,
  onPick,
  onThumb,
  onToggle,
  onAddMany,
}: {
  rows: Candidate[];
  marks: Place[];
  busy: boolean;
  note: string | null;
  onClose: () => void;
  onPick: (row: Candidate, place: Place) => void;
  onThumb: (row: Candidate, thumb: string) => void;
  onToggle: (row: Candidate) => void;
  onAddMany: (rows: Candidate[]) => void;
}) {
  const [limit, setLimit] = useState(PAGE);
  const body = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return pushBack(() => {
      onClose();
      return true;
    });
  }, [onClose]);

  useEffect(() => {
    if (!end.current || limit >= rows.length) return;
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setLimit((n) => n + PAGE);
      },
      { root: body.current, rootMargin: "400px" },
    );
    watch.observe(end.current);
    return () => watch.disconnect();
  }, [limit, rows.length]);

  // Group by place, in the order places first appear (newest photos first).
  const groups: { key: string; place: Place | null; isNew: boolean; rows: Candidate[] }[] = [];
  const byKey = new Map<string, (typeof groups)[number]>();
  for (const row of rows) {
    const key = row.place?.id ?? "none";
    let group = byKey.get(key);
    if (!group) {
      group = { key, place: row.place, isNew: Boolean(row.isNew), rows: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.rows.push(row);
  }
  let budget = limit;
  const added = rows.filter((row) => row.added).length;
  const remaining = rows.filter((row) => row.place && !row.added);

  return (
    <div role="dialog" aria-label="Review photos" className="fixed inset-0 z-50 flex flex-col bg-bg screen-top">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <button type="button" onClick={onClose} className="h-11 px-2 text-sm text-muted">
          ‹ Photos
        </button>
        <div className="min-w-0 flex-1 text-right">
          <p className="font-serif text-lg leading-tight">Review photos</p>
          <p className="text-xs text-muted">
            {added} of {rows.length} added
          </p>
        </div>
      </div>
      {note ? <p className="shrink-0 px-4 pt-2 text-xs text-muted">{note}</p> : null}
      <div ref={body} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-4">
        {groups.map((group) => {
          // Counts and "Add N" cover the whole group; only the first `limit` photos overall are drawn.
          const open = group.rows.filter((row) => row.place && !row.added);
          const drawn = group.rows.slice(0, Math.max(0, budget));
          budget -= drawn.length;
          if (!drawn.length) return null;
          return (
            <section key={group.key} className="mt-4 min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <div className="min-w-0 flex-1">
                  {group.isNew ? <p className="text-[11px] tracking-widest text-accent uppercase">New place</p> : null}
                  <p className="truncate text-sm">{group.place ? placeLabel(group.place) : "No place yet"}</p>
                  <p className="text-xs text-faint">
                    {group.rows.length} {group.rows.length === 1 ? "photo" : "photos"}
                  </p>
                </div>
                <PlacePick
                  place={group.place}
                  empty=""
                  label={group.place ? "Change" : "Pick a place"}
                  marks={marks}
                  onPick={(place) => group.rows.filter((row) => !row.added).forEach((row) => onPick(row, place))}
                  className="h-9 shrink-0 rounded-lg border border-line px-3 text-xs"
                />
                {group.place && open.length ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onAddMany(open)}
                    className="h-9 shrink-0 rounded-lg border border-ink bg-elevated px-3 text-xs disabled:text-faint"
                  >
                    Add {open.length}
                  </button>
                ) : null}
              </div>
              <ul className="mt-2 grid grid-cols-3 gap-2">
                {drawn.map((row) => (
                  <ReviewTile key={row.key} row={row} busy={busy} marks={marks} onThumb={onThumb} onToggle={onToggle} onPick={onPick} />
                ))}
              </ul>
            </section>
          );
        })}
        {limit < rows.length ? (
          <div ref={end} className="py-6 text-center text-xs text-faint">
            Loading more…
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-2 border-t border-line px-3 pt-2 safe-bottom">
        <button
          type="button"
          disabled={busy || !remaining.length}
          onClick={() => onAddMany(remaining)}
          className="h-11 flex-1 rounded-lg border border-ink bg-elevated text-sm disabled:border-line disabled:text-faint"
        >
          {busy ? "Adding…" : remaining.length ? `Add all ${remaining.length}` : "All added"}
        </button>
        <button type="button" onClick={onClose} className="h-11 flex-1 rounded-lg border border-line text-sm">
          Done
        </button>
      </div>
    </div>
  );
}

export function PhotoFinder({
  marks,
  trip,
  onSaved,
  onRemoved,
  suggest,
  addPlace,
}: {
  marks: Place[];
  trip: RecordingTrip;
  onSaved: (rows: PhotoInfo[]) => void;
  onRemoved?: (id: string) => void;
  /** An atlas place, not yet added, where a photo was taken. */
  suggest?: (lat: number, lon: number) => Promise<Place | null>;
  addPlace?: (place: Place, takenAt: number | null) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [rows, setRows] = useState<Candidate[] | null>(null);
  const autoRan = useRef(false);
  const [reviewing, setReviewing] = useState(false);
  const suggestCache = useRef(new Map<string, Promise<Place | null>>());

  /** Phone only: read recent photos with their locations and offer the ones taken at places on the atlas. */
  async function scanPhone(quiet = false) {
    setBusy(true);
    if (!quiet) setNote(null);
    try {
      const [found, shapes] = await Promise.all([scanLibrary(), loadParkShapes().catch(() => null)]);
      const next: Candidate[] = [];
      let elsewhere = 0;
      for (const photo of found.photos) {
        const byPoint = matchPlace(photo.lat, photo.lon, marks);
        const park = shapes ? matchPark(photo.lat, photo.lon, marks, shapes) : null;
        let place = choosePhotoPlace(photo.lat, photo.lon, byPoint, park);
        let isNew = false;
        if (!place && suggest) {
          // Photos taken together share a lookup (about half a mile apart).
          const cell = `${photo.lat.toFixed(2)},${photo.lon.toFixed(2)}`;
          let pending = suggestCache.current.get(cell);
          if (!pending) {
            pending = suggest(photo.lat, photo.lon).catch(() => null);
            suggestCache.current.set(cell, pending);
          }
          place = await pending;
          isNew = Boolean(place);
        }
        if (!place) {
          elsewhere += 1;
          continue;
        }
        if (next.length >= 500) continue;
        next.push({
          key: photo.uri,
          uri: photo.uri,
          // Thumbnails load as rows scroll into view.
          thumb: "",
          image: "",
          lat: photo.lat,
          lon: photo.lon,
          takenAt: photo.takenAt || null,
          place,
          matched: true,
          isNew,
          added: false,
        });
      }
      const shown = next;
      if (quiet && !shown.length) return;
      setRows(shown.length ? shown : null);
      if (shown.length && !quiet) setReviewing(true);
      const parts = [
        shown.length
          ? `Found ${shown.length} ${shown.length === 1 ? "photo" : "photos"} taken at atlas places.${
              shown.some((row) => row.isNew) ? " Ones marked New add that place too." : ""
            }`
          : "No new photos from the last 90 days were taken at atlas places.",
        elsewhere ? `${elsewhere} ${elsewhere === 1 ? "was" : "were"} taken away from any atlas place.` : "",
        found.noLocation ? `${found.noLocation} had no location saved.` : "",
      ].filter(Boolean);
      setNote(`${parts.join(" ")}${shown.length ? " Nothing is saved until you add them." : ""}`);
    } catch (err) {
      if (!quiet) setNote(err instanceof Error ? err.message : "Couldn't read your photos.");
    } finally {
      setBusy(false);
    }
  }

  // Once the app may read photos, look for new ones each time the gallery opens (at most hourly).
  useEffect(() => {
    if (autoRan.current || !canScanLibrary() || !scanAllowed() || !marks.length) return;
    if (Date.now() - lastScanAt() < 3_600_000) return;
    autoRan.current = true;
    void scanPhone(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks.length]);

  async function scan(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    setNote(null);
    const shapes = await loadParkShapes().catch(() => null);
    const next: Candidate[] = [];
    let unreadable = 0;
    let noLocation = 0;
    for (const file of files.slice(0, 40)) {
      try {
        const read = await readPhotoFile(file);
        if (!read.gps) noLocation += 1;
        const byPoint = read.gps ? matchPlace(read.gps.lat, read.gps.lon, marks) : null;
        const park = read.gps && shapes ? matchPark(read.gps.lat, read.gps.lon, marks, shapes) : null;
        const place = read.gps ? choosePhotoPlace(read.gps.lat, read.gps.lon, byPoint, park) : null;
        next.push({
          key: `${file.name}-${file.size}-${next.length}`,
          thumb: read.thumb,
          image: read.image,
          lat: read.gps?.lat ?? null,
          lon: read.gps?.lon ?? null,
          takenAt: read.gps?.takenAt ?? (file.lastModified || null),
          place,
          matched: Boolean(place),
          added: false,
        });
      } catch {
        unreadable += 1;
      }
    }
    setRows(next);
    const matched = next.filter((row) => row.matched).length;
    const parts = [
      matched ? `${matched} ${matched === 1 ? "matches" : "match"} a place you've added.` : "",
      next.length - matched ? `Pick a place for the other ${next.length - matched}.` : "",
      noLocation && noLocation === next.length ? "Android may remove the location from photos it shares with apps." : "",
      unreadable ? `${unreadable} couldn't be read.` : "",
    ].filter(Boolean);
    setNote(next.length ? `${parts.join(" ")} Nothing is saved until you add them.` : "Those couldn't be read.");
    if (next.length) setReviewing(true);
    setBusy(false);
  }

  /** Save one candidate's photo (and its place, if new). */
  async function saveRow(row: Candidate): Promise<PhotoInfo> {
    const id = `ph-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const place = row.place!;
    const image = row.image || (row.uri ? await phonePhoto(row.uri, 720, 160000) : "");
    if (!image) throw new Error("Couldn't read a photo.");
    const thumb = row.thumb || (row.uri ? await phonePhoto(row.uri, 280, 80000) : "");
    if (row.isNew && addPlace && !marks.some((mark) => mark.id === place.id)) await addPlace(place, row.takenAt);
    const info: PhotoInfo = {
      id,
      poiId: place.id,
      tripId: tripFor(trip, place.id),
      caption: "",
      takenAt: row.takenAt,
      lat: place.lat ?? row.lat,
      lon: place.lon ?? row.lon,
      shared: false,
      thumb,
    };
    if (nativeApp) await saveLocalPhoto({ ...info, image, uploaded: false, uri: row.uri });
    else await savePhoto({ data: { ...info, image } });
    if (row.uri) rememberAdded([row.uri]);
    setRows((list) => list?.map((item) => (item.key === row.key ? { ...item, added: true, savedId: id } : item)) ?? list);
    return info;
  }

  async function addOne(row: Candidate) {
    if (!row.place || row.added) return;
    setBusy(true);
    try {
      const info = await saveRow(row);
      onSaved([info]);
      setNote(nativeApp ? "Added. It's on this phone until you upload it." : "Added.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't add that photo.");
    } finally {
      setBusy(false);
    }
  }

  /** Tapping "Added" again takes the photo back out. A place it added stays. */
  async function undoRow(row: Candidate) {
    if (!row.savedId) return;
    setBusy(true);
    try {
      if (nativeApp) await deleteLocalPhoto(row.savedId);
      await deletePhoto({ data: row.savedId }).catch(() => undefined);
      if (row.uri) forgetAdded(row.uri);
      setRows((list) => list?.map((item) => (item.key === row.key ? { ...item, added: false, savedId: undefined } : item)) ?? list);
      onRemoved?.(row.savedId);
      setNote("Taken back out.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't remove that photo.");
    } finally {
      setBusy(false);
    }
  }

  async function addMany(list: Candidate[]) {
    const chosen = list.filter((row) => row.place && !row.added);
    if (!chosen.length) {
      setNote("Pick a place for at least one photo.");
      return;
    }
    setBusy(true);
    const saved: PhotoInfo[] = [];
    for (const row of chosen) {
      try {
        saved.push(await saveRow(row));
      } catch (err) {
        setNote(err instanceof Error ? err.message : "Couldn't add a photo.");
        break;
      }
    }
    if (saved.length) onSaved(saved);
    if (saved.length) setNote(`Added ${saved.length} ${saved.length === 1 ? "photo" : "photos"}${nativeApp ? " to this phone" : ""}.`);
    setBusy(false);
  }

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          // Copy the list first: clearing the input empties the FileList it gave us.
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void scan(files);
        }}
      />
      {canScanLibrary() ? (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => void scanPhone()}
            className="h-11 w-full rounded-lg border border-ink bg-elevated text-sm disabled:border-line disabled:text-faint"
          >
            {busy ? "Looking through your photos…" : "Scan my camera roll"}
          </button>
          <p className="mt-2 text-xs text-muted">
            Looks at the last 90 days of photos and finds the ones taken at places on your atlas. Android asks once to let the
            app see your photos and where they were taken. Nothing is uploaded until you add it.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="mt-2 h-11 w-full rounded-lg border border-line text-sm text-muted disabled:text-faint"
          >
            Choose photos instead
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="h-11 w-full rounded-lg border border-ink bg-elevated text-sm disabled:border-line disabled:text-faint"
          >
            {busy ? "Reading photos…" : "Find photos of places you've been"}
          </button>
          <p className="mt-2 text-xs text-muted">
            Choose pictures from your camera roll. A picture with a location is matched to a place already on your atlas; for
            the rest, pick the place. Nothing is uploaded until you add it.
          </p>
        </>
      )}
      {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
      {rows?.length ? (
        <div className="mt-3 rounded-lg border border-line px-3 py-3">
          <p className="text-sm">
            {rows.filter((row) => row.added).length
              ? `${rows.filter((row) => row.added).length} of ${rows.length} photos added.`
              : `${rows.length} ${rows.length === 1 ? "photo" : "photos"} ready to review.`}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setReviewing(true)}
              className="h-11 flex-1 rounded-lg border border-ink bg-elevated text-sm"
            >
              Review photos
            </button>
            <button type="button" onClick={() => setRows(null)} className="h-11 flex-1 rounded-lg border border-line text-sm">
              {rows.some((row) => row.added) ? "Done" : "Not now"}
            </button>
          </div>
        </div>
      ) : null}
      {reviewing && rows?.length ? (
        <PhotoReview
          rows={rows}
          marks={marks}
          busy={busy}
          note={note}
          onClose={() => setReviewing(false)}
          onPick={(row, place) =>
            setRows((list) => list?.map((item) => (item.key === row.key ? { ...item, place, isNew: false } : item)) ?? list)
          }
          onThumb={(row, thumb) => setRows((list) => list?.map((item) => (item.key === row.key ? { ...item, thumb } : item)) ?? list)}
          onToggle={(row) => void (row.added ? undoRow(row) : addOne(row))}
          onAddMany={(list) => void addMany(list)}
        />
      ) : null}
    </div>
  );
}

export function PhotosPanel({
  photos,
  marks,
  trips,
  trip,
  onChange,
  suggest,
  addPlace,
}: {
  photos: PhotoInfo[];
  marks: Place[];
  trips: { id: string; name: string }[];
  trip: RecordingTrip;
  onChange: (photos: PhotoInfo[]) => void;
  suggest?: (lat: number, lon: number) => Promise<Place | null>;
  addPlace?: (place: Place, takenAt: number | null) => Promise<void>;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [group, setGroup] = useState<"place" | "trip" | "month">("place");
  const [open, setOpen] = useState<PhotoInfo | null>(null);
  const [full, setFull] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [local, setLocal] = useState<LocalPhoto[]>([]);
  const [menu, setMenu] = useState<PhotoInfo | null>(null);
  const names = new Map(marks.map((mark) => [mark.id, mark.name]));
  const tripNames = new Map(trips.map((trip) => [trip.id, trip.name]));

  useEffect(() => {
    if (!nativeApp) return;
    listLocalPhotos().then(setLocal).catch(() => setLocal([]));
  }, [photos.length]);

  const allPhotos = useMemo(() => {
    const byId = new Map(photos.map((p) => [p.id, p]));
    for (const lp of local) if (!byId.has(lp.id)) byId.set(lp.id, lp);
    return [...byId.values()];
  }, [photos, local]);

  useEffect(() => {
    if (!open) return;
    return pushBack(() => {
      setOpen(null);
      return true;
    });
  }, [open]);

  useEffect(() => {
    if (!menu) return;
    return pushBack(() => {
      setMenu(null);
      return true;
    });
  }, [menu]);

  async function openPhoto(photo: PhotoInfo) {
    setOpen(photo);
    setFull(null);
    setNote(null);
    setConfirmRemove(false);
    try {
      if (nativeApp) {
        const lp = local.find((p) => p.id === photo.id);
        if (lp) {
          setFull(lp.image);
          return;
        }
      }
      const row = await loadPhoto({ data: photo.id });
      setFull(row.image);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't open that photo.");
    }
  }

  function step(delta: number) {
    if (!open) return;
    const list = allPhotos;
    const idx = list.findIndex((p) => p.id === open.id);
    const next = list[(idx + delta + list.length) % list.length];
    if (next) void openPhoto(next);
  }

  async function uploadOne(photo: PhotoInfo) {
    const lp = local.find((p) => p.id === photo.id);
    if (!lp) return;
    try {
      await upload(lp);
      setLocal((prev) => prev.map((p) => (p.id === photo.id ? { ...p, uploaded: true } : p)));
      setNote("Uploaded.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't upload.");
    }
  }

  /** Send a phone-only photo to the account (needed before friends can see it). */
  async function upload(lp: LocalPhoto, shared = lp.shared) {
    await savePhoto({
      data: {
        id: lp.id,
        poiId: lp.poiId,
        tripId: lp.tripId,
        caption: lp.caption,
        takenAt: lp.takenAt,
        lat: lp.lat,
        lon: lp.lon,
        thumb: lp.thumb,
        image: lp.image,
      },
    });
    if (shared) await setPhotoShared({ data: { id: lp.id, shared: true } });
    await markUploaded(lp.id);
  }

  async function removeLocal(photo: PhotoInfo, fromServer = false) {
    if (fromServer) {
      // A phone-only photo isn't on the account; nothing to remove there.
      await deletePhoto({ data: photo.id }).catch(() => undefined);
    }
    await deleteLocalPhoto(photo.id);
    setLocal((prev) => prev.filter((p) => p.id !== photo.id));
    onChange(photos.filter((p) => p.id !== photo.id));
    setOpen(null);
    setMenu(null);
  }

  async function share(photo: PhotoInfo) {
    const shared = !photo.shared;
    const lp = local.find((p) => p.id === photo.id);
    onChange(photos.map((item) => (item.id === photo.id ? { ...item, shared } : item)));
    setLocal((prev) => prev.map((p) => (p.id === photo.id ? { ...p, shared } : p)));
    setOpen({ ...photo, shared });
    try {
      if (lp && !lp.uploaded && shared) {
        // Friends can only see photos on the account, so sharing uploads it.
        await upload(lp, true);
        setLocal((prev) => prev.map((p) => (p.id === photo.id ? { ...p, uploaded: true } : p)));
        setNote("Uploaded and shared with friends.");
      } else if (!lp || lp.uploaded) {
        await setPhotoShared({ data: { id: photo.id, shared } });
      }
      if (lp) await setLocalShared(photo.id, shared);
    } catch (err) {
      onChange(photos);
      setLocal((prev) => prev.map((p) => (p.id === photo.id ? { ...p, shared: !shared } : p)));
      setOpen({ ...photo, shared: !shared });
      setNote(err instanceof Error ? err.message : "Couldn't update sharing.");
    }
  }

  async function remove(photo: PhotoInfo) {
    onChange(photos.filter((item) => item.id !== photo.id));
    setOpen(null);
    try {
      if (local.some((p) => p.id === photo.id)) {
        await deleteLocalPhoto(photo.id);
        setLocal((prev) => prev.filter((p) => p.id !== photo.id));
      }
      await deletePhoto({ data: photo.id });
    } catch (err) {
      onChange(photos);
      setNote(err instanceof Error ? err.message : "Couldn't remove that photo.");
    }
  }

  const groups = new Map<string, PhotoInfo[]>();
  for (const photo of allPhotos) {
    const key =
      group === "trip"
        ? (photo.tripId && tripNames.get(photo.tripId)) || "Not on a trip"
        : group === "month"
          ? photo.takenAt
            ? new Date(photo.takenAt).toLocaleDateString(undefined, { month: "long", year: "numeric" })
            : "No date"
          : names.get(photo.poiId) || "Place";
    groups.set(key, [...(groups.get(key) ?? []), photo]);
  }

  if (open) {
    return (
      <div className="px-2 pb-4">
        <button type="button" onClick={() => setOpen(null)} className="h-11 px-2 text-sm text-muted">
          All photos
        </button>
        <div className="mt-1 flex items-center justify-between px-2">
          <button type="button" onClick={() => step(-1)} className="h-10 rounded-lg border border-line px-3 text-sm">Prev</button>
          <button type="button" onClick={() => step(1)} className="h-10 rounded-lg border border-line px-3 text-sm">Next</button>
        </div>
        {full ? (
          <img src={full} alt="" className="mt-1 max-h-[60dvh] w-full rounded-lg bg-bg object-contain" />
        ) : (
          <img src={open.thumb} alt="" className="mt-1 max-h-[60dvh] w-full rounded-lg bg-bg object-contain opacity-60 blur-sm" />
        )}
        <p className="mt-2 px-2 font-serif text-xl">{names.get(open.poiId) || "Place"}</p>
        <p className="px-2 text-xs text-muted">
          {open.takenAt ? new Date(open.takenAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "No date on the photo"}
          {open.tripId && tripNames.get(open.tripId) ? ` · ${tripNames.get(open.tripId)}` : ""}
        </p>
        {note ? <p className="mt-2 px-2 text-sm text-accent">{note}</p> : null}
        <button
          type="button"
          onClick={() => void share(open)}
          className={"mt-3 h-11 w-full rounded-lg border text-sm " + (open.shared ? "border-ink bg-elevated" : "border-line")}
        >
          {open.shared ? "Shared with friends" : "Share with friends"}
        </button>
        {nativeApp && local.some((p) => p.id === open.id && !p.uploaded) ? (
          <>
            <p className="mt-2 px-2 text-xs text-faint">Only on this phone. Upload it to keep it with your account.</p>
            <button type="button" onClick={() => void uploadOne(open)} className="mt-1 h-11 w-full rounded-lg border border-line text-sm">
              Upload to my account
            </button>
          </>
        ) : null}
        {confirmRemove ? (
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => void remove(open)} className="h-11 flex-1 rounded-lg border border-accent text-sm text-accent">
              Remove it
            </button>
            <button type="button" onClick={() => setConfirmRemove(false)} className="h-11 flex-1 rounded-lg border border-line text-sm">
              Keep it
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmRemove(true)} className="mt-2 h-11 w-full rounded-lg border border-line text-sm text-muted">
            Remove photo
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="px-2 pb-4">
      <h2 className="px-2 font-serif text-2xl">Photos</h2>
      <p className="mt-1 px-2 text-sm text-muted">Pictures stay with the place. Friends see one only after you share it.</p>
      <div className="mt-3 px-2">
        <PhotoFinder
          marks={marks}
          trip={trip}
          suggest={suggest}
          addPlace={addPlace}
          onSaved={(rows) => onChange([...rows, ...photos])}
          onRemoved={(id) => onChange(photos.filter((photo) => photo.id !== id))}
        />
      </div>
      <div className="mt-4 flex gap-2 px-2">
        {(["place", "trip", "month"] as const).map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={group === id}
            onClick={() => setGroup(id)}
            className={"h-10 flex-1 rounded-lg border text-xs capitalize " + (group === id ? "border-ink bg-elevated" : "border-line text-muted")}
          >
            {id}
          </button>
        ))}
      </div>
      {photos.length === 0 ? <p className="mt-4 px-2 text-sm text-muted">No photos yet.</p> : null}
      {menu ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-3 pb-6" onClick={() => setMenu(null)}>
          <div className="w-full max-w-sm rounded-card border border-line bg-surface p-3" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-medium">{names.get(menu.poiId) || "Photo"}</p>
            {nativeApp && local.some((p) => p.id === menu.id && !p.uploaded) ? (
              <button type="button" onClick={() => void uploadOne(menu)} className="mt-2 h-11 w-full rounded-lg border border-ink text-sm">Upload</button>
            ) : null}
            <button type="button" onClick={() => void removeLocal(menu, true)} className="mt-2 h-11 w-full rounded-lg border border-accent text-sm text-accent">Delete from atlas</button>
            <button type="button" onClick={() => setMenu(null)} className="mt-2 h-11 w-full rounded-lg border border-line text-sm">Cancel</button>
          </div>
        </div>
      ) : null}
      {[...groups.entries()].map(([label, items]) => (
        <section key={label} className="mt-4">
          <h3 className="px-2 font-serif text-lg">{label}</h3>
          <ul className="mt-2 grid grid-cols-3 gap-2 px-2">
            {items.map((photo) => {
              const lp = local.find((p) => p.id === photo.id);
              const uploaded = !nativeApp || lp?.uploaded !== false;
              return (
                <li key={photo.id}>
                  <button
                    type="button"
                    onClick={() => void openPhoto(photo)}
                    onContextMenu={(e) => { e.preventDefault(); setMenu(photo); }}
                    className="relative block w-full text-left"
                  >
                    <img src={photo.thumb} alt="" className="aspect-square w-full rounded-md object-cover" />
                    {nativeApp && !uploaded ? (
                      <span className="absolute right-1 top-1 rounded-full bg-black/60 px-1 text-[9px] text-white">local</span>
                    ) : null}
                    {photo.shared ? <span className="mt-1 block text-[10px] tracking-wide text-faint uppercase">Shared</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * One place's photos, full screen, opened from its card on the map. Back (or
 * Close) returns to the card.
 */
export function PhotoViewer({
  photos,
  startId,
  title,
  onClose,
}: {
  photos: PhotoInfo[];
  startId: string;
  title: string;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(() => Math.max(0, photos.findIndex((photo) => photo.id === startId)));
  const [full, setFull] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const photo = photos[index];

  useEffect(
    () =>
      pushBack(() => {
        onClose();
        return true;
      }),
    [onClose],
  );

  useEffect(() => {
    if (!photo) return;
    let live = true;
    setFull(null);
    setNote(null);
    void (async () => {
      try {
        const local = nativeApp ? await getLocalPhoto(photo.id) : null;
        const image = local?.image ?? (await loadPhoto({ data: photo.id })).image;
        if (live) setFull(image);
      } catch (err) {
        if (live) setNote(err instanceof Error ? err.message : "Couldn't open that photo.");
      }
    })();
    return () => {
      live = false;
    };
  }, [photo]);

  if (!photo) return null;
  const step = (delta: number) => setIndex((i) => (i + delta + photos.length) % photos.length);

  return (
    <div role="dialog" aria-label={`Photos of ${title}`} className="fixed inset-0 z-50 flex flex-col bg-bg screen-top">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <button type="button" onClick={onClose} className="h-11 px-2 text-sm text-muted">
          ‹ Back
        </button>
        <p className="min-w-0 flex-1 truncate text-right font-serif text-lg">{title}</p>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        <img
          src={full ?? photo.thumb}
          alt=""
          className={"max-h-full max-w-full rounded-lg object-contain " + (full ? "" : "opacity-60 blur-sm")}
        />
      </div>
      <div className="shrink-0 border-t border-line px-3 pt-2 safe-bottom">
        <p className="text-center text-xs text-muted">
          {photo.takenAt
            ? new Date(photo.takenAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
            : "No date"}
          {photos.length > 1 ? ` · ${index + 1} of ${photos.length}` : ""}
          {photo.shared ? " · Shared" : ""}
        </p>
        {note ? <p className="mt-1 text-center text-xs text-accent">{note}</p> : null}
        {photos.length > 1 ? (
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => step(-1)} className="h-11 flex-1 rounded-lg border border-line text-sm">
              Previous
            </button>
            <button type="button" onClick={() => step(1)} className="h-11 flex-1 rounded-lg border border-line text-sm">
              Next
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
