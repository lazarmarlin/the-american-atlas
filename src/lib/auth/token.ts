/**
 * Bearer-token storage, shared by the auth client and the server-function
 * fetch in `src/start.ts`.
 *
 * - Live preview (partitioned iframe): sessionStorage, as before.
 * - Native app: localStorage, so the user stays signed in across app restarts.
 * - Deployed web: normally empty — the session cookie is used instead.
 */
import { nativeApp } from "@/lib/native";

const BEARER_KEY = "grok-auth.bearer-token";

function store(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return nativeApp ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

/** The stored bearer token, or null. */
export function getBearerToken(): string | null {
  try {
    return store()?.getItem(BEARER_KEY) ?? null;
  } catch {
    return null;
  }
}

export function setBearerToken(token: string | null): void {
  try {
    const s = store();
    if (!s) return;
    if (token) s.setItem(BEARER_KEY, token);
    else s.removeItem(BEARER_KEY);
  } catch {
    /* storage unavailable — ignore */
  }
}
