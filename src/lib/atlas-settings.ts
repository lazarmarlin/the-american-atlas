import { create } from "zustand";

export const BORDER_COLORS = [
  { id: "#f3f0e6", label: "Cream" },
  { id: "#e23d2b", label: "Red" },
  { id: "#e2b15a", label: "Gold" },
  { id: "#3d7ab5", label: "Blue" },
  { id: "#9ed68a", label: "Green" },
  { id: "#c4a484", label: "Tan" },
];

type Settings = {
  icons: boolean;
  stateBorder: string;
  countyColor: string;
  trackTravel: boolean;
  fastAdd: boolean;
  setIcons: (icons: boolean) => void;
  setStateBorder: (stateBorder: string) => void;
  setCountyColor: (countyColor: string) => void;
  setTrackTravel: (trackTravel: boolean) => void;
  setFastAdd: (fastAdd: boolean) => void;
};

const KEY = "trak-settings";

function readSaved(): Pick<Settings, "icons" | "stateBorder" | "countyColor" | "trackTravel" | "fastAdd"> {
  if (typeof window === "undefined") return { icons: true, stateBorder: "#f3f0e6", countyColor: "#e23d2b", trackTravel: false, fastAdd: false };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<Settings>;
    return {
      icons: raw.icons !== false,
      stateBorder: typeof raw.stateBorder === "string" ? raw.stateBorder : "#f3f0e6",
      countyColor: typeof raw.countyColor === "string" ? raw.countyColor : "#e23d2b",
      trackTravel: raw.trackTravel === true,
      fastAdd: raw.fastAdd === true,
    };
  } catch {
    return { icons: true, stateBorder: "#f3f0e6", countyColor: "#e23d2b", trackTravel: false, fastAdd: false };
  }
}

function write(partial: Partial<Pick<Settings, "icons" | "stateBorder" | "countyColor" | "trackTravel" | "fastAdd">>) {
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
}));
