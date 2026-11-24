#!/usr/bin/env node
/**
 * Adds places from the raw OpenStreetMap / Wikidata download
 * (scripts/fetch-places.mjs, run by .github/workflows/fetch-places.yml) to the
 * static atlas in public/atlas, plus places worked out from the atlas itself:
 * state-line crossings and river crossings on Interstates and U.S. routes.
 *
 *   node scripts/import-places.mjs raw-places        # merge, then run fix-atlas-data + build-catalog-index
 *
 * Safe to re-run: ids are stable (OSM node/way/relation id, Wikidata Q-id, or
 * a slug), anything already in the atlas is left alone, and a new place that
 * sits on top of one already in the same category is skipped.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ATLAS = path.join(ROOT, "public", "atlas");
const RAW = path.resolve(process.argv[2] ?? "raw-places");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
/** One raw file, merged across RAW and its subfolders (one artifact per OSM region). */
const RAW_DIRS = [RAW, ...(fs.existsSync(RAW) ? fs.readdirSync(RAW).map((d) => path.join(RAW, d)).filter((d) => fs.statSync(d).isDirectory()) : [])];
const rawFound = (name) => RAW_DIRS.some((dir) => fs.existsSync(path.join(dir, `${name}.json`)));
const raw = (name) => {
  const out = [];
  const seen = new Set();
  for (const dir of RAW_DIRS) {
    const file = path.join(dir, `${name}.json`);
    if (!fs.existsSync(file)) continue;
    const data = readJson(file);
    for (const row of Array.isArray(data) ? data : []) {
      // The same OSM object can be in two neighboring regions' extracts.
      const key = row.type && row.id != null ? `${row.type}${row.id}` : null;
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      out.push(row);
    }
  }
  return out;
};

// ---------------------------------------------------------------- categories
/** New categories: label for meta.json. Points live in scripts/fix-atlas-data.mjs. */
const NEW_CATS = {
  crossing: "River crossings",
  stateline: "State lines",
  landmark: "Natural landmarks",
  hotspring: "Hot springs",
  peak: "Fourteeners",
  pass: "Mountain passes",
  dam: "Dams",
  lake: "Lakes",
  ship: "Museum ships",
  railroad: "Heritage railroads",
  aviation: "Air & space museums",
  space: "Space centers",
  observatory: "Observatories",
  geo: "Geographic oddities",
  ghost: "Ghost towns",
  unesco: "World Heritage",
  ski: "Ski areas",
  college: "Colleges",
  ferry: "Ferries",
  tunnel: "Tunnels",
};

