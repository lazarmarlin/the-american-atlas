import { useEffect, useRef, useState } from "react";
import type { ExpressionSpecification, GeoJSONSource, Map as MlMap } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import type { StateInfo } from "@/lib/atlas-model";
import { tokenColor } from "@/lib/atlas-model";
import type { Mark } from "@/lib/marks";
import { TIER_ZOOM, kindFor, placeKinds } from "@/lib/place-kinds";
import { glyphImage, glyphKinds } from "@/lib/map-glyphs";
import type { Fix } from "@/lib/nearby";
import { loadTowns } from "@/lib/towns-overlay";
import { youMarkerImage } from "@/lib/you-marker";

type Props = {
  states: StateInfo[];
  marks: Mark[];
  preview: Mark | null;
  stateAbbr: string | null;
  selected: string | null;
  showRoads: boolean;
  showCounties: boolean;
  hiddenKinds: string[];
  useIcons: boolean;
  visitedOnly: boolean;
  stateBorder: string;
  countyColor: string;
  showParks: boolean;
  showTowns: boolean;
  showReservations: boolean;
  townColor: string;
  reservationColor: string;
  markerIcon: string;
  markerColor: string;
  offers: (Mark & { tier?: number })[];
  tripLine: [number, number][];
  you: Fix | null;
  dot: Fix | null;
  onState: (abbr: string) => void;
  onCounty: (county: { id: string; name: string; st: string; lat: number; lon: number }) => void;
  onPark: (park: { id: string; name: string; cat: string; st: string; lat: number; lon: number; pts: number }) => void;
  onSelect: (id: string) => void;
  onOffer: (id: string) => void;
  onPress: () => void;
  onView: (zoom: number, base: number | null) => void;
};

const USA: [[number, number], [number, number]] = [
  [-128, 24.2],
  [-66.5, 49.6],
];

function duration() {
  if (typeof window === "undefined") return 0;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700;
}

function isLine(item: { category: string }) {
  return item.category === "route" || item.category === "drive";
}

function lineFeatures(items: Mark[]) {
  return items
    .filter((item) => isLine(item) && item.paths.length > 0)
    .map((item) => ({
      type: "Feature" as const,
      id: item.id,
      properties: { id: item.id, sys: item.sys || "SR", st: item.state, kind: kindFor(item.category, item.name, item.points, item.sys) },
      geometry: { type: "MultiLineString" as const, coordinates: item.paths },
    }));
}

type Shown = Mark & { tier?: number };

function offerLineFeatures(items: Shown[]) {
  return items
    .filter((item) => isLine(item) && item.paths.length > 0)
    .map((item) => ({
      type: "Feature" as const,
      id: item.id,
      properties: { id: item.id, sys: item.sys || "SR", tier: item.tier ?? 0, kind: kindFor(item.category, item.name, item.points, item.sys) },
      geometry: { type: "MultiLineString" as const, coordinates: item.paths },
    }));
}

function offerDotFeatures(items: Shown[]) {
  return items
    .filter((item) => !isLine(item) && item.lat != null && item.lon != null)
    .map((item) => ({
      type: "Feature" as const,
      id: item.id,
      properties: { id: item.id, pts: item.points, tier: item.tier ?? 0, kind: kindFor(item.category, item.name, item.points, item.sys) },
      geometry: { type: "Point" as const, coordinates: [item.lon as number, item.lat as number] },
    }));
}

function dotFeatures(items: Mark[]) {
  return items
    .filter((item) => !isLine(item) && item.category !== "state" && item.category !== "county" && item.lat != null && item.lon != null)
    .map((item) => ({
      type: "Feature" as const,
      id: item.id,
      properties: { id: item.id, st: item.state, kind: kindFor(item.category, item.name, item.points, item.sys) },
      geometry: { type: "Point" as const, coordinates: [item.lon as number, item.lat as number] },
    }));
}

