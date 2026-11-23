/**
 * Saved ghost trails, stored on the account so they follow the user to every
 * device. The live trail (the one still growing while tracking) is not synced.
 * Client-side merging and the offline queue live in src/lib/ghost-trail.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

/** Compact on the wire and in the table: [lat, lon, t] or [lat, lon, t, 1] where 1 starts a new line. */
export type PackedPoint = [number, number, number] | [number, number, number, 1];

export type SyncedTrail = {
  id: string;
  name: string;
  startedAt: number;
  savedAt: number;
  hidden: boolean;
  /** Visible to friends (see src/lib/friends.ts). Off unless the owner turns it on. */
  shared: boolean;
  points: PackedPoint[];
};

export const MAX_TRAILS = 30;
const MAX_POINTS = 6000;
const ID_RE = /^g-[a-z0-9]{1,20}$/;

function parseId(value: unknown) {
  const id = String(value ?? "");
  if (!ID_RE.test(id)) throw new Error("Unknown trail");
  return id;
}

function parsePoints(value: unknown): PackedPoint[] {
  if (!Array.isArray(value) || value.length < 2) throw new Error("That trail is too short to save");
  if (value.length > MAX_POINTS) throw new Error("That trail is too long to save");
  return value.map((row) => {
    if (!Array.isArray(row)) throw new Error("Bad trail point");
    const [lat, lon, t, brk] = row.map(Number);
    if (
      ![lat, lon, t].every(Number.isFinite) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180 ||
      t <= 0
    ) {
      throw new Error("Bad trail point");
    }
    const point: PackedPoint = [
      Math.round(lat * 1e5) / 1e5,
      Math.round(lon * 1e5) / 1e5,
      Math.round(t),
    ];
    return brk === 1 ? [point[0], point[1], point[2], 1] : point;
  });
}

const toMs = (value: unknown) => {
  const t = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(t) ? t : Date.now();
};

export const listGhostTrails = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<SyncedTrail[]> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      name: string;
      started_at: unknown;
      saved_at: unknown;
      hidden: boolean;
      shared: boolean;
      points: unknown;
    }>`
      select id, name, started_at, saved_at, hidden, shared, points from ghost_trails
      where user_id = ${context.userId}
      order by saved_at desc
      limit ${MAX_TRAILS}
    `;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      startedAt: toMs(row.started_at),
      savedAt: toMs(row.saved_at),
      hidden: Boolean(row.hidden),
      shared: Boolean(row.shared),
      points: (typeof row.points === "string"
        ? JSON.parse(row.points)
        : row.points) as PackedPoint[],
    }));
  });

export const saveGhostTrail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Missing trail");
    const row = input as Record<string, unknown>;
    const points = parsePoints(row.points);
    const startedAt = Number(row.startedAt);
    const savedAt = Number(row.savedAt);
    return {
      id: parseId(row.id),
      name:
        String(row.name ?? "")
          .trim()
          .slice(0, 40) || "Trail",
      startedAt: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : points[0]![2],
      savedAt: Number.isFinite(savedAt) && savedAt > 0 ? Math.min(savedAt, Date.now()) : Date.now(),
      hidden: row.hidden === true,
      shared: row.shared === true,
      points,
    };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const existing = await sql<{ count: number | string; has: boolean }>`
      select count(*) as count, bool_or(id = ${data.id}) as has from ghost_trails where user_id = ${context.userId}
    `;
    const count = Number(existing[0]?.count ?? 0);
    if (!existing[0]?.has && count >= MAX_TRAILS)
      throw new Error(`You can keep up to ${MAX_TRAILS} trails. Delete one first.`);
    await sql`
      insert into ghost_trails (user_id, id, name, started_at, saved_at, hidden, shared, points)
      values (
        ${context.userId}, ${data.id}, ${data.name},
        to_timestamp(${data.startedAt / 1000}), to_timestamp(${data.savedAt / 1000}),
        ${data.hidden}, ${data.shared}, ${JSON.stringify(data.points)}::jsonb
      )
      on conflict (user_id, id) do update set
        name = excluded.name, hidden = excluded.hidden, shared = excluded.shared, points = excluded.points
    `;
    return { ok: true as const };
  });

export const setGhostTrailHidden = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = (input ?? {}) as Record<string, unknown>;
    return { id: parseId(row.id), hidden: row.hidden === true };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`update ghost_trails set hidden = ${data.hidden} where user_id = ${context.userId} and id = ${data.id}`;
    return { ok: true as const };
  });

export const setGhostTrailShared = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = (input ?? {}) as Record<string, unknown>;
    return { id: parseId(row.id), shared: row.shared === true };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`update ghost_trails set shared = ${data.shared} where user_id = ${context.userId} and id = ${data.id}`;
    return { ok: true as const };
  });

export const deleteGhostTrail = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: unknown) => parseId(id))
  .handler(async ({ context, data: id }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`delete from ghost_trails where user_id = ${context.userId} and id = ${id}`;
    return { ok: true as const };
  });
