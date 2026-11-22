/**
 * Bearer-token storage, shared by the auth client and the server-function
 * fetch in `src/start.ts`.
 *
 * - Live preview (partitioned iframe): sessionStorage, as before.
 * - Native app: Capacitor Preferences, which survives the web view being
 *   killed when the app is closed. localStorage alone does not.
 * - Deployed web: normally empty — the session cookie is used instead.
 */
import { nativeApp } from "@/lib/native";

const BEARER_KEY = "grok-auth.bearer-token";

let memory: string | null | undefined;

function webStore(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return nativeApp ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function writeWeb(token: string | null) {
  try {
    const store = webStore();
    if (!store) return;
    if (token) store.setItem(BEARER_KEY, token);
    else store.removeItem(BEARER_KEY);
  } catch {
    /* storage unavailable — ignore */
  }
}

/** The stored bearer token, or null. */
export function getBearerToken(): string | null {
  if (memory !== undefined) return memory;
  try {
    memory = webStore()?.getItem(BEARER_KEY) ?? null;
  } catch {
    memory = null;
  }
  return memory;
}

export function setBearerToken(token: string | null): void {
  memory = token;
  writeWeb(token);
  if (nativeApp) void persistNative(token);
}

/** Read the phone's saved sign-in before the first session check. */
export async function restoreBearerToken(): Promise<void> {
  if (!nativeApp) return;
  try {
    const { Preferences } = await import("@capacitor/preferences");
    const { value } = await Preferences.get({ key: BEARER_KEY });
    if (!value) return;
    memory = value;
    writeWeb(value);
  } catch {
    /* the web copy, if any, still applies */
  }
}

async function persistNative(token: string | null) {
  try {
    const { Preferences } = await import("@capacitor/preferences");
    if (token) await Preferences.set({ key: BEARER_KEY, value: token });
    else await Preferences.remove({ key: BEARER_KEY });
  } catch {
    /* localStorage copy remains */
  }
}
