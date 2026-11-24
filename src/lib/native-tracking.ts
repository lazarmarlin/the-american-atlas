/**
 * Keeps tracking going when Android closes the app.
 *
 * The location service only outlives the app when it has somewhere to post
 * fixes natively (its "url" option), so the phone gets a token for
 * /api/track. The service also writes every fix to a log on the phone; when
 * the app opens again, the fixes it missed are read back from that log so the
 * towns, counties and places passed in the meantime still get added.
 */
import { apiOrigin } from "@/lib/native";
import type { Fix } from "@/lib/nearby";

const LAST_FIX_KEY = "atlas-last-fix-at";
const TOKEN_KEY = "atlas-track-token";

/** Remember the time of the newest fix the app has handled itself. */
export function noteHandledFix(t: number) {
  try {
    const prev = Number(localStorage.getItem(LAST_FIX_KEY)) || 0;
    if (t > prev) localStorage.setItem(LAST_FIX_KEY, String(Math.round(t)));
  } catch {
    // Storage can be unavailable; the log is then read from the start next time.
  }
}

/** The native-delivery options for start(): the post URL and this device's token. Empty if it can't get one. */
export async function nativeDelivery(userId: string, deviceId: string): Promise<{ url?: string; headers?: Record<string, string> }> {
  if (!apiOrigin || !userId) return {};
  const key = `${TOKEN_KEY}:${userId}`;
  let token = "";
  try {
    token = localStorage.getItem(key) ?? "";
  } catch {
    token = "";
  }
  if (!token) {
    try {
      const { trackToken } = await import("@/lib/track-token");
      token = (await trackToken({ data: { deviceId } })).token;
      localStorage.setItem(key, token);
    } catch {
      return {};
    }
  }
  return { url: `${apiOrigin}/api/track`, headers: { Authorization: `Bearer ${token}` } };
}

/**
 * Fixes from the phone's location log that the app never saw (newer than the
 * last one it handled), oldest first, about 60 m apart. The log is cleared up
 * to what was read.
 */
type LogReader = Pick<
  import("@capgo/background-geolocation").BackgroundGeolocationPlugin,
  "getLocationLog" | "clearLocationLog"
>;

export async function missedFixes(plugin?: LogReader): Promise<Fix[]> {
  const BackgroundGeolocation = plugin ?? (await import("@capgo/background-geolocation")).BackgroundGeolocation;
  let since = 0;
  try {
    since = Number(localStorage.getItem(LAST_FIX_KEY)) || 0;
  } catch {
    since = 0;
  }
  const out: Fix[] = [];
  let afterId: number | undefined;
  let lastId: number | undefined;
  for (let page = 0; page < 60; page++) {
    const { entries } = await BackgroundGeolocation.getLocationLog({ afterId, limit: 2000 });
    if (!entries.length) break;
    for (const entry of entries) {
      lastId = entry.id;
      const t = Number(entry.time) || 0;
      if (t <= since) continue;
      const prev = out[out.length - 1];
      if (prev && Math.hypot(prev.lat - entry.latitude, (prev.lon - entry.longitude) * Math.cos((entry.latitude * Math.PI) / 180)) < 0.00055) continue;
      out.push({ lat: entry.latitude, lon: entry.longitude, t });
    }
    afterId = lastId;
    if (entries.length < 2000) break;
  }
  if (lastId != null) await BackgroundGeolocation.clearLocationLog({ upToId: lastId }).catch(() => {});
  const newest = out[out.length - 1]?.t;
  if (newest) noteHandledFix(newest);
  return out;
}