// ---------------------------------------------------------------- geometry
const statesGeo = readJson(path.join(ATLAS, "states.geojson"));
const STATES = statesGeo.features.map((f) => ({
  abbr: f.properties.abbr,
  name: f.properties.name,
  polys: f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates,
}));
const STATE = Object.fromEntries(STATES.map((s) => [s.abbr, s]));
const normLon = (st, lon) => (st.abbr === "AK" && lon > 0 ? lon - 360 : lon);
function inRing(x, y, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
const inside = (st, lon, lat) => {
  const x = normLon(st, lon);
  return st.polys.some((p) => inRing(x, lat, p[0]) && !p.slice(1).some((h) => inRing(x, lat, h)));
};
function boundaryDist(st, lon, lat) {
  const x = normLon(st, lon);
  const k = Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (const p of st.polys)
    for (const ring of p)
      for (let i = 1; i < ring.length; i++) {
        const [ax, ay] = ring[i - 1];
        const [bx, by] = ring[i];
        const dx = (bx - ax) * k;
        const dy = by - ay;
        let t = ((x - ax) * k * dx + (lat - ay) * dy) / (dx * dx + dy * dy || 1);
        t = Math.max(0, Math.min(1, t));
        best = Math.min(best, Math.hypot((x - (ax + t * (bx - ax))) * k, lat - (ay + t * (by - ay))));
      }
  return best;
}
const BOX = Object.fromEntries(
  STATES.map((s) => {
    let w = Infinity, e = -Infinity, so = Infinity, n = -Infinity;
    for (const p of s.polys) for (const [x, y] of p[0]) { w = Math.min(w, x); e = Math.max(e, x); so = Math.min(so, y); n = Math.max(n, y); }
    return [s.abbr, { w, e, s: so, n }];
  }),
);
/** The state a point is in; offshore points within ~25 miles go to the nearest state. */
function stateOf(lon, lat) {
  for (const st of STATES) {
    const b = BOX[st.abbr];
    const x = normLon(st, lon);
    if (x < b.w || x > b.e || lat < b.s || lat > b.n) continue;
    if (inside(st, lon, lat)) return st.abbr;
  }
  let best = null;
  let bd = 0.4;
  for (const st of STATES) {
    const b = BOX[st.abbr];
    const x = normLon(st, lon);
    if (x < b.w - 0.5 || x > b.e + 0.5 || lat < b.s - 0.5 || lat > b.n + 0.5) continue;
    const d = boundaryDist(st, lon, lat);
    if (d < bd) [bd, best] = [d, st.abbr];
  }
  return best;
}
const milesApart = (a, b) => {
  const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot((a.lat - b.lat) * 69.05, (a.lon - b.lon) * 69.17 * k);
};
const r5 = (v) => Math.round(v * 1e5) / 1e5;
const slug = (s) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
const normName = (s) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();

// ---------------------------------------------------------------- atlas
const places = {};
for (const st of STATES) places[st.abbr] = readJson(path.join(ATLAS, "places", `${st.abbr}.json`));
const existing = {}; // cat -> rows (all states), for overlap checks
for (const bundle of Object.values(places))
  for (const [cat, rows] of Object.entries(bundle)) (existing[cat] ??= []).push(...rows.filter((r) => r.lat != null));
const known = new Set(Object.values(places).flatMap((b) => Object.values(b).flat().map((r) => r.id)));

// ---------------------------------------------------------------- candidates
const GENERIC_NAME =
  /^(the )?((confederate|union|old|historic) fort( site)?|cave|cavern|caves|waterfall|waterfalls|falls|cascade|hot springs?|warm springs?|springs?|dam|fort|battlefield|winery|vineyard|distillery|tunnel|ferry( terminal| landing| dock)?|terminal|dock|landing|pass|summit|saddle|arch|natural arch|rock|ski area|diner|restaurant|drive[- ]?in|covered bridge|bridge|lake|reservoir|university|college|campus|observatory|planetarium|unnamed.*|untitled.*|ruins?)$/i;
const goodName = (name) =>
  typeof name === "string" && name.trim().length >= 3 && !GENERIC_NAME.test(name.trim()) && !/^Q\d+$/.test(name) && !/^\d/.test(name);

const added = {}; // cat -> [{row, st}]
function addPlace(cat, { id, name, lat, lon, paths, pts }, opts = {}) {
  if (!goodName(name) || lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const st = opts.state ?? stateOf(lon, lat);
  if (!st) return false;
  const fullId = `p:${cat}:${opts.idState ?? st}:${id}`;
  if (known.has(fullId)) return false;
  const near = opts.near ?? 0.3; // miles
  const sameName = opts.sameName ?? 2;
  const key = normName(name);
  const pool = [...(existing[cat] ?? []), ...(added[cat] ?? []).map((a) => a.row)];
  for (const other of pool) {
    const d = milesApart({ lat, lon }, other);
    if (d <= near) return false;
    if (d <= sameName && normName(other.name) === key) return false;
  }
  const row = { id: fullId, name: name.trim().replace(/\s+/g, " "), lat: r5(lat), lon: r5(lon), pts: pts ?? 10 };
  if (paths?.length) row.paths = paths;
  (added[cat] ??= []).push({ row, st });
  known.add(fullId);
  return true;
}

const osmId = (el) => `${el.type === "relation" ? "rel" : el.type}${el.id}`;
const osmPos = (el) => (el.lat != null ? [el.lat, el.lon] : el.center ? [el.center.lat, el.center.lon] : [null, null]);
const fromOsm = (cat, file, opts = {}) => {
  let n = 0;
  for (const el of raw(file)) {
    const t = el.tags ?? {};
    if (opts.filter && !opts.filter(t, el)) continue;
    if (t.disused || t.abandoned || t["disused:amenity"] || /\b(closed|demolished|former)\b/i.test(t.name ?? "")) continue;
    const [lat, lon] = osmPos(el);
    const name = opts.name ? opts.name(t) : t.name;
    if (addPlace(cat, { id: osmId(el), name, lat, lon, pts: opts.pts?.(t) }, opts)) n++;
  }
  return n;
};
const wdPoint = (s) => {
  const m = /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(s ?? "");
  return m ? [Number(m[2]), Number(m[1])] : [null, null];
};
const fromWd = (cat, file, opts = {}) => {
  let n = 0;
  const seen = new Set();
  for (const row of raw(file)) {
    const q = row.item?.split("/").pop();
    if (!q || seen.has(q)) continue;
    if (opts.filter && !opts.filter(row)) continue;
    seen.add(q);
    const [lat, lon] = wdPoint(row.coord);
    if (addPlace(cat, { id: `wd${q}`, name: opts.name ? opts.name(row) : row.itemLabel, lat, lon, pts: opts.pts?.(row) }, opts)) n++;
  }
  return n;
};

const log = {};
const count = (label, n) => (log[label] = (log[label] ?? 0) + n);

// --- filling thin categories
count("winery", fromOsm("winery", "osm-winery"));
count("winery", fromWd("winery", "wd-winery"));
count("distillery", fromOsm("distillery", "osm-distillery"));
count("cave", fromWd("cave", "wd-showcave", { pts: () => 25 }));
count("cave", fromOsm("cave", "osm-cave", { pts: () => 25, filter: (t) => /cave|cavern|grotto|sink|hole|mine/i.test(t.name ?? "") }));
count("fort", fromOsm("fort", "osm-fort", { pts: () => 25 }));
count("fort", fromWd("fort", "wd-fort", { pts: () => 25 }));
count("battlefield", fromOsm("battlefield", "osm-battlefield", { near: 1, sameName: 5, pts: () => 40 }));
count("battlefield", fromWd("battlefield", "wd-battlefield", { near: 1, sameName: 5, pts: () => 40 }));
// Wikidata lists thousands of long-closed drive-ins, so only OpenStreetMap's open ones.
count("drivein", fromOsm("drivein", "osm-drivein", { pts: () => 15 }));
count("diner", fromOsm("diner", "osm-diner", { pts: () => 10 }));
count("waterfall", fromWd("waterfall", "wd-waterfall", { pts: () => 15 }));
count("waterfall", fromOsm("waterfall", "osm-waterfall", { pts: () => 15 }));
count("bridge", fromWd("bridge", "wd-coveredbridge", { pts: () => 15 }));
count("bridge", fromOsm("bridge", "osm-coveredbridge", { near: 0.1, pts: () => 15 }));
// Presidential libraries and centers by name (OSM), minus bus stops, shops and the like.
count("president", fromWd("president", "wd-preslib2", { near: 1, pts: () => 40 }));
count("president", fromOsm("president", "osm-preslib", {
  near: 1,
  pts: () => 40,
  filter: (t, el) =>
    el.type !== "relation" && !t.route && !t.highway && !t.public_transport &&
    /\b(library|center|museum|site)\b/i.test(t.name ?? "") &&
    !/^(presidential (library|center|museum)( and museum)?|presidential library association)$/i.test(t.name ?? "") &&
    !/tiny door|lake|branch|association|jefferson davis|bus |streetcar/i.test(t.name ?? ""),
}));
for (const f of ["wd-preslib", "wd-presgrave", "wd-preshome", "wd-presnamed"])
  count("president", fromWd("president", f, { near: 0.2, pts: () => 40, filter: (r) => !/apartment|hotel|school|office|street|memorial library/i.test(r.itemLabel ?? "") }));

// Scenic byways (points) and historic highways (lines).
count("drive", fromWd("drive", "wd-byway", { near: 1, sameName: 400, pts: () => 30 }));

function simplify(line, tol) {
  if (line.length < 3) return line;
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = line[a];
    const [bx, by] = line[b];
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = line[i];
      const dx = bx - ax, dy = by - ay;
      const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1);
      const tt = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + tt * dx), py - (ay + tt * dy));
      if (d > md) [md, mi] = [d, i];
    }
    if (md > tol && mi > 0) {
      keep[mi] = 1;
      stack.push([a, mi], [mi, b]);
    }
  }
  return line.filter((_, i) => keep[i]);
}
/** Join a relation's member ways into as few lines as possible. */
function joinWays(ways) {
  const lines = ways.map((w) => w.slice());
  const out = [];
  const key = (p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  while (lines.length) {
    let line = lines.pop();
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < lines.length; i++) {
        const o = lines[i];
        const [hs, he, os, oe] = [key(line[0]), key(line.at(-1)), key(o[0]), key(o.at(-1))];
        if (he === os) line = line.concat(o.slice(1));
        else if (he === oe) line = line.concat(o.slice(0, -1).reverse());
        else if (hs === oe) line = o.concat(line.slice(1));
        else if (hs === os) line = o.slice().reverse().concat(line.slice(1));
        else continue;
        lines.splice(i, 1);
        grew = true;
        break;
      }
    }
    out.push(line);
  }
  return out;
}
const relLines = (rel) =>
  joinWays((rel.members ?? []).filter((m) => m.type === "way" && m.geometry?.length >= 2).map((m) => m.geometry.map((g) => [g.lon, g.lat])));