export function AtlasMap({
  states,
  marks,
  preview,
  stateAbbr,
  selected,
  showRoads,
  showCounties,
  hiddenKinds,
  useIcons,
  visitedOnly,
  stateBorder,
  countyColor,
  showParks,
  showTowns,
  showReservations,
  townColor,
  reservationColor,
  markerIcon,
  markerColor,
  offers,
  tripLine,
  you,
  dot,
  onState,
  onCounty,
  onPark,
  onSelect,
  onOffer,
  onPress,
  onView,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const propsRef = useRef({ onState, onCounty, onPark, onSelect, onOffer, onPress, onView });
  propsRef.current = { onState, onCounty, onPark, onSelect, onOffer, onPress, onView };
  const viewRef = useRef({ stateAbbr, showCounties });
  viewRef.current = { stateAbbr, showCounties };
  const [ready, setReady] = useState(false);
  const overlaysLoaded = useRef(new Set<string>());
  /** Download the town outlines once (for the town layer or a selected town's outline). */
  const ensureTowns = (map: MlMap) => {
    if (overlaysLoaded.current.has("towns")) return;
    overlaysLoaded.current.add("towns");
    void loadTowns()
      .then((towns) => (map.getSource("towns") as GeoJSONSource | undefined)?.setData(towns))
      .catch(() => overlaysLoaded.current.delete("towns"));
  };
  const [countiesReady, setCountiesReady] = useState(false);
  const prevState = useRef<string | null | undefined>(undefined);
  const prevCounties = useRef<Set<string>>(new Set());
  const prevYou = useRef<string>("");
  const baseRef = useRef<number | null>(null);
  const hiddenRef = useRef(hiddenKinds);
  hiddenRef.current = hiddenKinds;
  const markerRef = useRef({ icon: markerIcon, color: markerColor });
  markerRef.current = { icon: markerIcon, color: markerColor };

  function applyFilters(map: MlMap) {
    if (!map.getLayer("offer-line")) return;
    const base = baseRef.current ?? 6;
    const hidden = hiddenRef.current;
    const closer = Math.round((base + TIER_ZOOM[1]) * 10) / 10;
    const closest = Math.round((base + TIER_ZOOM[2]) * 10) / 10;
    const zoomFilter: ExpressionSpecification = [
      "any",
      ["==", ["get", "tier"], 0],
      ["all", ["==", ["get", "tier"], 1], [">=", ["zoom"], closer]],
      ["all", [">=", ["get", "tier"], 2], [">=", ["zoom"], closest]],
    ];
    const offerFilter: ExpressionSpecification = hidden.length
      ? ["all", zoomFilter, ["!", ["in", ["get", "kind"], ["literal", hidden]]]]
      : zoomFilter;
    map.setFilter("offer-line", offerFilter);
    map.setFilter("offer-halo", offerFilter);
    map.setFilter("offer-dots", offerFilter);
    if (map.getLayer("offer-icons")) map.setFilter("offer-icons", offerFilter);
    const savedFilter = (hidden.length ? ["!", ["in", ["get", "kind"], ["literal", hidden]]] : null) as ExpressionSpecification | null;
    map.setFilter("place-dots", savedFilter);
    if (map.getLayer("place-icons")) map.setFilter("place-icons", savedFilter);
  }

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let map: MlMap | null = null;
    let dead = false;

    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (dead || !host.current) return;
      maplibregl.setWorkerUrl(maplibreWorkerUrl);
      const ink = tokenColor("--color-ink", "#f3f0e6");
      const accent = tokenColor("--color-accent", "#e23d2b");
      const elevated = tokenColor("--color-elevated", "#262a22");
      const interstate = tokenColor("--color-interstate", "#3d7ab5");
      const usroute = tokenColor("--color-usroute", "#f3f0e6");
      const statec = tokenColor("--color-state", "#8aa56a");
      const place = tokenColor("--color-place", "#e2b15a");

      map = new maplibregl.Map({
        container: host.current,
        style: "https://tiles.openfreemap.org/styles/dark",
        bounds: USA,
        fitBoundsOptions: { padding: 28 },
        attributionControl: { compact: true },
        fadeDuration: 0,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      map.dragRotate.disable();
      map.touchZoomRotate.disableRotation();
      mapRef.current = map;

      map.on("load", () => {
        if (!map) return;
        const empty = { type: "FeatureCollection" as const, features: [] };
        // Cities and towns draw a bit larger than other pins so they stand out.
        const townBoost = (base: number) =>
          ["match", ["get", "kind"], "city", base * 1.4, "town", base * 1.25, base] as unknown as number;
        map.addSource("states", { type: "geojson", data: "/atlas/states.geojson", promoteId: "abbr" });
        map.addSource("counties", { type: "geojson", data: "/atlas/counties.geojson", promoteId: "id" });
        // Towns and reservations are big files: they start empty and are only
        // downloaded the first time their layer is switched on (see below).
        map.addSource("towns", { type: "geojson", data: empty });
        map.addSource("reservations", { type: "geojson", data: empty });
        map.addSource("parks", { type: "geojson", data: "/atlas/overlays/parks.geojson" });
        map.on("sourcedata", (event) => {
          if (event.sourceId === "counties" && event.isSourceLoaded) setCountiesReady(true);
        });
        map.addSource("routes", { type: "geojson", data: empty });
        map.addSource("trip", { type: "geojson", data: empty });
        map.addSource("places", { type: "geojson", data: empty });
        map.addSource("offers", { type: "geojson", data: empty });
        map.addSource("offer-places", { type: "geojson", data: empty });
        map.addSource("you", { type: "geojson", data: empty });
        for (const id of glyphKinds()) {
          const color = placeKinds.find((kind) => kind.id === id)?.color ?? "#e2b15a";
          map.addImage(`k-${id}`, glyphImage(id, color, false), { pixelRatio: 2 });
          map.addImage(`s-${id}`, glyphImage(id, color, true), { pixelRatio: 2 });
        }

        map.addImage("you-marker", youMarkerImage(markerRef.current.icon, markerRef.current.color), { pixelRatio: 2 });

        const routeColor = [
          "case",
          ["==", ["get", "id"], ""],
          accent,
          ["match", ["get", "sys"], "I", interstate, "US", usroute, "PK", place, statec],
        ] as never;

        map.addLayer({
          id: "states-fill",
          type: "fill",
          source: "states",
          paint: {
            "fill-color": elevated,
            "fill-opacity": [
              "case",
              ["boolean", ["feature-state", "hover"], false],
              0.16,
              ["boolean", ["feature-state", "active"], false],
              0.05,
              ["boolean", ["feature-state", "visited"], false],
              0.1,
              0,
            ],
          },
        });
        map.addLayer({
          id: "states-line",
          type: "line",
          source: "states",
          paint: {
            "line-color": ink,
            "line-opacity": [
              "case",
              ["boolean", ["feature-state", "active"], false],
              1,
              ["boolean", ["feature-state", "visited"], false],
              0.95,
              0.4,
            ],
            "line-width": [
              "case",
              ["boolean", ["feature-state", "active"], false],
              3,
              ["boolean", ["feature-state", "visited"], false],
              1.5,
              1.15,
            ],
          },
        });
        map.addLayer(
          {
            id: "town-fill",
            type: "fill",
            source: "towns",
            paint: { "fill-color": "#c4a484", "fill-opacity": 0.16 },
          },
          "states-line",
        );
        // Thin outline around the town or city whose pin is selected.
        map.addLayer(
          {
            id: "town-outline",
            type: "line",
            source: "towns",
            filter: ["==", ["get", "geoid"], ""],
            paint: { "line-color": "#e2b15a", "line-width": 1.6, "line-opacity": 0.95 },
            layout: { "line-join": "round" },
          },
          "states-line",
        );
        map.addLayer(
          {
            id: "reservation-fill",
            type: "fill",
            source: "reservations",
            paint: { "fill-color": "#3d7ab5", "fill-opacity": 0.28 },
          },
          "states-line",
        );
        map.addLayer(
          {
            id: "reservation-line",
            type: "line",
            source: "reservations",
            paint: { "line-color": "#d7e6f5", "line-width": 1.15, "line-opacity": 0.9 },
          },
          "states-line",
        );
        map.addLayer(
          {
            id: "park-fill",
            type: "fill",
            source: "parks",
            // Bright enough to read on the dark basemap.
            paint: {
              "fill-color": ["match", ["get", "level"], "state", "#c6efb0", "#3fa45b"],
              "fill-opacity": ["match", ["get", "level"], "state", 0.46, 0.34],
            },
          },
          "states-line",
        );
        map.addLayer(
          {
            id: "park-line",
            type: "line",
            source: "parks",
            paint: {
              "line-color": ["match", ["get", "level"], "state", "#e7f8dc", "#8ee0a4"],
              "line-width": ["match", ["get", "level"], "state", 1.05, 1.3],
              "line-opacity": 0.95,
            },
          },
          "states-line",
        );
        map.addLayer({
          id: "county-fill",
          type: "fill",
          source: "counties",
          layout: { visibility: "none" },
          paint: {
            "fill-color": accent,
            "fill-opacity": ["case", ["boolean", ["feature-state", "visited"], false], 0.46, 0.03],
          },
        });
        map.addLayer({
          id: "county-line",
          type: "line",
          source: "counties",
          layout: { visibility: "none" },
          paint: {
            "line-color": ["case", ["boolean", ["feature-state", "visited"], false], accent, ink],
            "line-width": ["case", ["boolean", ["feature-state", "visited"], false], 1.7, 0.7],
            "line-opacity": ["case", ["boolean", ["feature-state", "visited"], false], 1, 0.55],
          },
        });
        // Parks sit above the county tint (which covers every county) but
        // under county borders, roads and pins.
        map.moveLayer("reservation-fill", "county-line");
        map.moveLayer("reservation-line", "county-line");
        map.moveLayer("park-fill", "county-line");
        map.moveLayer("park-line", "county-line");
        const offerFilter: ExpressionSpecification = ["==", ["get", "tier"], 0];
        map.addLayer({
          id: "offer-halo",
          type: "line",
          source: "offers",
          filter: offerFilter,
          paint: { "line-color": routeColor, "line-width": 12, "line-opacity": 0.01 },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        map.addLayer({
          id: "offer-line",
          type: "line",
          source: "offers",
          filter: offerFilter,
          paint: { "line-color": routeColor, "line-width": ["case", ["==", ["get", "sys"], "I"], 1.4, 0.7], "line-opacity": 0.7 },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        map.addLayer({
          id: "route-halo",
          type: "line",
          source: "routes",
          paint: { "line-color": accent, "line-width": 4, "line-opacity": 0.85 },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        map.addLayer({
          id: "route-line",
          type: "line",
          source: "routes",
          paint: { "line-color": routeColor, "line-width": 1.6, "line-opacity": 0.95 },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        map.addLayer({
          id: "trip-line",
          type: "line",
          source: "trip",
          paint: { "line-color": "#f3f0e6", "line-width": 2, "line-opacity": 0.9, "line-dasharray": [1.2, 1.2] },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        map.addLayer({
          id: "offer-dots",
          type: "circle",
          source: "offer-places",
          filter: offerFilter,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, townBoost(3), 8, townBoost(5), 11, townBoost(7)],
            "circle-color": place,
            "circle-stroke-color": ink,
            "circle-stroke-width": 0.6,
            "circle-opacity": 0.8,
          },
        });
        map.addLayer({
          id: "offer-icons",
          type: "symbol",
          source: "offer-places",
          filter: offerFilter,
          layout: {
            "icon-image": ["concat", "k-", ["get", "kind"]],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 4, townBoost(0.5), 8, townBoost(0.72), 12, townBoost(1.05), 16, townBoost(1.3)],
            "symbol-sort-key": ["match", ["get", "kind"], "city", 2, "town", 1, 0],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
        });
        map.addLayer({
          id: "place-dots",
          type: "circle",
          source: "places",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, townBoost(2.2), 8, townBoost(3.6), 12, townBoost(5)],
            "circle-color": accent,
            "circle-stroke-color": ink,
            "circle-stroke-width": 0.6,
            "circle-opacity": 0.95,
          },
        });
        map.addLayer({
          id: "place-icons",
          type: "symbol",
          source: "places",
          layout: {
            "icon-image": ["concat", "s-", ["get", "kind"]],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 3, townBoost(0.55), 8, townBoost(0.8), 12, townBoost(1.15), 16, townBoost(1.4)],
            "symbol-sort-key": ["match", ["get", "kind"], "city", 2, "town", 1, 0],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
        });
        map.addLayer({
          id: "you-dot",
          type: "symbol",
          source: "you",
          layout: {
            "icon-image": "you-marker",
            "icon-size": 1,
            "icon-anchor": "center",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
        });

        let hover: string | null = null;
        map.on("mousemove", "states-fill", (event) => {
          const abbr = event.features?.[0]?.properties?.abbr;
          if (typeof abbr !== "string" || !map) return;
          map.getCanvas().style.cursor = "pointer";
          if (hover === abbr) return;
          if (hover) map.setFeatureState({ source: "states", id: hover }, { hover: false });
          hover = abbr;
          map.setFeatureState({ source: "states", id: abbr }, { hover: true });
        });
        map.on("mouseleave", "states-fill", () => {
          if (!map) return;
          map.getCanvas().style.cursor = "";
          if (hover) map.setFeatureState({ source: "states", id: hover }, { hover: false });
          hover = null;
        });
        for (const layer of ["route-line", "place-dots", "place-icons", "offer-line", "offer-dots", "offer-icons", "park-fill", "reservation-fill", "county-fill"]) {
          map.on("mouseenter", layer, () => map?.getCanvas().style.setProperty("cursor", "pointer"));
          map.on("mouseleave", layer, () => map?.getCanvas().style.setProperty("cursor", ""));
        }
        map.on("click", (event) => {
          if (!map) return;
          const pad = 18;
          const area: [[number, number], [number, number]] = [
            [event.point.x - pad, event.point.y - pad],
            [event.point.x + pad, event.point.y + pad],
          ];
          const saved = map.queryRenderedFeatures(area, { layers: ["route-line", "place-icons", "place-dots"] });
          const savedId = saved[0]?.properties?.id;
          if (typeof savedId === "string") {
            propsRef.current.onSelect(savedId);
            return;
          }
          const offer = map.queryRenderedFeatures(area, { layers: ["offer-icons", "offer-dots", "offer-line", "offer-halo"] });
          const offerId = offer[0]?.properties?.id;
          if (typeof offerId === "string") {
            propsRef.current.onOffer(offerId);
            return;
          }
          // Outlines not linked to an atlas place (no id) don't take the tap,
          // so the county or state underneath still opens.
          const park = map
            .queryRenderedFeatures(event.point, { layers: ["park-fill"] })
            .map((feature) => feature.properties)
            .find((props) => typeof props?.id === "string" && props.id);
          if (park) {
            propsRef.current.onPark({
              id: String(park.id),
              name: String(park.name ?? "Park"),
              cat: typeof park.cat === "string" && park.cat ? park.cat : "park",
              st: String(park.st ?? ""),
              lat: Number(park.lat),
              lon: Number(park.lon),
              pts: Number(park.pts ?? 0),
            });
            return;
          }
          const reservation = map
            .queryRenderedFeatures(event.point, { layers: ["reservation-fill"] })
            .map((feature) => feature.properties)
            .find((props) => typeof props?.id === "string" && props.id);
          if (reservation) {
            propsRef.current.onPark({
              id: String(reservation.id),
              name: String(reservation.name ?? "Reservation"),
              cat: "reservation",
              st: String(reservation.st ?? ""),
              lat: Number(reservation.lat),
              lon: Number(reservation.lon),
              pts: Number(reservation.pts ?? 0),
            });
            return;
          }
          const countyHit = map.queryRenderedFeatures(event.point, { layers: ["county-fill"] });
          const county = countyHit[0]?.properties;
          if (county && typeof county.id === "string") {
            const viewing = viewRef.current.stateAbbr;
            if (viewing || !viewRef.current.showCounties) {
              propsRef.current.onCounty({
                id: county.id,
                name: String(county.name ?? "County"),
                st: String(county.st ?? ""),
                lat: Number(county.lat),
                lon: Number(county.lon),
              });
            } else if (typeof county.st === "string") {
              propsRef.current.onState(county.st);
            }
            return;
          }
          const stateHit = map.queryRenderedFeatures(event.point, { layers: ["states-fill"] });
          const abbr = stateHit[0]?.properties?.abbr;
          if (typeof abbr === "string") {
            propsRef.current.onState(abbr);
            return;
          }
          propsRef.current.onPress();
        });
        map.on("zoomend", () => {
          if (!map) return;
          propsRef.current.onView(map.getZoom(), baseRef.current);
        });
        propsRef.current.onView(map.getZoom(), baseRef.current);
        setReady(true);
      });
    })();

    const observer = new ResizeObserver(() => map?.resize());
    observer.observe(el);
    return () => {
      dead = true;
      setReady(false);
      observer.disconnect();
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const shown = preview && !marks.some((mark) => mark.id === preview.id) ? [...marks, preview] : marks;
    (map.getSource("routes") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: lineFeatures(shown),
    });
    (map.getSource("places") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: dotFeatures(shown),
    });

    const accent = tokenColor("--color-accent", "#e23d2b");
    const ink = tokenColor("--color-ink", "#f3f0e6");
    const interstate = tokenColor("--color-interstate", "#3d7ab5");
    const usroute = tokenColor("--color-usroute", "#f3f0e6");
    const statec = tokenColor("--color-state", "#8aa56a");
    const selectedId = selected ?? "";
    const kindColor = [
      "match",
      ["get", "kind"],
      ...placeKinds.flatMap((kind) => [kind.id, kind.color]),
      "#e2b15a",
    ] as unknown as ExpressionSpecification;
    const roadColor: ExpressionSpecification = ["match", ["get", "sys"], "I", interstate, "US", usroute, "PK", "#e2b15a", statec];
    map.setPaintProperty("route-line", "line-color", roadColor);
    map.setPaintProperty("route-halo", "line-color", accent);
    map.setPaintProperty("route-halo", "line-opacity", 0.9);
    // Interstates keep their full width; US and state routes and scenic drives
    // draw about half as wide so they don't crowd the map.
    const isInterstate = ["==", ["get", "sys"], "I"] as ExpressionSpecification;
    const picked = ["==", ["get", "id"], selectedId] as ExpressionSpecification;
    map.setPaintProperty("route-halo", "line-width", [
      "case",
      isInterstate,
      ["case", picked, 5.5, 4],
      ["case", picked, 3.2, 2.2],
    ] as ExpressionSpecification);
    map.setPaintProperty("route-line", "line-width", [
      "case",
      isInterstate,
      ["case", picked, 2.4, 1.6],
      ["case", picked, 1.4, 0.8],
    ] as ExpressionSpecification);
    map.setPaintProperty("place-dots", "circle-color", kindColor);
    map.setPaintProperty("offer-dots", "circle-color", kindColor);
    map.setPaintProperty("place-dots", "circle-stroke-color", accent);
    map.setPaintProperty("place-dots", "circle-stroke-width", [
      "case",
      ["==", ["get", "id"], selectedId],
      2.6,
      1.7,
    ] as ExpressionSpecification);
    map.setLayoutProperty("route-line", "visibility", showRoads ? "visible" : "none");
    map.setLayoutProperty("route-halo", "visibility", showRoads ? "visible" : "none");
    const visitedCounties = new Set(marks.filter((mark) => mark.category === "county").map((mark) => mark.id));
    if (preview?.category === "county" && marks.some((mark) => mark.id === preview.id)) visitedCounties.add(preview.id);
    const countyOn = showCounties ? "visible" : "none";
    map.setLayoutProperty("county-fill", "visibility", countyOn);
    map.setLayoutProperty("county-line", "visibility", countyOn);
    map.setLayoutProperty("town-fill", "visibility", showTowns ? "visible" : "none");
    map.setLayoutProperty("reservation-fill", "visibility", showReservations ? "visible" : "none");
    map.setLayoutProperty("reservation-line", "visibility", showReservations ? "visible" : "none");
    if (showTowns) ensureTowns(map);
    if (showReservations && !overlaysLoaded.current.has("reservations")) {
      overlaysLoaded.current.add("reservations");
      (map.getSource("reservations") as GeoJSONSource).setData("/atlas/overlays/reservations.geojson");
    }
    map.setLayoutProperty("park-fill", "visibility", showParks ? "visible" : "none");
    map.setLayoutProperty("park-line", "visibility", showParks ? "visible" : "none");
    map.setPaintProperty("town-fill", "fill-color", townColor);
    map.setPaintProperty("reservation-fill", "fill-color", reservationColor);
    map.setPaintProperty("reservation-line", "line-color", reservationColor);
    if (showCounties) {
      const countyFilter: ExpressionSpecification = stateAbbr ? ["==", ["get", "st"], stateAbbr] : ["has", "st"];
      map.setFilter("county-fill", countyFilter);
      map.setFilter("county-line", countyFilter);
    }
    map.setPaintProperty("county-fill", "fill-color", countyColor);
    map.setPaintProperty("county-line", "line-color", [
      "case",
      ["boolean", ["feature-state", "visited"], false],
      countyColor,
      ink,
    ] as ExpressionSpecification);
    const selectedCounty = selected?.startsWith("county:") ? selected : "";
    map.setPaintProperty("county-line", "line-width", [
      "case",
      ["==", ["get", "id"], selectedCounty],
      2.6,
      ["boolean", ["feature-state", "visited"], false],
      1.7,
      0.7,
    ] as ExpressionSpecification);
    const showOffers = !visitedOnly;
    map.setLayoutProperty("offer-line", "visibility", showRoads && showOffers ? "visible" : "none");
    map.setLayoutProperty("offer-halo", "visibility", showRoads && showOffers ? "visible" : "none");
    map.setLayoutProperty("place-dots", "visibility", useIcons ? "none" : "visible");
    map.setLayoutProperty("offer-dots", "visibility", showOffers && !useIcons ? "visible" : "none");
    map.setLayoutProperty("place-icons", "visibility", useIcons ? "visible" : "none");
    map.setLayoutProperty("offer-icons", "visibility", showOffers && useIcons ? "visible" : "none");
    map.setPaintProperty("states-line", "line-color", [
      "case",
      ["boolean", ["feature-state", "visited"], false],
      stateBorder,
      ink,
    ]);

    const been = new Set(marks.map((mark) => mark.state).filter(Boolean));
    for (const state of states) {
      map.setFeatureState(
        { source: "states", id: state.abbr },
        { active: state.abbr === stateAbbr, visited: been.has(state.abbr) },
      );
    }
    if (countiesReady) {
      for (const id of visitedCounties) map.setFeatureState({ source: "counties", id }, { visited: true });
      for (const id of prevCounties.current) {
        if (!visitedCounties.has(id)) map.setFeatureState({ source: "counties", id }, { visited: false });
      }
      prevCounties.current = visitedCounties;
    }
  }, [countiesReady, countyColor, marks, preview, ready, reservationColor, selected, showCounties, showParks, showReservations, showRoads, showTowns, stateAbbr, stateBorder, states, townColor, useIcons, visitedOnly, you]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const roads = offers.filter((item) => isLine(item));
    const places = offers.filter((item) => !isLine(item));
    (map.getSource("offers") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: offerLineFeatures(roads),
    });
    (map.getSource("offer-places") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: offerDotFeatures(places),
    });
  }, [offers, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const coords = tripLine.length >= 2 ? tripLine : [];
    (map.getSource("trip") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: coords.length
        ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }]
        : [],
    });
  }, [ready, tripLine]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (prevState.current === stateAbbr) return;
    prevState.current = stateAbbr;
    if (selected) return;
    const box = stateAbbr ? states.find((state) => state.abbr === stateAbbr) : null;
    if (box) {
      const view = map.cameraForBounds(
        [
          [box.w, box.s],
          [box.e, box.n],
        ],
        { padding: 36, maxZoom: 7.2 },
      );
      const base = view?.zoom ?? 6;
      baseRef.current = base;
      applyFilters(map);
      propsRef.current.onView(map.getZoom(), base);
      map.fitBounds(
        [
          [box.w, box.s],
          [box.e, box.n],
        ],
        { padding: 36, duration: duration(), maxZoom: 7.2 },
      );
    } else if (!you) {
      baseRef.current = null;
      applyFilters(map);
      propsRef.current.onView(map.getZoom(), null);
      map.fitBounds(USA, { padding: 28, duration: duration() });
    }
  }, [ready, selected, stateAbbr, states, you]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    applyFilters(map);
  }, [hiddenKinds, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    // Town place ids end in the Census GEOID their outline is keyed by
    // (p:town:IL:1751622), so the selected pin maps straight to its shape.
    const geoid = selected?.startsWith("p:town:") ? (selected.split(":")[3] ?? "") : "";
    if (geoid) {
      ensureTowns(map);
      const mark = (preview && preview.id === selected ? preview : null) ?? marks.find((item) => item.id === selected);
      const kind = mark ? kindFor(mark.category, mark.name, mark.points, mark.sys) : "town";
      // Same color as the pin: gold for cities, pale gold for towns.
      const color = placeKinds.find((item) => item.id === kind)?.color ?? "#e2b15a";
      map.setPaintProperty("town-outline", "line-color", color);
    }
    map.setFilter("town-outline", ["==", ["get", "geoid"], geoid]);
  }, [marks, preview, ready, selected]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !selected) return;
    const mark = (preview && preview.id === selected ? preview : null) ?? marks.find((item) => item.id === selected);
    if (!mark) return;
    const flat = mark.paths.flat();
    if (flat.length >= 2) {
      let minX = 180;
      let minY = 90;
      let maxX = -180;
      let maxY = -90;
      for (const [x, y] of flat) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      map.fitBounds(
        [
          [minX, minY],
          [maxX, maxY],
        ],
        { padding: 64, maxZoom: 10, duration: duration() },
      );
      return;
    }
    if (mark.lat != null && mark.lon != null) {
      map.easeTo({ center: [mark.lon, mark.lat], zoom: Math.max(map.getZoom(), 8), duration: duration() });
    }
  }, [marks, preview, ready, selected]);


  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("you") as GeoJSONSource).setData(
      dot
        ? {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "Point", coordinates: [dot.lon, dot.lat] },
              },
            ],
          }
        : { type: "FeatureCollection", features: [] },
    );
  }, [dot, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !map.hasImage("you-marker")) return;
    map.updateImage("you-marker", youMarkerImage(markerIcon, markerColor));
  }, [markerColor, markerIcon, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !you || selected) return;
    const key = `${you.lat.toFixed(3)},${you.lon.toFixed(3)}`;
    if (prevYou.current === key) return;
    prevYou.current = key;
    map.easeTo({ center: [you.lon, you.lat], zoom: Math.max(map.getZoom(), 8), duration: duration() });
  }, [ready, selected, you]);

  return <div ref={host} className="h-full w-full" />;
}
