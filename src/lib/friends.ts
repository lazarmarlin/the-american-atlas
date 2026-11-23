/**
 * Friends. Each account has one link (`/?friend=CODE`). Opening it while
 * signed in adds both people. A friend can see earned badges and saved ghost
 * trails, never places, the live trail, or a trail the owner hid.
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

export const listFriends = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<FriendRow[]> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ id: string; name: string; photo: string; trails: number | string }>`
      select f.friend_id as id,
        coalesce(nullif(p.name, ''), nullif(u.name, ''), 'Friend') as name,
        coalesce(p.photo, '') as photo,
        (select count(*) from ghost_trails g where g.user_id = f.friend_id and g.hidden = false) as trails
      from friendships f
      left join profiles p on p.user_id = f.friend_id
      left join "user" u on u.id = f.friend_id
      where f.user_id = ${context.userId}
      order by 2
    `;
    return rows.map((row) => {
      const photo = row.photo ?? "";
      const ok = photo.startsWith("https://") || photo.startsWith("data:image/");
      return { id: row.id, name: row.name || "Friend", photo: ok ? photo : "", trails: Number(row.trails) || 0 };
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
    }>`
      select poi_id, name, category, state, points, sys, visits
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
          };
        }),
      )
    ).filter((row) => row !== null);
    const badges = badgeViewsFromMarks(rows)
      .filter((badge) => badge.earned)
      .map((badge) => ({ id: badge.id, group: badge.group, name: badge.name, detail: badge.detail }));
    const trails = await sql<{ id: string; name: string; started_at: unknown; saved_at: unknown; points: unknown }>`
      select id, name, started_at, saved_at, points
      from ghost_trails
      where user_id = ${friendId} and hidden = false
      order by saved_at desc
      limit 30
    `;
    return {
      ...friend,
      badges,
      trails: trails.map((trail) => {
        const points = asPoints(trail.points).map((p) =>
          p[3] === 1 ? { lat: p[0], lon: p[1], t: p[2], brk: true as const } : { lat: p[0], lon: p[1], t: p[2] },
        );
        return {
          id: trail.id,
          name: trail.name,
          startedAt: toMs(trail.started_at),
          savedAt: toMs(trail.saved_at),
          miles: trailMiles(points),
        };
      }),
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
    const rows = await sql<{ points: unknown }>`
      select points from ghost_trails
      where user_id = ${data.friendId} and id = ${data.id} and hidden = false
    `;
    if (!rows[0]) throw new Error("That trail isn't shared.");
    return asPoints(rows[0].points);
  });
