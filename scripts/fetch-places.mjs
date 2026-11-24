#!/usr/bin/env node
/**
 * Downloads raw place data for scripts/import-places.mjs from OpenStreetMap
 * (Overpass) and Wikidata. Runs in GitHub Actions (.github/workflows/fetch-places.yml)
 * because the build machines can't reach those hosts; the result is uploaded as
 * an artifact and imported locally.
 *
 *   OVERPASS_KEY=... node scripts/fetch-places.mjs [job ...]   # writes raw-places/*.json
 *
 * With OVERPASS_KEY set, overpass.ch is tried first; the public Overpass
 * servers are the fallback.
 */
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(process.env.OUT_DIR ?? "raw-places");
fs.mkdirSync(OUT, { recursive: true });
const KEY = process.env.OVERPASS_KEY ?? "";
const UA = "TheAmericanAtlas/1.0 (https://github.com/lazarmarlin/the-american-atlas)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const US = `area["ISO3166-1"="US"][admin_level=2]->.us;`;
const RIVERS = [
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
];

/** Overpass jobs: [name, query body]. Every query ends in `out center tags;` unless it needs geometry. */
const OSM = {
  winery: `${US}(nwr["craft"="winery"]["name"](area.us);nwr["tourism"="winery"]["name"](area.us);nwr["shop"="winery"]["name"](area.us););out center tags;`,
  distillery: `${US}(nwr["craft"="distillery"]["name"](area.us);nwr["industrial"="distillery"]["name"](area.us);nwr["craft"="spirits"]["name"](area.us););out center tags;`,
  cave: `${US}(nwr["natural"="cave_entrance"]["name"]["tourism"](area.us);nwr["natural"="cave_entrance"]["name"]["fee"](area.us);nwr["tourism"="attraction"]["name"~"Cavern|Cave",i](area.us);nwr["show_cave"="yes"](area.us););out center tags;`,
  fort: `${US}(nwr["historic"="fort"]["name"](area.us);nwr["historic"="castle"]["castle_type"~"fortress|defensive"]["name"](area.us););out center tags;`,
  battlefield: `${US}nwr["historic"="battlefield"]["name"](area.us);out center tags;`,
  drivein: `${US}(nwr["amenity"="cinema"]["drive_in"="yes"](area.us);nwr["amenity"="cinema"]["name"~"Drive[- ]?In",i](area.us););out center tags;`,
  diner: `${US}nwr["amenity"="restaurant"]["cuisine"~"(^|;)diner(;|$)"]["name"][!"brand"](area.us);out center tags;`,
  waterfall: `${US}(nwr["waterway"="waterfall"]["name"](area.us);nwr["natural"="waterfall"]["name"](area.us););out center tags;`,
  coveredbridge: `${US}way["bridge"]["covered"="yes"]["name"](area.us);out center tags;`,
  hotspring: `${US}nwr["natural"="hot_spring"]["name"](area.us);out center tags;`,
  landmark: `${US}(nwr["natural"~"^(arch|volcano|geyser|dune)$"]["name"](area.us);nwr["natural"~"^(rock|stone|cliff|peak)$"]["name"]["wikidata"]["tourism"](area.us););out center tags;`,
  peak: `${US}node["natural"="peak"]["name"]["ele"](if:number(t["ele"])>=4267)(area.us);out tags;`,
  pass: `${US}node["mountain_pass"="yes"]["name"](area.us)->.p;way(bn.p)["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified)$"];node.p(w);out tags;(nwr["name"~"Continental Divide"]["tourism"](area.us);nwr["name"~"Continental Divide"]["historic"](area.us););out center tags;`,
  ski: `${US}nwr["landuse"="winter_sports"]["name"](area.us);out center tags;`,
  college: `${US}nwr["amenity"="university"]["name"]["wikidata"](area.us);out center tags;`,
  ferry: `${US}nwr["amenity"="ferry_terminal"]["name"](area.us);out center tags;`,
  tristate: `${US}nwr["historic"="boundary_stone"]["name"~"tri|corner|four",i](area.us);out center tags;`,
  lincoln: `${US}relation["route"="road"]["name"~"^(Lincoln Highway|Dixie Highway|Great River Road|Natchez Trace Parkway|Blue Ridge Parkway|Pacific Coast Highway|Overseas Highway|Oregon Trail|Santa Fe Trail|Mormon Trail|Lewis and Clark Trail|Historic Columbia River Highway|Going-to-the-Sun Road|Beartooth Highway|Pony Express)"](area.us);out geom;`,
  // Overpass-only: name patterns (osmium can only match exact names).
  byway: `${US}relation["route"="road"]["name"~"Scenic Byway|Scenic Highway|Scenic Drive|All-American Road|Scenic Route|Scenic Loop|Byway$",i](area.us);out geom;`,
  historic: `${US}relation["route"~"^(road|hiking|historic|foot|bicycle)$"]["name"~"^(Historic )?(Lincoln Highway|Dixie Highway|Santa Fe Trail|Santa Fe National Historic Trail|Oregon Trail|Oregon National Historic Trail|California Trail|California National Historic Trail|Mormon (Pioneer )?Trail|Mormon Pioneer National Historic Trail|Pony Express|Lewis (and|&) Clark|Trail of Tears|Old Spanish (Trail|National Historic Trail)|El Camino Real|Jefferson Highway|Yellowstone Trail|National Road|Historic National Road|Great River Road|Bankhead Highway|Lee Highway|Victory Highway|Arrow Highway|Meridian Highway|Atlantic Highway|Mohawk Trail|Natchez Trace)",i](area.us);out geom;`,
  ship: `${US}nwr["historic"="ship"]["name"](area.us);out center tags;`,
  preslib: `${US}nwr["name"~"Presidential (Library|Center|Museum)|Presidential Library|Presidential Site|Birthplace of President",i](area.us);out center tags;`,
  rivers: `${US}relation["waterway"="river"]["name"~"^(${RIVERS.join("|")})$"](area.us);out geom;`,
};

