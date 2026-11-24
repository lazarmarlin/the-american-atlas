import { listMarks, removeMark, saveMark, updateJournal, updateVisits, type Mark } from "@/lib/marks";
import { getProfile, saveMarker, saveProfile, type Profile } from "@/lib/profile";
import { deleteTrip, ensureStops, listTrips, orderTripStops, saveTrip, setTripStop, type Trip, type TripStop } from "@/lib/trips";
import { ensureVisits, type Visit } from "@/lib/visits";

export type VaultSnapshot = {
  marks: Mark[];
  trips: Trip[];
  profile: Profile;
  pending: number;
};

type Op =
  | { kind: "save-mark"; mark: Mark }
  | { kind: "remove-mark"; id: string }
  | { kind: "journal"; id: string; visitedOn: string | null; note: string; photo: string }
  | { kind: "visits"; id: string; visits: Visit[] }
  | { kind: "save-trip"; id: string; name: string }
  | { kind: "delete-trip"; id: string }
  | { kind: "order-stops"; tripId: string; stops: TripStop[] }
  | { kind: "trip-stop"; tripId: string; poiId: string; on: boolean; stopId?: string }
  | { kind: "profile"; name: string; photo: string; markerIcon?: string; markerColor?: string }
  | { kind: "marker"; markerIcon: string; markerColor: string };

const EMPTY: VaultSnapshot = { marks: [], trips: [], profile: { name: "", photo: "", markerIcon: "", markerColor: "" }, pending: 0 };

function asProfile(raw: Partial<Profile> | undefined): Profile {
  return {
    name: typeof raw?.name === "string" ? raw.name : "",
    photo: typeof raw?.photo === "string" ? raw.photo : "",
    markerIcon: typeof raw?.markerIcon === "string" ? raw.markerIcon : "",
    markerColor: typeof raw?.markerColor === "string" ? raw.markerColor : "",
  };
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("american-atlas", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(store).objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
      }),
  );
}

function idbPut(store: string, key: IDBValidKey, value: unknown) {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const req = db.transaction(store, "readwrite").objectStore(store).put(value, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      }),
  );
}

function idbAdd(value: Op) {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const req = db.transaction("outbox", "readwrite").objectStore("outbox").add(value);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      }),
  );
}

async function outboxEntries(): Promise<{ key: IDBValidKey; op: Op }[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction("outbox").objectStore("outbox").openCursor();
    const rows: { key: IDBValidKey; op: Op }[] = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(rows);
        return;
      }
      rows.push({ key: cursor.key, op: cursor.value as Op });
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

async function outboxDelete(key: IDBValidKey) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const req = db.transaction("outbox", "readwrite").objectStore("outbox").delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function pendingCount() {
  const rows = await outboxEntries();
  return rows.length;
}

export async function readVault(): Promise<VaultSnapshot> {
  if (typeof indexedDB === "undefined") return EMPTY;
  const [marks, trips, profile, pending] = await Promise.all([
    idbGet<Mark[]>("kv", "marks"),
    idbGet<Trip[]>("kv", "trips"),
    idbGet<Profile>("kv", "profile"),
    pendingCount(),
  ]);
  return {
    marks: (marks ?? []).map((mark) => ensureVisits(mark)),
    trips: (trips ?? []).map((trip) => ensureStops(trip)),
    profile: asProfile(profile),
    pending,
  };
}

async function writeSnapshot(marks: Mark[], trips: Trip[], profile: Profile) {
  await Promise.all([
    idbPut("kv", "marks", marks),
    idbPut("kv", "trips", trips),
    idbPut("kv", "profile", profile),
  ]);
}

/**
 * Changes to the device copy take turns. Two at once (a place and its trip
 * stop, or a place saved while the account copy was being downloaded) could
 * otherwise each read the old copy and the second write drop the first's change.
 */
let turn: Promise<unknown> = Promise.resolve();
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const run = turn.then(work, work);
  turn = run.catch(() => {});
  return run;
}

async function mutate(op: Op, apply: (snap: VaultSnapshot) => VaultSnapshot) {
  await inTurn(async () => {
    const current = await readVault();
    const next = apply(current);
    await writeSnapshot(next.marks, next.trips, next.profile);
    await idbAdd(op);
  });
  void flushVault();
}

export function vaultSaveMark(mark: Mark) {
  return mutate({ kind: "save-mark", mark }, (snap) => ({
    ...snap,
    marks: [mark, ...snap.marks.filter((item) => item.id !== mark.id)],
  }));
}

export function vaultRemoveMark(id: string) {
  return mutate({ kind: "remove-mark", id }, (snap) => ({
    ...snap,
    marks: snap.marks.filter((item) => item.id !== id),
    trips: snap.trips.map((trip) => ({ ...trip, stops: trip.stops.filter((stop) => stop.poiId !== id) })),
  }));
}

export function vaultJournal(id: string, visitedOn: string | null, note: string, photo: string) {
  return mutate({ kind: "journal", id, visitedOn, note, photo }, (snap) => ({
    ...snap,
    marks: snap.marks.map((item) => {
      if (item.id !== id) return item;
      const visits = item.visits.length ? item.visits.slice() : ensureVisits(item).visits;
      visits[0] = { ...visits[0], visitedOn, note, photo };
      const latest = visits[visits.length - 1];
      return { ...item, visits, visitedOn: latest?.visitedOn ?? null, note: latest?.note ?? "", photo: latest?.photo ?? "" };
    }),
  }));
}

