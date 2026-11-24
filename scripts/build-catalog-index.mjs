#!/usr/bin/env node
/**
 * Builds src/lib/catalog-index.json from the static atlas in public/atlas.
 *
 * The server uses it to look up the real name, category, state(s), road
 * system and points of every place a user saves, so none of those can be set
 * by the browser. Re-run after any change to public/atlas (the build does it
 * automatically):
 *
 *   node scripts/build-catalog-index.mjs          # write the index
 *   node scripts/build-catalog-index.mjs --check  # exit 1 if it is out of date
 *
 * Format: { v, groups: { "<category>|<state>|<sys>": { prefix, rows: [[id, name, pts], ...] } } }
 * Row ids are stored without the group's prefix; an id that doesn't start with
 * it is stored whole, marked with a leading "=". An id listed under several
 * states (multi-state drives) appears in each of those groups.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ATLAS = path.join(ROOT, "public", "atlas");
const OUT = path.join(ROOT, "src", "lib", "catalog-index.json");

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ATLAS, file), "utf8"));
const groups = {};
const prefixFor = (category, state, sys) =>
  category === "state"
    ? "state:"
    : category === "county"
      ? "county:"
      : category === "route"
        ? `r:${state}:${sys}:`
        : `p:${category}:${state}:`;
const add = (category, state, sys, row) => {
  const key = `${category}|${state}|${sys}`;
  const group = (groups[key] ??= { prefix: prefixFor(category, state, sys), rows: [] });
  const id = row.id.startsWith(group.prefix) ? row.id.slice(group.prefix.length) : `=${row.id}`;
  group.rows.push([id, row.name, row.pts]);
};

const meta = readJson("meta.json");
const ALSO = path.join(ROOT, "src", "lib", "register-also.json");
const also = fs.existsSync(ALSO) ? JSON.parse(fs.readFileSync(ALSO, "utf8")) : {};
for (const st of meta.states) {
  // Matches stateToMark() in src/lib/nearby.ts.
  add("state", st.abbr, "", { id: `state:${st.abbr}`, name: st.name, pts: 50 });

  const bundle = readJson(`places/${st.abbr}.json`);
  for (const [category, rows] of Object.entries(bundle)) {
    if (category === "county") continue;
    // Matches placeToMark() in src/lib/nearby.ts.
    const sys = category === "drive" ? "PK" : "";
    for (const row of rows) {
      add(category, st.abbr, sys, row);
      // A Register listing merged into this place (scripts/fix-atlas-data.mjs)
      // still resolves, to this place, for anyone who saved it before.
      if (also[row.id]) add(category, st.abbr, sys, { ...row, id: also[row.id] });
    }
  }

  // Matches countyToMark() in src/lib/counties.ts (always 10 points).
  for (const row of readJson(`counties/${st.abbr}.json`))
    add("county", st.abbr, "", { ...row, pts: 10 });

  // Matches roadToMark() in src/lib/nearby.ts.
  for (const road of readJson(`roads/${st.abbr}.json`)) add("route", st.abbr, road.sys, road);
}

for (const { rows } of Object.values(groups))
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
const sorted = Object.fromEntries(Object.entries(groups).sort(([a], [b]) => (a < b ? -1 : 1)));
const text = JSON.stringify({ v: 1, groups: sorted });

const count = Object.values(groups).reduce((s, g) => s + g.rows.length, 0);
const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
if (process.argv.includes("--check")) {
  if (current !== text) {
    console.error(
      "src/lib/catalog-index.json is out of date — run: node scripts/build-catalog-index.mjs",
    );
    process.exit(1);
  }
  console.log(`catalog index up to date (${count} entries)`);
} else if (current !== text) {
  fs.writeFileSync(OUT, text);
  console.log(`wrote catalog index (${count} entries, ${(text.length / 1e6).toFixed(1)} MB)`);
} else {
  console.log(`catalog index unchanged (${count} entries)`);
}
