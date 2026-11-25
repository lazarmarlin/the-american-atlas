/**
 * Month and year recap, and the friends leaderboard. Both are worked out on
 * the server from the same rules, so the numbers always agree:
 *
 * - A place is new in a period when its first visit falls in it. A visit's day
 *   is the date you gave it, else the place's saved date, else the day it was
 *   added (in your time zone).
 * - Points are the points each visit in the period earned (later visits to the
 *   same place are worth less; see src/lib/visits.ts).
 * - A state is new when the period holds your first place in it.
 * - Miles come from the daily drive log (src/lib/drive-log.ts), so they only
 *   count from when that log started.
 * - The longest trail is your longest saved ghost trail started in the period.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

type Sql = Awaited<ReturnType<typeof import("@/lib/db").getSql>>;

export type RecapRange = { from: string; to: string; tz: number };

export type Recap = {
  from: string;
  to: string;
  miles: number;
  driveDays: number;
  points: number;
  places: number;
  newStates: string[];
  counties: number;
  towns: number;
  longestTrail: { name: string; miles: number } | null;
};

export type LeaderRow = {
  id: string;
  name: string;
  photo: string;
  me: boolean;
  points: number;
  counties: number;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseRange(input: unknown): RecapRange {
  const row = (input ?? {}) as Record<string, unknown>;
  const from = String(row.from ?? "");
  const to = String(row.to ?? "");
  const tz = Number(row.tz ?? 0);
  if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) throw new Error("Bad dates");
  if (!Number.isFinite(tz) || Math.abs(tz) > 14 * 60) throw new Error("Bad time zone");
  return { from, to, tz: Math.round(tz) };
}

function toMs(value: unknown) {
  if (value instanceof Date) return value.getTime();
  const ms = typeof value === "number" ? value : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : 0;
}

/** Local day of a time, given the client's getTimezoneOffset() minutes. */
function localDay(ms: number, tz: number) {
  return new Date(ms - tz * 60_000).toISOString().slice(0, 10);
}

function dayText(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).slice(0, 10);
  return DAY_RE.test(text) ? text : null;
}

type PlaceStats = {
  points: number;
  places: number;
  newStates: string[];
  counties: number;
  towns: number;
};

async function placeStats(sql: Sql, userId: string, range: RecapRange): Promise<PlaceStats> {
  const rows = await sql<{
    poi_id: string;
    state: string;
    visits: string | null;
    visited_on: unknown;
    created_at: unknown;
  }>`
    select poi_id, state, visits, visited_on::text as visited_on, created_at
    from marks
    where user_id = ${userId}
  `;
  const { canonicalPlace } = await import("@/lib/catalog.server");
  const { pointsForVisit, readVisits } = await import("@/lib/visits");

  const out: PlaceStats = { points: 0, places: 0, newStates: [], counties: 0, towns: 0 };
  const statesBefore = new Set<string>();
  const statesDuring = new Set<string>();

  for (const row of rows) {
    // Only places in the atlas count, with the atlas's own points and category.
    const real = await canonicalPlace(row.poi_id, row.state);
    if (!real) continue;
    const added = localDay(toMs(row.created_at), range.tz);
    const saved = dayText(row.visited_on);
    const visits = readVisits(row.visits, { visitedOn: saved });
    const days = visits.map((visit) => visit.visitedOn ?? saved ?? added);
    const first = days.reduce((a, b) => (b < a ? b : a), days[0] ?? added);

    days.forEach((day, index) => {
      if (day >= range.from && day <= range.to) out.points += pointsForVisit(real.points, index);
    });

    const state = String(real.state || "").toUpperCase();
    if (first < range.from) {
      if (state) statesBefore.add(state);
    } else if (first <= range.to) {
      out.places += 1;
      if (real.category === "county") out.counties += 1;
      if (real.category === "town") out.towns += 1;
      if (state) statesDuring.add(state);
    }
  }
  out.newStates = [...statesDuring].filter((state) => !statesBefore.has(state)).sort();
  return out;
}

