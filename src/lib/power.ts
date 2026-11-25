/** Battery optimization on Android (PowerPlugin.java). */
import { registerPlugin } from "@capacitor/core";
import { nativeApp } from "@/lib/native";

const Power = registerPlugin<{
  status(): Promise<{ unrestricted: boolean }>;
  requestUnrestricted(): Promise<void>;
  notifications(): Promise<{ enabled: boolean; channelsOff: string[] }>;
  openNotificationSettings(): Promise<void>;
}>("Power");

/** Whether Android lets the app run with the screen off. Always true off the phone. */
export async function batteryUnrestricted() {
  if (!nativeApp) return true;
  try {
    return (await Power.status()).unrestricted;
  } catch {
    return true;
  }
}

export async function askBatteryUnrestricted() {
  if (nativeApp) await Power.requestUnrestricted().catch(() => undefined);
}

/** Whether the phone lets the app notify, and any of its kinds switched off. */
export async function notificationStatus(): Promise<{ enabled: boolean; channelsOff: string[] } | null> {
  if (!nativeApp) return null;
  try {
    return await Power.notifications();
  } catch {
    return null;
  }
}

export async function openNotificationSettings() {
  if (nativeApp) await Power.openNotificationSettings().catch(() => undefined);
}
