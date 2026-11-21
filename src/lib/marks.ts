import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { parseVisits, readVisits, type Visit } from "@/lib/visits";

export type Mark = {
  id: string;
  name: string;
  category: string;
  state: string;
  lat: number | null;
  lon: number | null;
  points: number;
  sys: string;
  paths: number[][][];
  visitedOn: string | null;
  note: string;
  photo: string;
  visits: Visit[];
};

const SYSTEMS = new Set(["", "I", "US", "SR", "PK"]);

function cleanPaths(value: unknown): number[][][] {
  if (!Array.isArray(value)) return [];
  const paths: number[][][] = [];
  for (const line of value.slice(0, 8)) {
    if (!Array.isArray(line)) continue;
    const pts: number[][] = [];
    for (const point of line.slice(0, 180)) {
      if (!Array.isArray(point) || point.length < 2) continue;
      const lon = Number(point[0]);
      const lat = Number(point[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
      pts.push([Math.round(lon * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4]);
    }
    if (pts.length >= 2) paths.push(pts);
  }
  return paths;
}

function parseMark(input: unknown): Mark {
  if (!input || typeof input !== "object") throw new Error("Missing place");
  const row = input as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  const name = String(row.name ?? "").trim().slice(0, 160);
  const category = String(row.category ?? "").trim().slice(0, 32);
  const state = String(row.state ?? "").trim().toUpperCase();
  if (!/^[A-Za-z0-9:._ -]{1,140}$/.test(id)) throw new Error("That place can't be saved");
  if (!name || !/^[a-z]{2,16}$/.test(category)) throw new Error("That place can't be saved");
  if (state && !/^[A-Z]{2}$/.test(state)) throw new Error("That place can't be saved");
  const lat = row.lat == null || row.lat === "" ? null : Number(row.lat);
  const lon = row.lon == null || row.lon === "" ? null : Number(row.lon);
  if (lat != null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) throw new Error("Bad coordinates");
  if (lon != null && (!Number.isFinite(lon) || lon < -180 || lon > 180)) throw new Error("Bad coordinates");
  const points = Math.max(0, Math.min(500, Math.round(Number(row.points) || 0)));
  const sys = String(row.sys ?? "");
  if (!SYSTEMS.has(sys)) throw new Error("That place can't be saved");
  return {
    id,
    name,
    category,
    state,
    lat,
    lon,
    points,
    sys,
    paths: cleanPaths(row.paths),
    visitedOn: null,
    note: "",
    photo: "",
    visits: parseVisits(row.visits),
  };
}

function pathsFrom(raw: string | null): number[][][] {
  if (!raw) return [];
  try {
    return cleanPaths(JSON.parse(raw));
  } catch {
    return [];
  }
}

export const listMarks = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{
      poi_id: string;
      name: string;
      category: string;
      state: string;
      lat: number | null;
      lon: number | null;
      points: number;
      sys: string;
      geom: string | null;
      visited_on: string | null;
      note: string | null;
      photo: string | null;
      visits: string | null;
    }>`
      select poi_id, name, category, state, lat, lon, points, sys, geom, visited_on::text as visited_on, note, photo, visits
      from marks
      where user_id = ${context.userId}
      order by created_at desc
    `;
    return rows.map((row) => {
      const visits = readVisits(row.visits, { visitedOn: row.visited_on || null, note: row.note || "", photo: row.photo || "" });
      const latest = visits[visits.length - 1];
      return {
        id: row.poi_id,
        name: row.name,
        category: row.category,
        state: row.state,
        lat: row.lat,
        lon: row.lon,
        points: Number(row.points) || 0,
        sys: row.sys || "",
        paths: pathsFrom(row.geom),
        visitedOn: latest?.visitedOn ?? null,
        note: latest?.note ?? "",
        photo: latest?.photo ?? "",
        visits,
      };
    });
  });

export const saveMark = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => parseMark(input))
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const geom = data.paths.length ? JSON.stringify(data.paths) : null;
    const visits = JSON.stringify(data.visits);
    const latest = data.visits[data.visits.length - 1];
    await sql`
      insert into marks (user_id, poi_id, name, category, state, lat, lon, points, sys, geom, visits, visited_on, note, photo)
      values (
        ${context.userId},
        ${data.id},
        ${data.name},
        ${data.category},
        ${data.state},
        ${data.lat},
        ${data.lon},
        ${data.points},
        ${data.sys},
        ${geom},
        ${visits},
        ${latest?.visitedOn ?? null},
        ${latest?.note ?? ""},
        ${latest?.photo ?? ""}
      )
      on conflict (user_id, poi_id) do update set
        name = excluded.name,
        category = excluded.category,
        state = excluded.state,
        lat = excluded.lat,
        lon = excluded.lon,
        points = excluded.points,
        sys = excluded.sys,
        geom = coalesce(excluded.geom, marks.geom),
        visits = case when excluded.visits = '[]' then marks.visits else excluded.visits end,
        visited_on = case when excluded.visits = '[]' then marks.visited_on else excluded.visited_on end,
        note = case when excluded.visits = '[]' then marks.note else excluded.note end,
        photo = case when excluded.visits = '[]' then marks.photo else excluded.photo end
    `;
    return data;
  });

