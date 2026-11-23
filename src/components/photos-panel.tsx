import { useEffect, useMemo, useRef, useState } from "react";
import { matchPlace, readPhotoFile, tripFor, type RecordingTrip } from "@/lib/photo-file";
import { loadParkShapes, matchPark, choosePhotoPlace } from "@/lib/park-photo";
import { deletePhoto, loadPhoto, savePhoto, setPhotoShared, type PhotoInfo } from "@/lib/photos";
import { canScanLibrary, lastScanAt, loadLibraryPhoto, rememberAdded, scanAllowed, scanLibrary } from "@/lib/photo-scan";

/** A phone photo as a JPEG data URL under `limit` characters, trying lower quality if needed. */
async function phonePhoto(uri: string, edge: number, limit: number) {
  for (const quality of [72, 58, 45]) {
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
}: {
  place: Place | null;
  empty: string;
  marks: Place[];
  onPick: (place: Place) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
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
        className="block h-9 w-full truncate rounded-md border border-line bg-bg px-2 text-left text-sm text-ink"
      >
        {place ? placeLabel(place) : empty}
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
  keep: boolean;
};

export function PhotoFinder({
  marks,
  trip,
  onSaved,
  suggest,
  addPlace,
}: {
  marks: Place[];
  trip: RecordingTrip;
  onSaved: (rows: PhotoInfo[]) => void;
  /** An atlas place, not yet added, where a photo was taken. */
  suggest?: (lat: number, lon: number) => Promise<Place | null>;
  addPlace?: (place: Place, takenAt: number | null) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [rows, setRows] = useState<Candidate[] | null>(null);
  const autoRan = useRef(false);

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
        if (!place && suggest && next.length < 40) {
          place = await suggest(photo.lat, photo.lon).catch(() => null);
          isNew = Boolean(place);
        }
        if (!place) {
          elsewhere += 1;
          continue;
        }
        if (next.length >= 40) continue;
        next.push({
          key: photo.uri,
          uri: photo.uri,
          thumb: await phonePhoto(photo.uri, 96, 40000).catch(() => ""),
          image: "",
          lat: photo.lat,
          lon: photo.lon,
          takenAt: photo.takenAt || null,
          place,
          matched: true,
          isNew,
          keep: true,
        });
      }
      const shown = next.filter((row) => row.thumb);
      if (quiet && !shown.length) return;
      setRows(shown.length ? shown : null);
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

  async function scan(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setNote(null);
    const shapes = await loadParkShapes().catch(() => null);
    const next: Candidate[] = [];
    let unreadable = 0;
    let noLocation = 0;
    for (const file of Array.from(files).slice(0, 40)) {
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
          keep: Boolean(place),
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
    setBusy(false);
  }

  async function keep() {
    const chosen = (rows ?? []).filter((row) => row.keep && row.place);
    if (!chosen.length) {
      setNote("Pick a place for at least one photo.");
      return;
    }
    setBusy(true);
    const saved: PhotoInfo[] = [];
    for (const row of chosen) {
      const id = `ph-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const place = row.place!;
      try {
        const image = row.image || (row.uri ? await phonePhoto(row.uri, 720, 160000) : "");
        if (!image) throw new Error("Couldn't read a photo.");
        if (row.isNew && addPlace && !marks.some((mark) => mark.id === place.id)) await addPlace(place, row.takenAt);
        await savePhoto({
          data: {
            id,
            poiId: place.id,
            tripId: tripFor(trip, place.id),
            caption: "",
            takenAt: row.takenAt,
            lat: place.lat ?? row.lat,
            lon: place.lon ?? row.lon,
            thumb: row.thumb,
            image,
          },
        });
        if (row.uri) rememberAdded([row.uri]);
        saved.push({
          id,
          poiId: place.id,
          tripId: tripFor(trip, place.id),
          caption: "",
          takenAt: row.takenAt,
          lat: place.lat ?? row.lat,
          lon: place.lon ?? row.lon,
          shared: false,
          thumb: row.thumb,
        });
      } catch (err) {
        setNote(err instanceof Error ? err.message : "Couldn't save a photo.");
        break;
      }
    }
    if (saved.length) onSaved(saved);
    setRows(null);
    setNote(saved.length ? `Added ${saved.length} ${saved.length === 1 ? "photo" : "photos"}.` : note);
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
          void scan(event.target.files);
          event.target.value = "";
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
        <div className="mt-3">
          <ul className="grid gap-2">
            {rows.map((row) => (
              <li key={row.key} className="flex items-center gap-2 rounded-lg border border-line px-2 py-2">
                <img src={row.thumb} alt="" className="size-12 shrink-0 rounded-md object-cover" />
                <span className="min-w-0 flex-1">
                  {row.isNew ? <span className="block text-xs tracking-widest text-accent uppercase">New place</span> : null}
                  <PlacePick
                    place={row.place}
                    empty={row.lat == null ? "No location. Pick a place" : "Nothing close. Pick a place"}
                    marks={marks}
                    onPick={(place) => {
                      setRows(
                        (list) => list?.map((item) => (item.key === row.key ? { ...item, place, isNew: false, keep: true } : item)) ?? list,
                      );
                    }}
                  />
                  <span className="mt-0.5 block text-xs text-faint">
                    {row.takenAt
                      ? new Date(row.takenAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                      : "No date"}
                  </span>
                </span>
                <button
                  type="button"
                  aria-pressed={row.keep}
                  disabled={!row.place}
                  onClick={() => setRows((list) => list?.map((item) => (item.key === row.key ? { ...item, keep: !item.keep } : item)) ?? list)}
                  className={"h-11 shrink-0 rounded-lg border px-3 text-xs disabled:text-faint " + (row.keep ? "border-ink bg-elevated" : "border-line")}
                >
                  {row.place && row.keep ? "Keep" : "Skip"}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy || !rows.some((row) => row.keep && row.place)}
              onClick={() => void keep()}
              className="h-11 flex-1 rounded-lg border border-ink bg-elevated text-sm disabled:border-line disabled:text-faint"
            >
              {busy ? "Adding…" : `Add ${rows.filter((row) => row.keep && row.place).length || ""} ${rows.filter((row) => row.keep && row.place).length === 1 ? "photo" : "photos"}`.replace("  ", " ")}
            </button>
            <button type="button" onClick={() => setRows(null)} className="h-11 flex-1 rounded-lg border border-line text-sm">
              Cancel
            </button>
          </div>
        </div>
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
  const names = new Map(marks.map((mark) => [mark.id, mark.name]));
  const tripNames = new Map(trips.map((trip) => [trip.id, trip.name]));

  async function openPhoto(photo: PhotoInfo) {
    setOpen(photo);
    setFull(null);
    setNote(null);
    setConfirmRemove(false);
    try {
      const row = await loadPhoto({ data: photo.id });
      setFull(row.image);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't open that photo.");
    }
  }

  async function share(photo: PhotoInfo) {
    const shared = !photo.shared;
    onChange(photos.map((item) => (item.id === photo.id ? { ...item, shared } : item)));
    setOpen({ ...photo, shared });
    try {
      await setPhotoShared({ data: { id: photo.id, shared } });
    } catch (err) {
      onChange(photos);
      setNote(err instanceof Error ? err.message : "Couldn't update sharing.");
    }
  }

  async function remove(photo: PhotoInfo) {
    onChange(photos.filter((item) => item.id !== photo.id));
    setOpen(null);
    try {
      await deletePhoto({ data: photo.id });
    } catch (err) {
      onChange(photos);
      setNote(err instanceof Error ? err.message : "Couldn't remove that photo.");
    }
  }

  const groups = new Map<string, PhotoInfo[]>();
  for (const photo of photos) {
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
      {[...groups.entries()].map(([label, items]) => (
        <section key={label} className="mt-4">
          <h3 className="px-2 font-serif text-lg">{label}</h3>
          <ul className="mt-2 grid grid-cols-3 gap-2 px-2">
            {items.map((photo) => (
              <li key={photo.id}>
                <button type="button" onClick={() => void openPhoto(photo)} className="block w-full text-left">
                  <img src={photo.thumb} alt="" className="aspect-square w-full rounded-md object-cover" />
                  {photo.shared ? <span className="mt-1 block text-[10px] tracking-wide text-faint uppercase">Shared</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
