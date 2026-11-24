#!/usr/bin/env node
/**
 * One-pass cleanup of the static atlas data in public/atlas. Safe to re-run:
 * every step checks the current state before changing anything.
 *
 *   node scripts/fix-atlas-data.mjs          # fix files in place
 *   node scripts/fix-atlas-data.mjs --check  # report only, exit 1 if anything would change
 *
 * What it fixes:
 *  1. Places filed under the wrong state are moved to the right one (ids stay
 *     the same so existing check-ins keep working).
 *  2. Places and roads whose map point sits outside the state they are listed
 *     under get a point inside that state — on their own path when they have
 *     one (multi-state drives like Route 66, roads that cross a border).
 *     Roads also get their paths clipped to the state they are listed under.
 *  3. Known bogus records are removed.
 *  4. State bounding boxes in meta.json / atlas.json are recomputed from the
 *     state outlines, and the per-category / per-state counts are refreshed.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ATLAS = path.join(ROOT, "public", "atlas");
const CHECK = process.argv.includes("--check");

/** Records that sit in another state entirely (verified against the real location). */
const MOVES = [
  { id: "p:zoo:NC:way400983406", from: "NC", to: "NY" }, // The Wild Animal Park, Chittenango NY
  { id: "p:amusement:VA:way1158825845", from: "VA", to: "TN" }, // Wild Bear Falls, Gatlinburg TN
  { id: "p:amusement:WI:way1304627694", from: "WI", to: "IL" }, // Goebbert's Farm, Pingree Grove IL
];

/** Names double-encoded somewhere upstream (UTF-8 read as Latin-1). */
const NAME_FIXES = {
  "La Ca\u00c3\u00b1ada Flintridge": "La Ca\u00f1ada Flintridge",
  "Espa\u00c3\u00b1ola": "Espa\u00f1ola",
  "Ca\u00c3\u00b1on City": "Ca\u00f1on City",
  "Utqiag\u00cc\u0087vik": "Utqia\u0121vik",
};

/** Records with no real counterpart in the state they claim. */
const REMOVE = new Set([
  "r:AZ:SR:464:", // no AZ 464; the point is in Louisiana and there is no geometry
]);

/** How far (degrees) a point may sit outside its state's simplified outline before it counts as misplaced. */
const OUTSIDE = 0.2;
/** How close (degrees) a path vertex must be to the state to be kept when clipping. */
const KEEP = 0.05;

const changes = [];
const note = (msg) => changes.push(msg);

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const dirty = new Map();
function save(file, data) {
  dirty.set(file, data);
}

// ---------------------------------------------------------------- geometry
const statesGeo = readJson(path.join(ATLAS, "states.geojson"));
const STATES = {};
for (const f of statesGeo.features) {
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  STATES[f.properties.abbr] = { abbr: f.properties.abbr, name: f.properties.name, polys };
}

// The outline file stores the far Aleutians past -180 so Alaska is one shape.
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

function inside(st, lon, lat) {
  const x = normLon(st, lon);
  return st.polys.some((p) => inRing(x, lat, p[0]) && !p.slice(1).some((h) => inRing(x, lat, h)));
}

function nearestOnBoundary(st, lon, lat) {
  const x = normLon(st, lon);
  const k = Math.cos((lat * Math.PI) / 180);
  let best = { d: Infinity, x, y: lat };
  for (const p of st.polys)
    for (const ring of p)
      for (let i = 1; i < ring.length; i++) {
        const [ax, ay] = ring[i - 1];
        const [bx, by] = ring[i];
        const dx = (bx - ax) * k;
        const dy = by - ay;
        let t = ((x - ax) * k * dx + (lat - ay) * dy) / (dx * dx + dy * dy || 1);
        t = Math.max(0, Math.min(1, t));
        const px = ax + t * (bx - ax);
        const py = ay + t * (by - ay);
        const d = Math.hypot((x - px) * k, lat - py);
        if (d < best.d) best = { d, x: px, y: py };
      }
  return best;
}

