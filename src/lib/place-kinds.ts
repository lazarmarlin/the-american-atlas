export type PlaceKind = {
  id: string;
  label: string;
  color: string;
  tier: number;
  legend: boolean;
};

export const placeKinds: PlaceKind[] = [
  { id: "city", label: "Cities", color: "#e2b15a", tier: 0, legend: true },
  { id: "town", label: "Towns", color: "#f3e2b0", tier: 1, legend: true },
  { id: "park-national", label: "National parks", color: "#1b6b3a", tier: 0, legend: true },
  { id: "park-state", label: "State parks", color: "#9ed68a", tier: 0, legend: true },
  { id: "reservation", label: "Reservations", color: "#c4894a", tier: 0, legend: true },
  { id: "forest", label: "Forests", color: "#2f6b45", tier: 0, legend: true },
  { id: "refuge", label: "Refuges", color: "#7dcea0", tier: 0, legend: true },
  { id: "capitol", label: "Capitols", color: "#d4762c", tier: 0, legend: true },
  { id: "beach", label: "Beaches", color: "#3aa0c8", tier: 2, legend: true },
  { id: "stadium", label: "Stadiums", color: "#7d6bb5", tier: 2, legend: true },
  { id: "museum", label: "Museums", color: "#c4923a", tier: 2, legend: true },
  { id: "historic", label: "Historic", color: "#c4a484", tier: 2, legend: true },
  { id: "register", label: "Historic register", color: "#c4a06a", tier: 2, legend: true },
  { id: "zoo", label: "Zoos", color: "#e07a3d", tier: 2, legend: true },
  { id: "brewery", label: "Breweries", color: "#e0b03a", tier: 2, legend: true },
  { id: "lighthouse", label: "Lighthouses", color: "#e36a4a", tier: 2, legend: true },
  { id: "bridge", label: "Covered bridges", color: "#b08968", tier: 2, legend: true },
  { id: "span-long", label: "Long bridges", color: "#d5e2ea", tier: 1, legend: true },
  { id: "span", label: "Famous bridges", color: "#8ea4b8", tier: 2, legend: true },
  { id: "airport-major", label: "Major airports", color: "#3d8fd4", tier: 1, legend: true },
  { id: "airport", label: "Airports", color: "#8ec3ea", tier: 2, legend: true },
  { id: "garden", label: "Gardens", color: "#6aaf6a", tier: 2, legend: true },
  { id: "amusement", label: "Amusement", color: "#e25d8c", tier: 2, legend: true },
  { id: "chain", label: "Chains", color: "#6a8cbf", tier: 2, legend: true },
  { id: "bucee", label: "Buc-ee's", color: "#e23d2b", tier: 1, legend: true },
  { id: "outfitter", label: "Bass Pro", color: "#3d8fd4", tier: 1, legend: true },
  { id: "market", label: "Groceries", color: "#8fbf5a", tier: 2, legend: true },
  { id: "food", label: "Foods", color: "#e07050", tier: 2, legend: true },
  { id: "mall", label: "Malls", color: "#b07cc9", tier: 2, legend: true },
  { id: "roadside", label: "Roadside", color: "#e2a04a", tier: 2, legend: true },
  { id: "highpoint", label: "High points", color: "#f2f2f2", tier: 0, legend: true },
  { id: "seashore", label: "Shores", color: "#3aa0c8", tier: 0, legend: true },
  { id: "battlefield", label: "Battlefields", color: "#8d6a5a", tier: 1, legend: true },
  { id: "drive", label: "Scenic drives", color: "#e2b15a", tier: 0, legend: true },
  { id: "waterfall", label: "Waterfalls", color: "#7ec8e3", tier: 1, legend: true },
  { id: "cave", label: "Caves", color: "#6b5b4b", tier: 1, legend: true },
  { id: "president", label: "Presidents", color: "#c4a484", tier: 1, legend: true },
  { id: "fort", label: "Forts", color: "#a67c52", tier: 1, legend: true },
  { id: "cemetery", label: "National cemeteries", color: "#b8c2cc", tier: 1, legend: true },
  { id: "winery", label: "Wineries", color: "#8e3a4a", tier: 2, legend: true },
  { id: "distillery", label: "Distilleries", color: "#c47a3a", tier: 2, legend: true },
  { id: "drivein", label: "Drive-ins", color: "#e25d8c", tier: 2, legend: true },
  { id: "diner", label: "Diners", color: "#e07050", tier: 2, legend: true },
  { id: "unesco", label: "World Heritage", color: "#e2c35a", tier: 0, legend: true },
  { id: "geo", label: "Geographic oddities", color: "#f2f2f2", tier: 0, legend: true },
  { id: "space", label: "Space centers", color: "#c9d6ff", tier: 1, legend: true },
  { id: "peak", label: "Fourteeners", color: "#dfe7ee", tier: 1, legend: true },
  { id: "landmark", label: "Natural landmarks", color: "#d08a5a", tier: 1, legend: true },
  { id: "dam", label: "Dams", color: "#9fb4c4", tier: 1, legend: true },
  { id: "lake", label: "Lakes", color: "#4aa3d8", tier: 1, legend: true },
  { id: "ship", label: "Museum ships", color: "#8fa8c8", tier: 1, legend: true },
  { id: "railroad", label: "Heritage railroads", color: "#b0745a", tier: 1, legend: true },
  { id: "ski", label: "Ski areas", color: "#e8f4ff", tier: 1, legend: true },
  { id: "hotspring", label: "Hot springs", color: "#e0866a", tier: 2, legend: true },
  { id: "pass", label: "Mountain passes", color: "#c8b89a", tier: 2, legend: true },
  { id: "aviation", label: "Air & space museums", color: "#7fb2e0", tier: 2, legend: true },
  { id: "observatory", label: "Observatories", color: "#a99ad8", tier: 2, legend: true },
  { id: "ghost", label: "Ghost towns", color: "#cfc6b8", tier: 2, legend: true },
  { id: "college", label: "Colleges", color: "#c46a6a", tier: 2, legend: true },
  { id: "ferry", label: "Ferries", color: "#5ab0c8", tier: 2, legend: true },
  { id: "tunnel", label: "Tunnels", color: "#9a9a9a", tier: 2, legend: true },
  { id: "crossing", label: "River crossings", color: "#5a9ad8", tier: 2, legend: true },
  { id: "stateline", label: "State lines", color: "#e2b15a", tier: 2, legend: true },
  { id: "county", label: "Counties", color: "#e2b15a", tier: 0, legend: false },
  { id: "route-i", label: "Interstates", color: "#3d7ab5", tier: 0, legend: false },
  { id: "route-us", label: "U.S. routes", color: "#f3f0e6", tier: 0, legend: false },
  { id: "route-sr", label: "State routes", color: "#8aa56a", tier: 1, legend: false },
];

const byId = new Map(placeKinds.map((kind) => [kind.id, kind]));

export const TIER_ZOOM = [0, 0.9, 1.8];

export function kindFor(category: string, name: string, points: number, sys = "") {
  if (category === "route") {
    if (sys === "I") return "route-i";
    if (sys === "US") return "route-us";
    return "route-sr";
  }
  if (category === "county") return "county";
  if (/buc-?ee/i.test(name)) return "bucee";
  if (/cabela|bass pro/i.test(name)) return "outfitter";
  if (category === "town") return points >= 30 ? "city" : "town";
  if (category === "park") return /national/i.test(name) ? "park-national" : "park-state";
  if (category === "span") return points >= 50 ? "span-long" : "span";
  if (category === "airport") return points >= 50 ? "airport-major" : "airport";
  return byId.has(category) ? category : "town";
}

export function tierForKind(id: string) {
  return byId.get(id)?.tier ?? 2;
}

export function kindVisible(tier: number, zoom: number, base: number) {
  if (tier <= 0) return true;
  return zoom + 0.05 >= base + (TIER_ZOOM[tier] ?? TIER_ZOOM[2]);
}