export const getRecap = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(parseRange)
  .handler(async ({ context, data: range }): Promise<Recap> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const places = await placeStats(sql, context.userId, range);

    const drive = await sql<{ miles: number | string | null; days: number | string | null }>`
      select sum(miles) as miles, count(distinct day) as days
      from drive_days
      where user_id = ${context.userId} and day >= ${range.from}::date and day <= ${range.to}::date
    `;

    const trails = await sql<{ name: string; started_at: unknown; points: unknown }>`
      select name, started_at, points from ghost_trails where user_id = ${context.userId}
    `;
    const { trailMiles } = await import("@/lib/ghost-trail");
    let longestTrail: Recap["longestTrail"] = null;
    for (const trail of trails) {
      const day = localDay(toMs(trail.started_at), range.tz);
      if (day < range.from || day > range.to) continue;
      const raw = typeof trail.points === "string" ? JSON.parse(trail.points) : trail.points;
      const packed = Array.isArray(raw) ? (raw as [number, number, number, number?][]) : [];
      const miles = trailMiles(
        packed.map((p) =>
          p[3] === 1
            ? { lat: p[0], lon: p[1], t: p[2], brk: true as const }
            : { lat: p[0], lon: p[1], t: p[2] },
        ),
      );
      if (!longestTrail || miles > longestTrail.miles) longestTrail = { name: trail.name, miles };
    }

    return {
      from: range.from,
      to: range.to,
      miles: Math.round((Number(drive[0]?.miles) || 0) * 10) / 10,
      driveDays: Number(drive[0]?.days) || 0,
      ...places,
      longestTrail,
    };
  });

/** You and your friends for a period, by points, then new counties. */
export const friendsLeaderboard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(parseRange)
  .handler(async ({ context, data: range }): Promise<LeaderRow[]> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const people = await sql<{ id: string; name: string; photo: string }>`
      select ids.id,
        coalesce(nullif(p.name, ''), nullif(u.name, ''), 'Friend') as name,
        coalesce(p.photo, '') as photo
      from (
        select ${context.userId}::text as id
        union
        select friend_id from friendships where user_id = ${context.userId}
      ) ids
      left join profiles p on p.user_id = ids.id
      left join "user" u on u.id = ids.id
    `;
    const rows: LeaderRow[] = [];
    for (const person of people.slice(0, 100)) {
      const stats = await placeStats(sql, person.id, range);
      const photo = person.photo ?? "";
      const okPhoto = photo.startsWith("https://") || photo.startsWith("data:image/");
      rows.push({
        id: person.id,
        name: person.name || "Friend",
        photo: okPhoto ? photo : "",
        me: person.id === context.userId,
        points: stats.points,
        counties: stats.counties,
      });
    }
    return rows.sort(
      (a, b) => b.points - a.points || b.counties - a.counties || Number(b.me) - Number(a.me),
    );
  });

// ---------------------------------------------------------------- client helpers

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export type RecapPeriod = "today" | "week" | "month" | "last-month" | "year";

/** The local date range for a period, plus a label like "November 2026". */
export function periodRange(period: RecapPeriod, now = new Date()): RecapRange & { label: string; title: string } {
  const tz = now.getTimezoneOffset();
  if (period === "today") {
    const day = ymd(now);
    const label = `Today · ${now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`;
    return { from: day, to: day, tz, label, title: "day" };
  }
  if (period === "week") {
    // Monday through Sunday, like the week streak.
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    const short = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const label = `This week · ${short(start)} – ${start.getMonth() === end.getMonth() ? end.getDate() : short(end)}`;
    return { from: ymd(start), to: ymd(end), tz, label, title: "week" };
  }
  if (period === "year") {
    const y = now.getFullYear();
    return { from: `${y}-01-01`, to: `${y}-12-31`, tz, label: String(y), title: String(y) };
  }
  const start = new Date(now.getFullYear(), now.getMonth() - (period === "last-month" ? 1 : 0), 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  const label = start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return { from: ymd(start), to: ymd(end), tz, label, title: label };
}
