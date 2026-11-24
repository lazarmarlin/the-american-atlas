#!/usr/bin/env node
/**
 * Rewrites the "Add N <things>" badges (ids place:<category>:<n> and
 * place:<category>:all) in src/lib/badge-defs.ts from the current atlas counts,
 * for the categories below. Other badges are left as they are. Re-run after
 * scripts/import-places.mjs.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const FILE = path.join(ROOT, "src", "lib", "badge-defs.ts");

/** category: [group, singular, plural] */
const CATS = {
  cave: ["Caves", "cave", "caves"],
  winery: ["Wineries", "winery", "wineries"],
  distillery: ["Distilleries", "distillery", "distilleries"],
  fort: ["Forts", "fort", "forts"],
  battlefield: ["Battlefields", "battlefield", "battlefields"],
  president: ["Presidents", "presidential site", "presidential sites"],
  drivein: ["Drive-ins", "drive-in", "drive-ins"],
  diner: ["Diners", "diner", "diners"],
  waterfall: ["Waterfalls", "waterfall", "waterfalls"],
  drive: ["Scenic drives", "scenic drive", "scenic drives"],
  bridge: ["Bridges", "covered bridge", "covered bridges"],
  crossing: ["River crossings", "river crossing", "river crossings"],
  stateline: ["State lines", "state line", "state lines"],
  landmark: ["Natural landmarks", "natural landmark", "natural landmarks"],
  hotspring: ["Hot springs", "hot spring", "hot springs"],
  peak: ["Fourteeners", "fourteener", "fourteeners"],
  pass: ["Mountain passes", "mountain pass", "mountain passes"],
  dam: ["Dams", "dam", "dams"],
  lake: ["Lakes", "lake", "lakes"],
  ship: ["Museum ships", "museum ship", "museum ships"],
  railroad: ["Heritage railroads", "heritage railroad", "heritage railroads"],
  aviation: ["Air & space museums", "air & space museum", "air & space museums"],
  space: ["Space centers", "space center", "space centers"],
  observatory: ["Observatories", "observatory", "observatories"],
  geo: ["Geographic oddities", "geographic oddity", "geographic oddities"],
  ghost: ["Ghost towns", "ghost town", "ghost towns"],
  unesco: ["World Heritage", "World Heritage site", "World Heritage sites"],
  ski: ["Ski areas", "ski area", "ski areas"],
  college: ["Colleges", "college", "colleges"],
  ferry: ["Ferries", "ferry", "ferries"],
  tunnel: ["Tunnels", "tunnel", "tunnels"],
};
const WORDS = { 1: "One", 5: "Five", 10: "Ten", 25: "25", 50: "50", 100: "100", 250: "250", 500: "500" };

const meta = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "atlas", "meta.json"), "utf8"));
const counts = {};
for (const st of meta.states) {
  const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "atlas", "places", `${st.abbr}.json`), "utf8"));
  for (const [cat, rows] of Object.entries(bundle)) counts[cat] = (counts[cat] ?? 0) + new Set(rows.map((r) => r.id)).size;
}
// Multi-state drives are one place listed in several states.
{
  const ids = new Set();
  for (const st of meta.states) {
    const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "atlas", "places", `${st.abbr}.json`), "utf8"));
    for (const r of bundle.drive ?? []) ids.add(r.id);
  }
  counts.drive = ids.size;
}

const text = fs.readFileSync(FILE, "utf8");
const start = text.indexOf("[");
const end = text.lastIndexOf("]") + 1;
const defs = JSON.parse(text.slice(start, end));
const ours = new RegExp(`^place:(${Object.keys(CATS).join("|")}):`);
const kept = defs.filter((d) => !ours.test(d.id));
const fresh = [];
for (const [cat, [group, one, many]] of Object.entries(CATS)) {
  const total = counts[cat] ?? 0;
  if (!total) continue;
  for (const n of [1, 5, 10, 25, 50, 100, 250, 500]) {
    if (n >= total) break;
    fresh.push({ id: `place:${cat}:${n}`, group, name: `${WORDS[n]} ${n === 1 ? one : many}`, detail: `Add ${n} ${n === 1 ? one : many}.`, metric: "match", total: n, category: cat });
  }
  if (total <= 150) fresh.push({ id: `place:${cat}:all`, group, name: `Every ${one}`, detail: `Add all ${total} ${total === 1 ? one : many}.`, metric: "match", total, category: cat });
}
// Keep each group together, in the order the old file had them, new groups at the end.
const order = [...new Set(kept.map((d) => d.group))];
const out = [];
for (const g of order) {
  out.push(...kept.filter((d) => d.group === g));
  out.push(...fresh.filter((d) => d.group === g));
}
out.push(...fresh.filter((d) => !order.includes(d.group)));
fs.writeFileSync(FILE, text.slice(0, start) + JSON.stringify(out) + text.slice(end));
console.log(`badges: ${defs.length} -> ${out.length} (${fresh.length} category ladders)`);
