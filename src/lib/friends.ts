/**
 * Friends. Each account has one link (`/?friend=CODE`). Opening it while
 * signed in adds both people. A friend can see earned badges and the saved
 * ghost trails the owner chose to share. A live trail is separate: the owner
 * can show it to at most three friends while tracking (src/lib/live-share.ts).
 * Shared saved trails lose their first and last half kilometer (so
 * they don't point at a home or hotel) and their times are cut to the day.
 * Resetting the link stops new people adding you; existing friends stay.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { PackedPoint } from "@/lib/ghost-sync";

export type FriendRow = {
  id: string;
  name: string;
  photo: string;
  trails: number;
};

export type FriendBadge = {
  id: string;
  group: string;
  name: string;
  detail: string;
};

export type FriendTrailInfo = {
  id: string;
  name: string;
  startedAt: number;
  savedAt: number;
  miles: number;
};

export type FriendPage = {
  id: string;
  name: string;
  photo: string;
  badges: FriendBadge[];
  trails: FriendTrailInfo[];
  /** Their latest check-ins, newest first (for a thumbs-up). */
  recent: { target: string; name: string; category: string; state: string; points: number; visitedOn: string }[];
  /** Every place on their map, to compare with yours ("you've both been to…"). */
  places: { id: string; name: string; category: string; state: string; lat: number | null; lon: number | null }[];
};

const CODE_RE = /^[a-z0-9]{8}$/;
const USER_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TRAIL_RE = /^g-[a-z0-9]{1,20}$/;
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function parseCode(value: unknown) {
  const code = String(value ?? "").trim().toLowerCase();
  if (!CODE_RE.test(code)) throw new Error("That friend link isn't valid.");
  return code;
}

function parseUserId(value: unknown) {
  const id = String(value ?? "");
  if (!USER_RE.test(id)) throw new Error("Unknown friend");
  return id;
}

function parseTrailId(value: unknown) {
  const id = String(value ?? "");
  if (!TRAIL_RE.test(id)) throw new Error("Unknown trail");
  return id;
}

function makeCode() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

function toMs(value: unknown) {
  const t = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(t) ? t : Date.now();
}

function asPoints(value: unknown): PackedPoint[] {
  const rows = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(rows) ? (rows as PackedPoint[]) : [];
}

/** Meters trimmed off each end of a trail before a friend sees it. */
const TRIM_METERS = 500;
const DAY_MS = 86_400_000;

function metersBetween(a: PackedPoint, b: PackedPoint) {
  const k = Math.cos((((a[0] + b[0]) / 2) * Math.PI) / 180);
  return Math.hypot((b[1] - a[1]) * 111_320 * k, (b[0] - a[0]) * 110_540);
}

/** The day a time falls on (UTC midnight + 1 ms), so friends never see exact times. */
const toDay = (t: number) => Math.floor(t / DAY_MS) * DAY_MS + 1;

/**
 * What a friend gets: the trail minus its first and last TRIM_METERS along
 * the path, with every time set to the trail's day. Empty if nothing is left.
 */
function forFriends(points: PackedPoint[], savedAt: number): PackedPoint[] {
  if (points.length < 2) return [];
  const along: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    // A new-line marker means a jump in the recording, not distance travelled.
    const hop = points[i]![3] === 1 ? 0 : metersBetween(points[i - 1]!, points[i]!);
    along.push(along[i - 1]! + hop);
  }
  const total = along[along.length - 1]!;
  if (total <= TRIM_METERS * 2) return [];
  const day = toDay(savedAt);
  const kept = points.filter((_, i) => along[i]! >= TRIM_METERS && along[i]! <= total - TRIM_METERS);
  return kept.map((p, i) => (p[3] === 1 && i > 0 ? [p[0], p[1], day, 1] : [p[0], p[1], day]));
}

type NameRow = { id: string; name: string; photo: string };

async function friendName(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>, userId: string): Promise<NameRow> {
  const rows = await sql<NameRow>`
    select ${userId} as id,
      coalesce(nullif(p.name, ''), nullif(u.name, ''), 'Friend') as name,
      coalesce(p.photo, '') as photo
    from (select 1) _
    left join profiles p on p.user_id = ${userId}
    left join "user" u on u.id = ${userId}
  `;
  const row = rows[0];
  const photo = row?.photo ?? "";
  const ok = photo.startsWith("https://") || photo.startsWith("data:image/");
  return { id: userId, name: row?.name || "Friend", photo: ok ? photo : "" };
}

