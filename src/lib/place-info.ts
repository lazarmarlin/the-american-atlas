import type { Mark } from "@/lib/marks";

export type PlaceBlurb = {
  extract: string;
  url: string;
};

const KINDS: Record<string, string> = {
  town: "town or city",
  beach: "beach",
  stadium: "stadium",
  chain: "regional chain",
  market: "grocery store",
  museum: "museum",
  historic: "historic site",
  zoo: "zoo or aquarium",
  brewery: "brewery",
  lighthouse: "lighthouse",
  bridge: "covered bridge",
  span: "bridge",
  airport: "airport",
  garden: "botanical garden",
  amusement: "amusement park",
  refuge: "wildlife refuge",
  forest: "national forest",
  park: "park",
  capitol: "state capitol",
  food: "regional food",
  mall: "mall",
  roadside: "roadside attraction",
  route: "road",
};

const cache = new Map<string, PlaceBlurb | null>();

function norm(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function bareName(name: string) {
  return name.replace(/\s+\([^)]+\)$/, "").trim();
}

export function fallbackBlurb(mark: Mark, stateName: string) {
  const name = bareName(mark.name);
  const kind = KINDS[mark.category] ?? "place";
  if (mark.category === "route") return `${name} is a road in ${stateName}.`;
  if (mark.category === "state") return `${name} is on your atlas.`;
  return `${name} is a ${kind} in ${stateName}.`;
}

export function mapsUrl(mark: Mark, stateName: string) {
  const name = bareName(mark.name);
  const label =
    mark.lat != null && mark.lon != null
      ? `${name}, ${stateName} (${mark.lat},${mark.lon})`
      : `${name}, ${stateName}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label)}`;
}

function searchQuery(mark: Mark, stateName: string) {
  const name = bareName(mark.name);
  if (mark.category !== "route") return `${name}, ${stateName}`;
  const ref = mark.id.split(":")[3] ?? "";
  if (mark.sys === "I" && ref) return `Interstate ${ref} in ${stateName}`;
  if (mark.sys === "US" && ref) return `U.S. Route ${ref} in ${stateName}`;
  return `${name} ${stateName}`;
}

function scoreTitle(title: string, name: string, stateName: string) {
  const low = title.toLowerCase();
  if (low.includes("disambiguation") || low.startsWith("list of")) return 0;
  const bare = name.toLowerCase();
  const state = stateName.toLowerCase();
  if (low === `${bare}, ${state}`) return 10;
  if (low === bare) return 8;
  if (low.startsWith(`${bare},`) || low.startsWith(`${bare} (`)) return 7;
  if (low.startsWith(`${bare} `) && !low.includes("county")) return 5;
  const n = norm(name);
  const t = norm(title);
  if (n.length >= 4 && t.includes(n) && !t.includes("county")) return 4;
  return 0;
}

type WikiPage = { title?: string; extract?: string; fullurl?: string };

export async function lookupPlace(mark: Mark, stateName: string): Promise<PlaceBlurb | null> {
  if (cache.has(mark.id)) return cache.get(mark.id) ?? null;
  const name = bareName(mark.name);
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrsearch: searchQuery(mark, stateName),
    gsrlimit: "4",
    prop: "extracts|info",
    inprop: "url",
    exintro: "1",
    explaintext: "1",
    exchars: "320",
  });
  try {
    const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      cache.set(mark.id, null);
      return null;
    }
    const data = (await res.json()) as { query?: { pages?: Record<string, WikiPage> } };
    const pages = Object.values(data.query?.pages ?? {});
    const best = pages
      .map((page) => ({ page, score: scoreTitle(page.title ?? "", name, stateName) }))
      .filter((item) => item.score >= 4 && item.page.extract && item.page.fullurl)
      .sort((a, b) => b.score - a.score)[0];
    const blurb = best
      ? { extract: best.page.extract!.replace(/\s+/g, " ").trim(), url: best.page.fullurl! }
      : null;
    cache.set(mark.id, blurb);
    return blurb;
  } catch {
    return null;
  }
}
