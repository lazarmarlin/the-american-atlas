/**
 * Server half of the native app's system-browser sign-in (server-only).
 * The client half and the full flow are described in `./native-signin.ts`.
 *
 *   GET  /auth/native?providerId=…&challenge=…   start OAuth (302 to the broker)
 *   GET  /auth/native?done=1&challenge=…         after sign-in: mint a one-time
 *                                                code, send the browser back to the app
 *   POST /auth/native-exchange {code, verifier}  code + verifier → session token
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NATIVE_SCHEME } from "@/lib/native";
import { auth, SESSION_TOKEN_COOKIE } from "./server";
import { GROK_PROVIDERS } from "./providers";

const CODE_TTL_SECONDS = 120;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

const base64url = (buf: Buffer) => buf.toString("base64url");

function appLink(params: Record<string, string>) {
  return `${NATIVE_SCHEME}://auth?${new URLSearchParams(params).toString()}`;
}

/** Where this deployment is reachable (must match Better Auth's trusted origin). */
function selfOrigin(request: Request) {
  const configured = process.env.BETTER_AUTH_URL?.trim();
  return (configured ? new URL(configured) : new URL(request.url)).origin;
}

export async function handleNativeStart(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const challenge = url.searchParams.get("challenge") ?? "";
  if (!CHALLENGE_RE.test(challenge)) return backToApp({ error: "bad_request" });

  if (url.searchParams.get("done") === "1") {
    if (url.searchParams.has("error")) return backToApp({ error: "sign_in_failed" });
    const token = readCookie(request, SESSION_TOKEN_COOKIE);
    if (!token) return backToApp({ error: "no_session" });
    const code = base64url(randomBytes(32));
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`delete from native_auth_codes where expires_at < now()`;
    await sql`
      insert into native_auth_codes (code, challenge, token, expires_at)
      values (${code}, ${challenge}, ${token}, now() + make_interval(secs => ${CODE_TTL_SECONDS}))
    `;
    return backToApp({ code });
  }

  const providerId = url.searchParams.get("providerId") ?? "";
  if (!GROK_PROVIDERS.some((p) => p.providerId === providerId))
    return backToApp({ error: "bad_provider" });

  const back = `${selfOrigin(request)}/auth/native?done=1&challenge=${challenge}`;
  try {
    const apiRes = await auth.api.signInWithOAuth2({
      body: { providerId, callbackURL: back, errorCallbackURL: `${back}&error=1` },
      headers: request.headers,
      asResponse: true,
    });
    const body = (await apiRes.json().catch(() => null)) as { url?: string } | null;
    if (!apiRes.ok || !body?.url) return backToApp({ error: "oauth_init_failed" });
    const headers = new Headers({ location: body.url, "cache-control": "no-store" });
    for (const cookie of apiRes.headers.getSetCookie()) headers.append("set-cookie", cookie);
    return new Response(null, { status: 302, headers });
  } catch {
    return backToApp({ error: "oauth_init_failed" });
  }
}

export async function handleNativeExchange(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    code?: unknown;
    verifier?: unknown;
  } | null;
  const code = typeof body?.code === "string" ? body.code : "";
  const verifier = typeof body?.verifier === "string" ? body.verifier : "";
  if (!code || code.length > 100 || verifier.length < 43 || verifier.length > 128)
    return json({ error: "bad_request" }, 400);

  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  // Delete-and-return makes each code single-use even under concurrent requests.
  const rows = await sql<{ challenge: string; token: string }>`
    delete from native_auth_codes
    where code = ${code} and expires_at > now()
    returning challenge, token
  `;
  const row = rows[0];
  if (!row) return json({ error: "expired" }, 400);

  const expected = Buffer.from(row.challenge);
  const actual = Buffer.from(base64url(createHash("sha256").update(verifier).digest()));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return json({ error: "mismatch" }, 400);
  return json({ token: row.token }, 200);
}

function json(value: unknown, status: number) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/**
 * Hand the browser back to the app. A small page rather than a bare redirect,
 * so there's a button to tap if the browser holds the custom-scheme jump.
 */
function backToApp(params: Record<string, string>): Response {
  const link = appLink(params);
  const safe = link.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const ok = !params.error;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${ok ? "Signed in" : "Sign-in failed"} · The American Atlas</title>
<style>
  html,body{margin:0;min-height:100%;background:#121410;color:#e8e4d8;
    font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  main{min-height:100vh;display:grid;place-items:center;padding:1.5rem;text-align:center}
  a{display:inline-block;margin-top:1rem;padding:.75rem 1.25rem;border-radius:999px;
    background:#e2b15a;color:#121410;text-decoration:none;font-weight:600}
</style></head>
<body><main><div>
<p>${ok ? "You're signed in." : "Sign-in didn't go through."}</p>
<a href="${safe}">Return to the app</a>
</div></main>
<script>location.replace(${JSON.stringify(link).replace(/</g, "\\u003c")});</script>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0 || trimmed.slice(0, eq) !== name) continue;
    const raw = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}