async function assertFriend(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>, me: string, friendId: string) {
  const rows = await sql<{ ok: boolean }>`
    select true as ok from friendships where user_id = ${me} and friend_id = ${friendId}
  `;
  if (!rows[0]?.ok) throw new Error("Add them as a friend first.");
}

export const myFriendCode = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const existing = await sql<{ code: string }>`select code from friend_links where user_id = ${context.userId}`;
    if (existing[0]?.code) return { code: existing[0].code };
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeCode();
      try {
        const inserted = await sql<{ code: string }>`
          insert into friend_links (user_id, code)
          values (${context.userId}, ${code})
          on conflict (user_id) do nothing
          returning code
        `;
        if (inserted[0]?.code) return { code: inserted[0].code };
        const again = await sql<{ code: string }>`select code from friend_links where user_id = ${context.userId}`;
        if (again[0]?.code) return { code: again[0].code };
      } catch {
        // The code collided. Try another.
      }
    }
    throw new Error("Couldn't make a friend link. Try again.");
  });

/** New link code; the old link stops working. Friends you already have stay. */
export const resetFriendCode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeCode();
      try {
        await sql`
          insert into friend_links (user_id, code) values (${context.userId}, ${code})
          on conflict (user_id) do update set code = excluded.code
        `;
        return { code };
      } catch {
        // The code collided with someone else's. Try another.
      }
    }
    throw new Error("Couldn't make a new link. Try again.");
  });

export const listFriends = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<FriendRow[]> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ id: string; name: string; photo: string }>`
      select f.friend_id as id,
        coalesce(nullif(p.name, ''), nullif(u.name, ''), 'Friend') as name,
        coalesce(p.photo, '') as photo
      from friendships f
      left join profiles p on p.user_id = f.friend_id
      left join "user" u on u.id = f.friend_id
      where f.user_id = ${context.userId}
      order by 2
    `;
    // Count only trails a friend can actually open (some are too short once trimmed).
    const shared = rows.length
      ? await sql<{ user_id: string; points: unknown; saved_at: unknown }>`
          select g.user_id, g.points, g.saved_at from ghost_trails g
          join friendships f on f.friend_id = g.user_id and f.user_id = ${context.userId}
          where g.shared = true
        `
      : [];
    const usable = new Map<string, number>();
    for (const trail of shared) {
      if (forFriends(asPoints(trail.points), toMs(trail.saved_at)).length >= 2) {
        usable.set(trail.user_id, (usable.get(trail.user_id) ?? 0) + 1);
      }
    }
    return rows.map((row) => {
      const photo = row.photo ?? "";
      const ok = photo.startsWith("https://") || photo.startsWith("data:image/");
      return { id: row.id, name: row.name || "Friend", photo: ok ? photo : "", trails: usable.get(row.id) ?? 0 };
    });
  });

export const acceptFriend = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseCode(typeof input === "string" ? input : (input as { code?: unknown } | null)?.code))
  .handler(async ({ context, data: code }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const owner = await sql<{ user_id: string }>`select user_id from friend_links where code = ${code}`;
    const friendId = owner[0]?.user_id;
    if (!friendId) throw new Error("That friend link isn't valid.");
    if (friendId === context.userId) throw new Error("That's your own link.");
    const prior = await sql<{ ok: boolean }>`
      select true as ok from friendships where user_id = ${context.userId} and friend_id = ${friendId}
    `;
    await sql`
      insert into friendships (user_id, friend_id)
      values (${context.userId}, ${friendId}), (${friendId}, ${context.userId})
      on conflict do nothing
    `;
    const friend = await friendName(sql, friendId);
    return { ...friend, already: Boolean(prior[0]?.ok) };
  });

export const removeFriend = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseUserId(typeof input === "string" ? input : (input as { id?: unknown } | null)?.id))
  .handler(async ({ context, data: friendId }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`
      delete from friendships
      where (user_id = ${context.userId} and friend_id = ${friendId})
         or (user_id = ${friendId} and friend_id = ${context.userId})
    `;
    await sql`
      delete from live_viewers
      where (user_id = ${context.userId} and friend_id = ${friendId})
         or (user_id = ${friendId} and friend_id = ${context.userId})
    `;
    await sql`
      delete from photo_shares
      where (user_id = ${context.userId} and friend_id = ${friendId})
         or (user_id = ${friendId} and friend_id = ${context.userId})
    `;
    // The conversation goes too, and thumbs-up between you.
    await sql`
      delete from message_hidden where message_id in (
        select id from messages
        where (from_id = ${context.userId} and to_id = ${friendId}) or (from_id = ${friendId} and to_id = ${context.userId})
      )
    `;
    await sql`
      delete from messages
      where (from_id = ${context.userId} and to_id = ${friendId}) or (from_id = ${friendId} and to_id = ${context.userId})
    `;
    await sql`
      delete from message_reads
      where (user_id = ${context.userId} and thread = ${friendId}) or (user_id = ${friendId} and thread = ${context.userId})
    `;
    await sql`
      delete from reactions
      where (user_id = ${context.userId} and owner_id = ${friendId}) or (user_id = ${friendId} and owner_id = ${context.userId})
    `;
    await sql`
      delete from live_trails
      where user_id in (${context.userId}, ${friendId})
        and not exists (select 1 from live_viewers v where v.user_id = live_trails.user_id)
    `;
    return { ok: true as const };
  });

