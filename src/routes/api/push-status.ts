import { createFileRoute } from "@tanstack/react-router";

/**
 * Is push set up on this server? Open /api/push-status (add ?google=1 to also
 * check Google accepts the key). Says nothing secret.
 */
export const Route = createFileRoute("/api/push-status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { pushStatus } = await import("@/lib/push.server");
        const signIn = new URL(request.url).searchParams.get("google") === "1";
        return Response.json(await pushStatus(signIn), { headers: { "cache-control": "no-store" } });
      },
    },
  },
});
