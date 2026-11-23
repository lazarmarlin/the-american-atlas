/**
 * A private copy of the fading ghost trail, kept 24 hours on the account.
 * Only stored when the setting is on. Friends never see this; live sharing is
 * separate (src/lib/live-share.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { PackedPoint } from "@/lib/ghost-sync";

const MAX_POINTS = 800;
const DAY_MS = 24 * 60 * 60 * 1000;

function parsePoints(value: unknown): PackedPoint[] {
  if (!Array.isArray(value)) throw new Error("Bad trail");
  const cutoff = Date.now() - DAY_MS;
  const rows = value.slice(-MAX_POINTS);
  const points: PackedPoint[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const lat = Number(row[0]);
    const lon = Number(row[1]);
    const t = Number(row[2]);
    if (![lat, lon, t].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || t < cutoff) continue;
    const point: PackedPoint = [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, Math.round(t)];
    points.push(Number(row[3]) === 1 ? [point[0], point[1], point[2], 1] : point);
  }
  return points;
}

async function keeping(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>, userId: string) {
  const rows = await sql<{ keep: boolean }>`
    select coalesce((settings->>'keepGhost')::boolean, false) as keep
    from profiles where user_id = ${userId}
  `;
  return rows[0]?.keep === true;
}

export const pushGhostCache = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parsePoints(input))
  .handler(async ({ context, data: points }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    if (!(await keeping(sql, context.userId)) || points.length < 2) {
      await sql`delete from ghost_cache where user_id = ${context.userId}`;
      return { ok: false as const };
    }
    await sql`
      insert into ghost_cache (user_id, points, updated_at)
      values (${context.userId}, ${JSON.stringify(points)}::jsonb, now())
      on conflict (user_id) do update set points = excluded.points, updated_at = now()
    `;
    return { ok: true as const };
  });

export const pullGhostCache = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<PackedPoint[]> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    if (!(await keeping(sql, context.userId))) return [];
    const rows = await sql<{ points: unknown }>`
      select points from ghost_cache
      where user_id = ${context.userId} and updated_at > now() - interval '24 hours'
    `;
    return parsePoints(rows[0]?.points ?? []);
  });

export const clearGhostCache = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`delete from ghost_cache where user_id = ${context.userId}`;
    return { ok: true as const };
  });