export const loadFriend = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseUserId((input as { id?: unknown } | null)?.id))
  .handler(async ({ context, data: friendId }): Promise<FriendPage> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await assertFriend(sql, context.userId, friendId);
    const friend = await friendName(sql, friendId);
    const { canonicalPlace } = await import("@/lib/catalog.server");
    const { readVisits } = await import("@/lib/visits");
    const { badgeViewsFromMarks } = await import("@/lib/badges");
    const { trailMiles } = await import("@/lib/ghost-trail");
    const marks = await sql<{
      poi_id: string;
      name: string;
      category: string;
      state: string;
      points: number;
      sys: string;
      visits: string | null;
      lat: number | null;
      lon: number | null;
    }>`
      select poi_id, name, category, state, points, sys, visits, lat, lon
      from marks where user_id = ${friendId}
    `;
    const rows = (
      await Promise.all(
        marks.map(async (row) => {
          const real = await canonicalPlace(row.poi_id, row.state);
          if (!real) return null;
          return {
            id: row.poi_id,
            name: real.name,
            category: real.category,
            state: real.state,
            points: real.points,
            sys: real.sys,
            visits: readVisits(row.visits),
            lat: row.lat,
            lon: row.lon,
          };
        }),
      )
    ).filter((row) => row !== null);
    const badges = badgeViewsFromMarks(rows)
      .filter((badge) => badge.earned)
      .map((badge) => ({ id: badge.id, group: badge.group, name: badge.name, detail: badge.detail }));
    const recent = rows
      .flatMap((row) =>
        row.visits
          .filter((visit) => visit.visitedOn)
          .map((visit) => ({
            target: `visit:${row.id}|${visit.id}`,
            name: row.name,
            category: row.category,
            state: row.state,
            points: row.points,
            visitedOn: visit.visitedOn as string,
          })),
      )
      .sort((a, b) => (a.visitedOn < b.visitedOn ? 1 : -1))
      .slice(0, 12);
    const trails = await sql<{ id: string; name: string; started_at: unknown; saved_at: unknown; points: unknown }>`
      select id, name, started_at, saved_at, points
      from ghost_trails
      where user_id = ${friendId} and shared = true
      order by saved_at desc
      limit 30
    `;
    return {
      ...friend,
      badges,
      recent,
      places: rows.map((row) => ({ id: row.id, name: row.name, category: row.category, state: row.state, lat: row.lat, lon: row.lon })),
      trails: trails
        .map((trail) => {
          const savedAt = toMs(trail.saved_at);
          const points = forFriends(asPoints(trail.points), savedAt).map((p) =>
            p[3] === 1 ? { lat: p[0], lon: p[1], t: p[2], brk: true as const } : { lat: p[0], lon: p[1], t: p[2] },
          );
          return {
            id: trail.id,
            name: trail.name,
            startedAt: toDay(toMs(trail.started_at)),
            savedAt: toDay(savedAt),
            miles: trailMiles(points),
            usable: points.length >= 2,
          };
        })
        .filter((trail) => trail.usable)
        .map(({ usable: _usable, ...trail }) => trail),
    };
  });

export const friendTrail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = (input ?? {}) as Record<string, unknown>;
    return { friendId: parseUserId(row.friendId), id: parseTrailId(row.id) };
  })
  .handler(async ({ context, data }): Promise<PackedPoint[]> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await assertFriend(sql, context.userId, data.friendId);
    const rows = await sql<{ points: unknown; saved_at: unknown }>`
      select points, saved_at from ghost_trails
      where user_id = ${data.friendId} and id = ${data.id} and shared = true
    `;
    if (!rows[0]) throw new Error("That trail isn't shared.");
    const points = forFriends(asPoints(rows[0].points), toMs(rows[0].saved_at));
    if (points.length < 2) throw new Error("That trail is too short to share.");
    return points;
  });