function distOutside(st, lon, lat) {
  return inside(st, lon, lat) ? 0 : nearestOnBoundary(st, lon, lat).d;
}

const round = (v, places) => Math.round(v * 10 ** places) / 10 ** places;

/** A point just inside the state, as close as possible to (lon, lat). */
function pullInside(st, lon, lat, places) {
  const b = nearestOnBoundary(st, lon, lat);
  for (const r of [0.01, 0.02, 0.05, 0.1, 0.2]) {
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const x = b.x + Math.cos(ang) * r;
      const y = b.y + Math.sin(ang) * r;
      const outLon = x < -180 ? x + 360 : x;
      if (inside(st, outLon, y)) return [round(outLon, places), round(y, places)];
    }
  }
  return null;
}

/** The in-state path vertex nearest the middle of the in-state part of the path. */
function pointOnPath(st, paths, places) {
  const pts = paths.flat().filter(([x, y]) => distOutside(st, x, y) <= KEEP);
  if (!pts.length) return null;
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let best = pts[0];
  let bd = Infinity;
  for (const p of pts) {
    const d = (p[0] - mx) ** 2 + (p[1] - my) ** 2;
    if (d < bd) [bd, best] = [d, p];
  }
  return [round(best[0], places), round(best[1], places)];
}

/** The path vertex closest to the state (or `fallback` when there is no path). */
function nearestVertex(st, paths, fallback) {
  let best = fallback;
  let bd = Infinity;
  for (const p of (paths ?? []).flat()) {
    const d = distOutside(st, p[0], p[1]);
    if (d < bd) [bd, best] = [d, p];
  }
  return best;
}

function clipPaths(st, paths) {
  const out = [];
  for (const line of paths) {
    let run = [];
    for (const p of line) {
      if (distOutside(st, p[0], p[1]) <= KEEP) run.push(p);
      else {
        if (run.length >= 2) out.push(run);
        run = [];
      }
    }
    if (run.length >= 2) out.push(run);
  }
  return out;
}

const decimals = (v) => {
  const s = String(v);
  const i = s.indexOf(".");
  return i < 0 ? 4 : Math.max(4, s.length - i - 1);
};

// ---------------------------------------------------------------- places
const placeFile = (st) => path.join(ATLAS, "places", `${st}.json`);
const catFile = (cat, st) => path.join(ATLAS, "cat", cat, `${st}.json`);
const places = {};
for (const st of Object.keys(STATES)) places[st] = readJson(placeFile(st));

for (const move of MOVES) {
  const src = places[move.from];
  for (const [cat, rows] of Object.entries(src)) {
    const i = rows.findIndex((row) => row.id === move.id);
    if (i < 0) continue;
    const [row] = rows.splice(i, 1);
    const dest = (places[move.to][cat] ??= []);
    if (!dest.some((r) => r.id === row.id)) {
      dest.push(row);
      dest.sort((a, b) => a.name.localeCompare(b.name));
    }
    note(`moved ${row.name} (${cat}) ${move.from} -> ${move.to}`);
  }
}

for (const [st, bundle] of Object.entries(places)) {
  for (const rows of Object.values(bundle)) {
    for (const row of rows) {
      const fixed = NAME_FIXES[row.name];
      if (fixed) {
        note(`${st} renamed ${JSON.stringify(row.name)} -> ${fixed}`);
        row.name = fixed;
      }
    }
  }
}

// The town list the map's town outlines are built from (scripts/build-towns-overlay.py).
{
  const file = path.join(ATLAS, "towns-cities.csv");
  const text = fs.readFileSync(file, "utf8");
  let next = text;
  for (const [bad, good] of Object.entries(NAME_FIXES)) next = next.split(`${bad},`).join(`${good},`);
  if (next !== text) {
    note("towns-cities.csv: fixed garbled town names");
    if (!CHECK) fs.writeFileSync(file, next);
  }
}

