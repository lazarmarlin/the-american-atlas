import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

export type TripStop = {
  id: string;
  poiId: string;
};

export type Trip = {
  id: string;
  name: string;
  stops: TripStop[];
  recording?: boolean;
  /** When it first started recording and when it last stopped (ms), for the recap. */
  startedAt?: number | null;
  endedAt?: number | null;
  /** The trip chat it's shared in, if any. */
  groupId?: string | null;
};

function cleanId(value: unknown) {
  const id = String(value ?? "").trim();
  if (!/^[A-Za-z0-9:._ -]{1,140}$/.test(id)) throw new Error("That trip can't be saved");
  return id;
}

export function ensureStops(trip: {
  id: string;
  name: string;
  stops?: unknown;
  recording?: boolean;
  startedAt?: number | null;
  endedAt?: number | null;
  groupId?: string | null;
}): Trip {
  const raw = Array.isArray(trip.stops) ? trip.stops : [];
  const stops: TripStop[] = [];
  const seen = new Set<string>();
  raw.forEach((item, index) => {
    if (typeof item === "string") {
      if (!item || seen.has(item)) return;
      seen.add(item);
      stops.push({ id: item, poiId: item });
      return;
    }
    if (!item || typeof item !== "object") return;
    const row = item as { id?: unknown; poiId?: unknown };
    const poiId = String(row.poiId ?? "").trim();
    if (!poiId) return;
    const id = String(row.id ?? "").trim() || `${poiId}#${index}`;
    if (seen.has(id)) return;
    seen.add(id);
    stops.push({ id, poiId });
  });
  return {
    id: trip.id,
    name: trip.name,
    stops,
    recording: trip.recording === true,
    startedAt: trip.startedAt ?? null,
    endedAt: trip.endedAt ?? null,
    groupId: trip.groupId ?? null,
  };
}

function parseStops(value: unknown): TripStop[] {
  if (!Array.isArray(value)) throw new Error("Missing stops");
  return ensureStops({ id: "", name: "", stops: value.slice(0, 80) }).stops.map((stop) => ({
    id: cleanId(stop.id),
    poiId: cleanId(stop.poiId),
  }));
}

export const listTrips = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const trips = await sql<{ id: string; name: string; recording: boolean; started_at: unknown; ended_at: unknown; group_id: string | null }>`
      select id, name, recording, started_at, ended_at, group_id from trips where user_id = ${context.userId} order by created_at desc
    `;
    const stops = await sql<{ trip_id: string; stop_id: string; poi_id: string }>`
      select trip_id, stop_id, poi_id from trip_stops where user_id = ${context.userId} order by pos
    `;
    return trips.map((trip) =>
      ensureStops({
        id: trip.id,
        name: trip.name,
        stops: stops
          .filter((stop) => stop.trip_id === trip.id)
          .map((stop) => ({ id: stop.stop_id || stop.poi_id, poiId: stop.poi_id })),
        recording: trip.recording === true,
        startedAt: msOrNull(trip.started_at),
        endedAt: msOrNull(trip.ended_at),
        groupId: trip.group_id,
      }),
    );
  });

function msOrNull(value: unknown) {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export const saveTrip = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Missing trip");
    const row = input as Record<string, unknown>;
    const name = String(row.name ?? "").trim().slice(0, 80);
    if (!name) throw new Error("Name the trip");
    const id = row.id ? cleanId(row.id) : "";
    return { id, name };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const id = data.id || `trip:${crypto.randomUUID()}`;
    await sql`
      insert into trips (user_id, id, name)
      values (${context.userId}, ${id}, ${data.name})
      on conflict (user_id, id) do update set name = excluded.name
    `;
    return { id, name: data.name };
  });

export const deleteTrip = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: unknown) => cleanId(id))
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`delete from trip_stops where user_id = ${context.userId} and trip_id = ${data}`;
    await sql`delete from trip_tracks where user_id = ${context.userId} and trip_id = ${data}`;
    await sql`delete from trips where user_id = ${context.userId} and id = ${data}`;
    return data;
  });