/** Miles along a set of [lon, lat] lines. */
const lineMiles = (lines) =>
  lines.reduce((sum, l) => sum + l.slice(1).reduce((m, p, i) => m + milesApart({ lat: l[i][1], lon: l[i][0] }, { lat: p[1], lon: p[0] }), 0), 0);
/** "Trail Ridge Road Scenic Byway" and "Trail Ridge Road" are the same drive. */
const driveKey = (name) =>
  normName(name)
    .replace(/\b(national|scenic|byway|byways|highway|road|drive|parkway|route|all american|americas|america s|and|historic|backcountry|trail)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Drives with real lines from OSM route relations, grouped by name. One drive is
 * listed in every state it passes through, under one id. A drive already in
 * the atlas keeps its id; it gets these lines when it had only a point, or when
 * it is one of our historic routes and now reaches more states.
 */
function importRoutes(groups, { minMiles = 0, routeStates = {}, label }) {
  const drives = existing.drive ?? [];
  for (const [name, rels] of groups) {
    const key = driveKey(name);
    if (!key) continue;
    const lines = rels.flatMap(relLines).map((l) => simplify(l, 0.005)).filter((l) => l.length >= 2);
    if (!lines.length || lineMiles(lines) < minMiles) continue;
    const per = new Map();
    for (const line of lines) {
      let run = [], runSt = null;
      for (const p of line) {
        const st = stateOf(p[0], p[1]);
        if (st !== runSt && run.length) {
          if (runSt) (per.get(runSt) ?? per.set(runSt, []).get(runSt)).push(run.length >= 2 ? run : [run[0], p]);
          run = [run.at(-1)];
        }
        runSt = st;
        run.push(p.map(r5));
      }
      if (runSt && run.length >= 2) (per.get(runSt) ?? per.set(runSt, []).get(runSt)).push(run);
    }
    // Same-named local roads elsewhere (a "Great River Road" in Massachusetts) don't count.
    if (routeStates[name]) for (const st of [...per.keys()]) if (!routeStates[name].split(" ").includes(st)) per.delete(st);
    const states = [...per.keys()].sort();
    if (!states.length) continue;
    const already = drives.filter((d) => driveKey(d.name) === key);
    let id;
    let shownName = name;
    if (already.length) {
      const oldStates = new Set(Object.entries(places).filter(([, b]) => (b.drive ?? []).some((d) => d.id === already[0].id)).map(([st]) => st));
      const pointOnly = already.every((d) => !d.paths?.length);
      const ours = /:(node|way|rel)\d+$|:wdQ\d+$/.test(already[0].id) || routeStates[name];
      if (!pointOnly && !(ours && states.length > oldStates.size)) continue;
      id = already[0].id;
      shownName = already[0].name;
      // Replace the old rows (a point, or lines in fewer states).
      for (const st of oldStates) places[st].drive = places[st].drive.filter((d) => d.id !== id);
    } else {
      if ((added.drive ?? []).some((a) => driveKey(a.row.name) === key)) continue;
      id = `p:drive:${states[0]}:${slug(name)}`;
    }
    for (const st of states) {
      const ps = per.get(st);
      const mid = ps[Math.floor(ps.length / 2)];
      const [lon, lat] = mid[Math.floor(mid.length / 2)];
      (added.drive ??= []).push({ row: { id, name: shownName, lat, lon, pts: 30, paths: ps }, st });
    }
    count(label, 1);
  }
}

/** Group relations by a cleaned-up name; `clean` returns null to skip one. */
function groupRoutes(rels, clean) {
  const out = new Map();
  const seen = new Set();
  for (const rel of rels) {
    if (seen.has(rel.id)) continue;
    seen.add(rel.id);
    const name = rel.tags?.name ? clean(rel.tags.name, rel) : null;
    if (name) (out.get(name) ?? out.set(name, []).get(name)).push(rel);
  }
  return out;
}

// Historic highways and trails. OSM splits them by state and era ("Dixie
// Highway from Macon to Thomasville (1919)", "Lincoln Highway - original route
// (1913) - Iowa"): one drive per route.
const HISTORIC_NAMES = [
  [/^(historic )?lincoln highway/i, "Lincoln Highway"],
  [/^dixie highway/i, "Dixie Highway"],
  [/^great river road/i, "Great River Road"],
  [/^(historic )?national road/i, "Historic National Road"],
  [/^santa fe (national historic )?trail/i, "Santa Fe Trail"],
  [/^oregon (national historic )?trail/i, "Oregon Trail"],
  [/^california (national historic )?trail/i, "California Trail"],
  [/^mormon (pioneer )?(national historic )?trail/i, "Mormon Trail"],
  [/^pony express/i, "Pony Express Trail"],
  [/^lewis (and|&) clark/i, "Lewis and Clark Trail"],
  [/^trail of tears/i, "Trail of Tears National Historic Trail"],
  [/^jefferson highway/i, "Jefferson Highway"],
  [/^yellowstone trail/i, "Yellowstone Trail"],
  [/^bankhead highway/i, "Bankhead Highway"],
  [/^atlantic highway/i, "Atlantic Highway"],
  [/^lee highway/i, "Lee Highway"],
  [/^victory highway/i, "Victory Highway"],
  [/^mohawk trail/i, "Mohawk Trail"],
  [/^old spanish (national historic )?trail/i, "Old Spanish Trail"],
  [/^el camino real/i, "El Camino Real"],
];
const historic = groupRoutes([...raw("osm-lincoln"), ...raw("osm-historic")], (full, rel) => {
  if (/detour|auxiliary|other routes|branch|loop|spur|alternate|greenway|heritage trail|bike|bicycle/i.test(full)) return null;
  if (rel.tags?.route && !/^(road|historic|hiking|foot)$/.test(rel.tags.route)) return null;
  const hit = HISTORIC_NAMES.find(([re]) => re.test(full));
  if (!hit) return null;
  let name = hit[1];
  const g = rel.members?.[0]?.geometry?.[0];
  if (name === "Old Spanish Trail" && g && g.lon > -100) name = "Old Spanish Trail Highway";
  if (name === "El Camino Real") name = g && g.lon < -114 ? "El Camino Real (California)" : "El Camino Real de Tierra Adentro";
  return name;
});
importRoutes(historic, {
  label: "drive (historic route)",
  routeStates: {
    "Great River Road": "MN WI IA IL MO KY TN AR MS LA",
    "Lincoln Highway": "NY NJ PA OH IN IL IA NE CO WY UT NV CA",
    "Dixie Highway": "MI OH IN IL KY TN NC SC GA AL FL",
    "Santa Fe Trail": "MO KS OK CO NM",
    "Oregon Trail": "MO KS NE WY ID OR WA",
    "California Trail": "MO KS NE WY ID UT NV CA",
    "Mormon Trail": "IL IA NE WY UT",
    "Pony Express Trail": "MO KS NE CO WY UT NV CA",
    "Old Spanish Trail": "NM CO UT AZ NV CA",
    "Old Spanish Trail Highway": "FL AL MS LA TX NM AZ CA",
    "Historic National Road": "MD PA WV OH IN IL",
    "Lewis and Clark Trail": "IL MO KS NE IA SD ND MT ID OR WA",
    "Trail of Tears National Historic Trail": "NC GA AL TN KY IL MO AR OK",
    "Jefferson Highway": "MN IA MO KS OK TX LA",
    "Yellowstone Trail": "MA NY PA OH IN IL WI MN SD ND MT ID WA",
    "Bankhead Highway": "DC VA NC SC GA AL MS TN AR TX NM AZ CA",
    "Atlantic Highway": "ME NH MA RI CT NY NJ PA DE MD VA NC SC GA FL",
    "Lee Highway": "NY DC VA TN AL MS LA TX NM AZ CA",
    "Victory Highway": "NY NJ PA OH IN IL MO KS CO UT NV CA",
    "Mohawk Trail": "MA",
  },
});

// Scenic byways: every named byway route at least 10 miles long. Loops of a
// byway ("Loess Hills National Scenic Byway: Ridge Road Loop") join the byway.
const byways = groupRoutes(raw("osm-byway"), (full) => {
  const name = full.replace(/\s*\(.*?\)/g, "").replace(/\s*:.*$/, "").trim();
  if (!/[a-z]/i.test(driveKey(name)) || /^(scenic (drive|highway|route|loop)|byway)$/i.test(name)) return null;
  // A byway that is one of the historic routes above ("Jefferson Highway Heritage Byway").
  if (HISTORIC_NAMES.some(([re]) => re.test(name))) return null;
  return name;
});
importRoutes(byways, { minMiles: 10, label: "drive (scenic byway)" });

// --- new categories
count("landmark", fromWd("landmark", "wd-nnl", { near: 0.5, pts: () => 20 }));
count("landmark", fromOsm("landmark", "osm-landmark", { near: 0.2, pts: () => 20 }));
count("hotspring", fromOsm("hotspring", "osm-hotspring", { pts: () => 15 }));
count("peak", fromOsm("peak", "osm-peak", { near: 0.5, pts: () => 30, filter: (t) => parseFloat(t.ele) >= 4267 }));
count("pass", fromOsm("pass", "osm-pass", { near: 0.5, pts: () => 15 }));
count("dam", fromWd("dam", "wd-dam", { near: 0.5, pts: () => 20 }));
count("lake", fromWd("lake", "wd-lake", { near: 2, pts: () => 15 }));
count("ship", fromWd("ship", "wd-museumship", { near: 0.05, sameName: 1, pts: () => 20 }));
// Historic ships on display (OSM historic=ship): the notable ones, not every boat on a lawn.
count("ship", fromOsm("ship", "osm-ship", {
  near: 0.05,
  sameName: 1,
  pts: () => 20,
  filter: (t) =>
    !/yacht club|maritime museum|museum$|taxi|remains|sail$|replica of/i.test(t.name ?? "") &&
    (!!t.wikidata || /^(attraction|museum)$/.test(t.tourism ?? "") || /^(USS|SS|USCGC|LV|USNS|PT|Lightship|Battleship|Fireboat|Fire Fighter|Steamer|Tug|Submarine)\b/i.test(t.name ?? "")),
}));
count("railroad", fromWd("railroad", "wd-heritagerail", { near: 0.5, pts: () => 15 }));
count("aviation", fromWd("aviation", "wd-aviation", { near: 0.2, pts: () => 15 }));
count("observatory", fromWd("observatory", "wd-observatory", { pts: () => 15 }));
count("observatory", fromWd("observatory", "wd-planetarium", { pts: () => 15 }));
count("ghost", fromWd("ghost", "wd-ghost", { pts: () => 15 }));
count("unesco", fromWd("unesco", "wd-unesco", { near: 3, sameName: 50, pts: () => 50 }));
count("ski", fromOsm("ski", "osm-ski", { near: 1, sameName: 5, pts: () => 15 }));
count("ski", fromWd("ski", "wd-skiresort", { near: 1, sameName: 5, pts: () => 15 }));
count("college", fromOsm("college", "osm-college", { near: 0.5, sameName: 5, pts: () => 10 }));
count("ferry", fromOsm("ferry", "osm-ferry", { near: 0.2, pts: () => 10, filter: (t) => /ferry|terminal|landing|dock|pier|slip|wharf/i.test(t.name ?? "") }));
count("tunnel", fromWd("tunnel", "wd-tunnel", { near: 0.3, pts: () => 15, filter: (r) => !r.len || Number(r.len) >= 300 }));

// Space: NASA centers and launch sites (hand-checked), then Wikidata.
const SPACE = [
  ["Kennedy Space Center", 28.5235, -80.6833],
  ["Space Center Houston (Johnson Space Center)", 29.5502, -95.097],
  ["U.S. Space & Rocket Center (Marshall)", 34.7108, -86.6538],
  ["Jet Propulsion Laboratory", 34.2013, -118.1714],
  ["Goddard Space Flight Center", 38.994, -76.852],
  ["Ames Research Center", 37.4089, -122.064],
  ["Langley Research Center", 37.092, -76.3807],
  ["Glenn Research Center", 41.415, -81.861],
  ["INFINITY Science Center (Stennis)", 30.3603, -89.6006],
  ["Armstrong Flight Research Center", 34.958, -117.884],
  ["Wallops Flight Facility", 37.94, -75.466],
  ["Vandenberg Space Force Base", 34.742, -120.5724],
  ["Cape Canaveral Space Force Station", 28.4889, -80.5778],
  ["Spaceport America", 32.9903, -106.975],
  ["Starbase", 25.9972, -97.1566],
];
for (const [name, lat, lon] of SPACE) count("space", +addPlace("space", { id: slug(name), name, lat, lon, pts: 30 }, { near: 0.5 }));
count("space", fromWd("space", "wd-spaceport", { near: 2, sameName: 10, pts: () => 30 }));

// Geographic oddities (hand-checked), plus marked tri-state corners from OSM.
const GEO = [
  ["Four Corners Monument", 36.99903, -109.0452],
  ["Geographic Center of the Contiguous United States", 39.8283, -98.5795],
  ["Center of the Nation Monument", 44.6713, -103.8521],
  ["Geographic Center of North America", 48.3683, -99.9962],
  ["Point Barrow (northernmost point)", 71.3875, -156.48],
  ["Ka Lae (southernmost point)", 18.9108, -155.681],
  ["Southernmost Point Buoy", 24.5465, -81.7975],
  ["West Quoddy Head (easternmost point)", 44.815, -66.9503],
  ["Cape Alava (westernmost contiguous point)", 48.165, -124.7339],
  ["Northwest Angle (northernmost contiguous point)", 49.3843, -95.1531],
  ["Badwater Basin (lowest point)", 36.2502, -116.8256],
];
for (const [name, lat, lon] of GEO) count("geo", +addPlace("geo", { id: slug(name), name, lat, lon, pts: 30 }, { near: 0.2 }));
count("geo", fromOsm("geo", "osm-tristate", { near: 0.2, pts: () => 20, name: (t) => (/tri|state|four|corner/i.test(t.name) && !/^(north|south)(east|west) corner$/i.test(t.name) ? t.name : `${t.name} (boundary marker)`) }));

// ---------------------------------------------------------------- crossings
const roads = {};
for (const st of STATES) roads[st.abbr] = readJson(path.join(ATLAS, "roads", `${st.abbr}.json`));
const mainRoads = Object.entries(roads).flatMap(([st, rows]) =>
  rows.filter((r) => (r.sys === "I" || r.sys === "US") && r.paths?.length).map((r) => ({ ...r, st })),
);

const segHit = (p, q, a, b) => {
  const d = (q[0] - p[0]) * (b[1] - a[1]) - (q[1] - p[1]) * (b[0] - a[0]);
  if (!d) return null;
  const t = ((a[0] - p[0]) * (b[1] - a[1]) - (a[1] - p[1]) * (b[0] - a[0])) / d;
  const u = ((a[0] - p[0]) * (q[1] - p[1]) - (a[1] - p[1]) * (q[0] - p[0])) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])] : null;
};

