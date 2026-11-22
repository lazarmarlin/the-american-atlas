#!/usr/bin/env python3
"""
Rebuild public/atlas/overlays/towns.json from Census TIGER place boundaries.

Output format (decoded by src/lib/towns-overlay.ts):
    {"v": 1, "scale": 10000, "towns": [[name, st, geoid, polygons], ...]}
where polygons is a list of polygons, each a list of rings, each ring a flat
list of integers: the first point as lon*scale, lat*scale, then each next
point as the difference from the previous one. About a quarter the size of
the same outlines as GeoJSON.

Source: TIGER/Line 2019 places as GeoJSON, one file per place, from
https://github.com/generalpiston/geojson-us-city-boundaries (cities/<st>/*.json).

    git clone --depth 1 https://github.com/generalpiston/geojson-us-city-boundaries /tmp/cityb
    pip install shapely
    python3 scripts/build-towns-overlay.py /tmp/cityb

The previous public/atlas/overlays/towns.geojson, if present, supplies
fallback outlines; it is no longer used by the app and can be deleted after.

What goes in: every town in public/atlas/towns-cities.csv (the app's town
list), matched to its Census boundary by GEOID — so outlines line up exactly
with the towns the app knows about. Census-designated places (unincorporated
communities) and territories are left out.

Where the source has no boundary for a town — New England / New York "towns"
(Census county subdivisions, not places), and a few cities the source lost to
same-name file collisions — the previous outline for that name and state is
kept if there was one, so nothing that used to show disappears.

Geometry is simplified to about 80 m, pieces and holes under ~2 hectares are
dropped (a tiny town keeps its largest piece), and coordinates are rounded to 4
decimals (about 10 m), to keep the file small enough to load on a phone.
"""
import csv
import glob
import json
import os
import sys

from shapely.geometry import Polygon, mapping, shape
from shapely.ops import unary_union

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "public", "atlas", "overlays", "towns.json")
OLD_GEOJSON = os.path.join(ROOT, "public", "atlas", "overlays", "towns.geojson")
TOLERANCE = 0.0008  # degrees, ~80 m
DECIMALS = 4
SCALE = 10 ** DECIMALS
MIN_AREA = 2e-6  # drop pieces and holes under ~2 hectares (5 acres)


def rounded(coords):
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], DECIMALS), round(coords[1], DECIMALS)]
    out = [rounded(c) for c in coords]
    # Rounding can repeat a vertex; drop consecutive duplicates in rings.
    if out and isinstance(out[0][0], (int, float)):
        dedup = [out[0]]
        for pt in out[1:]:
            if pt != dedup[-1]:
                dedup.append(pt)
        out = dedup
    return out


def clean(geom):
    if not geom.is_valid:
        geom = geom.buffer(0)
    geom = geom.simplify(TOLERANCE, preserve_topology=True)
    parts = [
        Polygon(g.exterior, [h for h in g.interiors if Polygon(h).area >= MIN_AREA])
        for g in getattr(geom, "geoms", [geom])
        if g.geom_type == "Polygon" and g.area >= MIN_AREA
    ]
    if not parts:
        # Very small towns: keep their largest piece rather than nothing.
        polys = [g for g in getattr(geom, "geoms", [geom]) if g.geom_type == "Polygon"]
        parts = [max(polys, key=lambda g: g.area)] if polys else []
    if not parts:
        return None
    geom = unary_union(parts) if len(parts) > 1 else parts[0]
    gj = mapping(geom)
    gj = {"type": gj["type"], "coordinates": rounded(gj["coordinates"])}
    # Rings that collapsed to fewer than 4 points after rounding are dropped.
    if gj["type"] == "Polygon":
        rings = [r for r in gj["coordinates"] if len(r) >= 4]
        if not rings:
            return None
        gj["coordinates"] = rings
    else:
        polys = [[r for r in p if len(r) >= 4] for p in gj["coordinates"]]
        polys = [p for p in polys if p]
        if not polys:
            return None
        gj = {"type": "Polygon", "coordinates": polys[0]} if len(polys) == 1 else {"type": "MultiPolygon", "coordinates": polys}
    return gj


def main(src):
    by_geoid = {}
    for path in glob.glob(os.path.join(src, "cities", "*", "*.json")):
        with open(path, encoding="utf-8") as fh:
            for feat in json.load(fh)["features"]:
                by_geoid[feat["properties"]["GEOID"]] = feat

    with open(os.path.join(ROOT, "public", "atlas", "towns-cities.csv"), encoding="utf-8") as fh:
        towns = list(csv.DictReader(fh))

    previous = {}
    if os.path.exists(OLD_GEOJSON):
        with open(OLD_GEOJSON, encoding="utf-8") as fh:
            for feat in json.load(fh)["features"]:
                p = feat["properties"]
                previous.setdefault((p["name"].lower(), p.get("st")), feat)

    features = []
    census = kept = missing = 0
    for town in towns:
        feat = by_geoid.get(town["geoid"])
        if feat:
            geom = clean(shape(feat["geometry"]))
            name = feat["properties"]["NAME"]  # Census spelling, proper UTF-8
            source = "census"
        else:
            old = previous.get((town["name"].lower(), town["state"]))
            if not old:
                missing += 1
                continue
            geom = old["geometry"]
            name = old["properties"]["name"]
            source = "previous"
        if not geom:
            missing += 1
            continue
        census += source == "census"
        kept += source == "previous"
        features.append(
            {
                "type": "Feature",
                "properties": {"name": name, "st": town["state"], "geoid": town["geoid"]},
                "geometry": geom,
            }
        )

    features.sort(key=lambda f: (f["properties"]["st"], f["properties"]["name"]))
    packed = []
    for f in features:
        g = f["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        out_polys = []
        for poly in polys:
            out_rings = []
            for ring in poly:
                flat, px, py = [], 0, 0
                for x, y in ring:
                    ix, iy = round(x * SCALE), round(y * SCALE)
                    flat += [ix - px, iy - py]
                    px, py = ix, iy
                out_rings.append(flat)
            out_polys.append(out_rings)
        p = f["properties"]
        packed.append([p["name"], p["st"], p["geoid"], out_polys])
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"v": 1, "scale": SCALE, "towns": packed}, fh, separators=(",", ":"), ensure_ascii=False)
    size = os.path.getsize(OUT) / 1e6
    print(f"{len(features)} towns ({census} Census boundaries, {kept} kept from before, {missing} without an outline), {size:.1f} MB")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
