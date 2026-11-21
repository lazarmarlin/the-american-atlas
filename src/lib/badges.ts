import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { badgeDefs } from "@/lib/badge-defs";
import { earnedFromVisits, readVisits, visitCount, type Visit } from "@/lib/visits";

export type BadgeView = {
  id: string;
  group: string;
  name: string;
  detail: string;
  have: number;
  total: number;
  earned: boolean;
};

type BadgeDef = {
  id: string;
  group: string;
  name: string;
  detail: string;
  metric: "match" | "places" | "points" | "states" | "roads";
  total: number;
  category?: string;
  state?: string;
  sys?: string;
  ref?: string;
  nameIs?: string;
  nameHas?: string;
  nameLacks?: string[];
  mainline?: boolean;
  minPoints?: number;
};

type Saved = {
  poi_id: string;
  name: string;
  category: string;
  state: string;
  points: number;
  earned: number;
  sys: string;
};

function norm(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function refOf(id: string) {
  return id.split(":")[3] ?? "";
}

function isMainline(id: string) {
  const parts = id.split(":");
  return parts.length >= 5 && parts.slice(4).join(":") === "";
}

function matches(mark: Saved, def: BadgeDef) {
  if (def.category && mark.category !== def.category) return false;
  if (def.state && mark.state !== def.state) return false;
  if (def.sys && mark.sys !== def.sys) return false;
  if (def.ref && refOf(mark.poi_id) !== def.ref) return false;
  if (def.mainline && !isMainline(mark.poi_id)) return false;
  if (def.minPoints && (Number(mark.points) || 0) < def.minPoints) return false;
  if (def.nameIs && norm(mark.name) !== def.nameIs) return false;
  const low = mark.name.toLowerCase();
  if (def.nameHas && !low.includes(def.nameHas)) return false;
  if (def.nameLacks?.some((word) => low.includes(word))) return false;
  return true;
}

function have(marks: Saved[], def: BadgeDef) {
  if (def.metric === "places") return marks.length;
  if (def.metric === "points") return marks.reduce((sum, mark) => sum + (Number(mark.earned) || 0), 0);
  if (def.metric === "states") return new Set(marks.map((mark) => mark.state).filter(Boolean)).size;
  if (def.metric === "roads") return marks.filter((mark) => mark.category === "route").length;
  return marks.filter((mark) => matches(mark, def)).length;
}

const catalog = badgeDefs as BadgeDef[];

export function badgeViewsFromMarks(
  rows: { id: string; name: string; category: string; state: string; points: number; sys: string; visits?: Visit[] }[],
): BadgeView[] {
  const marks: Saved[] = rows.map((row) => ({
    poi_id: row.id,
    name: row.name,
    category: row.category,
    state: row.state,
    points: row.points,
    earned: earnedFromVisits(row.points, visitCount(row.visits)),
    sys: row.sys,
  }));
  return catalog.map((def) => {
    const count = Math.min(def.total, have(marks, def));
    return {
      id: def.id,
      group: def.group,
      name: def.name,
      detail: def.detail,
      have: count,
      total: def.total,
      earned: count >= def.total,
    };
  });
}

export const listBadgeProgress = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const marks = await sql<{ poi_id: string; name: string; category: string; state: string; points: number; sys: string; visits: string | null }>`
      select poi_id, name, category, state, points, sys, visits
      from marks
      where user_id = ${context.userId}
    `;
    const { canonicalPlace } = await import("@/lib/catalog.server");
    const rows = await Promise.all(
      marks.map(async (row) => {
        // Badge progress uses the atlas's own record of each place, never the stored
        // copy; rows for places that aren't in the atlas don't count.
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
    );
    const views = badgeViewsFromMarks(rows.filter((row) => row !== null));
    const earnedIds = views.filter((badge) => badge.earned).map((badge) => badge.id);
    const existing = await sql<{ badge_id: string }>`
      select badge_id from earned_badges where user_id = ${context.userId}
    `;
    const had = new Set(existing.map((row) => row.badge_id));
    const now = new Set(earnedIds);
    for (const id of earnedIds) {
      if (had.has(id)) continue;
      await sql`
        insert into earned_badges (user_id, badge_id)
        values (${context.userId}, ${id})
        on conflict (user_id, badge_id) do nothing
      `;
    }
    for (const id of had) {
      if (now.has(id)) continue;
      await sql`delete from earned_badges where user_id = ${context.userId} and badge_id = ${id}`;
    }
    return views;
  });
