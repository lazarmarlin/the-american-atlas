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
};

function cleanId(value: unknown) {
  const id = String(value ?? "").trim();
  if (!/^[A-Za-z0-9:._ -]{1,140}$/.test(id)) throw new Error("That trip can't be saved");
  return id;
}

export function ensureStops(trip: { id: string; name: string; stops?: unknown }): Trip {
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
  return { id: trip.id, name: trip.name, stops };
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
    const trips = await sql<{ id: string; name: string }>`
      select id, name from trips where user_id = ${context.userId} order by created_at desc
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
      }),
    );
  });

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