export const setTripStop = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Missing stop");
    const row = input as Record<string, unknown>;
    return { tripId: cleanId(row.tripId), poiId: cleanId(row.poiId), on: Boolean(row.on), stopId: row.stopId ? cleanId(row.stopId) : "" };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    if (!data.on) {
      await sql`delete from trip_stops where user_id = ${context.userId} and trip_id = ${data.tripId} and poi_id = ${data.poiId}`;
      return data;
    }
    const existing = await sql<{ stop_id: string }>`
      select stop_id from trip_stops
      where user_id = ${context.userId} and trip_id = ${data.tripId} and poi_id = ${data.poiId}
      limit 1
    `;
    if (existing.length) return data;
    const rows = await sql<{ pos: number }>`
      select coalesce(max(pos), 0) as pos from trip_stops where user_id = ${context.userId} and trip_id = ${data.tripId}
    `;
    const pos = Number(rows[0]?.pos ?? 0) + 1;
    const stopId = data.stopId || `stop:${crypto.randomUUID()}`;
    await sql`
      insert into trip_stops (user_id, trip_id, poi_id, pos, stop_id)
      values (${context.userId}, ${data.tripId}, ${data.poiId}, ${pos}, ${stopId})
      on conflict (user_id, trip_id, stop_id) do nothing
    `;
    return data;
  });

export const orderTripStops = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Missing trip");
    const row = input as Record<string, unknown>;
    const tripId = cleanId(row.tripId);
    const stops = parseStops(row.stops);
    return { tripId, stops };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`delete from trip_stops where user_id = ${context.userId} and trip_id = ${data.tripId}`;
    for (let i = 0; i < data.stops.length; i += 1) {
      const stop = data.stops[i];
      if (!stop) continue;
      await sql`
        insert into trip_stops (user_id, trip_id, poi_id, pos, stop_id)
        values (${context.userId}, ${data.tripId}, ${stop.poiId}, ${i + 1}, ${stop.id})
      `;
    }
    return data;
  });

/** One trip records places as you travel. Turning one on turns the others off. */
export const setTripRecording = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Missing trip");
    const row = input as Record<string, unknown>;
    const groupId = row.groupId == null || row.groupId === "" ? null : cleanId(row.groupId);
    return { id: cleanId(row.id), on: row.on === true, groupId };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    if (data.groupId) {
      const member = await sql`select 1 from chat_group_members where group_id = ${data.groupId} and user_id = ${context.userId}`;
      if (!member.length) throw new Error("You're not in that chat.");
    }
    // A trip made a moment ago may still be on its way up from the phone's queue:
    // make its row now (the queued save fills in the name), so recording isn't lost.
    await sql`insert into trips (user_id, id, name) values (${context.userId}, ${data.id}, 'Trip') on conflict (user_id, id) do nothing`;
    if (data.on) {
      await sql`update trips set recording = false, ended_at = now() where user_id = ${context.userId} and id <> ${data.id} and recording`;
      await sql`
        update trips set recording = true, started_at = coalesce(started_at, now()), ended_at = null,
          group_id = coalesce(${data.groupId}, group_id)
        where user_id = ${context.userId} and id = ${data.id}
      `;
    } else {
      await sql`update trips set recording = false, ended_at = now() where user_id = ${context.userId} and id = ${data.id}`;
    }
    return data;
  });

/** A trip recap as sent in a chat (src/components/trip-recap.tsx). */
export type TripCard = {
  name: string;
  from: string | null;
  to: string | null;
  miles: number;
  places: number;
  fresh: number;
  states: string[];
  counties: number;
  points: number;
  /** The route, thinned, as [lon, lat] lines. */
  lines: [number, number][][];
  /** Stops: [lon, lat, 1 if new on this trip]. */
  dots: [number, number, number][];
};

// ---------------------------------------------------------------- the route

export type TrackPoint = [lon: number, lat: number, t: number];

