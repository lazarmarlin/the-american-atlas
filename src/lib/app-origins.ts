/**
 * Origins the Capacitor app's web view runs on. The server accepts
 * cross-origin requests from these (CORS + CSRF + Better Auth trusted origins),
 * but only ever authenticates them with a bearer token, never cookies.
 *
 *   https://localhost   Capacitor Android (androidScheme "https")
 *   capacitor://localhost  Capacitor iOS, if an iOS build is added later
 */
export const APP_ORIGINS: readonly string[] = ["https://localhost", "capacitor://localhost"];

export function isAppOrigin(origin: string | null | undefined): origin is string {
  return Boolean(origin) && APP_ORIGINS.includes(origin as string);
}

export function hasBearer(headers: Headers): boolean {
  return /^Bearer\s+\S+/i.test(headers.get("authorization") ?? "");
}
