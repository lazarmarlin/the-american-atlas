/**
 * Driving choices, kept on this phone: spoken announcements, Drive mode
 * turning itself on, a map that turns to face the way you're going, and
 * saving maps ahead for where you are and are heading.
 */
import { create } from "zustand";

export type VoiceLevel = "off" | "highlights" | "all";
export type MapsAhead = "off" | "wifi" | "any";

type DriveSettings = {
  /** Highlights: new states and counties. All: every new place, and what's coming up. */
  voice: VoiceLevel;
  /** Drive mode on when you're driving with the app open, off once you've parked a while. */
  autoDrive: boolean;
  /** In Drive mode, the map turns to face the way you're going. */
  headingUp: boolean;
  /** Save the base map for the state you're in and the ones close by: on Wi-Fi, on any connection, or not. */
  mapsAhead: MapsAhead;
  set: (patch: Partial<Omit<DriveSettings, "set">>) => void;
};

const KEY = "atlas.drive-settings";

function read(): Omit<DriveSettings, "set"> {
  const fallback = { voice: "off" as VoiceLevel, autoDrive: true, headingUp: true, mapsAhead: "wifi" as MapsAhead };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<DriveSettings>;
    return {
      voice: raw.voice === "highlights" || raw.voice === "all" ? raw.voice : "off",
      autoDrive: raw.autoDrive !== false,
      headingUp: raw.headingUp !== false,
      mapsAhead: raw.mapsAhead === "off" || raw.mapsAhead === "any" ? raw.mapsAhead : "wifi",
    };
  } catch {
    return fallback;
  }
}

export const useDrive = create<DriveSettings>((set, get) => ({
  ...(typeof window === "undefined" ? { voice: "off", autoDrive: true, headingUp: true, mapsAhead: "wifi" } : read()),
  set: (patch) => {
    set(patch);
    const { voice, autoDrive, headingUp, mapsAhead } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ voice, autoDrive, headingUp, mapsAhead }));
    } catch {
      /* fine */
    }
  },
}));
