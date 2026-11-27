import { createFileRoute } from "@tanstack/react-router";
import { hashToken } from "@/lib/track-token";

/**
 * What the phone's own background check asks for (MessageWatch in the Android
 * app): your newest unread messages and the thumbs-up count. That check runs
 * natively, so it works with the app in the background or closed, where the
 * web code's own check is paused. It signs in with this device's token, the
 * same one the location service posts with (src/routes/api/track.ts).
 */
export const Route = createFileRoute("/api/notify")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
        if (!/^[0-9a-f]{64}$/.test(token)) return new Response(null, { status: 401 });
        const { getSql } = await import("@/lib/db");
        const sql = await getSql();
        const owner = await sql<{ user_id: string }>`select user_id from track_tokens where token_hash = ${await hashToken(token)}`;
        const me = owner[0]?.user_id;
        if (!me) return new Response(null, { status: 401 });
        const { unreadFor, reactionNotices } = await import("@/lib/messages");
        const [summary, reactions] = await Promise.all([unreadFor(me), reactionNotices(me)]);
        return Response.json(
          {
            likes: summary.likes,
            messages: [
              ...reactions,
              ...summary.latest.map((m) => ({
                id: m.id,
                title: m.from,
                body: m.preview,
                thread: `${m.thread.kind}:${m.thread.id}`,
              })),
            ].slice(0, 8),
          },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
