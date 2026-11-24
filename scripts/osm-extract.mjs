#!/usr/bin/env node
/**
 * Turns osmium exports of a Geofabrik region (see .github/workflows/fetch-places.yml)
 * into the raw files scripts/import-places.mjs reads, so the import doesn't
 * need an Overpass server:
 *
 *   node scripts/osm-extract.mjs pois.geojsonseq lines.geojsonseq OUT_DIR
 *
 * pois:  tagged places -> osm-<job>.json, in the same shape Overpass returns
 *        ({type, id, tags, lat, lon}).
 * lines: state/national borders, Interstate & U.S. route ways and big rivers ->
 *        osm-stateline-hits.json (where a route crosses a border) and
 *        osm-river-hits.json (where a route crosses a river).
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const [POIS, LINES, OUT, ROUTES] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });

const RIVERS = new Set([
  "Mississippi River", "Missouri River", "Ohio River", "Colorado River", "Columbia River", "Rio Grande",
  "Arkansas River", "Snake River", "Tennessee River", "Red River", "Hudson River", "Delaware River",
  "Susquehanna River", "Potomac River", "Platte River", "Yellowstone River", "Illinois River",
  "Sacramento River", "Cumberland River", "Brazos River", "Wabash River", "Kansas River",
  "Allegheny River", "Connecticut River", "Savannah River", "Alabama River", "Pecos River",
  "Green River", "Wisconsin River", "Minnesota River", "Red River of the North", "Saint Lawrence River",
  "Gila River", "Willamette River", "Yukon River", "James River", "Canadian River", "Niobrara River",
  "Big Sioux River", "Des Moines River", "Iowa River", "Kentucky River", "Monongahela River",
  "Shenandoah River", "Chattahoochee River", "Suwannee River", "Trinity River", "Sabine River",
  "Atchafalaya River", "Neosho River", "Cimarron River", "North Platte River", "South Platte River",
]);

async function* features(file) {
  if (!file || !fs.existsSync(file)) return;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (let line of rl) {
    line = line.replace(/^\x1e/, "").trim();
    if (!line) continue;
    try {
      yield JSON.parse(line);
    } catch {}
  }
}

function center(geom) {
  const pts = [];
  const walk = (c) => (typeof c[0] === "number" ? pts.push(c) : c.forEach(walk));
  if (geom.type === "Point") return geom.coordinates;
  // Outer ring only for areas.
  if (geom.type === "Polygon") walk(geom.coordinates[0]);
  else if (geom.type === "MultiPolygon") geom.coordinates.forEach((p) => walk(p[0]));
  else walk(geom.coordinates);
  if (!pts.length) return null;
  let x = 0, y = 0;
  for (const [a, b] of pts) { x += a; y += b; }
  return [x / pts.length, y / pts.length];
}

const has = (t, k, re) => t[k] != null && re.test(t[k]);
/** The same selections the Overpass queries in scripts/fetch-places.mjs make. */
const JOBS = {
  winery: (t) => t.name && (t.craft === "winery" || t.tourism === "winery" || t.shop === "winery"),
  distillery: (t) => t.name && (t.craft === "distillery" || t.industrial === "distillery" || t.craft === "spirits"),
  cave: (t) => (t.natural === "cave_entrance" && t.name && (t.tourism || t.fee)) || (t.tourism === "attraction" && has(t, "name", /cavern|cave/i)) || t.show_cave === "yes",
  fort: (t) => t.name && (t.historic === "fort" || (t.historic === "castle" && has(t, "castle_type", /fortress|defensive/))),
  battlefield: (t) => t.name && t.historic === "battlefield",
  drivein: (t) => t.amenity === "cinema" && (t.drive_in === "yes" || has(t, "name", /drive[- ]?in/i)),
  diner: (t) => t.amenity === "restaurant" && t.name && !t.brand && has(t, "cuisine", /(^|;)diner(;|$)/),
  waterfall: (t) => t.name && (t.waterway === "waterfall" || t.natural === "waterfall"),
  coveredbridge: (t) => t.name && t.bridge && t.covered === "yes",
  hotspring: (t) => t.name && t.natural === "hot_spring",
  landmark: (t) => t.name && (/^(arch|volcano|geyser|dune)$/.test(t.natural ?? "") || (/^(rock|stone|cliff|peak)$/.test(t.natural ?? "") && t.wikidata && t.tourism)),
  peak: (t) => t.name && t.natural === "peak" && parseFloat(t.ele) >= 4267,
  pass: (t) => t.name && ((t.mountain_pass === "yes" && t.ele && !t.sac_scale) || (/continental divide/i.test(t.name) && (t.tourism || t.historic))),
  ski: (t) => t.name && t.landuse === "winter_sports",
  college: (t) => t.name && t.amenity === "university" && t.wikidata,
  ferry: (t) => t.name && t.amenity === "ferry_terminal",
  tristate: (t) => t.historic === "boundary_stone" && has(t, "name", /tri|corner|four/i),
};
const out = Object.fromEntries(Object.keys(JOBS).map((k) => [k, []]));
let poiCount = 0;
for await (const f of features(POIS)) {
  const t = f.properties ?? {};
  const c = f.geometry && center(f.geometry);
  if (!c) continue;
  const type = t["@type"] ?? "node";
  const id = t["@id"];
  const tags = Object.fromEntries(Object.entries(t).filter(([k]) => !k.startsWith("@")));
  for (const [job, test] of Object.entries(JOBS)) {
    if (!test(tags)) continue;
    out[job].push({ type, id, tags, lat: c[1], lon: c[0] });
    poiCount++;
  }
}
for (const [job, rows] of Object.entries(out)) fs.writeFileSync(path.join(OUT, `osm-${job}.json`), JSON.stringify(rows));
console.log("pois:", Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])), poiCount);

