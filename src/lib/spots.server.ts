/**
 * A City squares game's everyday places (libraries, churches, water towers,
 * bridges, railroad crossings…), looked up from OpenStreetMap once when the
 * game starts, for the game map and the everyday-place cards.
 *
 * Asks overpass.ch first when the server secret OVERPASS_KEY is set (the key
 * never leaves the server), then the public Overpass servers.
 */
import { env } from "@/lib/env.server";
import { DECK_MAX, SPOT_KINDS } from "@/lib/square-cards";

/** [osm id, kind, name, lat, lon] */
export type Spot = [string, string, string, number, number];

type Element = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

/** Each kind: the Overpass statement and how many to ask for at most. */
const ASKS: [string, string, number][] = [
  ["library", 'nwr["amenity"="library"]', 120],
  ["church", 'nwr["amenity"="place_of_worship"]', 250],
  ["school", 'nwr["amenity"="school"]', 200],
  ["hall", 'nwr["amenity"~"^(townhall|courthouse)$"]', 80],
  ["post", 'nwr["amenity"="post_office"]', 80],
  ["grocery", 'nwr["shop"="supermarket"]', 150],
  ["fuel", 'nwr["amenity"="fuel"]', 200],
  ["ball", 'nwr["leisure"~"^(pitch|playground)$"]', 300],
  ["tower", 'nwr["man_made"="water_tower"]', 80],
  ["graves", 'nwr["landuse"="cemetery"];nwr["amenity"="grave_yard"]', 150],
  ["bridge", 'way["bridge"="yes"]["highway"~"^(primary|secondary|tertiary|residential|unclassified|footway|cycleway|path|pedestrian)$"]', 400],
  ["crossing", 'node["railway"="level_crossing"]', 250],
];

function kindOf(tags: Record<string, string>): string | null {
  if (tags.amenity === "library") return "library";
  if (tags.amenity === "place_of_worship") return "church";
  if (tags.amenity === "school") return "school";
  if (tags.amenity === "townhall" || tags.amenity === "courthouse") return "hall";
  if (tags.amenity === "post_office") return "post";
  if (tags.shop === "supermarket") return "grocery";
  if (tags.amenity === "fuel") return "fuel";
  if (tags.leisure === "pitch" || tags.leisure === "playground") return "ball";
  if (tags.man_made === "water_tower") return "tower";
  if (tags.landuse === "cemetery" || tags.amenity === "grave_yard") return "graves";
  if (tags.bridge === "yes" && tags.highway) return "bridge";
  if (tags.railway === "level_crossing") return "crossing";
  return null;
}

function nameOf(kind: string, tags: Record<string, string>) {
  const name = (tags.name ?? "").trim();
  if (kind === "bridge") return name ? `Bridge (${name})` : "Bridge";
  if (kind === "crossing") return "Railroad crossing";
  if (kind === "ball" && !name) return tags.leisure === "playground" ? "Playground" : tags.sport ? `${tags.sport[0].toUpperCase()}${tags.sport.slice(1).replace(/_/g, " ")} field` : "Ball field";
  return (name || SPOT_KINDS[kind] || "Place").slice(0, 80);
}

function endpoints() {
  // Tests point this at a stand-in.
  const only = env("OVERPASS_URL");
  if (only) return [{ url: only, headers: {} as Record<string, string> }];
  const key = env("OVERPASS_KEY");
  return [
    ...(key
      ? [
          { url: `https://api.overpass.ch/v1/${key}/interpreter`, headers: {} as Record<string, string> },
          { url: "https://api.overpass.ch/v1/interpreter", headers: { "X-API-Key": key } },
          { url: "https://api.overpass.ch/api/interpreter", headers: { Authorization: `Bearer ${key}` } },
        ]
      : []),
    { url: "https://overpass-api.de/api/interpreter", headers: {} as Record<string, string> },
    { url: "https://overpass.private.coffee/api/interpreter", headers: {} as Record<string, string> },
  ];
}

/** Everything of those kinds inside the box [south, west, north, east], tidied: one per spot (a bridge in segments is one). */
export async function lookUpSpots(box: [number, number, number, number], inside: (lat: number, lon: number) => boolean): Promise<Spot[]> {
  const [s, w, n, e] = box.map((v) => Math.round(v * 1e5) / 1e5);
  const query = `[out:json][timeout:30][bbox:${s},${w},${n},${e}];` + ASKS.map(([, stmt, max]) => stmt.split(";").map((part) => `${part};out center tags ${max};`).join("")).join("");
  let elements: Element[] | null = null;
  let last = "";
  for (const ep of endpoints()) {
    try {
      const res = await fetch(ep.url, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        headers: { "User-Agent": "TheAmericanAtlas/1.0 (city squares)", ...ep.headers },
        signal: AbortSignal.timeout(40_000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${res.status}`);
      const json = JSON.parse(text) as { elements?: Element[]; remark?: string };
      if (!json.elements) throw new Error(json.remark ?? "no elements");
      elements = json.elements;
      break;
    } catch (err) {
      last = String((err as Error)?.message ?? err);
    }
  }
  if (!elements) throw new Error(`Couldn't reach OpenStreetMap (${last})`);
  const byKind = new Map<string, Spot[]>();
  const seen = new Set<string>();
  for (const el of elements) {
    const tags = el.tags ?? {};
    const kind = kindOf(tags);
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!kind || lat == null || lon == null) continue;
    const id = `osm:${el.type[0]}${el.id}`;
    if (seen.has(id) || !inside(lat, lon)) continue;
    seen.add(id);
    const list = byKind.get(kind) ?? [];
    // One per spot: a bridge (or a church's buildings) close to one already in counts as that one.
    const near = kind === "bridge" || kind === "graves" ? 60 : 25;
    if (list.some((p) => Math.hypot((p[3] - lat) * 364000, (p[4] - lon) * 364000 * Math.cos((lat * Math.PI) / 180)) < near * 3.28)) continue;
    list.push([id, kind, nameOf(kind, tags), Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5]);
    byKind.set(kind, list);
  }
  const out: Spot[] = [];
  for (const list of byKind.values()) {
    // Spread out past the cap (every k-th), not the first ones in one corner.
    const step = Math.max(1, Math.ceil(list.length / DECK_MAX));
    for (let i = 0; i < list.length; i += step) out.push(list[i]);
  }
  return out;
}
