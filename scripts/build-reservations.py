#!/usr/bin/env python3
"""Give each Indian reservation an atlas id, a point inside every state it
covers, and its own score. Rewrites the overlay and prints a JSON list of
catalog rows for the node step that files them into the place bundles.

Points, from the land area:
  50  at least 1,500 square miles
  40  at least 200
  25  at least 20
  15  smaller
"""
import json
import math
import re
from pathlib import Path

from shapely.geometry import shape
from shapely.validation import make_valid

ROOT = Path(__file__).resolve().parents[1]
ATLAS = ROOT / "public" / "atlas"
OUT_ROWS = Path("/tmp/reservation-rows.json")


def sq_miles(geom) -> float:
    lat = geom.centroid.y if not geom.is_empty else 0
    kx = 69.172 * math.cos(math.radians(lat))
    return abs(geom.area) * kx * 69.0


def points_for(miles: float) -> int:
    if miles >= 1500:
        return 50
    if miles >= 200:
        return 40
    if miles >= 20:
        return 25
    return 15


def slug(name: str) -> str:
    text = re.sub(r"[^a-z0-9]+", "", name.lower())
    return (text or "reservation")[:48]


def main() -> None:
    states = []
    for feature in json.loads((ATLAS / "states.geojson").read_text())["features"]:
        geom = make_valid(shape(feature["geometry"]))
        states.append((feature["properties"]["abbr"], geom, geom.bounds))

    src = json.loads((ATLAS / "overlays" / "reservations.geojson").read_text())
    used: set[str] = set()
    by_state: dict[str, list[dict]] = {}
    features = []
    skipped = []

    for feature in src["features"]:
        name = str(feature["properties"].get("name") or "").strip()
        raw = shape(feature["geometry"])
        geom = raw if raw.is_valid else make_valid(raw)
        if geom.is_empty or not name:
            skipped.append(name or "?")
            continue
        simple = geom.simplify(0.01, preserve_topology=True)
        minx, miny, maxx, maxy = simple.bounds
        hits: list[tuple[float, str]] = []
        for abbr, state, (sx0, sy0, sx1, sy1) in states:
            if maxx < sx0 or minx > sx1 or maxy < sy0 or miny > sy1:
                continue
            if not simple.intersects(state):
                continue
            area = simple.intersection(state).area
            if area > 0:
                hits.append((area, abbr))
        hits.sort(reverse=True)
        if not hits:
            point = geom.representative_point()
            nearest = None
            for abbr, state, _box in states:
                if state.contains(point):
                    hits = [(1.0, abbr)]
                    break
                distance = state.distance(point)
                if nearest is None or distance < nearest[0]:
                    nearest = (distance, abbr)
            # Coastal and island lands sit just outside the simplified state
            # outline. A degree is about 69 miles; these misses are much closer.
            if not hits and nearest and nearest[0] <= 1:
                hits = [(1.0, nearest[1])]
        if not hits:
            skipped.append(name)
            continue
        total = hits[0][0]
        kept = [abbr for area, abbr in hits if area >= 0.004 or area >= total * 0.08]
        if hits[0][1] not in kept:
            kept.insert(0, hits[0][1])
        base = slug(name)
        ident = base
        n = 2
        while ident in used:
            ident = f"{base}{n}"
            n += 1
        used.add(ident)
        primary = kept[0]
        place_id = f"p:reservation:{primary}:{ident}"
        miles = sq_miles(geom)
        pts = points_for(miles)
        state_geom = {abbr: state for abbr, state, _box in states}
        primary_point = None
        for abbr in kept:
            piece = geom.intersection(state_geom[abbr])
            if piece.is_empty:
                piece = simple.intersection(state_geom[abbr])
            if piece.is_empty:
                continue
            point = piece.representative_point()
            row = {
                "id": place_id,
                "name": name,
                "lat": round(point.y, 5),
                "lon": round(point.x, 5),
                "pts": pts,
            }
            by_state.setdefault(abbr, []).append(row)
            if abbr == primary:
                primary_point = row
        if primary_point is None:
            point = geom.representative_point()
            primary_point = {
                "id": place_id,
                "name": name,
                "lat": round(point.y, 5),
                "lon": round(point.x, 5),
                "pts": pts,
            }
            by_state.setdefault(primary, []).append(primary_point)
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "id": place_id,
                    "name": name,
                    "cat": "reservation",
                    "st": primary,
                    "lat": primary_point["lat"],
                    "lon": primary_point["lon"],
                    "pts": pts,
                },
                "geometry": feature["geometry"],
            }
        )

    features.sort(key=lambda item: item["properties"]["name"])
    for rows in by_state.values():
        rows.sort(key=lambda row: row["name"])
    geo = {"type": "FeatureCollection", "features": features}
    (ATLAS / "overlays" / "reservations.geojson").write_text(json.dumps(geo, separators=(",", ":")))
    OUT_ROWS.write_text(json.dumps(by_state))
    listings = sum(len(rows) for rows in by_state.values())
    from collections import Counter

    scores = Counter(row["pts"] for rows in by_state.values() for row in rows)
    # Scores repeat once per state listing; count unique ids.
    unique_scores = Counter()
    seen = set()
    for rows in by_state.values():
        for row in rows:
            if row["id"] in seen:
                continue
            seen.add(row["id"])
            unique_scores[row["pts"]] += 1
    print(
        f"reservations {len(features)} unique, {listings} state listings, "
        f"skipped {len(skipped)} {skipped[:8]}"
    )
    print("points", dict(sorted(unique_scores.items())))


if __name__ == "__main__":
    main()
