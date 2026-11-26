/**
 * Driving choices, kept on this phone: spoken announcements, Drive mode
 * turning itself on, and a map that turns to face the way you're going.
 */
import { create } from "zustand";

export type VoiceLevel = "off" | "highlights" | "all";

type DriveSettings = {
  /** Highlights: new states and counties. All: every new place, and what's coming up. */
  voice: VoiceLevel;
  /** Drive mode on when you're driving with the app open, off once you've parked a while. */
  autoDrive: boolean;
  /** In Drive mode, the map turns to face the way you're going. */
  headingUp: boolean;
  set: (patch: Partial<Omit<DriveSettings, "set">>) => void;
};

const KEY = "atlas.drive-settings";

function read(): Omit<DriveSettings, "set"> {
  const fallback = { voice: "off" as VoiceLevel, autoDrive: true, headingUp: true };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<DriveSettings>;
    return {
      voice: raw.voice === "highlights" || raw.voice === "all" ? raw.voice : "off",
      autoDrive: raw.autoDrive !== false,
      headingUp: raw.headingUp !== false,
    };
  } catch {
    return fallback;
  }
}

export const useDrive = create<DriveSettings>((set, get) => ({
  ...(typeof window === "undefined" ? { voice: "off", autoDrive: true, headingUp: true } : read()),
  set: (patch) => {
    set(patch);
    const { voice, autoDrive, headingUp } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ voice, autoDrive, headingUp }));
    } catch {
      /* fine */
    }
  },
}));
