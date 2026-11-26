/**
 * Spoken announcements while driving (SpeechPlugin.java on the phone; the
 * browser's own voice on the website). Quiet unless turned on in Settings or
 * with the speaker in Drive mode, and spaced out so it doesn't chatter.
 */
import { registerPlugin } from "@capacitor/core";
import { useDrive, type VoiceLevel } from "@/lib/drive-settings";
import { nativeApp } from "@/lib/native";

const Speech = registerPlugin<{ speak(options: { text: string }): Promise<void>; stop(): Promise<void> }>("Speech");

let lastAt = 0;

/**
 * Say it, if the voice is on at this level. `important` (a new state) skips
 * the spacing; everything else waits at least 15 s after the last one.
 */
export function announce(text: string, level: Exclude<VoiceLevel, "off">, important = false) {
  const voice = useDrive.getState().voice;
  if (voice === "off" || (level === "all" && voice !== "all")) return false;
  const now = Date.now();
  if (!important && now - lastAt < 15_000) return false;
  lastAt = now;
  speak(text);
  return true;
}

/** Say it now, whatever the setting (the "test" button). */
export function speak(text: string) {
  if (nativeApp) {
    void Speech.speak({ text }).catch(() => {});
    return;
  }
  try {
    const say = new SpeechSynthesisUtterance(text);
    say.lang = "en-US";
    window.speechSynthesis?.speak(say);
  } catch {
    /* no voice here */
  }
}

/** How a number of points reads aloud. */
export function pointsText(points: number) {
  return points ? `${points} ${points === 1 ? "point" : "points"}` : "";
}