for (const [st, bundle] of Object.entries(places)) {
  for (const [cat, rows] of Object.entries(bundle)) {
    if (cat === "county") continue;
    for (const row of rows) {
      if (row.lat == null || row.lon == null) continue;
      if (distOutside(STATES[st], row.lon, row.lat) <= OUTSIDE) continue;
      // Islands and capes the simplified outline leaves out are fine; only
      // fix points that land inside some other state.
      const other = Object.values(STATES).find((s) => s.abbr !== st && inside(s, row.lon, row.lat));
      if (!other) continue;
      const places4 = decimals(row.lat);
      const fixed =
        (row.paths?.length ? pointOnPath(STATES[st], row.paths, places4) : null) ??
        pullInside(
          STATES[st],
          ...nearestVertex(STATES[st], row.paths, [row.lon, row.lat]),
          places4,
        );
      if (!fixed) continue;
      note(
        `${st} ${cat} ${row.name}: point ${row.lat},${row.lon} (in ${other.abbr}) -> ${fixed[1]},${fixed[0]}`,
      );
      row.lon = fixed[0];
      row.lat = fixed[1];
    }
  }
}

// ---------------------------------------------------------------- roads
const roads = {};
const roadPoint = new Map();
for (const st of Object.keys(STATES)) {
  const file = path.join(ATLAS, "roads", `${st}.json`);
  const rows = readJson(file);
  const kept = [];
  for (const road of rows) {
    if (REMOVE.has(road.id)) {
      note(`removed ${road.id} (${road.name})`);
      continue;
    }
    kept.push(road);
    if (distOutside(STATES[st], road.lon, road.lat) <= OUTSIDE) continue;
    // Same rule as places: a point offshore with no path to snap to (island
    // routes the simplified outline leaves out) is left alone.
    const inOther = Object.values(STATES).some(
      (s) => s.abbr !== st && inside(s, road.lon, road.lat),
    );
    if (!inOther && !road.paths?.length) continue;
    const places5 = decimals(road.lat);
    let fixed = null;
    if (road.paths?.length) {
      const clipped = clipPaths(STATES[st], road.paths);
      if (clipped.length) {
        const before = road.paths.flat().length;
        const after = clipped.flat().length;
        if (after !== before)
          note(`${st} ${road.name}: clipped path to state (${before} -> ${after} points)`);
        road.paths = clipped;
        fixed = pointOnPath(STATES[st], clipped, places5);
      }
    }
    fixed ??= pullInside(STATES[st], road.lon, road.lat, places5);
    if (!fixed) continue;
    note(`${st} ${road.name}: point ${road.lat},${road.lon} -> ${fixed[1]},${fixed[0]}`);
    road.lon = fixed[0];
    road.lat = fixed[1];
  }
  if (kept.length !== rows.length || changes.some((c) => c.startsWith(`${st} `))) save(file, kept);
  roads[st] = kept;
  for (const road of kept) roadPoint.set(road.id, road);
}