export function vaultVisits(id: string, visits: Visit[]) {
  return mutate({ kind: "visits", id, visits }, (snap) => ({
    ...snap,
    marks: snap.marks.map((item) => {
      if (item.id !== id) return item;
      const latest = visits[visits.length - 1];
      return {
        ...item,
        visits,
        visitedOn: latest?.visitedOn ?? null,
        note: latest?.note ?? "",
        photo: latest?.photo ?? "",
      };
    }),
  }));
}

export async function vaultCreateTrip(name: string) {
  const id = `trip:${crypto.randomUUID()}`;
  await mutate({ kind: "save-trip", id, name }, (snap) => ({
    ...snap,
    trips: [{ id, name, stops: [] }, ...snap.trips.filter((trip) => trip.id !== id)],
  }));
  return { id, name };
}

export function vaultRenameTrip(id: string, name: string) {
  return mutate({ kind: "save-trip", id, name }, (snap) => ({
    ...snap,
    trips: snap.trips.map((trip) => (trip.id === id ? { ...trip, name } : trip)),
  }));
}

export function vaultDeleteTrip(id: string) {
  return mutate({ kind: "delete-trip", id }, (snap) => ({
    ...snap,
    trips: snap.trips.filter((trip) => trip.id !== id),
  }));
}

export function vaultOrderStops(tripId: string, stops: TripStop[]) {
  return mutate({ kind: "order-stops", tripId, stops }, (snap) => ({
    ...snap,
    trips: snap.trips.map((trip) => (trip.id === tripId ? { ...trip, stops } : trip)),
  }));
}

export function vaultTripStop(tripId: string, poiId: string, on: boolean) {
  const stopId = `stop:${crypto.randomUUID()}`;
  return mutate({ kind: "trip-stop", tripId, poiId, on, stopId }, (snap) => ({
    ...snap,
    trips: snap.trips.map((trip) => {
      if (trip.id !== tripId) return trip;
      const without = trip.stops.filter((stop) => stop.poiId !== poiId);
      if (!on) return { ...trip, stops: without };
      if (trip.stops.some((stop) => stop.poiId === poiId)) return trip;
      return { ...trip, stops: [...trip.stops, { id: stopId, poiId }] };
    }),
  }));
}

export function vaultSaveProfile(profile: Profile) {
  return mutate(
    {
      kind: "profile",
      name: profile.name,
      photo: profile.photo,
      markerIcon: profile.markerIcon,
      markerColor: profile.markerColor,
    },
    (snap) => ({ ...snap, profile }),
  );
}

export function vaultSaveMarker(markerIcon: string, markerColor: string) {
  return mutate({ kind: "marker", markerIcon, markerColor }, (snap) => ({
    ...snap,
    profile: { ...snap.profile, markerIcon, markerColor },
  }));
}

let flushing = false;
let flushAgain = false;

export async function flushVault() {
  if (flushing || typeof navigator === "undefined" || !navigator.onLine) {
    if (flushing) flushAgain = true;
    return false;
  }
  flushing = true;
  try {
    do {
      flushAgain = false;
      const rows = await outboxEntries();
      for (const row of rows) {
        await replay(row.op);
        await outboxDelete(row.key);
      }
    } while (flushAgain);
    return true;
  } catch {
    return false;
  } finally {
    flushing = false;
  }
}

async function replay(op: Op) {
  if (op.kind === "save-mark") await saveMark({ data: op.mark });
  else if (op.kind === "remove-mark") await removeMark({ data: op.id });
  else if (op.kind === "journal") await updateJournal({ data: op });
  else if (op.kind === "visits") await updateVisits({ data: { id: op.id, visits: op.visits } });
  else if (op.kind === "save-trip") await saveTrip({ data: { id: op.id, name: op.name } });
  else if (op.kind === "delete-trip") await deleteTrip({ data: op.id });
  else if (op.kind === "order-stops") await orderTripStops({ data: { tripId: op.tripId, stops: ensureStops({ id: op.tripId, name: "", stops: op.stops }).stops } });
  else if (op.kind === "trip-stop") await setTripStop({ data: op });
  else if (op.kind === "marker") await saveMarker({ data: { markerIcon: op.markerIcon, markerColor: op.markerColor } });
  else if (op.kind === "profile") {
    await saveProfile({
      data: { name: op.name, photo: op.photo, markerIcon: op.markerIcon, markerColor: op.markerColor },
    });
  }
}

/** Pull the account copy when the outbox is empty. Returns null if the device copy should stay. */
export async function refreshVault(): Promise<VaultSnapshot | null> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return null;
  const flushed = await flushVault();
  if (!flushed || (await pendingCount()) > 0) return null;
  const [marks, trips, profile] = await Promise.all([listMarks(), listTrips(), getProfile()]);
  const nextMarks = marks.map((mark) => ensureVisits(mark));
  const nextTrips = trips.map((trip) => ensureStops(trip));
  return inTurn(async () => {
    // Something was saved on the device while the account copy downloaded: the
    // download is already out of date, so keep the device copy (it syncs next).
    if ((await pendingCount()) > 0) return null;
    await writeSnapshot(nextMarks, nextTrips, profile);
    return { marks: nextMarks, trips: nextTrips, profile, pending: 0 };
  });
}
