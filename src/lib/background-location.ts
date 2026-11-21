import { nativeApp } from "@/lib/native";

export type TrackPermission = "always" | "while-using" | "denied";

/** Asks the phone app for location, including with the screen off. The website skips this. */
export async function requestTrackingPermission(): Promise<TrackPermission> {
  if (!nativeApp) return "while-using";
  const { BackgroundGeolocation } = await import("@capgo/background-geolocation");
  const status = await BackgroundGeolocation.requestPermissions({
    permissions: ["location", "backgroundLocation", "notification"],
  });
  if (status.location !== "granted") return "denied";
  if (status.backgroundLocation === "granted" || status.backgroundLocation === "always") return "always";
  return "while-using";
}