// ---------------------------------------------------------------- crossings
function refLabel(ref) {
  const parts = String(ref ?? "")
    .split(/[;,]/)
    .map((p) => p.trim().match(/^(I|US)[ -]?(\d+[A-Z]?)\b/))
    .filter(Boolean);
  const m = parts.find((x) => x[1] === "I") ?? parts[0];
  return m ? (m[1] === "I" ? `I-${m[2]}` : `US ${m[2]}`) : null;
}
const lines = (geom) =>
  geom.type === "LineString"
    ? [geom.coordinates]
    : geom.type === "MultiLineString" || geom.type === "Polygon"
      ? geom.coordinates
      : geom.type === "MultiPolygon"
        ? geom.coordinates.flat()
        : [];
const CELL = 0.05;
const borders = new Map(); // cell -> [[a, b, level]]
const rivers = new Map(); // cell -> [[a, b, name]]
const roads = []; // {ref, name, line}
const put = (grid, a, b, extra) => {
  for (let x = Math.floor(Math.min(a[0], b[0]) / CELL); x <= Math.floor(Math.max(a[0], b[0]) / CELL); x++)
    for (let y = Math.floor(Math.min(a[1], b[1]) / CELL); y <= Math.floor(Math.max(a[1], b[1]) / CELL); y++) {
      const k = `${x},${y}`;
      (grid.get(k) ?? grid.set(k, []).get(k)).push([a, b, extra]);
    }
};
for await (const f of features(LINES)) {
  const t = f.properties ?? {};
  if (!f.geometry) continue;
  if (t.boundary === "administrative" && (t.admin_level === "4" || t.admin_level === "2") && !t.maritime) {
    for (const l of lines(f.geometry)) for (let i = 1; i < l.length; i++) put(borders, l[i - 1], l[i], t.admin_level);
  } else if (t.waterway === "river" && RIVERS.has(t.name)) {
    for (const l of lines(f.geometry)) for (let i = 1; i < l.length; i++) put(rivers, l[i - 1], l[i], t.name);
  } else if (/^(motorway|trunk|primary)$/.test(t.highway ?? "")) {
    const ref = refLabel(t.ref);
    if (ref) for (const l of lines(f.geometry)) roads.push({ ref, bridge: t.bridge ? t.bridge_name ?? t.name ?? "" : null, line: l });
  }
}
const hit = (p, q, a, b) => {
  const d = (q[0] - p[0]) * (b[1] - a[1]) - (q[1] - p[1]) * (b[0] - a[0]);
  if (!d) return null;
  const t = ((a[0] - p[0]) * (b[1] - a[1]) - (a[1] - p[1]) * (b[0] - a[0])) / d;
  const u = ((a[0] - p[0]) * (q[1] - p[1]) - (a[1] - p[1]) * (q[0] - p[0])) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])] : null;
};
const stateHits = [];
const riverHits = [];
for (const r of roads) {
  for (let i = 1; i < r.line.length; i++) {
    const p = r.line[i - 1], q = r.line[i];
    const cells = [];
    for (let x = Math.floor(Math.min(p[0], q[0]) / CELL); x <= Math.floor(Math.max(p[0], q[0]) / CELL); x++)
      for (let y = Math.floor(Math.min(p[1], q[1]) / CELL); y <= Math.floor(Math.max(p[1], q[1]) / CELL); y++) cells.push(`${x},${y}`);
    const seen = new Set();
    for (const c of cells) {
      for (const s of borders.get(c) ?? []) {
        if (seen.has(s)) continue;
        seen.add(s);
        const x = hit(p, q, s[0], s[1]);
        if (x) {
          // Direction of travel, so the import can look a few miles to each side.
          const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
          stateHits.push({ lon: x[0], lat: x[1], ref: r.ref, level: s[2], dx: (q[0] - p[0]) / len, dy: (q[1] - p[1]) / len });
        }
      }
      for (const s of rivers.get(c) ?? []) {
        if (seen.has(s)) continue;
        seen.add(s);
        const x = hit(p, q, s[0], s[1]);
        if (x) riverHits.push({ lon: x[0], lat: x[1], ref: r.ref, river: s[2], bridge: r.bridge || "" });
      }
    }
  }
}
fs.writeFileSync(path.join(OUT, "osm-stateline-hits.json"), JSON.stringify(stateHits));
fs.writeFileSync(path.join(OUT, "osm-river-hits.json"), JSON.stringify(riverHits));
console.log("roads:", roads.length, "state hits:", stateHits.length, "river hits:", riverHits.length);

