/**
 * Phone notification when travel tracking adds places (Android app only).
 *
 * Notification permission is asked for when tracking is turned on (see
 * `requestTrackingPermission`), so this never prompts on its own — tracking
 * can be running with the screen off, where a prompt would be lost.
 */
import { nativeApp } from "@/lib/native";

const CHANNEL_ID = "places-added";
let channelReady: Promise<void> | null = null;

type Added = { name: string; points: number };

async function plugin() {
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  channelReady ??= LocalNotifications.createChannel({
    id: CHANNEL_ID,
    name: "Places added",
    description: "When tracking adds a county, road, or place you passed.",
    importance: 3,
  }).catch(() => {});
  await channelReady;
  return LocalNotifications;
}

function text(added: Added[]) {
  const points = added.reduce((sum, place) => sum + (Number(place.points) || 0), 0);
  const pts = points > 0 ? ` · +${points} pts` : "";
  if (added.length === 1)
    return { title: `Added ${added[0]?.name}`, body: `Saved to your atlas${pts}` };
  const names = added.slice(0, 3).map((place) => place.name);
  const more = added.length > 3 ? ` and ${added.length - 3} more` : "";
  return { title: `Added ${added.length} places`, body: `${names.join(", ")}${more}${pts}` };
}

export async function notifyPlacesAdded(added: Added[]): Promise<void> {
  if (!nativeApp || !added.length) return;
  try {
    const LocalNotifications = await plugin();
    const { display } = await LocalNotifications.checkPermissions();
    if (display !== "granted") return;
    const { title, body } = text(added);
    await LocalNotifications.schedule({
      notifications: [
        {
          // Any 32-bit id; a fresh one per drop so earlier ones stay in the shade.
          id: Math.floor(Date.now() % 2147483647),
          title,
          body,
          channelId: CHANNEL_ID,
          smallIcon: "ic_stat_atlas",
          iconColor: "#e2b15a",
          group: CHANNEL_ID,
        },
      ],
    });
  } catch {
    /* a missed notification shouldn't stop tracking */
  }
}
