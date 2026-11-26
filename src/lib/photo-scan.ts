/**
 * Camera-roll scan for the Android app. The web file picker hands the app
 * copies of photos with their location removed, so on the phone the app reads
 * the library itself (PhotoLibraryPlugin.java): it asks for photo access and
 * "media location", then gets where and when each recent photo was taken.
 * Photos already added are remembered here so they aren't offered again.
 */
import { registerPlugin } from "@capacitor/core";
import { nativeApp } from "@/lib/native";

export type LibraryPhoto = { uri: string; lat: number; lon: number; takenAt: number };

type PhotoLibraryPlugin = {
  scan(options: { since: number; limit: number }): Promise<{ photos: LibraryPhoto[]; checked: number; noLocation: number }>;
  load(options: { uri: string; max: number; quality: number }): Promise<{ dataUrl: string }>;
};

const PhotoLibrary = registerPlugin<PhotoLibraryPlugin>("PhotoLibrary");

const KEY = "atlas.photo-scan";
const LOOK_BACK_DAYS = 90;

type Saved = { on: boolean; added: string[]; lastAt: number };

function read(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Saved> | null;
    return { on: raw?.on === true, added: Array.isArray(raw?.added) ? raw.added.slice(-2000) : [], lastAt: Number(raw?.lastAt) || 0 };
  } catch {
    return { on: false, added: [], lastAt: 0 };
  }
}

function write(next: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full */
  }
}

export const canScanLibrary = () => nativeApp;

/** The person has let the app read their photos before, so a scan won't pop up a permission prompt. */
export const scanAllowed = () => read().on;

export const lastScanAt = () => read().lastAt;

/** Recent photos with a location that haven't been added yet. */
export async function scanLibrary(days = LOOK_BACK_DAYS) {
  const state = read();
  try {
    const result = await PhotoLibrary.scan({ since: Date.now() - days * 86_400_000, limit: 400 });
    const added = new Set(state.added);
    write({ ...state, on: true, lastAt: Date.now() });
    return { ...result, photos: result.photos.filter((photo) => !added.has(photo.uri)) };
  } catch (err) {
    const code = err instanceof Error ? err.message : "";
    if (code === "no-photo-access" || code === "no-location-access") write({ ...state, on: false });
    throw new Error(
      code === "no-photo-access"
        ? "The app needs access to your photos to scan them. You can allow it in Android settings."
        : code === "no-location-access"
          ? "Without photo locations the app can't tell where they were taken."
          : code || "Couldn't read your photos.",
    );
  }
}

export async function loadLibraryPhoto(uri: string, max: number, quality: number) {
  const { dataUrl } = await PhotoLibrary.load({ uri, max, quality });
  return dataUrl;
}

export function forgetAdded(uri: string) {
  const state = read();
  write({ ...state, added: state.added.filter((item) => item !== uri) });
}

export function rememberAdded(uris: string[]) {
  if (!uris.length) return;
  const state = read();
  write({ ...state, added: [...state.added, ...uris].slice(-2000) });
}

/** Don't offer these photos again, even though they were never added to the map. */
export function skipSuggested(uris: string[]) {
  rememberAdded(uris);
}