export const removeMark = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: unknown) => {
    const value = String(id ?? "").trim();
    if (!/^[A-Za-z0-9:._ -]{1,140}$/.test(value)) throw new Error("Missing place");
    return value;
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`delete from trip_stops where user_id = ${context.userId} and poi_id = ${data}`;
    await sql`delete from marks where user_id = ${context.userId} and poi_id = ${data}`;
    return data;
  });

export const updateJournal = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Missing place");
    const row = input as Record<string, unknown>;
    const id = String(row.id ?? "").trim();
    if (!/^[A-Za-z0-9:._ -]{1,140}$/.test(id)) throw new Error("Missing place");
    const rawDate = String(row.visitedOn ?? "").trim();
    const visitedOn = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
    const note = String(row.note ?? "").trim().slice(0, 500);
    const photo = String(row.photo ?? "");
    if (photo && (!photo.startsWith("data:image/jpeg;base64,") || photo.length > 140000)) {
      throw new Error("Use a smaller photo");
    }
    return { id, visitedOn, note, photo };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ visits: string | null; visited_on: string | null; note: string | null; photo: string | null }>`
      select visits, visited_on::text as visited_on, note, photo
      from marks
      where user_id = ${context.userId} and poi_id = ${data.id}
    `;
    const current = readVisits(rows[0]?.visits, {
      visitedOn: rows[0]?.visited_on || null,
      note: rows[0]?.note || "",
      photo: rows[0]?.photo || "",
    });
    current[0] = { ...current[0], visitedOn: data.visitedOn, note: data.note, photo: data.photo };
    const latest = current[current.length - 1];
    await sql`
      update marks
      set visits = ${JSON.stringify(current)},
          visited_on = ${latest?.visitedOn ?? null},
          note = ${latest?.note ?? ""},
          photo = ${latest?.photo ?? ""}
      where user_id = ${context.userId} and poi_id = ${data.id}
    `;
    return data;
  });

export const updateVisits = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Missing place");
    const row = input as Record<string, unknown>;
    const id = String(row.id ?? "").trim();
    if (!/^[A-Za-z0-9:._ -]{1,140}$/.test(id)) throw new Error("Missing place");
    const visits = parseVisits(row.visits);
    if (!visits.length) throw new Error("Keep at least one visit");
    return { id, visits };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const latest = data.visits[data.visits.length - 1];
    await sql`
      update marks
      set visits = ${JSON.stringify(data.visits)},
          visited_on = ${latest?.visitedOn ?? null},
          note = ${latest?.note ?? ""},
          photo = ${latest?.photo ?? ""}
      where user_id = ${context.userId} and poi_id = ${data.id}
    `;
    return data;
  });