// State lines, from OpenStreetMap: each Interstate / U.S. route way that crosses
// a state or national border (worked out per region by scripts/osm-extract.mjs).
const stateRaw = rawFound("osm-stateline-hits");
if (stateRaw) {
  const hits = raw("osm-stateline-hits");
  // Both directions of a divided highway, and the same crossing from two regions.
  const clusters = [];
  for (const h of hits) {
    if (clusters.some((c) => c.ref === h.ref && milesApart(c, h) <= 0.6)) continue;
    clusters.push(h);
  }
  const deg = (miles) => miles / 69;
  for (const c of clusters) {
    // Look a few miles down the road each way to see which states it joins.
    const side = (sign) => {
      for (const miles of [3, 6, 10]) {
        const k = Math.cos((c.lat * Math.PI) / 180) || 1;
        const st = stateOf(c.lon + (sign * c.dx * deg(miles)) / k, c.lat + sign * c.dy * deg(miles));
        if (st) return st;
      }
      return null;
    };
    const a = side(-1), b = side(1);
    let label, pair;
    if (c.level === "2" || !a || !b || a === b) {
      const own = a ?? b ?? stateOf(c.lon, c.lat);
      if (!own) continue;
      if (c.level !== "2" && a === b) continue; // a road that wiggles along one border
      pair = [own];
      label = c.lat > 36 ? `${STATE[own].name}–Canada border` : `${STATE[own].name}–Mexico border`;
    } else {
      pair = [a, b].sort((x, y) => STATE[x].name.localeCompare(STATE[y].name));
      label = `${STATE[pair[0]].name}–${STATE[pair[1]].name} line`;
    }
    const st = stateOf(c.lon, c.lat) ?? pair[0];
    const id = `${slug(c.ref)}-${pair.join("").toLowerCase()}-${c.lat.toFixed(2)}${c.lon.toFixed(2)}`.replace(/\./g, "_");
    count("stateline", +addPlace("stateline", { id, name: `${label} (${c.ref})`, lat: c.lat, lon: c.lon, pts: 10 }, { state: st, near: 0.6, sameName: 2 }));
  }
}

