/** Battery optimization on Android (PowerPlugin.java). */
import { registerPlugin } from "@capacitor/core";
import { nativeApp } from "@/lib/native";

const Power = registerPlugin<{
  status(): Promise<{ unrestricted: boolean }>;
  requestUnrestricted(): Promise<void>;
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
