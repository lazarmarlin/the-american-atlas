import { create } from "zustand";
import { DEFAULT_MARKER_COLOR, DEFAULT_MARKER_ICON, isMarkerColor, isMarkerIcon } from "@/lib/you-marker";

export const BORDER_COLORS = [
  { id: "#f3f0e6", label: "Cream" },
  { id: "#e23d2b", label: "Red" },
  { id: "#e2b15a", label: "Gold" },
  { id: "#3d7ab5", label: "Blue" },
  { id: "#9ed68a", label: "Green" },
  { id: "#c4a484", label: "Tan" },
];

type Saved = {
  icons: boolean;
  stateBorder: string;
  countyColor: string;
  trackTravel: boolean;
  fastAdd: boolean;
  showParks: boolean;
  showTowns: boolean;
  showReservations: boolean;
  townColor: string;
  reservationColor: string;
  markerIcon: string;
  markerColor: string;
};

type Settings = Saved & {
  setIcons: (icons: boolean) => void;
  setStateBorder: (stateBorder: string) => void;
  setCountyColor: (countyColor: string) => void;
  setTrackTravel: (trackTravel: boolean) => void;
  setFastAdd: (fastAdd: boolean) => void;
  setShowParks: (showParks: boolean) => void;
  setShowTowns: (showTowns: boolean) => void;
  setShowReservations: (showReservations: boolean) => void;
  setTownColor: (townColor: string) => void;
  setReservationColor: (reservationColor: string) => void;
  setMarkerIcon: (markerIcon: string) => void;
  setMarkerColor: (markerColor: string) => void;
};

const KEY = "trak-settings";
const DEFAULTS: Saved = {
  icons: true,
  stateBorder: "#f3f0e6",
  countyColor: "#e23d2b",
  trackTravel: false,
  fastAdd: false,
  showParks: true,
  showTowns: true,
  showReservations: true,
  townColor: "#c4a484",
  reservationColor: "#3d7ab5",
  markerIcon: DEFAULT_MARKER_ICON,
  markerColor: DEFAULT_MARKER_COLOR,
};

function readSaved(): Saved {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<Saved>;
    return {
      icons: raw.icons !== false,
      stateBorder: typeof raw.stateBorder === "string" ? raw.stateBorder : DEFAULTS.stateBorder,
      countyColor: typeof raw.countyColor === "string" ? raw.countyColor : DEFAULTS.countyColor,
      trackTravel: raw.trackTravel === true,
      fastAdd: raw.fastAdd === true,
      showParks: raw.showParks !== false,
      showTowns: raw.showTowns !== false,
      showReservations: raw.showReservations !== false,
      townColor: typeof raw.townColor === "string" ? raw.townColor : DEFAULTS.townColor,
      reservationColor: typeof raw.reservationColor === "string" ? raw.reservationColor : DEFAULTS.reservationColor,
      markerIcon: isMarkerIcon(raw.markerIcon) ? raw.markerIcon : DEFAULTS.markerIcon,
      markerColor: isMarkerColor(raw.markerColor) ? raw.markerColor.toLowerCase() : DEFAULTS.markerColor,
    };
  } catch {
    return DEFAULTS;
  }
}

function write(partial: Partial<Saved>) {
  localStorage.setItem(KEY, JSON.stringify({ ...readSaved(), ...partial }));
}

export const useSettings = create<Settings>((set) => ({
  ...readSaved(),
  setIcons: (icons) => {
    write({ icons });
    set({ icons });
  },
  setStateBorder: (stateBorder) => {
    write({ stateBorder });
    set({ stateBorder });
  },
  setCountyColor: (countyColor) => {
    write({ countyColor });
    set({ countyColor });
  },
  setTrackTravel: (trackTravel) => {
    write({ trackTravel });
    set({ trackTravel });
  },
  setFastAdd: (fastAdd) => {
    write({ fastAdd });
    set({ fastAdd });
  },
  setShowParks: (showParks) => {
    write({ showParks });
    set({ showParks });
  },
  setShowTowns: (showTowns) => {
    write({ showTowns });
    set({ showTowns });
  },
  setShowReservations: (showReservations) => {
    write({ showReservations });
    set({ showReservations });
  },
  setTownColor: (townColor) => {
    write({ townColor });
    set({ townColor });
  },
  setReservationColor: (reservationColor) => {
    write({ reservationColor });
    set({ reservationColor });
  },
  setMarkerIcon: (markerIcon) => {
    write({ markerIcon });
    set({ markerIcon });
  },
  setMarkerColor: (markerColor) => {
    write({ markerColor });
    set({ markerColor });
  },
}));