/** Wikidata jobs. Each returns ?item ?itemLabel ?coord and optional extras. */
const PRES = `?pres wdt:P39 wd:Q11696 .`;
const base = (inner, extra = "") => `
SELECT DISTINCT ?item ?itemLabel ?coord ?links ${extra} WHERE {
  ${inner}
  ?item wdt:P17 wd:Q30 ; wdt:P625 ?coord .
  OPTIONAL { ?item wikibase:sitelinks ?links . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
const ofClass = (...labels) =>
  `VALUES ?clsLabel { ${labels.map((l) => `"${l}"@en`).join(" ")} } ?cls rdfs:label ?clsLabel . ?item wdt:P31/wdt:P279* ?cls .`;
const WD = {
  unesco: base(`?item wdt:P1435 wd:Q9259 .`),
  nnl: base(`?des rdfs:label "National Natural Landmark"@en . ?item wdt:P1435 ?des .`),
  showcave: base(ofClass("show cave")),
  coveredbridge: base(ofClass("covered bridge")),
  byway: base(`VALUES ?dl { "National Scenic Byway"@en "All-American Road"@en } ?des rdfs:label ?dl . { ?item wdt:P31 ?des } UNION { ?item wdt:P1435 ?des } .`),
  preslib: base(ofClass("presidential library")),
  presgrave: base(`${PRES} ?pres wdt:P119 ?item .`, "?presLabel"),
  preshome: base(`${PRES} ?item wdt:P466 ?pres .`, "?presLabel"),
  presnamed: base(`${PRES} ?item wdt:P138 ?pres . ?item wdt:P31 ?t . ?t rdfs:label ?tl . FILTER(LANG(?tl) = "en" && REGEX(?tl, "museum|house|home|library|memorial|birthplace|tomb|mausoleum|historic site|historical park|monument|ranch|plantation|estate", "i"))`, "?presLabel"),
  museumship: base(ofClass("museum ship")),
  heritagerail: base(ofClass("heritage railway", "heritage railroad", "tourist railroad")),
  aviation: base(ofClass("aviation museum", "aerospace museum", "air museum")),
  spaceport: base(ofClass("spaceport", "rocket launch site", "NASA facility")),
  observatory: base(`${ofClass("astronomical observatory")} ?item wikibase:sitelinks ?sl . FILTER(?sl >= 2)`),
  planetarium: base(ofClass("planetarium")),
  ghost: base(ofClass("ghost town")),
  skiresort: base(ofClass("ski resort", "ski area")),
  tunnel: base(`${ofClass("road tunnel")} OPTIONAL { ?item wdt:P2043 ?len . }`, "?len"),
  dam: base(`?item wdt:P31/wdt:P279* wd:Q12323 . OPTIONAL { ?item p:P2048/psn:P2048/wikibase:quantityAmount ?h . } ?item wikibase:sitelinks ?sl . FILTER(?sl >= 4 || ?h >= 60)`, "?h"),
  lake: base(`VALUES ?t { wd:Q23397 wd:Q131681 } ?item wdt:P31 ?t . ?item p:P2046/psn:P2046/wikibase:quantityAmount ?area . FILTER(?area >= 100000000)`, "?area"),
  drivein: base(ofClass("drive-in theater")),
  winery: base(ofClass("winery")),
  fort: base(`${ofClass("fort")} ?item wikibase:sitelinks ?sl . FILTER(?sl >= 1)`),
  battlefield: base(`${ofClass("battlefield")}`),
  waterfall: base(`?item wdt:P31/wdt:P279* wd:Q34038 .`),
  // Byway names and states (most byways have no point on Wikidata); lines come from Overpass.
  bywaynames: `