// River crossings, from OpenStreetMap: Interstate / U.S. route bridges over each big river.
const BIG = new Set(["Mississippi River", "Missouri River", "Ohio River", "Colorado River", "Columbia River", "Rio Grande"]);
/** Where each river really runs, so a creek that shares the name (Georgia's Hudson River) doesn't count. */
const RIVER_STATES = {
  "Mississippi River": "MN WI IA IL MO KY TN AR MS LA", "Missouri River": "MT ND SD NE IA KS MO",
  "Ohio River": "PA OH WV KY IN IL", "Colorado River": "CO UT AZ NV CA TX", "Columbia River": "WA OR",
  "Rio Grande": "CO NM TX", "Arkansas River": "CO KS OK AR", "Snake River": "WY ID OR WA",
  "Tennessee River": "TN AL MS KY", "Red River": "TX OK AR LA", "Hudson River": "NY NJ",
  "Delaware River": "NY PA NJ DE", "Susquehanna River": "NY PA MD", "Potomac River": "MD VA WV DC",
  "Platte River": "NE", "Yellowstone River": "WY MT ND", "Illinois River": "IL",
  "Sacramento River": "CA", "Cumberland River": "KY TN", "Brazos River": "TX", "Wabash River": "OH IN IL",
  "Kansas River": "KS", "Allegheny River": "PA NY", "Connecticut River": "NH VT MA CT",
  "Savannah River": "GA SC", "Alabama River": "AL", "Pecos River": "NM TX", "Green River": "WY UT CO",
  "Wisconsin River": "WI", "Minnesota River": "MN SD", "Red River of the North": "MN ND",
  "Saint Lawrence River": "NY", "Gila River": "NM AZ", "Willamette River": "OR", "Yukon River": "AK",
  "James River": "VA ND SD", "Canadian River": "NM TX OK", "Niobrara River": "WY NE",
  "Big Sioux River": "SD IA", "Des Moines River": "MN IA MO", "Iowa River": "IA", "Kentucky River": "KY",
  "Monongahela River": "WV PA", "Shenandoah River": "VA WV", "Chattahoochee River": "GA AL FL",
  "Suwannee River": "GA FL", "Trinity River": "TX", "Sabine River": "TX LA", "Atchafalaya River": "LA",
  "Neosho River": "KS OK", "Cimarron River": "NM CO KS OK", "North Platte River": "CO WY NE",
  "South Platte River": "CO NE",
};
const bridgeRaw = rawFound("osm-river-hits");
if (bridgeRaw) {
  for (const h of raw("osm-river-hits")) {
    const where = stateOf(h.lon, h.lat);
    if (!where || !(RIVER_STATES[h.river] ?? "").split(" ").includes(where)) continue;
    const river = h.river.replace(/^Saint /, "St. ");
    const bridge = /bridge|crossing|viaduct|causeway/i.test(h.bridge ?? "") ? h.bridge : "";
    const name = `${h.ref} over the ${river}${bridge ? ` (${bridge})` : ""}`;
    const id = `${slug(h.ref)}-${slug(h.river)}-${h.lat.toFixed(2)}${h.lon.toFixed(2)}`.replace(/\./g, "_");
    // One per road per crossing: the two halves of a divided highway are one crossing.
    const dup = [...(existing.crossing ?? []), ...(added.crossing ?? []).map((a) => a.row)].some(
      (row) => row.name.startsWith(`${h.ref} over the ${river}`) && milesApart(row, h) <= 0.6,
    );
    if (dup) continue;
    count("crossing", +addPlace("crossing", { id, name, lat: h.lat, lon: h.lon, pts: BIG.has(h.river) ? 15 : 10 }, { near: 0.05, sameName: 0 }));
  }
}

