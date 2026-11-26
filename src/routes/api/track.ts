import { createFileRoute } from "@tanstack/react-router";
import { hashToken } from "@/lib/track-token";

/**
 * Where the phone's native location service posts each fix (see
 * startTracking in src/components/atlas-app.tsx). Posting somewhere is what
 * keeps that service running after Android closes the app; the app itself
 * catches up on the places you passed from the phone's own location log when
 * it opens again. While you're sharing your location live, each fix also
 * extends the trail your friends see, so they keep seeing you move even if the
 * app was closed.
 *
 * "X-Atlas-Live" tells the phone whether anyone is watching: with "0" it keeps
 * fixes on the phone and only posts one every 10 minutes (saves battery).
 */
const MAX_POINTS = 600;
const QUIET = { status: 204, headers: { "X-Atlas-Live": "0" } };
const LIVE = { status: 204, headers: { "X-Atlas-Live": "1" } };

export const Route = createFileRoute("/api/track")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
        if (!/^[0-9a-f]{64}$/.test(token)) return new Response(null, { status: 401 });
        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return new Response(null, { status: 400 });
        }
        const lat = Number(body.latitude);
        const lon = Number(body.longitude);
        const t = Number(body.time) || Date.now();
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
          return new Response(null, { status: 400 });
        }
        const { getSql } = await import("@/lib/db");
        const sql = await getSql();
        const owner = await sql<{ user_id: string; device_id: string }>`
          select user_id, device_id from track_tokens where token_hash = ${await hashToken(token)}
        `;
        const who = owner[0];
        if (!who) return new Response(null, { status: 401 });
        const viewers = await sql<{ ok: boolean }>`select true as ok from live_viewers where user_id = ${who.user_id} limit 1`;
        if (!viewers[0]?.ok) return new Response(null, QUIET);
        // Append to the live trail, at most every 10 seconds per person.
        const rows = await sql<{ points: unknown; updated_at: string }>`
          select points, updated_at from live_trails where user_id = ${who.user_id}
        `;
        const prev = rows[0];
        if (prev && Date.now() - new Date(prev.updated_at).getTime() < 10_000) return new Response(null, LIVE);
        const points = Array.isArray(prev?.points) ? (prev.points as unknown[]) : [];
        const last = points.at(-1) as number[] | undefined;
        if (last && Number(last[2]) >= t) return new Response(null, LIVE);
        const next = [...points, [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, Math.round(t)]].slice(-MAX_POINTS);
        await sql`
          insert into live_trails (user_id, points, device_id, updated_at)
          values (${who.user_id}, ${JSON.stringify(next)}::jsonb, ${who.device_id}, now())
          on conflict (user_id) do update set points = excluded.points, device_id = excluded.device_id, updated_at = now()
        `;
        return new Response(null, LIVE);
      },
    },
  },
});
