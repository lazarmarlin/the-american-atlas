/** This phone's push token, kept with your account (src/lib/push.server.ts sends to it). */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

const TOKEN_RE = /^[\w:.-]{20,4096}$/;

/** Saves the token for this account (moving it off any other account). `sending`: the server can push. */
export const registerPush = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const row = (input ?? {}) as Record<string, unknown>;
    const token = String(row.token ?? "");
    if (!TOKEN_RE.test(token)) throw new Error("Bad token");
    return { token, deviceId: String(row.deviceId ?? "").slice(0, 80) };
  })
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const { pushConfigured } = await import("@/lib/push.server");
    const sql = await getSql();
    // One token per phone: an older token from this phone goes.
    if (data.deviceId) await sql`delete from push_tokens where device_id = ${data.deviceId} and token <> ${data.token}`;
    await sql`
      insert into push_tokens (token, user_id, device_id, updated_at) values (${data.token}, ${context.userId}, ${data.deviceId}, now())
      on conflict (token) do update set user_id = excluded.user_id, device_id = excluded.device_id, updated_at = now()
    `;
    return { sending: pushConfigured() };
  });

/** Signing out: this phone stops getting pokes for the account. */
export const unregisterPush = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => ({ token: String((input as { token?: unknown } | null)?.token ?? "") }))
  .handler(async ({ context, data }) => {
    if (!TOKEN_RE.test(data.token)) return { ok: true };
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`delete from push_tokens where token = ${data.token} and user_id = ${context.userId}`;
    return { ok: true };
  });

/** Pokes your own phones and reports where it broke, if it did (Settings › Notifications › Test push). */
export const testPush = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sendPokes } = await import("@/lib/push.server");
    // Always an answer (never a hang the app can't read), whatever goes wrong.
    try {
      return await Promise.race([
        sendPokes([context.userId], "test"),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timed out talking to Google")), 15_000)),
      ]);
    } catch (err) {
      return { configured: true, phones: 0, sent: 0, problems: [err instanceof Error ? err.message : "The test failed on the server."] };
    }
  });
