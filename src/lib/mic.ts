/**
 * Microphone for a voice note. On the phone, Android's permission and the
 * web view's permission are two different asks. The web view keeps saying no
 * unless the app permission is already granted, so ask the app first.
 */
import { registerPlugin } from "@capacitor/core";
import { nativeApp } from "@/lib/native";

const Mic = registerPlugin<{ allow(): Promise<void> }>("Mic");

export async function allowMic() {
  if (!nativeApp) return;
  await Mic.allow();
}