/** Add a stretch of the route driven while a trip records. */
export const appendTripTrack = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = (input ?? {}) as Record<string, unknown>;
    const raw = Array.isArray(row.points) ? row.points.slice(0, 800) : [];
    const points: TrackPoint[] = [];
    for (const item of raw) {
      if (!Array.isArray(item)) continue;
      const [lon, lat, t] = item.map(Number);
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(t)) continue;
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || t < 1.5e12 || t > 1e13) continue;
      points.push([Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5, Math.round(t)]);
    }
    if (!points.length) throw new Error("No points");
    return { tripId: cleanId(row.tripId), points };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const trip = await sql`select 1 from trips where user_id = ${context.userId} and id = ${data.tripId}`;
    if (!trip.length) return { ok: false as const };
    await sql`insert into trip_tracks (user_id, trip_id, points) values (${context.userId}, ${data.tripId}, ${JSON.stringify(data.points)}::jsonb)`;
    return { ok: true as const };
  });

async function readTrack(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>, userId: string, tripId: string) {
  const rows = await sql<{ points: unknown }>`select points from trip_tracks where user_id = ${userId} and trip_id = ${tripId} order by seq`;
  const out: TrackPoint[] = [];
  for (const row of rows) {
    const list = typeof row.points === "string" ? (JSON.parse(row.points) as TrackPoint[]) : (row.points as TrackPoint[]);
    if (Array.isArray(list)) out.push(...list);
  }
  out.sort((a, b) => a[2] - b[2]);
  return out;
}

/** Your own trip's route, in time order. */
export const tripTrack = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: unknown) => cleanId(id))
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    return readTrack(await getSql(), context.userId, data);
  });

export type SharedTraveler = {
  userId: string;
  name: string;
  tripId: string;
  tripName: string;
  recording: boolean;
  startedAt: number | null;
  stops: string[];
  /** Where those places are, with their names: [lon, lat, name]. */
  spots: [number, number, string][];
  track: TrackPoint[];
};

/** Everyone's trip shared in a trip chat: their routes and the places they've picked up. */
export const sharedTrip = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: unknown) => cleanId(id))
  .handler(async ({ context, data }): Promise<SharedTraveler[]> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const member = await sql`select 1 from chat_group_members where group_id = ${data} and user_id = ${context.userId}`;
    if (!member.length) throw new Error("You're not in that chat.");
    const trips = await sql<{ user_id: string; id: string; name: string; recording: boolean; started_at: unknown; person: string }>`
      select t.user_id, t.id, t.name, t.recording, t.started_at,
        coalesce(nullif(p.name, ''), nullif(u.name, ''), 'Friend') as person
      from trips t
      join chat_group_members m on m.group_id = t.group_id and m.user_id = t.user_id
      left join profiles p on p.user_id = t.user_id
      left join "user" u on u.id = t.user_id
      where t.group_id = ${data}
      order by t.started_at nulls last
    `;
    const out: SharedTraveler[] = [];
    for (const trip of trips) {
      const stops = await sql<{ poi_id: string; lat: number | null; lon: number | null; name: string | null }>`
        select s.poi_id, m.lat, m.lon, m.name from trip_stops s
        left join marks m on m.user_id = s.user_id and m.poi_id = s.poi_id
        where s.user_id = ${trip.user_id} and s.trip_id = ${trip.id} order by s.pos
      `;
      out.push({
        userId: trip.user_id,
        name: trip.person,
        tripId: trip.id,
        tripName: trip.name,
        recording: trip.recording === true,
        startedAt: msOrNull(trip.started_at),
        stops: stops.map((row) => row.poi_id),
        spots: stops
          .filter((row) => row.lat != null && row.lon != null && !row.poi_id.startsWith("r:"))
          .map((row) => [Number(row.lon), Number(row.lat), row.name ?? ""] as [number, number, string]),
        track: await readTrack(sql, trip.user_id, trip.id),
      });
    }
    return out;
  });
