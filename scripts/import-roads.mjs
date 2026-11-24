#!/usr/bin/env node
/**
 * Rebuilds the lines of every Interstate and U.S. route in public/atlas/roads
 * from OpenStreetMap route relations (the "roads" job in
 * scripts/fetch-places.mjs, one Overpass query per state), and adds routes
 * OSM has that the atlas was missing.
 *
 *   node scripts/import-roads.mjs RAW_DIR      # then: node scripts/fix-atlas-data.mjs && node scripts/build-catalog-index.mjs
 *
 * Road ids never change (r:<state>:<I|US>:<ref>:<modifier>), so saved roads
 * keep working. Prints a report: how many roads had no line, how well the old
 * lines matched OSM, and which atlas roads OSM doesn't have in that state.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ATLAS = path.join(ROOT, "public", "atlas");
const RAW = path.resolve(process.argv[2] ?? "raw-roads");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

function findRaw() {
  const dirs = [RAW, ...fs.readdirSync(RAW).map((d) => path.join(RAW, d)).filter((d) => fs.statSync(d).isDirectory())];
  for (const dir of dirs) {
    const file = path.join(dir, "osm-roads.json");
    if (fs.existsSync(file)) return readJson(file);
  }
  throw new Error(`No osm-roads.json under ${RAW}`);
}
const osm = findRaw();

const MODS = {
  business: "Business",
  "business loop": "Business Loop",
  "business spur": "Business Spur",
  alternate: "Alternate",
  bypass: "Bypass",
  spur: "Spur",
  truck: "Truck",
  connector: "Connector",
  loop: "Loop",
  express: "Express",
  historic: "Historic",
  scenic: "Scenic",
  toll: "Toll",
};
/** OSM tags -> the atlas's {sys, ref, mod}, or null. */
function routeKey(tags) {
  const net = String(tags.network ?? "");
  const m = net.match(/^US:(I|US)(?::(.+))?$/);
  if (!m) return null;
  const sys = m[1];
  const ref = String(tags.ref ?? "").replace(/^(I|US)[ -]?/i, "").replace(/^H-/i, "H").trim().toUpperCase();
  // Hawaii's Interstates are H1, H2, H3, H201; New Jersey has US 1-9.
  if (!/^([A-Z]?\d+[A-Z]?|\d+-\d+)$/.test(ref)) return null;
  // The network says more than the modifier ("US:I:Business:Loop" vs "Business").
  let raw = (m[2] ? m[2].replace(/:/g, " ") : tags.modifier ?? "").toLowerCase().trim();
  // US 25E, US 89A: the letter is part of the number, not a modifier.
  if (raw.length === 1 && ref.endsWith(raw.toUpperCase())) raw = "";
  // I-80E "East", US 70N "North": the direction is already in the number.
  if (/^(east|west|north|south)$/.test(raw) && ref.endsWith(raw[0].toUpperCase())) raw = "";
  if (raw.includes("historic")) raw = "historic";
  // Not routes you can drive as such (yet, or any more).
  if (/\b(future|old|temporary|hov|truck|proposed|unsigned|emergency|detour|local|thru)\b/.test(raw)) return null;
  const mod = raw ? (MODS[raw] ?? raw.replace(/\b\w/g, (c) => c.toUpperCase())) : "";
  return { sys, ref, mod };
}
const nameOf = ({ sys, ref, mod }) => `${sys === "I" ? `I-${ref}` : `US ${ref}`}${mod ? ` ${mod}` : ""}`;
const ptsOf = ({ sys, mod }) => (sys === "I" ? (mod ? 16 : 50) : mod === "Historic" ? 40 : mod ? 10 : 30);

const milesApart = (a, b) => {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((a[1] - b[1]) * 69.05, (a[0] - b[0]) * 69.17 * k);
};
/** Share of an old line's points within half a mile of the new lines. */
function agreement(oldPaths, newPaths) {
  const pts = oldPaths.flat();
  if (!pts.length) return null;
  const CELL = 0.02;
  const grid = new Map();
  for (const line of newPaths)
    for (const p of line) {
      const k = `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`;
      (grid.get(k) ?? grid.set(k, []).get(k)).push(p);
    }
  let near = 0;
  for (const p of pts) {
    const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL);
    let ok = false;
    for (let dx = -1; dx <= 1 && !ok; dx++)
      for (let dy = -1; dy <= 1 && !ok; dy++) for (const q of grid.get(`${cx + dx},${cy + dy}`) ?? []) if (milesApart(p, q) <= 0.5) { ok = true; break; }
    if (ok) near++;
  }
  return near / pts.length;
}

