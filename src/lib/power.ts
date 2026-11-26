/** Battery optimization on Android (PowerPlugin.java). */
import { registerPlugin } from "@capacitor/core";
import { nativeApp } from "@/lib/native";

const Power = registerPlugin<{
  status(): Promise<{ unrestricted: boolean }>;
  requestUnrestricted(): Promise<void>;
  notifications(): Promise<{ enabled: boolean; channelsOff: string[] }>;
  openNotificationSettings(): Promise<void>;
  driveScreen(options: { on: boolean }): Promise<void>;
  battery(): Promise<{ level: number; charging: boolean }>;
}>("Power");

/** Battery level (0–100) and charging, or null off the phone / on an older app. */
export async function batteryInfo(): Promise<{ level: number; charging: boolean } | null> {
  if (!nativeApp) return null;
  try {
    const info = await Power.battery();
    return info.level >= 0 ? info : null;
  } catch {
    return null;
  }
}

/**
 * Tracking eases off at 20% or less (not charging) and goes back to normal
 * once charging or above 30%, so it doesn't flip back and forth around one number.
 */
export function lowPowerNext(current: boolean, info: { level: number; charging: boolean } | null) {
  if (!info || info.charging) return false;
  if (info.level <= 20) return true;
  if (info.level >= 30) return false;
  return current;
}

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

/** Landscape and the screen stays on, in the installed app and in the phone site. */
let wakeLock: WakeLockSentinel | null = null;
let watching = false;
let openedFullscreen = false;

async function holdScreen() {
  // One hold at a time: a second request would leave the first holding the screen on after Done.
  if (wakeLock && !wakeLock.released) return;
  try {
    const lock = await navigator.wakeLock.request("screen");
    if (!watching) {
      // Driving ended while this was being granted.
      await lock.release().catch(() => undefined);
      return;
    }
    wakeLock = lock;
  } catch {
    wakeLock = null;
  }
}

async function turnSideways() {
  const orientation = screen.orientation as ScreenOrientation & { lock?: (kind: string) => Promise<void> };
  if (!orientation?.lock) return;
  try {
    await orientation.lock("landscape");
    return;
  } catch {
    /* A browser tab only allows this while fullscreen. The installed site does not. */
  }
  const installed =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches;
  const root = document.documentElement;
  if (installed || document.fullscreenElement || !root.requestFullscreen) return;
  try {
    await root.requestFullscreen();
    openedFullscreen = true;
    await orientation.lock("landscape");
  } catch {
    /* The phone can still be turned by hand. */
  }
}

function onVisible() {
  if (!watching || document.visibilityState !== "visible") return;
  void holdScreen();
  void turnSideways();
}

export function startDriveScreen() {
  watching = true;
  if (nativeApp) void Power.driveScreen({ on: true }).catch(() => undefined);
  void holdScreen();
  void turnSideways();
  document.addEventListener("visibilitychange", onVisible);
}

export async function stopDriveScreen() {
  watching = false;
  document.removeEventListener("visibilitychange", onVisible);
  if (nativeApp) await Power.driveScreen({ on: false }).catch(() => undefined);
  await wakeLock?.release().catch(() => undefined);
  wakeLock = null;
  try {
    screen.orientation?.unlock();
  } catch {
    /* already unlocked */
  }
  if (openedFullscreen && document.fullscreenElement) {
    openedFullscreen = false;
    await document.exitFullscreen().catch(() => undefined);
  }
}
