import { createFileRoute } from "@tanstack/react-router";

// Native app sign-in, step 3: one-time code + verifier → session token.
export const Route = createFileRoute("/auth/native-exchange")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleNativeExchange } = await import("@/lib/auth/native.server");
        return handleNativeExchange(request);
      },
    },
  },
});
