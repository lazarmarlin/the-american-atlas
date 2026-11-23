/**
 * Photos belong to a place you have added. They stay private until you share
 * one. Friends then see it on your page and as a thumbnail on the map.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

export type PhotoInfo = {
  id: string;
  poiId: string;
  tripId: string;
  caption: string;
  takenAt: number | null;
  lat: number | null;
  lon: number | null;
  shared: boolean;
  thumb: string;
};

export type FriendPhotoPin = PhotoInfo & { friendId: string; friendName: string };

const ID_RE = /^ph-[a-z0-9]{6,24}$/;
const PLACE_RE = /^[\w:._ -]{1,140}$/;
const JPEG = /^data:image\/jpeg;base64,/;
const MAX_PHOTOS = 80;

function cleanId(value: unknown) {
  const id = String(value ?? "").trim();
  if (!ID_RE.test(id)) throw new Error("Unknown photo");
  return id;
}

function cleanPlace(value: unknown) {
  const id = String(value ?? "").trim();
  if (!PLACE_RE.test(id)) throw new Error("Unknown place");
  return id;
}

function jpeg(value: unknown, max: number, label: string) {
  const text = String(value ?? "");
  if (!JPEG.test(text) || text.length > max) throw new Error(label);
  return text;
}

function parseSave(input: unknown) {
  if (!input || typeof input !== "object") throw new Error("Missing photo");
  const row = input as Record<string, unknown>;
  const takenRaw = row.takenAt;
  const latRaw = row.lat;
  const lonRaw = row.lon;
  const taken = takenRaw == null || takenRaw === "" ? NaN : Number(takenRaw);
  const lat = latRaw == null || latRaw === "" ? NaN : Number(latRaw);
  const lon = lonRaw == null || lonRaw === "" ? NaN : Number(lonRaw);
  const trip = String(row.tripId ?? "").trim();
  return {
    id: cleanId(row.id),
    poiId: cleanPlace(row.poiId),
    tripId: trip && PLACE_RE.test(trip) ? trip : "",
    caption: String(row.caption ?? "").trim().slice(0, 80),
    takenAt: Number.isFinite(taken) && taken > 0 ? Math.round(taken) : null,
    lat: Number.isFinite(lat) && Math.abs(lat) <= 90 ? lat : null,
    lon: Number.isFinite(lon) && Math.abs(lon) <= 180 ? lon : null,
    thumb: jpeg(row.thumb, 40000, "That thumbnail is too large"),
    image: jpeg(row.image, 160000, "Use a smaller photo"),
  };
}

function asInfo(row: {
  id: string;
  poi_id: string;
  trip_id: string | null;
  caption: string;
  taken_at: number | null;
  lat: number | null;
  lon: number | null;
  shared: boolean;
  thumb: string;
}): PhotoInfo {
  return {
    id: row.id,
    poiId: row.poi_id,
    tripId: row.trip_id || "",
    caption: row.caption || "",
    takenAt: row.taken_at == null ? null : Number(row.taken_at),
    lat: row.lat == null ? null : Number(row.lat),
    lon: row.lon == null ? null : Number(row.lon),
    shared: row.shared === true,
    thumb: row.thumb,
  };
}

export const listPhotos = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<PhotoInfo[]> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      poi_id: string;
      trip_id: string | null;
      caption: string;
      taken_at: number | null;
      lat: number | null;
      lon: number | null;
      shared: boolean;
      thumb: string;
    }>`
      select id, poi_id, trip_id, caption, taken_at, lat, lon, shared, thumb
      from photos where user_id = ${context.userId}
      order by coalesce(taken_at, 0) desc, created_at desc
    `;
    return rows.map(asInfo);
  });

export const savePhoto = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseSave(input))
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const count = await sql<{ n: number }>`select count(*)::int as n from photos where user_id = ${context.userId}`;
    const existing = await sql<{ id: string }>`select id from photos where user_id = ${context.userId} and id = ${data.id}`;
    if (!existing.length && Number(count[0]?.n ?? 0) >= MAX_PHOTOS) {
      throw new Error(`The gallery holds ${MAX_PHOTOS} photos. Remove one to add another.`);
    }
    await sql`
      insert into photos (user_id, id, poi_id, trip_id, caption, taken_at, lat, lon, shared, thumb, image)
      values (
        ${context.userId}, ${data.id}, ${data.poiId}, ${data.tripId || null}, ${data.caption},
        ${data.takenAt}, ${data.lat}, ${data.lon}, false, ${data.thumb}, ${data.image}
      )
      on conflict (user_id, id) do update set
        caption = excluded.caption,
        trip_id = excluded.trip_id
    `;
    return { id: data.id };
  });

export const setPhotoShared = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Missing photo");
    const row = input as Record<string, unknown>;
    return { id: cleanId(row.id), shared: row.shared === true };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`update photos set shared = ${data.shared} where user_id = ${context.userId} and id = ${data.id}`;
    return data;
  });

export const deletePhoto = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => cleanId(typeof input === "string" ? input : (input as { id?: unknown } | null)?.id))
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`delete from photos where user_id = ${context.userId} and id = ${data}`;
    return { id: data };
  });

export const loadPhoto = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => cleanId(typeof input === "string" ? input : (input as { id?: unknown } | null)?.id))
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ image: string }>`select image from photos where user_id = ${context.userId} and id = ${data}`;
    if (!rows[0]) throw new Error("Unknown photo");
    return { image: rows[0].image };
  });

export const friendPhotos = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => cleanPlace((input as { id?: unknown } | null)?.id))
  .handler(async ({ context, data: friendId }): Promise<PhotoInfo[]> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const ok = await sql<{ ok: boolean }>`
      select true as ok from friendships where user_id = ${context.userId} and friend_id = ${friendId}
    `;
    if (!ok[0]?.ok) throw new Error("Add them as a friend first.");
    const rows = await sql<{
      id: string;
      poi_id: string;
      trip_id: string | null;
      caption: string;
      taken_at: number | null;
      lat: number | null;
      lon: number | null;
      shared: boolean;
      thumb: string;
    }>`
      select id, poi_id, trip_id, caption, taken_at, lat, lon, shared, thumb
      from photos where user_id = ${friendId} and shared = true
      order by coalesce(taken_at, 0) desc
    `;
    return rows.map(asInfo);
  });

/** The larger image of a photo a friend shared. */
export const loadFriendPhoto = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = (input ?? {}) as Record<string, unknown>;
    return { friendId: cleanPlace(row.friendId), id: cleanId(row.id) };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ image: string }>`
      select p.image from photos p
      join friendships f on f.friend_id = p.user_id and f.user_id = ${context.userId}
      where p.user_id = ${data.friendId} and p.id = ${data.id} and p.shared = true
    `;
    if (!rows[0]) throw new Error("That photo isn't shared.");
    return { image: rows[0].image };
  });

export const friendPhotoPins = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<FriendPhotoPin[]> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      poi_id: string;
      trip_id: string | null;
      caption: string;
      taken_at: number | null;
      lat: number | null;
      lon: number | null;
      shared: boolean;
      thumb: string;
      friend_id: string;
      friend_name: string;
    }>`
      select p.id, p.poi_id, p.trip_id, p.caption, p.taken_at, p.lat, p.lon, p.shared, p.thumb,
        p.user_id as friend_id,
        coalesce(nullif(pr.name, ''), nullif(u.name, ''), 'Friend') as friend_name
      from photos p
      join friendships f on f.friend_id = p.user_id and f.user_id = ${context.userId}
      left join profiles pr on pr.user_id = p.user_id
      left join "user" u on u.id = p.user_id
      where p.shared = true and p.lat is not null and p.lon is not null
      order by p.created_at desc
      limit 60
    `;
    return rows.map((row) => ({ ...asInfo(row), friendId: row.friend_id, friendName: row.friend_name || "Friend" }));
  });
