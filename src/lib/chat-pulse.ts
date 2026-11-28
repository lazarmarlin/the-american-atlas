/**
 * What makes a chat feel alive: who else has it open right now (their map
 * avatar peeks in the corner, with dots while they type), and streaks, the
 * run of days in a row that you and a friend have both sent each other
 * something.
 *
 * The open chat checks in every few seconds. Separate from listThread on
 * purpose, so a phone and a server on different versions still get along.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { namesFor, openThread, parseThread, readKey } from "@/lib/messages";
import { DEFAULT_MARKER_COLOR, DEFAULT_MARKER_ICON, isMarkerColor, isMarkerIcon } from "@/lib/you-marker";

export type ChatPresent = { id: string; name: string; icon: string; color: string; typing: boolean };

export type Streak = {
  /** Days in a row you've both sent something, through today or yesterday. */
  days: number;
  /** Who has sent something today. */
  today: { me: boolean; them: boolean };
  /** When the streak runs out (end of today) if today isn't done yet; else null. */
  endsAt: number | null;
};

export type ChatPulse = { here: ChatPresent[]; streak: Streak | null };

/** A streak shows from this many days. */
export const STREAK_SHOWS = 2;
/** The hourglass shows when there's this little time left to keep it. */
export const STREAK_HURRY_MS = 4 * 60 * 60 * 1000;

/** Someone counts as in the chat if they checked in this recently. */
const HERE_SECONDS = 12;
const TYPING_SECONDS = 6;

function cleanZone(value: unknown) {
  const zone = String(value ?? "");
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(zone)) return "America/New_York";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "America/New_York";
  }
}

const dayFormats = new Map<string, Intl.DateTimeFormat>();
/** "2026-11-27" in that time zone. */
function dayIn(ms: number, zone: string) {
  let format = dayFormats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormats.set(zone, format);
  }
  return format.format(ms);
}

function dayBefore(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** Milliseconds left in today, in that time zone. */
function leftToday(now: number, zone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return Math.max(0, 24 * 3600 * 1000 - ((get("hour") * 60 + get("minute")) * 60 + get("second")) * 1000);
}

type Hour = { hour: number; mine: boolean; theirs: boolean };

/** Messages are counted by the hour (US time zones are whole hours off), then by local day. */
export function streakFrom(hours: Hour[], zone: string, now = Date.now()): Streak {
  const mine = new Set<string>();
  const theirs = new Set<string>();
  for (const row of hours) {
    const day = dayIn(row.hour, zone);
    if (row.mine) mine.add(day);
    if (row.theirs) theirs.add(day);
  }
  const today = dayIn(now, zone);
  const both = (day: string) => mine.has(day) && theirs.has(day);
  const done = both(today);
  let day = done ? today : dayBefore(today);
  let days = 0;
  while (both(day)) {
    days += 1;
    day = dayBefore(day);
  }
  return { days, today: { me: mine.has(today), them: theirs.has(today) }, endsAt: days > 0 && !done ? now + leftToday(now, zone) : null };
}

type Sql = Awaited<ReturnType<typeof openThread>>;

async function pairHours(sql: Sql, me: string, friend: string, days: number) {
  const rows = await sql<{ hour: number; mine: boolean; theirs: boolean }>`
    select (extract(epoch from date_trunc('hour', created_at)) * 1000)::float8 as hour,
      bool_or(from_id = ${me}) as mine,
      bool_or(from_id = ${friend}) as theirs
    from messages
    where ((from_id = ${me} and to_id = ${friend}) or (from_id = ${friend} and to_id = ${me}))
      and created_at > now() - make_interval(days => ${days})
    group by 1
  `;
  return rows.map((row) => ({ hour: Number(row.hour), mine: Boolean(row.mine), theirs: Boolean(row.theirs) }));
}

/** A first look covers this many days; a streak that reaches back that far gets the full look. */
const FIRST_LOOK = 120;
const FULL_LOOK = 2000;

async function streakBetween(sql: Sql, me: string, friend: string, zone: string) {
  let streak = streakFrom(await pairHours(sql, me, friend, FIRST_LOOK), zone);
  if (streak.days >= FIRST_LOOK - 2) streak = streakFrom(await pairHours(sql, me, friend, FULL_LOOK), zone);
  return streak;
}

/** The open chat checks in: you're here (and typing, or gone), and who else is. */
export const chatPulse = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = (input ?? {}) as Record<string, unknown>;
    return { thread: parseThread(row.thread), typing: row.typing === true, gone: row.gone === true, zone: cleanZone(row.zone) };
  })
  .handler(async ({ context, data }): Promise<ChatPulse> => {
    const me = context.userId;
    const sql = await openThread(me, data.thread);
    const key = readKey(data.thread);
    if (data.gone) {
      await sql`delete from chat_presence where user_id = ${me} and thread = ${key}`;
      return { here: [], streak: null };
    }
    await sql`
      insert into chat_presence (user_id, thread, seen_at, typing_at)
      values (${me}, ${key}, now(), case when ${data.typing} then now() else null end)
      on conflict (user_id, thread) do update set seen_at = now(), typing_at = excluded.typing_at
    `;
    const present =
      data.thread.kind === "friend"
        ? await sql<{ user_id: string; typing: boolean }>`
            select user_id, coalesce(typing_at > now() - make_interval(secs => ${TYPING_SECONDS}), false) as typing
            from chat_presence
            where user_id = ${data.thread.id} and thread = ${me} and seen_at > now() - make_interval(secs => ${HERE_SECONDS})
          `
        : await sql<{ user_id: string; typing: boolean }>`
            select p.user_id, coalesce(p.typing_at > now() - make_interval(secs => ${TYPING_SECONDS}), false) as typing
            from chat_presence p
            join chat_group_members m on m.group_id = ${data.thread.id} and m.user_id = p.user_id
            where p.thread = ${key} and p.user_id <> ${me} and p.seen_at > now() - make_interval(secs => ${HERE_SECONDS})
            order by p.seen_at desc
            limit 6
          `;
    const ids = present.map((row) => row.user_id);
    const looks = ids.length
      ? await sql<{ user_id: string; marker_icon: string | null; marker_color: string | null }>`
          select user_id, marker_icon, marker_color from profiles where user_id = any(${ids}::text[])
        `
      : [];
    const names = ids.length ? await namesFor(sql, ids) : new Map<string, string>();
    const here = present.map((row) => {
      const look = looks.find((item) => item.user_id === row.user_id);
      return {
        id: row.user_id,
        name: names.get(row.user_id) ?? "Friend",
        icon: isMarkerIcon(look?.marker_icon) ? look.marker_icon : DEFAULT_MARKER_ICON,
        color: isMarkerColor(look?.marker_color) ? look.marker_color.toLowerCase() : DEFAULT_MARKER_COLOR,
        typing: Boolean(row.typing),
      };
    });
    const streak = data.thread.kind === "friend" ? await streakBetween(sql, me, data.thread.id, data.zone) : null;
    return { here, streak };
  });

