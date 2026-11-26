import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

/**
 * Stops detected from GPS while tracking (src/lib/stop-detect.ts): somewhere
 * you stayed at least 10 minutes. Kept with your account; shown with your
 * places in the Stops view.
 */
export type GpsStop = {
  id: string;
  lat: number;
  lon: number;
  start: number;
  end: number;
  /** "Love's Travel Stop", or "Near Guymon". */
  label: string;
  state: string;
  poiId: string | null;
};

const ID_RE = /^s-[a-z0-9-]{4,40}$/;
const POI_RE = /^[a-z][a-z0-9-]*:[A-Za-z0-9:._-]{1,80}$/;

function cleanStop(value: unknown): GpsStop | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = String(row.id ?? "");
  const lat = Number(row.lat);
  const lon = Number(row.lon);
  const start = Number(row.start);
  const end = Number(row.end);
  if (!ID_RE.test(id) || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 14 * 86400000) return null;
  if (start < Date.UTC(2020, 0, 1) || end > Date.now() + 86400000) return null;
  const poiId = typeof row.poiId === "string" && POI_RE.test(row.poiId) ? row.poiId : null;
  return {
    id,
    lat: Math.round(lat * 1e5) / 1e5,
    lon: Math.round(lon * 1e5) / 1e5,
    start: Math.round(start),
    end: Math.round(end),
    label: String(row.label ?? "").slice(0, 120),
    state: /^[A-Z]{2}$/.test(String(row.state ?? "")) ? String(row.state) : "",
    poiId,
  };
}

const toMs = (value: unknown) => (value instanceof Date ? value.getTime() : new Date(String(value)).getTime());

export const saveStops = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const list = Array.isArray((input as { stops?: unknown } | null)?.stops) ? ((input as { stops: unknown[] }).stops) : [];
    return list.slice(0, 100).map(cleanStop).filter((s): s is GpsStop => !!s);
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    for (const s of data) {
      await sql`
        insert into stops (user_id, id, lat, lon, started_at, ended_at, label, state, poi_id)
        values (${context.userId}, ${s.id}, ${s.lat}, ${s.lon}, to_timestamp(${s.start / 1000}), to_timestamp(${s.end / 1000}), ${s.label}, ${s.state}, ${s.poiId})
        on conflict (user_id, id) do update set
          lat = excluded.lat, lon = excluded.lon, ended_at = excluded.ended_at,
          label = excluded.label, state = excluded.state, poi_id = excluded.poi_id
      `;
    }
    return { saved: data.length };
  });

export const listStops = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<GpsStop[]> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ id: string; lat: number; lon: number; started_at: unknown; ended_at: unknown; label: string; state: string; poi_id: string | null }>`
      select id, lat, lon, started_at, ended_at, label, state, poi_id from stops
      where user_id = ${context.userId}
      order by started_at desc
      limit 3000
    `;
    return rows.map((row) => ({
      id: row.id,
      lat: Number(row.lat),
      lon: Number(row.lon),
      start: toMs(row.started_at),
      end: toMs(row.ended_at),
      label: row.label,
      state: row.state,
      poiId: row.poi_id,
    }));
  });

export const removeStop = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const id = String((input as { id?: unknown } | null)?.id ?? "");
    if (!ID_RE.test(id)) throw new Error("Unknown stop");
    return id;
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`delete from stops where user_id = ${context.userId} and id = ${data}`;
    return { ok: true };
  });