// ---------------------------------------------------------------- historic routes
// routes.opl: the named route relations plus their ways and nodes (osmium cat -f opl).
if (ROUTES && fs.existsSync(ROUTES)) {
  const dec = (v) => v.replace(/%([0-9a-fA-F]+)%/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  const nodes = new Map();
  const ways = new Map();
  const rels = [];
  const rl = readline.createInterface({ input: fs.createReadStream(ROUTES), crlfDelay: Infinity });
  for await (const line of rl) {
    const parts = line.split(" ");
    const kind = parts[0][0];
    const id = Number(parts[0].slice(1));
    const field = (c) => parts.find((p) => p[0] === c)?.slice(1) ?? "";
    if (kind === "n") {
      const x = parseFloat(field("x")), y = parseFloat(field("y"));
      if (Number.isFinite(x)) nodes.set(id, [x, y]);
    } else if (kind === "w") ways.set(id, field("N").split(",").filter(Boolean).map((n) => Number(n.slice(1))));
    else if (kind === "r") {
      const tags = Object.fromEntries(field("T").split(",").filter(Boolean).map((kv) => kv.split("=").map(dec)));
      const members = field("M").split(",").filter((m) => m[0] === "w").map((m) => Number(m.slice(1).split("@")[0]));
      rels.push({ id, tags, members });
    }
  }
  const outRels = rels
    .filter((r) => r.tags.name)
    .map((r) => ({
      type: "relation",
      id: r.id,
      tags: r.tags,
      members: r.members
        .map((w) => (ways.get(w) ?? []).map((n) => nodes.get(n)).filter(Boolean))
        .filter((g) => g.length >= 2)
        .map((g) => ({ type: "way", geometry: g.map(([lon, lat]) => ({ lat, lon })) })),
    }))
    .filter((r) => r.members.length);
  fs.writeFileSync(path.join(OUT, "osm-lincoln.json"), JSON.stringify(outRels));
  console.log("routes:", outRels.map((r) => `${r.tags.name} (${r.members.length})`).join(", "));
}