/** Streaks with every friend, for the list of chats. Only the ones that show. */
export const myStreaks = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ zone: cleanZone((input as Record<string, unknown> | null)?.zone) }))
  .handler(async ({ context, data }): Promise<Record<string, Streak>> => {
    const me = context.userId;
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ other: string; hour: number; mine: boolean; theirs: boolean }>`
      select case when m.from_id = ${me} then m.to_id else m.from_id end as other,
        (extract(epoch from date_trunc('hour', m.created_at)) * 1000)::float8 as hour,
        bool_or(m.from_id = ${me}) as mine,
        bool_or(m.from_id <> ${me}) as theirs
      from messages m
      join friendships f on f.user_id = ${me} and f.friend_id = case when m.from_id = ${me} then m.to_id else m.from_id end
      where (m.from_id = ${me} or m.to_id = ${me})
        and m.created_at > now() - make_interval(days => ${FIRST_LOOK})
      group by 1, 2
    `;
    const byFriend = new Map<string, Hour[]>();
    for (const row of rows) {
      const list = byFriend.get(row.other) ?? [];
      list.push({ hour: Number(row.hour), mine: Boolean(row.mine), theirs: Boolean(row.theirs) });
      byFriend.set(row.other, list);
    }
    const out: Record<string, Streak> = {};
    for (const [friend, hours] of byFriend) {
      let streak = streakFrom(hours, data.zone);
      if (streak.days >= FIRST_LOOK - 2) streak = streakFrom(await pairHours(sql, me, friend, FULL_LOOK), data.zone);
      if (streak.days >= STREAK_SHOWS) out[friend] = streak;
    }
    return out;
  });

export type FriendFace = { id: string; name: string; icon: string; color: string; lastAt: number | null };

/** Your friends' map avatars for the row of faces on the map: whoever you've talked to most recently first. */
export const friendFaces = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<FriendFace[]> => {
    const me = context.userId;
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ id: string; name: string; icon: string | null; color: string | null; last_at: number | null }>`
      select f.friend_id as id,
        coalesce(nullif(p.name, ''), nullif(u.name, ''), 'Friend') as name,
        p.marker_icon as icon,
        p.marker_color as color,
        (
          select (extract(epoch from max(m.created_at)) * 1000)::float8 from messages m
          where (m.from_id = ${me} and m.to_id = f.friend_id) or (m.from_id = f.friend_id and m.to_id = ${me})
        ) as last_at
      from friendships f
      left join profiles p on p.user_id = f.friend_id
      left join "user" u on u.id = f.friend_id
      where f.user_id = ${me}
      order by last_at desc nulls last, 2
      limit 40
    `;
    return rows.map((row) => ({
      id: row.id,
      name: row.name || "Friend",
      icon: isMarkerIcon(row.icon) ? row.icon : DEFAULT_MARKER_ICON,
      color: isMarkerColor(row.color) ? row.color.toLowerCase() : DEFAULT_MARKER_COLOR,
      lastAt: row.last_at == null ? null : Number(row.last_at),
    }));
  });

/** Your time zone, for counting days the way you live them. */
export function myZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}
