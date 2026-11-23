import { create } from "zustand";

type Tab = "yours" | "add" | "near" | "trips" | "badges" | "recap" | "friends" | "photos";

type AtlasUi = {
  stateAbbr: string | null;
  category: string | null;
  query: string;
  selected: string | null;
  tab: Tab;
  showRoads: boolean;
  showCounties: boolean;
  showPlaces: boolean;
  setStateAbbr: (stateAbbr: string | null) => void;
  setCategory: (category: string | null) => void;
  setQuery: (query: string) => void;
  setSelected: (selected: string | null) => void;
  setTab: (tab: Tab) => void;
  toggleRoads: () => void;
  toggleCounties: () => void;
  togglePlaces: () => void;
};

export const useAtlas = create<AtlasUi>((set) => ({
  stateAbbr: null,
  category: null,
  query: "",
  selected: null,
  tab: "yours",
  showRoads: true,
  showCounties: false,
  showPlaces: true,
  setStateAbbr: (stateAbbr) => set({ stateAbbr, category: null, query: "", selected: null }),
  setCategory: (category) => set({ category, query: "" }),
  setQuery: (query) => set({ query }),
  setSelected: (selected) => set({ selected }),
  setTab: (tab) => set({ tab }),
  toggleRoads: () => set((s) => ({ showRoads: !s.showRoads })),
  toggleCounties: () => set((s) => ({ showCounties: !s.showCounties })),
  togglePlaces: () => set((s) => ({ showPlaces: !s.showPlaces })),
}));
