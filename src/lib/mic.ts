/**
 * Microphone for a voice note (and the camera for a picture). On the phone, Android's permission and the
 * web view's permission are two different asks. The web view keeps saying no
 * unless the app permission is already granted, so ask the app first.
 */
import { registerPlugin } from "@capacitor/core";
import { nativeApp } from "@/lib/native";

const Mic = registerPlugin<{ allow(): Promise<void>; allowCamera(): Promise<void> }>("Mic");

export async function allowMic() {
  if (!nativeApp) return;
  await Mic.allow();
}

/** The camera, for taking a picture in a chat: the same two asks as the mic. */
export async function allowCamera() {
  if (!nativeApp) return;
  try {
    await Mic.allowCamera();
  } catch (err) {
    // An app from before the in-app camera has no such ask: let the web view ask.
    if (String((err as Error)?.message ?? err).includes("denied")) throw err;
  }
}