// Fallback when the state-line download is missing: where the same road's
// line ends in one state and picks up in the next. Only when nothing at all
// was downloaded, so a partial run can't add rougher duplicates.
if (!stateRaw && !rawFound("osm-winery")) {
  const ends = new Map(); // "I:94" -> [{st, p}]
  for (const r of mainRoads) {
    const key = `${r.sys}:${r.ref}`;
    for (const line of r.paths) for (const p of [line[0], line.at(-1)]) (ends.get(key) ?? ends.set(key, []).get(key)).push({ st: r.st, p, name: r.name });
  }
  for (const list of ends.values()) {
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.st === b.st) continue;
        const d = milesApart({ lat: a.p[1], lon: a.p[0] }, { lat: b.p[1], lon: b.p[0] });
        if (d > 3) continue;
        const lon = (a.p[0] + b.p[0]) / 2;
        const lat = (a.p[1] + b.p[1]) / 2;
        const [s1, s2] = [a.st, b.st].sort((x, y) => STATE[x].name.localeCompare(STATE[y].name));
        const name = `${STATE[s1].name}–${STATE[s2].name} line (${a.name})`;
        const st = stateOf(lon, lat) ?? s1;
        const id = `${slug(a.name)}-${s1.toLowerCase()}${s2.toLowerCase()}-${lat.toFixed(2)}${lon.toFixed(2)}`.replace(/\./g, "_");
        count("stateline", +addPlace("stateline", { id, name, lat, lon, pts: 10 }, { state: st, near: 1, sameName: 5 }));
      }
  }
}


