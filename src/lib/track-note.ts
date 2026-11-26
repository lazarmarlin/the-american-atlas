/**
 * The tracking notification (Android): its lines show today's tally and the
 * next county, and its buttons are "I'm here" (opens the app on the I'm here
 * sheet) and "Stop tracking" (stops the location service; the app turns
 * tracking off when it hears about it). TrackNotePlugin.java.
 */
import { registerPlugin } from "@capacitor/core";
import { nativeApp } from "@/lib/native";

type Handle = { remove: () => Promise<void> };
const Note = registerPlugin<{
  set(options: { title: string; text: string }): Promise<void>;
  clear(): Promise<void>;
  takeStopped(): Promise<{ stopped: boolean }>;
  postSoon(): Promise<void>;
  addListener(event: "stopped", cb: () => void): Promise<Handle>;
  addListener(event: "action", cb: (data: { action: string }) => void): Promise<Handle>;
}>("TrackNote");

let shown = "";

/** New lines for the notification (only sent when they change). */
export function setTrackNote(title: string, text: string) {
  if (!nativeApp) return;
  const key = `${title}\n${text}`;
  if (key === shown) return;
  shown = key;
  void Note.set({ title, text }).catch(() => {
    shown = "";
  });
}

/** Back to the plain lines (tracking stopped). */
export function clearTrackNote() {
  if (!nativeApp) return;
  shown = "";
  void Note.clear().catch(() => {});
}

/**
 * Live-trail friends changed: the location service posts its next fix
 * (with nobody watching it keeps fixes on the phone, to save battery).
 */
export function postNextFix() {
  if (nativeApp) void Note.postSoon().catch(() => {});
}

/** Whether "Stop tracking" was tapped on the notification while the app wasn't listening. */
export async function stoppedFromNotification() {
  if (!nativeApp) return false;
  try {
    return (await Note.takeStopped()).stopped;
  } catch {
    return false;
  }
}

/** The notification's buttons, while the app is open. Returns a stop function. */
export function onTrackNote(handlers: { stopped: () => void; here: () => void }) {
  if (!nativeApp) return () => {};
  const handles: Handle[] = [];
  let dead = false;
  const keep = (handle: Handle) => {
    if (dead) void handle.remove();
    else handles.push(handle);
  };
  Note.addListener("stopped", handlers.stopped).then(keep).catch(() => {});
  Note.addListener("action", ({ action }) => {
    if (action === "here") handlers.here();
  })
    .then(keep)
    .catch(() => {});
  return () => {
    dead = true;
    for (const handle of handles) void handle.remove();
  };
}

/** "3 places · 25 pts · 42 mi today" (or how tracking is going when nothing's new yet). */
export function noteTitle(places: number, points: number, miles: number) {
  const parts: string[] = [];
  if (places) parts.push(`${places} ${places === 1 ? "place" : "places"}`);
  if (points) parts.push(`${points.toLocaleString()} pts`);
  if (miles >= 1) parts.push(`${Math.round(miles).toLocaleString()} mi`);
  return parts.length ? `${parts.join(" · ")} today` : "Tracking your trip";
}