// ---------------------------------------------------------------- points
// One scale for the whole atlas (see docs/points.md). Baseline: a county is 10.
// Rare, hard-to-reach or nationally significant places are worth the most;
// everyday stops that number in the thousands are worth the least. Each rule
// is safe to re-run: it maps both the old and the new values to the new ones.
const big = (row, oldBig, newBig) => row.pts >= oldBig || row.pts === newBig;
/** Added from OpenStreetMap / Wikidata by scripts/import-places.mjs (not the hand-picked starter list). */
const imported = (row) => /:(node|way|rel)\d+$|:wdQ\d+$/.test(row.id);
const POINTS = {
  highpoint: () => 50,
  capitol: () => 40,
  president: () => 40,
  forest: () => 40,
  seashore: () => 40,
  battlefield: () => 40,
  drive: () => 30,
  cave: () => 25,
  // The famous falls 25; the thousands of other named falls 15.
  waterfall: (row) => (imported(row) ? 15 : 25),
  refuge: () => 25,
  fort: () => 25,
  span: (row) => (big(row, 50, 30) ? 30 : 15),
  zoo: () => 20,
  lighthouse: () => 20,
  amusement: (row) => (big(row, 40, 20) ? 20 : 10),
  airport: (row) => (big(row, 50, 20) ? 20 : 10),
  historic: () => 15,
  museum: () => 15,
  garden: () => 15,
  cemetery: () => 15,
  bridge: () => 15,
  roadside: () => 15,
  // Classic diners 15; every other diner 10.
  diner: (row) => (imported(row) ? 10 : 15),
  drivein: () => 15,
  // Historic districts and larger listings (30 before) 15, single buildings 10.
  register: (row) => (row.pts === 30 || row.pts === 15 ? 15 : 10),
  beach: () => 10,
  stadium: () => 10,
  brewery: () => 10,
  winery: () => 10,
  distillery: () => 10,
  food: () => 10,
  mall: () => 5,
  market: () => 5,
  chain: () => 5,
  unesco: () => 50,
  peak: () => 30,
  space: () => 30,
  geo: (row) => (row.pts === 20 ? 20 : 30), // marked tri-state corners 20
  landmark: () => 20,
  dam: () => 20,
  ship: () => 20,
  hotspring: () => 15,
  pass: () => 15,
  lake: () => 15,
  railroad: () => 15,
  aviation: () => 15,
  observatory: () => 15,
  ghost: () => 15,
  ski: () => 15,
  tunnel: () => 15,
  crossing: (row) => (row.pts === 15 ? 15 : 10), // the six biggest rivers 15
  stateline: () => 10,
  college: () => 10,
  ferry: () => 10,
};
let repriced = 0;
for (const bundle of Object.values(places)) {
  for (const [cat, rows] of Object.entries(bundle)) {
    const rule = POINTS[cat];
    if (!rule) continue;
    for (const row of rows) {
      const next = rule(row);
      if (row.pts !== next) {
        row.pts = next;
        repriced++;
      }
    }
  }
}
if (repriced) note(`points: ${repriced} place(s) repriced`);

// ---------------------------------------------------------------- register duplicates
// A National Register listing that is already in the atlas under another
// category (Fort Pulaski as a historic site, the Cannonball House as a
// museum) is dropped, and the other entry is marked as listed, so it's one
// pin, counted once, and its card says it's on the Register.
const normName = (name) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const milesApart = (a, b) => {
  const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot((a.lat - b.lat) * 69.05, (a.lon - b.lon) * 69.17 * k);
};
const GENERIC = new Set(
  "museum house home mansion homestead castle station light lighthouse historic historical site park state national monument memorial district building center centre and of the farm".split(" "),
);
// Kept in src/lib so the server (marks.ts) and the app can both import it.
const ALSO_FILE = path.join(ROOT, "src", "lib", "register-also.json");
const also = {};
let merged = 0;
for (const bundle of Object.values(places)) {
  const others = [];
  for (const [cat, rows] of Object.entries(bundle)) {
    // A town, county or store isn't the same thing as a listed building in it.
    if (["register", "county", "town", "reservation", "chain", "market", "mall"].includes(cat)) continue;
    for (const row of rows) if (row.lat != null && row.lon != null) others.push({ row, key: normName(row.name) });
  }
  const byName = new Map();
  for (const other of others) {
    const list = byName.get(other.key) ?? [];
    list.push(other);
    byName.set(other.key, list);
  }
  const kept = [];
  for (const reg of bundle.register ?? []) {
    const key = normName(reg.name);
    let match = null;
    if (reg.lat != null && reg.lon != null) {
      for (const other of byName.get(key) ?? []) {
        if (milesApart(reg, other.row) <= 0.75) {
          match = other.row;
          break;
        }
      }
      // The same name plus only generic words, very close by ("Hammond
      // Castle" / "Hammond Castle Museum", "Bass Harbor Head Light" / "... Light Station").
      if (!match && key.length >= 8) {
        for (const other of others) {
          if (other.key.length < 8) continue;
          const [short, long] = key.length <= other.key.length ? [key, other.key] : [other.key, key];
          if (short === long || !long.startsWith(`${short} `)) continue;
          const extra = long.slice(short.length).trim().split(" ");
          if (!extra.every((word) => GENERIC.has(word))) continue;
          if (milesApart(reg, other.row) <= 0.3) {
            match = other.row;
            break;
          }
        }
      }
    }
    if (match) {
      also[match.id] = reg.id;
      merged++;
    } else kept.push(reg);
  }
  if (bundle.register && kept.length !== bundle.register.length) bundle.register = kept;
}
// Earlier runs already removed their duplicates; keep what they found.
const prevAlso = fs.existsSync(ALSO_FILE) ? readJson(ALSO_FILE) : {};
const alsoAll = { ...prevAlso, ...also };
if (merged) note(`register: ${merged} duplicate listing(s) merged into the existing place`);
save(ALSO_FILE, Object.fromEntries(Object.entries(alsoAll).sort(([a], [b]) => (a < b ? -1 : 1))));