SELECT DISTINCT ?item ?itemLabel ?stateLabel ?desLabel WHERE {
  VALUES ?dl { "National Scenic Byway"@en "All-American Road"@en }
  ?des rdfs:label ?dl .
  { ?item wdt:P31 ?des } UNION { ?item wdt:P1435 ?des } .
  OPTIONAL { ?item wdt:P131 ?state . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`,
  preslib2: `
SELECT DISTINCT ?item ?itemLabel ?coord ?links WHERE {
  VALUES ?q { "presidential library" "presidential center" "presidential museum" "presidential library and museum" }
  SERVICE wikibase:mwapi {
    bd:serviceParam wikibase:endpoint "www.wikidata.org"; wikibase:api "EntitySearch"; mwapi:search ?q; mwapi:language "en"; mwapi:limit "50" .
    ?item wikibase:apiOutputItem mwapi:item .
  }
  ?item wdt:P17 wd:Q30 ; wdt:P625 ?coord .
  OPTIONAL { ?item wikibase:sitelinks ?links . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`,
};

const ENDPOINTS = [
  ...(KEY
    ? [
        { url: `https://api.overpass.ch/v1/${KEY}/interpreter`, headers: {} },
        { url: "https://api.overpass.ch/v1/interpreter", headers: { "X-API-Key": KEY } },
        { url: "https://api.overpass.ch/api/interpreter", headers: { Authorization: `Bearer ${KEY}` } },
        { url: "https://overpass.ch/api/interpreter", headers: { Authorization: `Bearer ${KEY}` } },
      ]
    : []),
  { url: "https://overpass-api.de/api/interpreter", headers: {} },
  { url: "https://overpass.private.coffee/api/interpreter", headers: {} },
  { url: "https://maps.mail.ru/osm/tools/overpass/api/interpreter", headers: {} },
];

async function overpass(ep, query, timeout = 600) {
  const size = timeout > 60 ? "[maxsize:1073741824]" : "";
  const body = new URLSearchParams({ data: `[out:json][timeout:${timeout}]${size};${query}` });
  const res = await fetch(ep.url, {
    method: "POST",
    body,
    headers: { "User-Agent": UA, ...ep.headers },
    signal: AbortSignal.timeout((timeout + 120) * 1000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  if (json.remark && /error|timed out|runtime/i.test(json.remark) && !json.elements?.length) throw new Error(json.remark);
  return json;
}

const working = [];
for (const ep of ENDPOINTS) {
  try {
    const r = await overpass(ep, `node(1);out;`, 20);
    if (r.elements) {
      working.push(ep);
      console.log("overpass ok:", ep.url.replace(KEY, "***"));
    }
  } catch (e) {
    console.log("overpass no:", ep.url.replace(KEY, "***"), String(e.message).slice(0, 120));
  }
}

const only = process.argv.slice(2);
const want = (name) => !only.length || only.includes(name);
const summary = {};

if (!working.length) console.log("No Overpass server answered; skipping OpenStreetMap jobs.");
for (const [name, query] of Object.entries(OSM)) {
  if (!working.length) break;
  if (!want(`osm-${name}`) && !want(name)) continue;
  let done = false;
  for (let attempt = 0; attempt < 3 && !done; attempt++) {
    for (const ep of working) {
      try {
        const json = await overpass(ep, query);
        fs.writeFileSync(path.join(OUT, `osm-${name}.json`), JSON.stringify(json.elements));
        summary[`osm-${name}`] = json.elements.length;
        console.log(`osm-${name}: ${json.elements.length}`);
        done = true;
        break;
      } catch (e) {
        console.log(`osm-${name} failed on ${ep.url.replace(KEY, "***")}: ${String(e.message).slice(0, 160)}`);
        await sleep(5000);
      }
    }
    if (!done) await sleep(30000);
  }
  if (!done) summary[`osm-${name}`] = "FAILED";
}

/** Join a route's member ways into as few lines as possible, then simplify them (~50 m). */
function shrinkRoads(els) {
  const key = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const simplify = (line, tol) => {
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
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
        if (d > md) [md, mi] = [d, i];
      }
      if (md > tol && mi > 0) {
        keep[mi] = 1;
        stack.push([a, mi], [mi, b]);
      }
    }
    return line.filter((_, i) => keep[i]);
  };
  return els
    .filter((el) => el.type === "relation")
    .map((rel) => {
      const lines = (rel.members ?? [])
        .filter((m) => m.type === "way" && m.geometry?.length >= 2 && !/^(platform|stop)/.test(m.role ?? ""))
        .map((m) => m.geometry.map((g) => [Math.round(g.lon * 1e5) / 1e5, Math.round(g.lat * 1e5) / 1e5]));
      // Join end to end (both directions of a divided highway stay separate lines, which is fine).
      const out = [];
      while (lines.length) {
        let line = lines.pop();
        for (let grew = true; grew; ) {
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
        out.push(simplify(line, 0.0005));
      }
      const t = rel.tags ?? {};
      return { id: rel.id, tags: { ref: t.ref, network: t.network, modifier: t.modifier, name: t.name, "is_in:state": t["is_in:state"] }, lines: out };
    });
}

/** Jobs that run one query per state or per river and merge the results. */
const STATE_CODES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
const ROAD = `["highway"~"^(motorway|trunk|primary)$"]["ref"~"(^|;) *(I|US)[ -]?[0-9]"]`;
const LOOPS = {
  // Each state's border plus the Interstate / U.S. route ways that touch it.
  statelines: STATE_CODES.filter((c) => c !== "HI" && c !== "AK").map((c) => [
    c,
    `rel["ISO3166-2"="US-${c}"]["admin_level"="4"];way(r)->.b;.b out geom;way(around.b:0)${ROAD};out geom;`,
  ]),
  // Every Interstate and U.S. route relation in the state, with its lines
  // (simplified before saving; see shrinkRoads).
  roads: STATE_CODES.map((c) => [
    c,
    `area["ISO3166-2"="US-${c}"]["admin_level"="4"]->.a;relation["type"="route"]["route"="road"]["network"~"^US:(I|US)"](area.a);out geom;`,
  ]),
  // Interstate / U.S. route bridges over each big river.
  riverbridges: RIVERS.map((r) => [
    r,
    `${US}rel["waterway"="river"]["name"="${r}"](area.us)->.rr;way(r.rr)->.rw;way(around.rw:25)["bridge"]${ROAD};out center tags;`,
  ]),
};
for (const [name, parts] of Object.entries(LOOPS)) {
  if (!working.length) break;
  if (!want(`osm-${name}`) && !want(name)) continue;
  const all = {};
  for (const [part, query] of parts) {
    let done = false;
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      for (const ep of working) {
        try {
          const els = (await overpass(ep, query, 900)).elements;
          all[part] = name === "roads" ? shrinkRoads(els) : els;
          done = true;
          break;
        } catch (e) {
          console.log(`osm-${name} ${part} failed on ${ep.url.replace(KEY, "***")}: ${String(e.message).slice(0, 160)}`);
          await sleep(5000);
        }
      }
      if (!done) await sleep(20000);
    }
    console.log(`osm-${name} ${part}: ${all[part]?.length ?? "FAILED"}`);
  }
  fs.writeFileSync(path.join(OUT, `osm-${name}.json`), JSON.stringify(all));
  summary[`osm-${name}`] = Object.keys(all).length + "/" + parts.length;
}

for (const [name, query] of Object.entries(WD)) {
  if (!want(`wd-${name}`) && !want(name)) continue;
  let done = false;
  for (let attempt = 0; attempt < 4 && !done; attempt++) {
    try {
      const res = await fetch("https://query.wikidata.org/sparql", {
        method: "POST",
        headers: { "User-Agent": UA, Accept: "application/sparql-results+json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ query }),
        signal: AbortSignal.timeout(150000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
      const rows = JSON.parse(text).results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
      fs.writeFileSync(path.join(OUT, `wd-${name}.json`), JSON.stringify(rows));
      summary[`wd-${name}`] = rows.length;
      console.log(`wd-${name}: ${rows.length}`);
      done = true;
    } catch (e) {
      console.log(`wd-${name} failed: ${String(e.message).slice(0, 200)}`);
      await sleep(15000 * (attempt + 1));
    }
  }
  if (!done) summary[`wd-${name}`] = "FAILED";
  await sleep(1500);
}

fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
