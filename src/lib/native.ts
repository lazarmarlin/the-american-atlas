/**
 * Build-time switches for the Capacitor (Android) app.
 *
 * The app ships the same React UI, built as a static single-page app with
 * `npm run build:app`, and talks to the deployed web app for sign-in, saved
 * places and badges. Both values are baked in at build time:
 *
 *   VITE_NATIVE_APP=true                       set by `npm run build:app`
 *   VITE_API_ORIGIN=https://your-app.vercel.app the deployed web app
 *
 * In the normal web build both are unset and nothing here changes behavior.
 */

export const nativeApp = import.meta.env.VITE_NATIVE_APP === "true";

/** Origin of the deployed web app the native build talks to (no trailing slash). */
export const apiOrigin = (import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/+$/, "");

/** Custom URL scheme the native sign-in flow returns to (matches capacitor.config.ts appId). */
export const NATIVE_SCHEME = "com.lazarmarlin.americanatlas";

/** Absolute URL on the web app for a server path in the native build; unchanged on the web. */
export function apiUrl(path: string): string {
  if (!nativeApp || !path.startsWith("/")) return path;
  return `${apiOrigin}${path}`;
}