// ---------------------------------------------------------------- write places + per-category copies
for (const [st, bundle] of Object.entries(places)) {
  save(placeFile(st), bundle);
  for (const [cat, rows] of Object.entries(bundle)) {
    if (cat === "county") continue;
    save(catFile(cat, st), rows);
  }
}

// ---------------------------------------------------------------- atlas.json + meta.json
const atlas = readJson(path.join(ATLAS, "atlas.json"));
atlas.routes = atlas.routes.filter((r) => {
  if (REMOVE.has(r.id)) return false;
  const road = roadPoint.get(r.id);
  if (road) {
    r.lat = round(road.lat, 4);
    r.lon = round(road.lon, 4);
  }
  return true;
});

function bboxOf(st) {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of st.polys)
    for (const [x, y] of p[0]) {
      w = Math.min(w, x);
      e = Math.max(e, x);
      s = Math.min(s, y);
      n = Math.max(n, y);
    }
  return { w: round(Math.max(w, -180), 3), s: round(s, 3), e: round(e, 3), n: round(n, 3) };
}

const meta = readJson(path.join(ATLAS, "meta.json"));
for (const entry of meta.states) {
  const box = bboxOf(STATES[entry.abbr]);
  if (entry.w !== box.w || entry.s !== box.s || entry.e !== box.e || entry.n !== box.n)
    note(`bbox ${entry.abbr}`);
  Object.assign(entry, box);
}
for (const [abbr, entry] of Object.entries(atlas.states)) {
  Object.assign(entry, bboxOf(STATES[abbr]));
  entry.routes = roads[abbr].length;
}

const counts = {};
for (const bundle of Object.values(places))
  for (const [cat, rows] of Object.entries(bundle)) counts[cat] = (counts[cat] ?? 0) + rows.length;
counts.route = Object.values(roads).reduce((s, rows) => s + rows.length, 0);
for (const c of meta.categories) if (counts[c.id] != null) c.count = counts[c.id];

save(path.join(ATLAS, "atlas.json"), atlas);
save(path.join(ATLAS, "meta.json"), meta);

// ---------------------------------------------------------------- flush
let written = 0;
for (const [file, data] of dirty) {
  const text = JSON.stringify(data);
  const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (prev === text) continue;
  // Keep files byte-identical when only key order / formatting would differ.
  if (prev != null && JSON.stringify(JSON.parse(prev)) === text) continue;
  written++;
  if (!CHECK) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

for (const c of changes) console.log(c);
console.log(
  `${changes.length} change(s), ${written} file(s) ${CHECK ? "would change" : "written"}`,
);
if (CHECK && written) process.exit(1);
