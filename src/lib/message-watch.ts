/**
 * The Android app's native check for new messages (MessageWatch). The web
 * code's own check pauses once the app is in the background, so without this
 * a message only got a notification while the app was open. Here the app
 * hands the native side this device's token (the one the location service
 * already uses) so it can ask /api/notify on its own, and notifies through it
 * so a message is never notified twice.
 */
import { registerPlugin } from "@capacitor/core";
import { quietList } from "@/lib/chat-look";
import { apiOrigin, nativeApp } from "@/lib/native";

type Item = { id: string; title: string; body: string; thread?: string };
const Watch = registerPlugin<{
  addListener(event: "openThread", cb: (data: { thread: string }) => void): Promise<{ remove: () => Promise<void> }>;
  configure(options: { url: string; token: string; seen: string[]; quiet?: string[] }): Promise<void>;
  setQuiet(options: { quiet: string[] }): Promise<void>;
  show(options: { items: Item[]; seen: string[]; likes: number }): Promise<void>;
  stop(): Promise<void>;
}>("MessageWatch");

let ready = false;

/** Set up the native check for this account. Quietly does nothing on the web or an older app. */
export async function startMessageWatch(userId: string, seen: string[]) {
  if (!nativeApp || !apiOrigin || !userId) return;
  try {
    const [{ nativeDelivery }, { deviceId }] = await Promise.all([import("@/lib/native-tracking"), import("@/lib/drive-log")]);
    const delivery = await nativeDelivery(userId, deviceId());
    const token = (delivery.headers?.Authorization ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return;
    await Watch.configure({ url: `${apiOrigin}/api/notify`, token, seen, quiet: quietList(userId) });
    ready = true;
  } catch {
    ready = false;
  }
}

/**
 * Notify through the native side (it skips anything already notified).
 * False when it isn't there, so the caller notifies the old way.
 */
export async function showThroughWatch(items: Item[], seen: string[], likes: number) {
  if (!ready) return false;
  try {
    await Watch.show({ items, seen, likes });
    return true;
  } catch {
    return false;
  }
}

export async function setQuietThreads(quiet: string[]) {
  if (!nativeApp || !ready) return;
  await Watch.setQuiet({ quiet }).catch(() => undefined);
}

export async function stopMessageWatch() {
  if (!nativeApp) return;
  ready = false;
  await Watch.stop().catch(() => {});
}

/**
 * Tapping a message notification opens its chat: `onOpen` gets
 * "friend:<id>", "group:<id>" or "likes". Returns a stop function.
 */
export function onNotificationOpen(onOpen: (thread: string) => void) {
  if (!nativeApp) return () => {};
  let handle: { remove: () => Promise<void> } | null = null;
  let dead = false;
  Watch.addListener("openThread", ({ thread }) => onOpen(thread))
    .then((h) => {
      if (dead) void h.remove();
      else handle = h;
    })
    .catch(() => {});
  return () => {
    dead = true;
    void handle?.remove();
  };
}
