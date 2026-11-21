/**
 * TanStack Start instance options.
 *
 * Adds what the Capacitor app needs on top of the defaults:
 *  - Server: CORS for the app's web-view origins (see `@/lib/app-origins`), and
 *    the CSRF check TanStack applies to server functions by default, widened to
 *    accept those origins when the request carries a bearer token. Cookie-only
 *    cross-site requests are still refused.
 *  - Client (native build only): server-function calls go to the deployed web
 *    app instead of the app's own https://localhost origin, with the bearer token.
 */
import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { hasBearer, isAppOrigin } from "@/lib/app-origins";
import { getBearerToken } from "@/lib/auth/token";
import { apiUrl, nativeApp } from "@/lib/native";

const appCors = createMiddleware().server(async ({ request, next }) => {
  const origin = request.headers.get("origin");
  if (!isAppOrigin(origin)) return next();
  const cors: Record<string, string> = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      request.headers.get("access-control-request-headers") ?? "authorization, content-type",
    // set-auth-token: Better Auth's bearer plugin returns the session token here.
    // x-tss-*: TanStack's server-function client reads these to decode results.
    "Access-Control-Expose-Headers": "set-auth-token, x-tss-serialized, x-tss-raw, x-tss-context",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const result = await next();
  try {
    for (const [key, value] of Object.entries(cors)) result.response.headers.set(key, value);
    return result;
  } catch {
    // Some responses (redirects) have immutable headers — copy them.
    const headers = new Headers(result.response.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    const { status, statusText, body } = result.response;
    return new Response(body, { status, statusText, headers });
  }
});

const sameOriginOrApp = (value: string, request: Request) =>
  value === new URL(request.url).origin || (isAppOrigin(value) && hasBearer(request.headers));

const csrf = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
  secFetchSite: (site, ctx) =>
    site === "same-origin" ||
    (isAppOrigin(ctx.request.headers.get("origin")) && hasBearer(ctx.request.headers)),
  origin: (value, ctx) => sameOriginOrApp(value, ctx.request),
});

export const startInstance = createStart(() => ({
  requestMiddleware: [appCors, csrf],
  ...(nativeApp
    ? {
        serverFns: {
          fetch: (url: RequestInfo | URL, init?: RequestInit) => {
            const headers = new Headers(init?.headers);
            const token = getBearerToken();
            if (token) headers.set("Authorization", `Bearer ${token}`);
            return fetch(apiUrl(String(url)), { ...init, headers });
          },
        },
      }
    : {}),
}));
