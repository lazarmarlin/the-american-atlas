/**
 * Push pokes through Firebase Cloud Messaging (HTTP v1).
 *
 * Needs the server secret FIREBASE_SERVICE_ACCOUNT: the whole service-account
 * JSON from Firebase (Project settings › Service accounts › Generate new
 * private key). Without it nothing is sent and the phones keep checking on
 * their own, as before.
 *
 * What's sent is data only ({ kind: "poke" }) at high priority: the phone
 * wakes, asks /api/notify (signed in with its own device token) and shows the
 * notification itself, with its usual quiet-chat and already-seen rules. So
 * no names or message text ever go through Google.
 */
import { env } from "@/lib/env.server";

type Account = { client_email: string; private_key: string; project_id: string };

let account: Account | null | undefined;
let access: { token: string; until: number } | null = null;

function serviceAccount(): Account | null {
  if (account !== undefined) return account;
  const raw = env("FIREBASE_SERVICE_ACCOUNT");
  account = null;
  if (!raw) return null;
  try {
    // Pasted as JSON, or base64 of it (some settings screens mangle newlines).
    const text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(text) as Partial<Account>;
    if (parsed.client_email && parsed.private_key && parsed.project_id) {
      account = { client_email: parsed.client_email, private_key: parsed.private_key.replace(/\\n/g, "\n"), project_id: parsed.project_id };
    }
  } catch {
    account = null;
  }
  return account;
}

/** Whether the server can send pushes (the secret is set and readable). */
export function pushConfigured() {
  return serviceAccount() != null;
}

const b64url = (data: ArrayBuffer | Uint8Array | string) =>
  Buffer.from(typeof data === "string" ? data : data instanceof Uint8Array ? data : new Uint8Array(data)).toString("base64url");

/** A Google access token for FCM, from a JWT signed with the service account's key (cached ~55 min). */
async function accessToken(acct: Account): Promise<string> {
  if (access && access.until > Date.now()) return access.token;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: acct.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const pem = acct.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Buffer.from(pem, "base64"), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${b64url(signature)}` }),
  });
  if (!res.ok) throw new Error(`Google sign-in for push failed (${res.status})`);
  const body = (await res.json()) as { access_token: string; expires_in?: number };
  access = { token: body.access_token, until: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 300) * 1000 };
  return access.token;
}

export type PokeReport = {
  configured: boolean;
  phones: number;
  sent: number;
  /** What went wrong, in Google's words where there are any. */
  problems: string[];
};

/** Sends the pokes and says how it went (for the test button; pokeUsers ignores it). */
export async function sendPokes(userIds: string[], what: "message" | "like" | "test"): Promise<PokeReport> {
  const acct = serviceAccount();
  const report: PokeReport = { configured: !!acct, phones: 0, sent: 0, problems: [] };
  const raw = env("FIREBASE_SERVICE_ACCOUNT");
  if (!acct) {
    if (raw) report.problems.push("FIREBASE_SERVICE_ACCOUNT is set but isn't a readable service-account key (paste the whole .json file).");
    return report;
  }
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return report;
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const rows = await sql<{ token: string }>`select token from push_tokens where user_id = any(${ids})`;
  report.phones = rows.length;
  if (!rows.length) return report;
  let bearer: string;
  try {
    bearer = await accessToken(acct);
  } catch (err) {
    report.problems.push(err instanceof Error ? err.message : "Google sign-in for push failed");
    return report;
  }
  const url = `https://fcm.googleapis.com/v1/projects/${acct.project_id}/messages:send`;
  const dead: string[] = [];
  await Promise.all(
    rows.map(async ({ token }) => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
          body: JSON.stringify({
            message: {
              token,
              data: { kind: "poke", what },
              // Wakes the phone even when it's asleep; collapses repeats into one.
              android: { priority: "high", ...(what === "test" ? {} : { collapse_key: "atlas-poke" }), ttl: "3600s" },
            },
          }),
        });
        if (res.ok) {
          report.sent += 1;
          return;
        }
        const text = await res.text().catch(() => "");
        if (res.status === 404 || /UNREGISTERED/.test(text)) {
          dead.push(token);
          report.problems.push("A phone's token was out of date (removed; open the app on it to register again).");
          return;
        }
        let why = text.slice(0, 300);
        try {
          why = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? why;
        } catch {
          // Not JSON.
        }
        report.problems.push(`Google said ${res.status}: ${why}`);
      } catch (err) {
        report.problems.push(err instanceof Error ? err.message : "Couldn't reach Google");
      }
    }),
  );
  if (dead.length) await sql`delete from push_tokens where token = any(${dead})`;
  return report;
}

/**
 * Poke every phone of these people (not the sender). Never throws, and gives
 * up after a few seconds: a message is saved whether or not the poke goes out,
 * and the phones' own slower check still finds it.
 */
export async function pokeUsers(userIds: string[], kind: "message" | "like" = "message") {
  if (!serviceAccount() || !userIds.length) return;
  const work = sendPokes(userIds, kind).then((report) => {
    if (report.problems.length) console.warn("push:", report.problems.join(" | "));
  });
  await Promise.race([work.catch((err) => console.warn("push failed:", err)), new Promise((resolve) => setTimeout(resolve, 4000))]);
}
