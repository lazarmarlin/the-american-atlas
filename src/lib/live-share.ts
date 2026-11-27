/**
 * A live ghost trail shared with at most three friends. Only those friends can
 * read it, and only while tracking is on.
 *
 * Friends see it live while it's being updated (the last 3 minutes), and
 * after that as "last seen", for a day. Looking at someone (pingLive) wakes
 * their phone for a fresh location, and while anyone is looking their phone
 * posts every fix; when nobody is, it only posts now and then (saves battery).
 */
import { create } from "zustand";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { PackedPoint } from "@/lib/ghost-sync";

export const MAX_LIVE_FRIENDS = 3;
export const LIVE_STALE_MS = 3 * 60 * 1000;
/** How long a friend's last location stays on your map after it stops updating. */
export const LAST_SEEN_HOURS = 24;
const MAX_POINTS = 600;
const USER_RE = /^[A-Za-z0-9_-]{1,64}$/;

function parseIds(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Pick friends from the list.");
  const ids = [...new Set(value.map((id) => String(id)))];
  if (ids.length > MAX_LIVE_FRIENDS) throw new Error(`You can share the live trail with ${MAX_LIVE_FRIENDS} friends.`);
  for (const id of ids) {
    if (!USER_RE.test(id)) throw new Error("Unknown friend");
  }
  return ids;
}

function parsePoints(value: unknown): PackedPoint[] {
  if (!Array.isArray(value) || value.length < 1) throw new Error("The live trail is too short.");
  const rows = value.slice(-MAX_POINTS);
  return rows.map((row) => {
    if (!Array.isArray(row)) throw new Error("Bad trail point");
    const lat = Number(row[0]);
    const lon = Number(row[1]);
    const t = Number(row[2]);
    if (![lat, lon, t].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || t <= 0) {
      throw new Error("Bad trail point");
    }
    const point: PackedPoint = [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, Math.round(t)];
    return Number(row[3]) === 1 ? [point[0], point[1], point[2], 1] : point;
  });
}

export const liveViewers = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ friend_id: string }>`
      select friend_id from live_viewers where user_id = ${context.userId} order by created_at
    `;
    return { ids: rows.map((row) => row.friend_id).slice(0, MAX_LIVE_FRIENDS) };
  });

export const setLiveViewers = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseIds(input))
  .handler(async ({ context, data: ids }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    if (ids.length) {
      const a = ids[0]!;
      const b = ids[1] ?? a;
      const c = ids[2] ?? a;
      const friends = await sql<{ friend_id: string }>`
        select friend_id from friendships
        where user_id = ${context.userId} and friend_id in (${a}, ${b}, ${c})
      `;
      if (new Set(friends.map((row) => row.friend_id)).size !== ids.length) {
        throw new Error("You can only share this with a friend.");
      }
    }
    await sql`delete from live_viewers where user_id = ${context.userId}`;
    for (const id of ids) {
      await sql`insert into live_viewers (user_id, friend_id) values (${context.userId}, ${id}) on conflict do nothing`;
    }
    if (!ids.length) await sql`delete from live_trails where user_id = ${context.userId}`;
    return { ids };
  });

const DEVICE_RE = /^[a-z0-9]{8,40}$/;

function parseDevice(value: unknown) {
  const id = String(value ?? "");
  return DEVICE_RE.test(id) ? id : "";
}

export const pushLiveTrail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    // Older app builds send the points alone.
    if (Array.isArray(input)) return { points: parsePoints(input), deviceId: "" };
    const row = (input ?? {}) as Record<string, unknown>;
    return { points: parsePoints(row.points), deviceId: parseDevice(row.deviceId) };
  })
  .handler(async ({ context, data: { points, deviceId } }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const viewers = await sql<{ ok: boolean }>`select true as ok from live_viewers where user_id = ${context.userId} limit 1`;
    if (!viewers[0]?.ok) {
      await sql`delete from live_trails where user_id = ${context.userId}`;
      return { ok: false as const };
    }
    await sql`
      insert into live_trails (user_id, points, device_id, updated_at)
      values (${context.userId}, ${JSON.stringify(points)}::jsonb, ${deviceId}, now())
      on conflict (user_id) do update set points = excluded.points, device_id = excluded.device_id, updated_at = now()
    `;
    // Whether anyone is looking right now: the app sends every few seconds then, and only now and then otherwise.
    return { ok: true as const, watching: await isWatched(sql, context.userId) };
  });

/**
 * Stop showing the live trail. With a device id, only if that device sent it
 * last, so stopping tracking on one phone doesn't blank another still moving.
 */
export const clearLiveTrail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ deviceId: parseDevice((input as { deviceId?: unknown } | null)?.deviceId) }))
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    if (data.deviceId) {
      await sql`delete from live_trails where user_id = ${context.userId} and device_id in (${data.deviceId}, '')`;
    } else {
      await sql`delete from live_trails where user_id = ${context.userId}`;
    }
    return { ok: true as const };
  });

type Sql = Awaited<ReturnType<typeof import("@/lib/db").getSql>>;

/** Somebody is looking at this person's location (pinged in the last couple of minutes). */
export async function isWatched(sql: Sql, userId: string) {
  try {
    const rows = await sql<{ ok: boolean }>`select true as ok from live_watch where user_id = ${userId} and watched_until > now()`;
    return Boolean(rows[0]?.ok);
  } catch {
    // Before the migration: as before, as if somebody were.
    return true;
  }
}

