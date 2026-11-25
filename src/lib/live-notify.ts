/**
 * Phone notification when a friend starts sharing their location with you
 * (Android app). It comes from the app checking while it's running, including
 * in the background while tracking or sharing keeps it awake; with the app
 * fully closed there's nothing to check, so no notification.
 */
import { nativeApp } from "@/lib/native";

const CHANNEL_ID = "friends-live";
const ASKED_KEY = "atlas.notify-asked";
let channelReady: Promise<void> | null = null;

async function plugin() {
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  channelReady ??= LocalNotifications.createChannel({
    id: CHANNEL_ID,
    name: "Friends sharing location",
    description: "When a friend starts sharing their location with you.",
    importance: 4,
  }).catch(() => {});
  await channelReady;
  return LocalNotifications;
}

/**
 * Ask for notification permission if Android still can (it stops showing the
 * prompt after two "no"s; then the switch is in Settings > Tracking >
 * Notifications). At most once a week, so a "not now" isn't nagged.
 */
export async function askNotifyOnce() {
  if (!nativeApp) return;
  try {
    const asked = Number(localStorage.getItem(ASKED_KEY)) || 0;
    if (Date.now() - asked < 7 * 24 * 3600 * 1000) return;
    const LocalNotifications = await plugin();
    const { display } = await LocalNotifications.checkPermissions();
    if (display === "granted" || display === "denied") return;
    localStorage.setItem(ASKED_KEY, String(Date.now()));
    await LocalNotifications.requestPermissions();
  } catch {
    /* no notifications, then */
  }
}

export async function notifyFriendLive(name: string) {
  if (!nativeApp) return;
  try {
    const LocalNotifications = await plugin();
    const { display } = await LocalNotifications.checkPermissions();
    if (display !== "granted") return;
    await LocalNotifications.schedule({
      notifications: [
        {
          id: Math.floor(Date.now() % 2147483647),
          title: `${name} is sharing their location`,
          body: "Open the Friends tab to watch.",
          channelId: CHANNEL_ID,
          smallIcon: "ic_stat_atlas",
          iconColor: "#e2b15a",
        },
      ],
    });
  } catch {
    /* a missed notification is fine */
  }
}

const MESSAGE_CHANNEL = "messages";
let messageChannel: Promise<void> | null = null;

/** A phone notification for a new message or thumbs-up (Android app, while it's running). */
export async function notifyMessage(title: string, body: string) {
  if (!nativeApp) return;
  try {
    const LocalNotifications = await plugin();
    messageChannel ??= LocalNotifications.createChannel({
      id: MESSAGE_CHANNEL,
      name: "Messages",
      description: "Texts and thumbs-up from friends.",
      importance: 4,
    }).catch(() => {});
    await messageChannel;
    const { display } = await LocalNotifications.checkPermissions();
    if (display !== "granted") return;
    await LocalNotifications.schedule({
      notifications: [
        {
          id: Math.floor(Date.now() % 2147483647),
          title,
          body,
          channelId: MESSAGE_CHANNEL,
          smallIcon: "ic_stat_atlas",
          iconColor: "#e2b15a",
        },
      ],
    });
  } catch {
    /* a missed notification is fine */
  }
}