const meta = readJson(path.join(ATLAS, "meta.json"));
const STATE_CODES = new Set(meta.states.map((s) => s.abbr));
// Rough state outlines, to tell a route in this state from a neighbor's that only touches it.
const OUTLINES = Object.fromEntries(
  readJson(path.join(ATLAS, "states.geojson")).features.map((f) => [f.properties.abbr, f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates]),
);
function inRing(x, y, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
const insideShare = (st, lines) => {
  const pts = lines.flat();
  const polys = OUTLINES[st] ?? [];
  const x = (lon) => (st === "AK" && lon > 0 ? lon - 360 : lon);
  return pts.filter(([lon, lat]) => polys.some((p) => inRing(x(lon), lat, p[0]))).length / (pts.length || 1);
};
const atlas = readJson(path.join(ATLAS, "atlas.json"));
const report = { filled: 0, replaced: 0, added: 0, kept: 0, poor: [], missingInOsm: [], addedRoads: [] };
for (const st of meta.states.map((s) => s.abbr)) {
  const rels = osm[st];
  if (!Array.isArray(rels)) {
    console.log(`${st}: no OSM data (query failed?), left as is`);
    continue;
  }
  const byKey = new Map();
  for (const rel of rels) {
    const key = routeKey(rel.tags ?? {});
    if (!key || !rel.lines?.length) continue;
    // A neighboring state's relation that only touches the border.
    const tagState = rel.tags["is_in:state"] ?? (rel.tags.name ?? "").match(/\(([A-Z]{2})\)/)?.[1] ?? "";
    const states = tagState.split(/[;,]/).map((x) => x.trim()).filter((x) => STATE_CODES.has(x));
    if (states.length && !states.includes(st)) continue;
    const k = `${key.sys}:${key.ref}:${key.mod}`;
    const e = byKey.get(k) ?? byKey.set(k, { key, lines: [] }).get(k);
    e.lines.push(...rel.lines.filter((l) => l.length >= 2));
  }
  const file = path.join(ATLAS, "roads", `${st}.json`);
  const rows = readJson(file);
  const seen = new Set();
  for (const row of rows) {
    if (row.sys !== "I" && row.sys !== "US") continue;
    const k = `${row.sys}:${row.ref}:${row.id.split(":").slice(4).join(":")}`;
    const hit = byKey.get(k);
    if (!hit) {
      report.missingInOsm.push(`${st} ${row.name}`);
      report.kept++;
      continue;
    }
    seen.add(k);
    if (!row.paths?.length) report.filled++;
    else {
      const a = agreement(row.paths, hit.lines);
      if (a != null && a < 0.8) report.poor.push(`${st} ${row.name}: ${Math.round(a * 100)}% of the old line matched`);
      report.replaced++;
    }
    row.paths = hit.lines;
    const mid = hit.lines.reduce((a, b) => (b.length > a.length ? b : a));
    [row.lon, row.lat] = mid[Math.floor(mid.length / 2)];
  }
  for (const [k, { key, lines }] of byKey) {
    if (seen.has(k)) continue;
    // Only add a route that mostly lies in this state (outlines are rough, so not all).
    if (insideShare(st, lines) < 0.3) continue;
    // The same road named differently (atlas "US 14A" = OSM "US 14 Alternate",
    // "US 195" = "US 195 Spur"): give the atlas road the line instead of adding a twin.
    const twin = rows.find(
      (r) =>
        r.sys === key.sys &&
        !seen.has(`${r.sys}:${r.ref}:${r.id.split(":").slice(4).join(":")}`) &&
        !r.id.split(":").slice(4).join(":") &&
        (r.ref === key.ref || (key.mod && r.ref === `${key.ref}${key.mod[0]}`)),
    );
    if (twin) {
      seen.add(`${twin.sys}:${twin.ref}:`);
      if (!twin.paths?.length) report.filled++;
      else report.replaced++;
      twin.paths = lines;
      const mid = lines.reduce((a, b) => (b.length > a.length ? b : a));
      [twin.lon, twin.lat] = mid[Math.floor(mid.length / 2)];
      report.missingInOsm = report.missingInOsm.filter((x) => x !== `${st} ${twin.name}`);
      report.kept--;
      continue;
    }
    const id = `r:${st}:${key.sys}:${key.ref}:${key.mod}`;
    if (rows.some((r) => r.id === id)) continue;
    const mid = lines.reduce((a, b) => (b.length > a.length ? b : a));
    const [lon, lat] = mid[Math.floor(mid.length / 2)];
    const row = { id, name: nameOf(key), sys: key.sys, ref: key.ref, lat, lon, pts: ptsOf(key), paths: lines };
    rows.push(row);
    atlas.routes.push({ id, name: row.name, st, sys: key.sys, ref: key.ref, mod: key.mod, lat, lon, pts: row.pts });
    report.added++;
    report.addedRoads.push(`${st} ${row.name}`);
  }
  rows.sort((a, b) => a.sys.localeCompare(b.sys) || a.ref.localeCompare(b.ref, "en", { numeric: true }) || a.id.localeCompare(b.id));
  fs.writeFileSync(file, JSON.stringify(rows));
}
fs.writeFileSync(path.join(ATLAS, "atlas.json"), JSON.stringify(atlas));
console.log(`lines filled in (had none): ${report.filled}`);
console.log(`lines replaced with OSM's: ${report.replaced} (of those, ${report.poor.length} matched OSM poorly)`);
console.log(`roads added (OSM has them, the atlas didn't): ${report.added}`);
console.log(`atlas roads OSM doesn't have in that state (left as is): ${report.kept}`);
fs.writeFileSync(path.join(RAW, "road-report.json"), JSON.stringify(report, null, 1));