export type LiveFriend = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  icon: string;
  color: string;
  /** When their location last came in (ms). */
  seenAt: number;
  /** Updated in the last few minutes; otherwise it's where they were last seen. */
  live: boolean;
};

export const incomingLive = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<LiveFriend[]> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ id: string; name: string; icon: string | null; color: string | null; lat: number; lon: number; seen_at: number; live: boolean }>`
      select v.user_id as id,
        (extract(epoch from t.updated_at) * 1000)::float8 as seen_at,
        (t.updated_at > now() - interval '3 minutes') as live,
        coalesce(nullif(p.name, ''), nullif(u.name, ''), 'Friend') as name,
        p.marker_icon as icon,
        p.marker_color as color,
        (t.points->-1->>0)::float8 as lat,
        (t.points->-1->>1)::float8 as lon
      from live_viewers v
      join live_trails t on t.user_id = v.user_id
      left join profiles p on p.user_id = v.user_id
      left join "user" u on u.id = v.user_id
      where v.friend_id = ${context.userId}
        and t.updated_at > now() - interval '24 hours'
      order by t.updated_at desc
    `;
    return rows
      .filter((row) => Number.isFinite(Number(row.lat)) && Number.isFinite(Number(row.lon)))
      .map((row) => ({
        id: row.id,
        name: row.name || "Friend",
        lat: Number(row.lat),
        lon: Number(row.lon),
        icon: row.icon || "dot",
        color: (row.color || "#3d8fd4").toLowerCase(),
        seenAt: Math.round(Number(row.seen_at)) || 0,
        live: Boolean(row.live),
      }));
  });

export const pullLiveTrail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const id = String(typeof input === "string" ? input : (input as { id?: unknown } | null)?.id ?? "");
    if (!USER_RE.test(id)) throw new Error("Unknown friend");
    return id;
  })
  .handler(async ({ context, data: friendId }): Promise<PackedPoint[]> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ points: unknown }>`
      select t.points from live_trails t
      join live_viewers v on v.user_id = t.user_id and v.friend_id = ${context.userId}
      where t.user_id = ${friendId}
        and t.updated_at > now() - interval '24 hours'
    `;
    if (!rows[0]) return [];
    const raw = rows[0].points;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? (parsed as PackedPoint[]) : [];
  });

/**
 * You're looking at a friend who shares their location with you (their page,
 * their marker, or the map zoomed in on them). Called again each minute while
 * you keep looking. Their phone posts every fix for the next couple of
 * minutes, and if what the server has is over a minute old it's woken for a
 * fresh one (a push, at most once a minute whoever is asking).
 */
export const pingLive = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const id = String((input as { id?: unknown } | null)?.id ?? "");
    if (!USER_RE.test(id)) throw new Error("Unknown friend");
    return { id };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const shared = await sql<{ ok: boolean }>`select true as ok from live_viewers where user_id = ${data.id} and friend_id = ${context.userId}`;
    if (!shared[0]?.ok) throw new Error("They aren't sharing their location with you.");
    await sql`
      insert into live_watch (user_id, watched_until) values (${data.id}, now() + interval '150 seconds')
      on conflict (user_id) do update set watched_until = greatest(live_watch.watched_until, excluded.watched_until)
    `;
    const trail = await sql<{ fresh: boolean }>`select (updated_at > now() - interval '60 seconds') as fresh from live_trails where user_id = ${data.id}`;
    if (trail[0]?.fresh) return { woke: false };
    // Claimed in one step, so two friends looking at once send one push.
    const claimed = await sql<{ ok: boolean }>`
      update live_watch set pinged_at = now()
      where user_id = ${data.id} and (pinged_at is null or pinged_at < now() - interval '60 seconds')
      returning true as ok
    `;
    if (!claimed[0]?.ok) return { woke: false };
    const { locateUsers } = await import("@/lib/push.server");
    await locateUsers([data.id]);
    return { woke: true };
  });

/** "last seen 12 min ago" */
export function seenAgo(seenAt: number, now = Date.now()) {
  const min = Math.max(0, Math.round((now - seenAt) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  return `${hours} hr ago`;
}

type LiveState = {
  viewers: string[];
  /** The account's picks have been read (until then `viewers` is just empty). */
  loaded: boolean;
  load: () => Promise<void>;
  toggle: (id: string) => Promise<void>;
  /** Share with exactly these friends (the first few, up to the limit). */
  setAll: (ids: string[]) => Promise<string[]>;
};

export const useLiveShare = create<LiveState>((set, get) => ({
  viewers: [],
  loaded: false,
  load: async () => {
    const row = await liveViewers();
    set({ viewers: row.ids, loaded: true });
  },
  toggle: async (id) => {
    const current = get().viewers;
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    if (next.length > MAX_LIVE_FRIENDS) throw new Error(`You can share the live trail with ${MAX_LIVE_FRIENDS} friends.`);
    const saved = await setLiveViewers({ data: next });
    set({ viewers: saved.ids });
  },
  setAll: async (ids) => {
    const next = [...new Set(ids)].slice(0, MAX_LIVE_FRIENDS);
    const saved = await setLiveViewers({ data: next });
    set({ viewers: saved.ids });
    return saved.ids;
  },
}));