// Fallback when the bridge download is missing: our road lines against the river lines.
if (!bridgeRaw && !rawFound("osm-winery")) {
  const rivers = new Map(); // name -> longest relation's lines
  for (const rel of raw("osm-rivers")) {
    const name = rel.tags?.name;
    if (!name) continue;
    const lines = relLines(rel);
    const len = lines.reduce((s, l) => s + l.length, 0);
    const prev = rivers.get(name);
    if (!prev || len > prev.len) rivers.set(name, { len, lines: lines.map((l) => simplify(l, 0.0005)) });
  }
  const CELL = 0.25;
  const cellKey = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
  const grid = new Map();
  for (const [name, { lines }] of rivers)
    for (const line of lines)
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i];
        const seg = { a, b, name };
        const x0 = Math.floor(Math.min(a[0], b[0]) / CELL), x1 = Math.floor(Math.max(a[0], b[0]) / CELL);
        const y0 = Math.floor(Math.min(a[1], b[1]) / CELL), y1 = Math.floor(Math.max(a[1], b[1]) / CELL);
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) (grid.get(`${x},${y}`) ?? grid.set(`${x},${y}`, []).get(`${x},${y}`)).push(seg);
      }
  const hit = segHit;
  for (const r of mainRoads)
    for (const line of r.paths)
      for (let i = 1; i < line.length; i++) {
        const p = line[i - 1], q = line[i];
        const cells = new Set([cellKey(...p), cellKey(...q), cellKey((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)]);
        for (const c of cells)
          for (const seg of grid.get(c) ?? []) {
            const x = hit(p, q, seg.a, seg.b);
            if (!x) continue;
            const river = seg.name.replace(/^Saint /, "St. ");
            const name = `${r.name} over the ${river}`;
            const id = `${slug(r.name)}-${slug(seg.name)}-${x[1].toFixed(2)}${x[0].toFixed(2)}`.replace(/\./g, "_");
            count("crossing", +addPlace("crossing", { id, name, lat: x[1], lon: x[0], pts: BIG.has(seg.name) ? 15 : 10 }, { state: r.st, near: 0.5, sameName: 3 }));
          }
      }
}

