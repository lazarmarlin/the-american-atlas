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
  pushToken(): Promise<{ token: string | null; reason?: string }>;
  setPushOn(options: { on: boolean }): Promise<void>;
  pushStatus(): Promise<{ on: boolean; lastPoke: number; firebase: boolean }>;
  setOpen(options: { thread: string }): Promise<void>;
}>("MessageWatch");

export type PushState = {
  /** This build has Firebase in it. */
  firebase: boolean;
  /** The server took this phone's token and can send. */
  on: boolean;
  lastPoke: number;
};

/** How push stands on this phone (null on the web or an older app). */
export async function pushState(): Promise<PushState | null> {
  if (!nativeApp) return null;
  try {
    return await Watch.pushStatus();
  } catch {
    return null;
  }
}

/** Register again (after the server's key was added, say), then report. */
export async function refreshPush() {
  await startPush();
  return pushState();
}

let pushTokenNow: string | null = null;
let pushReady = false;

/**
 * Push (Firebase): register this phone's token with the account. When the
 * server can send, a poke wakes the phone. The minute-by-minute check stays
 * until one of those pokes arrives. Anything missing (a build without
 * Firebase, no Play services, the server's key not set) leaves the old
 * checks running.
 */
async function startPush() {
  try {
    const { token, reason } = await Watch.pushToken();
    if (!token) {
      await Watch.setPushOn({ on: false });
      if (reason === "not-set-up") pushReady = true;
      return;
    }
    const [{ registerPush }, { deviceId }] = await Promise.all([import("@/lib/push"), import("@/lib/drive-log")]);
    const { sending } = await registerPush({ data: { token, deviceId: deviceId() } });
    pushTokenNow = token;
    pushReady = true;
    await Watch.setPushOn({ on: sending });
  } catch {
    // Offline, or an older app: try again on the next check. The regular checks stay on.
    pushReady = false;
    await Watch.setPushOn({ on: false }).catch(() => undefined);
  }
}

/** Register this phone for push if the last try didn't stick (no signal the first time). */
export async function ensurePush() {
  if (!nativeApp || !ready || pushReady) return;
  await startPush();
}

/** Which chat is on screen, so a poke doesn't buzz for a message you're reading. */
export function setWatchOpen(thread: string) {
  if (!nativeApp) return;
  void Watch.setOpen({ thread }).catch(() => undefined);
}

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
    void startPush();
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
  pushReady = false;
  // Signed out: this phone stops getting pokes for that account.
  const token = pushTokenNow;
  pushTokenNow = null;
  if (token) {
    const { unregisterPush } = await import("@/lib/push");
    await unregisterPush({ data: { token } }).catch(() => undefined);
  }
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
