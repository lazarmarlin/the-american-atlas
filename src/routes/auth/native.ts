import { createFileRoute } from "@tanstack/react-router";

// Native app sign-in, step 1 + 2 (see src/lib/auth/native.server.ts).
export const Route = createFileRoute("/auth/native")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleNativeStart } = await import("@/lib/auth/native.server");
        return handleNativeStart(request);
      },
    },
  },
});
