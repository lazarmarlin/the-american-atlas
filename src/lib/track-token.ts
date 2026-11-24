import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

/**
 * The phone's location service runs on its own once tracking is on, even after
 * Android closes the app, and posts each fix to /api/track
 * (src/routes/api/track.ts). It can't use the sign-in cookie, so each device
 * gets its own token. Only its SHA-256 hash is kept.
 */
const DEVICE_RE = /^[a-z0-9]{8,40}$/;

export async function hashToken(token: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const trackToken = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const id = String((input as { deviceId?: unknown } | null)?.deviceId ?? "");
    return { deviceId: DEVICE_RE.test(id) ? id : "" };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const raw = new Uint8Array(32);
    crypto.getRandomValues(raw);
    const token = [...raw].map((b) => b.toString(16).padStart(2, "0")).join("");
    // One token per device: a new one replaces the old.
    await sql`delete from track_tokens where user_id = ${context.userId} and device_id = ${data.deviceId}`;
    await sql`insert into track_tokens (token_hash, user_id, device_id) values (${await hashToken(token)}, ${context.userId}, ${data.deviceId})`;
    return { token };
  });
