/**
 * Google / X sign-in for the native app.
 *
 * Google blocks OAuth inside embedded web views, so the app:
 *   1. makes a one-time verifier and sends only its SHA-256 (the challenge),
 *   2. opens `<web app>/auth/native?providerId=…&challenge=…` in the system
 *      browser (Chrome Custom Tab), which runs the normal Grok broker sign-in,
 *   3. gets sent back to `com.lazarmarlin.americanatlas://auth?code=…`,
 *   4. trades the code plus the verifier for a session token at
 *      `/auth/native-exchange`.
 *
 * Another app that grabbed the deep link would only see the code, which is
 * useless without the verifier that never leaves this app.
 */
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { apiUrl, NATIVE_SCHEME } from "@/lib/native";

const DEEP_LINK_PREFIX = `${NATIVE_SCHEME}://auth`;

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function makePkce() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

/** Wait for the deep link back into the app, or for the user to close the browser. */
function waitForReturn(): Promise<URL | null> {
  return new Promise((resolve) => {
    let settled = false;
    const handles: { remove: () => Promise<void> }[] = [];
    const finish = (value: URL | null) => {
      if (settled) return;
      settled = true;
      for (const h of handles) void h.remove();
      resolve(value);
    };
    void App.addListener("appUrlOpen", ({ url }) => {
      if (!url.startsWith(DEEP_LINK_PREFIX)) return;
      try {
        finish(new URL(url));
      } catch {
        finish(null);
      }
    }).then((h) => handles.push(h));
    // Closing the Custom Tab without finishing counts as cancelling. The deep
    // link can land just after this fires, so give it a moment first.
    void Browser.addListener("browserFinished", () => {
      setTimeout(() => finish(null), 1500);
    }).then((h) => handles.push(h));
  });
}

/** Run the system-browser sign-in and return a session bearer token. */
export async function nativeSignIn(providerId: string): Promise<string> {
  const { verifier, challenge } = await makePkce();
  const returned = waitForReturn();
  const start = new URL(apiUrl("/auth/native"));
  start.searchParams.set("providerId", providerId);
  start.searchParams.set("challenge", challenge);
  await Browser.open({ url: start.toString(), presentationStyle: "popover" });

  const link = await returned;
  void Browser.close().catch(() => {});
  if (!link) throw new Error("Sign-in was cancelled");
  const error = link.searchParams.get("error");
  if (error) throw new Error("Sign-in didn't go through. Try again.");
  const code = link.searchParams.get("code");
  if (!code) throw new Error("Sign-in didn't go through. Try again.");

  const res = await fetch(apiUrl("/auth/native-exchange"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, verifier }),
  });
  const body = (await res.json().catch(() => null)) as { token?: string; error?: string } | null;
  if (!res.ok || !body?.token) throw new Error("Sign-in expired before it finished. Try again.");
  return body.token;
}