// ---------------------------------------------------------------- starter list vs imported twins
// The hand-picked starter places have rough points (the Eisenhower Library was
// 20 miles off). Where an imported place in the same category has the same
// name close by, the starter place keeps its id and takes the better point,
// and the twin's id becomes an alias of it (src/lib/register-also.json), so
// anything saved under either id still resolves.
const TWIN_WORDS = /\b(presidential|library|museum|and|center|centre|boyhood|home|the|of|state|historic|site|national|park|falls|cave|caverns|fort|winery|vineyards?|distillery|diner|drive in|theater|theatre|covered|bridge)\b/g;
const twinKey = (name) => normName(name).replace(TWIN_WORDS, " ").replace(/\s+/g, " ").trim();
const imported = (id) => /:(node|way|rel)\d+$|:wdQ\d+$/.test(id);
const siteKind = (name) => (/library|center|museum/i.test(name) ? "library" : /home|house|birthplace|farm|ranch/i.test(name) ? "home" : "other");
const aliases = {};
for (const cat of ["president", "cave", "fort", "battlefield", "waterfall", "drivein", "diner", "winery", "distillery", "bridge"]) {
  const rows = Object.entries(places).flatMap(([st, b]) => (b[cat] ?? []).map((row) => ({ row, st })));
  const fresh = [...rows.filter((r) => imported(r.row.id)), ...(added[cat] ?? [])];
  for (const starter of rows.filter((r) => !imported(r.row.id))) {
    const key = twinKey(starter.row.name);
    if (key.length < 4) continue;
    // Same state, and close: chain and common names (Silver Diner, Tick Tock Diner) repeat.
    const reach = ["diner", "drivein", "winery", "distillery"].includes(cat) ? 10 : 30;
    const twin = fresh.find(
      (f) =>
        f.row.id !== starter.row.id &&
        f.st === starter.st &&
        twinKey(f.row.name) === key &&
        milesApart(f.row, starter.row) <= reach &&
        // A president's home and library are different places, often a mile apart.
        (cat !== "president" || siteKind(f.row.name) === siteKind(starter.row.name)),
    );
    if (!twin) continue;
    starter.row.lat = twin.row.lat;
    starter.row.lon = twin.row.lon;
    aliases[starter.row.id] = twin.row.id;
    places[twin.st][cat] = (places[twin.st][cat] ?? []).filter((r) => r.id !== twin.row.id);
    if (added[cat]) added[cat] = added[cat].filter((a) => a.row.id !== twin.row.id);
    count(`${cat} (starter point fixed)`, 1);
  }
}
if (Object.keys(aliases).length) {
  const file = path.join(ROOT, "src", "lib", "register-also.json");
  const prev = fs.existsSync(file) ? readJson(file) : {};
  // One alias per place in that file; keep an existing one (a merged Register listing).
  for (const [kept, gone] of Object.entries(aliases)) if (!prev[kept]) prev[kept] = gone;
  fs.writeFileSync(file, JSON.stringify(Object.fromEntries(Object.entries(prev).sort(([a], [b]) => (a < b ? -1 : 1)))));
}

// ---------------------------------------------------------------- known bad imports
const DROP = new Set([
  "p:president:CA:wdQ108659080", // a public library named for Kennedy, not a presidential site
  "p:president:NJ:wdQ69956867", // same
]);
for (const bundle of Object.values(places))
  for (const [cat, rows] of Object.entries(bundle)) if (rows.some((r) => DROP.has(r.id))) bundle[cat] = rows.filter((r) => !DROP.has(r.id));
for (const [cat, list] of Object.entries(added)) added[cat] = list.filter((a) => !DROP.has(a.row.id));

// ---------------------------------------------------------------- write
for (const [cat, list] of Object.entries(added))
  for (const { row, st } of list) {
    const rows = (places[st][cat] ??= []);
    if (!rows.some((r) => r.id === row.id)) rows.push(row);
  }
for (const bundle of Object.values(places))
  for (const rows of Object.values(bundle)) rows.sort((a, b) => a.name.localeCompare(b.name));
for (const [st, bundle] of Object.entries(places)) fs.writeFileSync(path.join(ATLAS, "places", `${st}.json`), JSON.stringify(bundle));

const meta = readJson(path.join(ATLAS, "meta.json"));
for (const c of meta.categories) if (c.id === "drive") c.label = "Scenic & historic drives";
for (const [id, label] of Object.entries(NEW_CATS)) if (!meta.categories.some((c) => c.id === id)) meta.categories.push({ id, label, count: 0 });
fs.writeFileSync(path.join(ATLAS, "meta.json"), JSON.stringify(meta));

console.log("added:", JSON.stringify(log, null, 1));
const totals = {};
for (const bundle of Object.values(places)) for (const [cat, rows] of Object.entries(bundle)) totals[cat] = (totals[cat] ?? 0) + rows.length;
console.log("totals:", JSON.stringify(Object.fromEntries(Object.entries(totals).filter(([k]) => k in log || k in NEW_CATS || ["winery","distillery","cave","fort","battlefield","drivein","diner","waterfall","bridge","president","drive"].includes(k)))));
