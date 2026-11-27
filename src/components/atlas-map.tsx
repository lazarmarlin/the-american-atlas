import { useCallback, useEffect, useRef, useState } from "react";
import { latestLiveFix, onLiveFix } from "@/lib/live-dot";
import { BASE_STYLE, loadAtlasResource, offlineReadyStyle } from "@/lib/offline-maps";
import type { ExpressionSpecification, GeoJSONSource, Map as MlMap } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import type { StateInfo } from "@/lib/atlas-model";
import { tokenColor } from "@/lib/atlas-model";
import type { Mark } from "@/lib/marks";
import { TIER_ZOOM, kindFor, placeKinds } from "@/lib/place-kinds";
import { glyphImage, glyphKinds } from "@/lib/map-glyphs";
import type { Fix } from "@/lib/nearby";
import { displayLine, type GhostLines } from "@/lib/ghost-trail";
import { loadTowns } from "@/lib/towns-overlay";
import { youMarkerImage } from "@/lib/you-marker";
import { heading, speedMph, turnBetween, zoomForSpeed } from "@/lib/motion";
import { makeCuller, type Box } from "@/lib/map-cull";
import { seenAgo } from "@/lib/live-share";
import type { Feature } from "geojson";

/** Your marker: full size at zoom 5.7 and in, about half by a whole-continent view. */
const AVATAR_SIZE = ["interpolate", ["linear"], ["zoom"], 1.5, 0.48, 3.5, 0.68, 5.7, 1] as unknown as number;
/** Friends': the same curve, a touch smaller. */
const AVATAR_SIZE_FRIEND = ["interpolate", ["linear"], ["zoom"], 1.5, 0.44, 3.5, 0.62, 5.7, 0.92] as unknown as number;

function viewBox(map: MlMap): Box {
  const b = map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

const LOCATE_SVG =
  '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle class="atlas-locate-dot" cx="12" cy="12" r="3" stroke="none"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';

/** When moving, you sit a fifth of the way down from the middle, so more of what's ahead shows. */
function aheadOffset(map: MlMap): [number, number] {
  return (speedMph() ?? 0) >= 5 ? [0, Math.round(map.getContainer().clientHeight * 0.2)] : [0, 0];
}

/** Facing the way you're going (only when clearly moving), else as it is. */
function bearingAhead(current: number) {
  const going = (speedMph() ?? 0) >= 5 ? heading() : null;
  if (going == null) return current;
  return turnBetween(current, going) >= 8 ? Math.round(going) : current;
}

function rgba(hex: string, alpha: number) {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Same fade stops for every color, so a red trail is as faint as a mist one. */
function ghostFade(hex: string, stops: [number, number][]): ExpressionSpecification {
  const expr: unknown[] = ["interpolate", ["linear"], ["line-progress"]];
  for (const [at, alpha] of stops) expr.push(at, rgba(hex, alpha));
  return expr as ExpressionSpecification;
}

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
  ghostLive: GhostLines;
  ghostSaved: { id: string; focus: boolean; lines: GhostLines }[];
  ghostFocus: string | null;
  ghostLook: number;
  ghostColor: string;
  friendLines: GhostLines;
  friendLook: number;
  friendLive: boolean;
  /** Friends sharing their location with you. `live: false`: where they were last seen (`seenAt`), drawn faded. */
  friendPins: { id: string; name: string; lat: number; lon: number; icon: string; color: string; live?: boolean; seenAt?: number }[];
  photoPins: { id: string; poiId: string; lat: number; lon: number; thumb: string; friendId?: string }[];
  you: Fix | null;
  dot: Fix | null;
  /** While driving, keep the camera at this zoom on your location. */
  followZoom?: number;
  /** While following (Drive mode): the way you're going, so the map faces it. Null: north up. */
  followBearing?: number | null;
  /**
   * While following: the part of the map covered by the dashboard (px from each
   * edge), so you and the road sit in the part that's free instead of under it.
   */
  followPadding?: MapPad | null;
  /** Bigger place icons and a bigger tap area, for tapping from the driver's seat. */
  bigIcons?: boolean;
  onState: (abbr: string) => void;
  /** Zoomed in, moving the map into another state picks it (keeping the view). */
  followState?: boolean;
  onCounty: (county: { id: string; name: string; st: string; lat: number; lon: number }) => void;
  onPark: (park: { id: string; name: string; cat: string; st: string; lat: number; lon: number; pts: number }) => void;
  onSelect: (id: string) => void;
  onOffer: (id: string) => void;
  onPress: () => void;
  onFriend: (id: string) => void;
  /** The friend the map is zoomed in on (zoom 11+, their marker on screen, nearest the middle), or null. */
  onLook?: (id: string | null) => void;
  onView: (zoom: number, base: number | null) => void;
  /** Bumped to fly back out to the whole country (Android back). */
  homeTick?: number;
  /** How far down the map the overlays at the top reach: the whole-country view fits below them. */
  topInset?: number;
  /** Bumped to fit the chosen state again (Android back from zoomed in). */
  focusTick?: number;
  /** Fit the view to these points ([lon, lat]) each time the tick changes. */
  fitTo?: { tick: number; points: [number, number][]; maxZoom: number } | null;
  /** Whether the map is zoomed in past the whole-country view. */
  onAway?: (away: boolean) => void;
  /** Trip routes drawn on the map (a recap, or everyone on a shared trip), each in its own color. */
  tripRoutes?: { color: string; lines: [number, number][][]; dots?: [number, number][] }[];
  /**
   * A group from the Stops view: places get a ring in their own color around
   * their icon (still tapped to open), GPS stops a small dot of their own.
   */
  groupSpots?: { id: string; lon: number; lat: number; kind: "place" | "stop"; color: string }[];
  onGroupStop?: (id: string) => void;
  /** One place on its own: everything else hidden, zoomed all the way in on it. */
  spotlight?: { id: string; lon: number; lat: number } | null;
};

const USA: [[number, number], [number, number]] = [
  [-128, 24.2],
  [-66.5, 49.6],
];

function roundPhoto(url: string, ring: string) {
  return new Promise<ImageData>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const g = canvas.getContext("2d");
      if (!g) {
        reject(new Error("No canvas"));
        return;
      }
      g.save();
      g.beginPath();
      g.arc(32, 32, 26, 0, Math.PI * 2);
      g.closePath();
      g.clip();
      g.drawImage(img, 6, 6, 52, 52);
      g.restore();
      g.beginPath();
      g.arc(32, 32, 26, 0, Math.PI * 2);
      g.strokeStyle = ring;
      g.lineWidth = 4;
      g.stroke();
      resolve(g.getImageData(0, 0, 64, 64));
    };
    img.onerror = () => reject(new Error("Bad photo"));
    img.src = url;
  });
}

/** The app's layers that a spotlight hides (everything we draw on top of the base map). */
const SPOT_HIDE = [
  "states-fill", "town-fill", "town-outline", "reservation-fill", "reservation-line", "park-fill", "park-line", "county-fill", "county-line",
  "offer-halo", "offer-line", "route-halo", "route-line", "trip-line", "ghost-saved-haze", "ghost-saved-line", "ghost-haze", "ghost-line",
  "friend-haze", "friend-line", "friend-live-haze", "friend-live-line", "friend-tip", "offer-dots", "offer-icons", "place-dots", "place-icons",
  "photo-pins", "you-dot", "friend-people", "trip-route-casing", "trip-route-line", "trip-route-dots",
];

/** How far past the whole-country view a tap still just opens the state (if a state's box is unknown). */
const COUNTRY_TAP_ZOOM = 1.2;

/** The camera that shows a whole state (the same fit as choosing it). */
function stateCamera(map: MlMap, box: { w: number; s: number; e: number; n: number }) {
  return map.cameraForBounds(
    [
      [box.w, box.s],
      [box.e, box.n],
    ],
    { padding: 36, maxZoom: 7.2 },
  );
}

let protocolAdded = false;

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function duration() {
  if (typeof window === "undefined") return 0;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700;
}

function frameLine(map: MlMap, lines: GhostLines) {
  const flat = lines.flat();
  if (flat.length < 2) return;
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
    { padding: 56, maxZoom: 12, duration: duration() },
  );
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

const EMPTY_SPOTS: { id: string; lon: number; lat: number; kind: "place" | "stop"; color: string }[] = [];

export type MapPad = { top: number; left: number; right: number; bottom: number };
const NO_PAD: MapPad = { top: 0, left: 0, right: 0, bottom: 0 };

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
  ghostLive,
  ghostSaved,
  ghostFocus,
  ghostLook,
  ghostColor,
  friendLines,
  friendLook,
  friendLive,
  friendPins,
  photoPins,
  you,
  dot,
  followZoom,
  followBearing = null,
  followPadding = null,
  bigIcons = false,
  onState,
  followState = false,
  onCounty,
  onPark,
  onSelect,
  onOffer,
  onPress,
  onFriend,
  onLook,
  onView,
  homeTick = 0,
  topInset = 0,
  focusTick = 0,
  fitTo = null,
  onAway,
  spotlight = null,
  tripRoutes = [],
  groupSpots = EMPTY_SPOTS,
  onGroupStop,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const bigRef = useRef(bigIcons);
  bigRef.current = bigIcons;
  const propsRef = useRef({ onState, onCounty, onPark, onSelect, onOffer, onPress, onFriend, onView, onAway, onGroupStop });
  propsRef.current = { onState, onCounty, onPark, onSelect, onOffer, onPress, onFriend, onView, onAway, onGroupStop };
  const statesRef = useRef(states);
  statesRef.current = states;
  const viewRef = useRef({ stateAbbr, showCounties, followState });
  viewRef.current = { stateAbbr, showCounties, followState };
  /** Set when the map picks a state itself (following the view), so the camera stays put. */
  const keepView = useRef(false);
  const [ready, setReady] = useState(false);
  const overlaysLoaded = useRef(new Set<string>());
  // Places, roads, a state's catalog and town outlines: only what's in or near the view goes to the map (src/lib/map-cull.ts).
  const culler = useRef(makeCuller());
  const showCulled = (map: MlMap, id: string, features?: Feature[]) => {
    if (features) culler.current.set(id, features);
    if (!culler.current.area()) culler.current.view(viewBox(map));
    (map.getSource(id) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: culler.current.pick(id) });
  };
  /** Download the town outlines once (for the town layer or a selected town's outline). */
  const ensureTowns = (map: MlMap) => {
    if (overlaysLoaded.current.has("towns")) return;
    overlaysLoaded.current.add("towns");
    void loadTowns()
      .then((towns) => showCulled(map, "towns", towns.features as Feature[]))
      .catch(() => overlaysLoaded.current.delete("towns"));
  };
  const [countiesReady, setCountiesReady] = useState(false);
  const prevState = useRef<string | null | undefined>(undefined);
  const prevCounties = useRef<Set<string>>(new Set());
  const prevFollow = useRef<number | undefined>(undefined);
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

      // Tiles, fonts and icons go through "atlas://": saved offline maps first, then the network.
      if (!protocolAdded) {
        protocolAdded = true;
        maplibregl.addProtocol("atlas", loadAtlasResource);
      }
      const style = await Promise.race([
        offlineReadyStyle().catch(() => BASE_STYLE),
        new Promise<string>((resolve) => window.setTimeout(() => resolve(BASE_STYLE), 6000)),
      ]);
      if (dead || !host.current) return;
      map = new maplibregl.Map({
        container: host.current,
        style: style as never,
        bounds: USA,
        fitBoundsOptions: { padding: 28 },
        // The (i) button sat where thumbs land and opened OpenStreetMap's site.
        // The credit is a plain line instead (below), with links in Settings.
        attributionControl: false,
        fadeDuration: 0,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      // Above the zoom buttons: tap for you (facing the way you're going), double-tap for friends one by one.
      map.addControl(
        {
          onAdd: () => {
            const wrap = document.createElement("div");
            wrap.className = "maplibregl-ctrl atlas-locate";
            const group = document.createElement("div");
            group.className = "maplibregl-ctrl-group";
            const button = document.createElement("button");
            button.type = "button";
            button.className = "atlas-locate-button";
            button.setAttribute("aria-label", "Show me. Double-tap for friends");
            button.setAttribute("aria-pressed", "false");
            button.innerHTML = LOCATE_SVG;
            button.addEventListener("click", () => locateTap.current());
            group.appendChild(button);
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "atlas-locate-chip";
            chip.hidden = true;
            chip.addEventListener("click", () => locateChip.current());
            wrap.append(chip, group);
            locateEls.current = { button, chip };
            return wrap;
          },
          onRemove: () => {
            locateEls.current = null;
          },
        },
        "bottom-right",
      );
      map.dragRotate.disable();
      map.touchZoomRotate.disableRotation();
      mapRef.current = map;
      // Dragging the map ends the locate button's follow; north comes back up when you let go.
      let turnedByLocate = false;
      const live = map;
      live.on("dragstart", (event) => {
        if (!(event as { originalEvent?: unknown }).originalEvent || locateRef.current === "off") return;
        turnedByLocate = locateRef.current === "you" && followRef.current == null && Math.abs(live.getBearing()) > 0.5;
        locateDrag.current();
      });
      live.on("dragend", () => {
        if (!turnedByLocate) return;
        turnedByLocate = false;
        // After the drag's own glide has finished (it would cancel this).
        const north = () => followRef.current == null && locateRef.current !== "you" && live.easeTo({ bearing: 0, duration: duration() });
        window.setTimeout(() => (live.isMoving() ? live.once("moveend", north) : north()), 0);
      });
      // For browser tests in development only.
      if (import.meta.env.DEV) (window as Window & { __atlasMap?: unknown }).__atlasMap = map;

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
        // lineMetrics lets the live trail fade along its length with line-gradient.
        map.addSource("ghost-live", { type: "geojson", data: empty, lineMetrics: true });
        map.addSource("ghost-saved", { type: "geojson", data: empty });
        map.addSource("friend-trail", { type: "geojson", data: empty });
        map.addSource("friend-live", { type: "geojson", data: empty, lineMetrics: true });
        map.addSource("friend-tip", { type: "geojson", data: empty });
        map.addSource("places", { type: "geojson", data: empty });
        map.addSource("offers", { type: "geojson", data: empty });
        map.addSource("offer-places", { type: "geojson", data: empty });
        map.addSource("you", { type: "geojson", data: empty });
        map.addSource("photo-pins", { type: "geojson", data: empty });
        map.addSource("friend-people", { type: "geojson", data: empty });
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
        // Ghost trail: a thin bright line with a soft, narrow glow. The live
        // trail is one line per stretch that fades smoothly from its oldest end
        // (transparent) to where you are now; saved trails draw evenly, dimmer.
        const savedFocus = ["==", ["get", "focus"], 1] as ExpressionSpecification;
        map.addLayer({
          id: "ghost-saved-haze",
          type: "line",
          source: "ghost-saved",
          paint: {
            "line-color": "#d5e2ea",
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 4, 10, 7, 14, 10],
            "line-blur": ["interpolate", ["linear"], ["zoom"], 4, 3, 14, 6],
            "line-opacity": ["case", savedFocus, 0.3, 0.14],
          },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        map.addLayer({
          id: "ghost-saved-line",
          type: "line",
          source: "ghost-saved",
          paint: {
            "line-color": "#d5e2ea",
            // The selected trail is wider and stronger, in any color.
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              4,
              ["case", savedFocus, 1.8, 1],
              10,
              ["case", savedFocus, 2.6, 1.6],
              14,
              ["case", savedFocus, 3.4, 2.2],
            ],
            "line-blur": 0.5,
            "line-opacity": ["case", savedFocus, 0.95, 0.35],
          },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        map.addLayer({
          id: "ghost-haze",
          type: "line",
          source: "ghost-live",
          paint: {
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 6, 10, 10, 14, 14],
            "line-blur": ["interpolate", ["linear"], ["zoom"], 4, 3, 14, 7],
            "line-gradient": [
              "interpolate",
              ["linear"],
              ["line-progress"],
              0,
              "rgba(213, 226, 234, 0)",
              0.4,
              "rgba(213, 226, 234, 0.16)",
              1,
              "rgba(213, 226, 234, 0.5)",
            ],
          },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        map.addLayer({
          id: "ghost-line",
          type: "line",
          source: "ghost-live",
          paint: {
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.2, 10, 1.8, 14, 2.4],
            "line-blur": 0.6,
            "line-gradient": [
              "interpolate",
              ["linear"],
              ["line-progress"],
              0,
              "rgba(243, 240, 230, 0)",
              0.25,
              "rgba(243, 240, 230, 0.3)",
              1,
              "rgba(243, 240, 230, 0.95)",
            ],
          },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        // A friend's saved trail. Gold, so it doesn't blend into your own ghost.
        map.addLayer({
          id: "friend-haze",
          type: "line",
          source: "friend-trail",
          paint: {
            "line-color": "#e2b15a",
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 6, 10, 10, 14, 14],
            "line-blur": ["interpolate", ["linear"], ["zoom"], 4, 3, 14, 7],
            "line-opacity": 0.4,
          },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        map.addLayer({
          id: "friend-line",
          type: "line",
          source: "friend-trail",
          paint: {
            "line-color": "#e2b15a",
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.4, 10, 2, 14, 2.6],
            "line-blur": 0.4,
            "line-opacity": 0.9,
            // Dashed, so a friend's trail never looks like your own in any color.
            "line-dasharray": [2, 1.5],
          },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        map.addLayer({
          id: "friend-live-haze",
          type: "line",
          source: "friend-live",
          paint: {
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 6, 10, 10, 14, 14],
            "line-blur": ["interpolate", ["linear"], ["zoom"], 4, 3, 14, 7],
            "line-gradient": [
              "interpolate",
              ["linear"],
              ["line-progress"],
              0,
              "rgba(226, 177, 90, 0)",
              0.45,
              "rgba(226, 177, 90, 0.16)",
              1,
              "rgba(226, 177, 90, 0.45)",
            ],
          },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        map.addLayer({
          id: "friend-live-line",
          type: "line",
          source: "friend-live",
          paint: {
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.3, 10, 1.9, 14, 2.4],
            "line-blur": 0.5,
            "line-gradient": [
              "interpolate",
              ["linear"],
              ["line-progress"],
              0,
              "rgba(226, 177, 90, 0)",
              0.3,
              "rgba(226, 177, 90, 0.28)",
              1,
              "rgba(243, 240, 230, 0.9)",
            ],
          },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        map.addLayer({
          id: "friend-tip",
          type: "circle",
          source: "friend-tip",
          paint: {
            "circle-radius": 6,
            "circle-color": "#e2b15a",
            "circle-stroke-color": "#f3f0e6",
            "circle-stroke-width": 1.5,
            "circle-opacity": 0.95,
          },
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
          id: "photo-pins",
          type: "symbol",
          source: "photo-pins",
          layout: {
            "icon-image": ["get", "icon"],
            "icon-size": 0.85,
            "icon-anchor": "center",
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
            // Full size from about the zoom of a few states; smaller as the map zooms out, so it
            // doesn't tower over the whole country.
            "icon-size": AVATAR_SIZE,
            "icon-anchor": "center",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
        });
        map.addLayer({
          id: "friend-people",
          type: "symbol",
          source: "friend-people",
          layout: {
            "icon-image": ["get", "icon"],
            "icon-size": AVATAR_SIZE_FRIEND,
            "icon-anchor": "center",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          // Faded: where they were last seen (not updating right now).
          paint: { "icon-opacity": ["case", ["boolean", ["get", "stale"], false], 0.5, 1] },
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
        for (const layer of ["route-line", "place-dots", "place-icons", "offer-line", "offer-dots", "offer-icons", "park-fill", "reservation-fill", "county-fill", "friend-people", "photo-pins"]) {
          map.on("mouseenter", layer, () => map?.getCanvas().style.setProperty("cursor", "pointer"));
          map.on("mouseleave", layer, () => map?.getCanvas().style.setProperty("cursor", ""));
        }
        map.on("click", (event) => {
          if (!map) return;
          const pad = bigRef.current ? 34 : 18;
          const area: [[number, number], [number, number]] = [
            [event.point.x - pad, event.point.y - pad],
            [event.point.x + pad, event.point.y + pad],
          ];
          // Zoomed out past a state's own view, everything is crowded together: a tap on
          // a state goes to that state (fitting it) instead of picking a place. At or past
          // a state's view, taps pick places, except a tap on a different state nearby,
          // which moves over to it.
          const tapped = map.queryRenderedFeatures(event.point, { layers: ["states-fill"] })[0]?.properties?.abbr;
          if (typeof tapped === "string") {
            const box = statesRef.current.find((state) => state.abbr === tapped);
            const fit = box ? stateCamera(map, box) : null;
            const zoom = map.getZoom();
            const current = viewRef.current.stateAbbr;
            const stateTap = fit
              ? zoom < (fit.zoom ?? 0) - 0.25 || (tapped !== current && zoom < (fit.zoom ?? 0) + 0.6)
              : zoom < (map.cameraForBounds(USA, { padding: 28 })?.zoom ?? 3) + COUNTRY_TAP_ZOOM;
            if (stateTap) {
              if (box) {
                keepView.current = true;
                map.fitBounds(
                  [
                    [box.w, box.s],
                    [box.e, box.n],
                  ],
                  { padding: 36, duration: duration(), maxZoom: 7.2 },
                );
              }
              if (tapped !== current) propsRef.current.onState(tapped);
              else keepView.current = false;
              return;
            }
          }
          // A GPS stop from a group shown from the Stops view: what it was.
          if (map.getLayer("group-stops")) {
            const stop = map.queryRenderedFeatures(area, { layers: ["group-stops"] })[0]?.properties?.id;
            if (typeof stop === "string") {
              propsRef.current.onGroupStop?.(stop);
              return;
            }
          }
          const person = map.queryRenderedFeatures(area, { layers: ["friend-people"] });
          const personId = person[0]?.properties?.id;
          if (typeof personId === "string") {
            propsRef.current.onFriend(personId);
            return;
          }
          const shot = map.queryRenderedFeatures(area, { layers: ["photo-pins"] });
          const shotFriend = shot[0]?.properties?.friendId;
          const shotPlace = shot[0]?.properties?.poiId;
          if (typeof shotFriend === "string" && shotFriend) {
            propsRef.current.onFriend(shotFriend);
            return;
          }
          if (typeof shotPlace === "string" && shotPlace) {
            propsRef.current.onSelect(shotPlace);
            return;
          }
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
        // "Away" once zoomed in past the whole-country view, so back can zoom out first.
        map.on("moveend", () => {
          if (!map) return;
          const home = map.cameraForBounds(USA, { padding: 28 })?.zoom ?? 3;
          propsRef.current.onAway?.(map.getZoom() > home + 0.4);
          // Follow the view into another state, once zoomed in past a state's
          // whole-state view (not while flying between states or out to the country).
          followView(true);
        });
        const followView = (retry: boolean) => {
          if (!map) return;
          const { stateAbbr: current, followState: follow } = viewRef.current;
          const base = baseRef.current;
          if (!follow || !current || base == null || map.getZoom() < base + 0.3) return;
          const center = map.project(map.getCenter());
          const hit = map.queryRenderedFeatures(center, { layers: ["states-fill"] })[0]?.properties?.abbr;
          // Nothing drawn under the center yet (a long jump): look again once the map settles.
          if (hit === undefined && retry) {
            map.once("idle", () => followView(false));
            return;
          }
          if (typeof hit === "string" && hit !== current) {
            keepView.current = true;
            propsRef.current.onState(hit);
          }
        };
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
    showCulled(map, "routes", lineFeatures(shown));
    showCulled(map, "places", dotFeatures(shown));

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
    showCulled(map, "offers", offerLineFeatures(roads));
    showCulled(map, "offer-places", offerDotFeatures(places));
  }, [offers, ready]);

  // The view moved out of the culled area (or zoomed well in): hand the map what's near the new
  // view, once the map has settled (not mid-drag, which made it stutter). Only during a long glide
  // that leaves the area altogether is it done on the way, and then at most twice a second.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    let settle = 0;
    let last = 0;
    const recull = () => {
      settle = 0;
      if (!culler.current.view(viewBox(map))) return;
      for (const id of culler.current.ids()) {
        const features = culler.current.fresh(id);
        if (features) (map.getSource(id) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });
      }
    };
    const onEnd = () => {
      window.clearTimeout(settle);
      settle = window.setTimeout(recull, 120);
    };
    const onMove = () => {
      const now = performance.now();
      if (now - last < 500 || !culler.current.outside(viewBox(map))) return;
      last = now;
      recull();
    };
    map.on("moveend", onEnd);
    map.on("move", onMove);
    return () => {
      map.off("moveend", onEnd);
      map.off("move", onMove);
      window.clearTimeout(settle);
    };
  }, [ready]);

  // Which friend the map is zoomed in on (atlas-app asks their phone for a fresh location).
  const onLookRef = useRef(onLook);
  onLookRef.current = onLook;
  const lookedAt = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const look = () => {
      let pick: string | null = null;
      if (map.getZoom() >= 11) {
        const b = map.getBounds();
        const c = map.getCenter();
        let best = Infinity;
        for (const pin of pinsRef.current) {
          if (!b.contains([pin.lon, pin.lat])) continue;
          const d = Math.hypot(pin.lon - c.lng, pin.lat - c.lat);
          if (d < best) {
            best = d;
            pick = pin.id;
          }
        }
      }
      if (pick === lookedAt.current) return;
      lookedAt.current = pick;
      onLookRef.current?.(pick);
    };
    map.on("moveend", look);
    look();
    return () => {
      map.off("moveend", look);
    };
  }, [ready]);

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
    // displayLine drops GPS jitter spikes and softens corners for drawing only.
    const liveFeatures = ghostLive.map((coordinates) => ({
      type: "Feature" as const,
      properties: {},
      geometry: { type: "LineString" as const, coordinates: displayLine(coordinates) },
    }));
    const savedFeatures = ghostSaved.flatMap((trail) =>
      trail.lines.map((coordinates) => ({
        type: "Feature" as const,
        properties: { focus: trail.focus ? 1 : 0 },
        geometry: { type: "LineString" as const, coordinates: displayLine(coordinates) },
      })),
    );
    (map.getSource("ghost-live") as GeoJSONSource).setData({ type: "FeatureCollection", features: liveFeatures });
    (map.getSource("ghost-saved") as GeoJSONSource).setData({ type: "FeatureCollection", features: savedFeatures });
  }, [ghostLive, ghostSaved, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const features = (friendLive ? [] : friendLines).map((coordinates) => ({
      type: "Feature" as const,
      properties: {},
      geometry: { type: "LineString" as const, coordinates: displayLine(coordinates) },
    }));
    const liveFeatures = (friendLive ? friendLines : []).map((coordinates) => ({
      type: "Feature" as const,
      properties: {},
      geometry: { type: "LineString" as const, coordinates: displayLine(coordinates) },
    }));
    const tip = friendLive ? friendLines.at(-1)?.at(-1) : null;
    (map.getSource("friend-trail") as GeoJSONSource).setData({ type: "FeatureCollection", features });
    (map.getSource("friend-live") as GeoJSONSource).setData({ type: "FeatureCollection", features: liveFeatures });
    (map.getSource("friend-tip") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: tip
        ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: tip } }]
        : [],
    });
  }, [friendLines, friendLive, ready]);

  // Trip routes: added on first use, on top of the other lines.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (!map.getSource("trip-routes")) {
      if (!tripRoutes.length) return;
      map.addSource("trip-routes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "trip-route-casing",
        type: "line",
        source: "trip-routes",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": "#121410", "line-width": ["interpolate", ["linear"], ["zoom"], 4, 4, 12, 7], "line-opacity": 0.7 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: "trip-route-line",
        type: "line",
        source: "trip-routes",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 4, 2.2, 12, 4] },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: "trip-route-dots",
        type: "circle",
        source: "trip-routes",
        filter: ["==", ["geometry-type"], "Point"],
        paint: { "circle-radius": 4.5, "circle-color": ["get", "color"], "circle-stroke-width": 1.5, "circle-stroke-color": "#121410" },
      });
    }
    const features = tripRoutes.flatMap((route) => [
      ...route.lines.map((coordinates) => ({
        type: "Feature" as const,
        properties: { color: route.color },
        geometry: { type: "LineString" as const, coordinates },
      })),
      ...(route.dots ?? []).map((coordinates) => ({
        type: "Feature" as const,
        properties: { color: route.color },
        geometry: { type: "Point" as const, coordinates },
      })),
    ]);
    (map.getSource("trip-routes") as GeoJSONSource).setData({ type: "FeatureCollection", features });
  }, [tripRoutes, ready]);

  // A group from the Stops view (see groupSpots): added on first use, on top.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (!map.getSource("group-spots")) {
      if (!groupSpots.length) return;
      map.addSource("group-spots", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "group-rings",
        type: "circle",
        source: "group-spots",
        filter: ["==", ["get", "kind"], "place"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 7, 9, 10, 14, 14],
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 1.5, 12, 2.5],
          "circle-stroke-color": ["get", "color"],
          "circle-stroke-opacity": 0.95,
        },
      });
      map.addLayer({
        id: "group-stops",
        type: "circle",
        source: "group-spots",
        filter: ["==", ["get", "kind"], "stop"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 9, 4.5, 14, 7],
          "circle-color": ["get", "color"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#121410",
        },
      });
    }
    (map.getSource("group-spots") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: groupSpots.map((spot) => ({
        type: "Feature" as const,
        properties: { id: spot.id, kind: spot.kind, color: spot.color },
        geometry: { type: "Point" as const, coordinates: [spot.lon, spot.lat] },
      })),
    });
  }, [groupSpots, ready]);

  // Driving: place icons and dots about twice the size, so they're easy to hit with a finger.
  const sizeBase = useRef(new Map<string, unknown>());
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const props: [string, "layout" | "paint", string][] = [
      ["offer-icons", "layout", "icon-size"],
      ["place-icons", "layout", "icon-size"],
      ["offer-dots", "paint", "circle-radius"],
      ["place-dots", "paint", "circle-radius"],
      ["photo-pins", "layout", "icon-size"],
    ];
    const scale = (value: unknown, k: number): unknown => {
      if (typeof value === "number") return value * k;
      // ["interpolate", how, ["zoom"], z1, v1, z2, v2…]: scale each output.
      if (Array.isArray(value) && value[0] === "interpolate") {
        return value.map((item, i) => (i >= 4 && i % 2 === 0 ? (typeof item === "number" ? item * k : ["*", k, item]) : item));
      }
      return value;
    };
    for (const [layer, kind, name] of props) {
      if (!map.getLayer(layer)) continue;
      const key = `${layer}:${name}`;
      if (!sizeBase.current.has(key)) {
        sizeBase.current.set(key, kind === "layout" ? map.getLayoutProperty(layer, name as never) : map.getPaintProperty(layer, name as never));
      }
      const base = sizeBase.current.get(key);
      if (base === undefined) continue;
      const value = bigIcons ? scale(base, 1.9) : base;
      try {
        if (kind === "layout") map.setLayoutProperty(layer, name as never, value as never);
        else map.setPaintProperty(layer, name as never, value as never);
      } catch {
        /* a style without that layer */
      }
    }
  }, [bigIcons, ready]);

  const framed = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !ghostFocus || ghostLook === framed.current) return;
    framed.current = ghostLook;
    const lines = ghostFocus === "live" ? ghostLive : (ghostSaved.find((trail) => trail.id === ghostFocus)?.lines ?? []);
    frameLine(map, lines);
  }, [ghostFocus, ghostLive, ghostLook, ghostSaved, ready]);

  const friendFramed = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || friendLook === friendFramed.current) return;
    if (friendLines.flat().length < 2) return;
    friendFramed.current = friendLook;
    frameLine(map, friendLines);
  }, [friendLines, friendLook, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    // Color only. The fade stops stay put, so every color stays a wisp.
    if (map.getLayer("ghost-haze")) {
      map.setPaintProperty("ghost-haze", "line-gradient", ghostFade(ghostColor, [[0, 0], [0.4, 0.16], [1, 0.5]]));
    }
    if (map.getLayer("ghost-line")) {
      map.setPaintProperty("ghost-line", "line-gradient", ghostFade(ghostColor, [[0, 0], [0.25, 0.3], [1, 0.95]]));
    }
    for (const id of ["ghost-saved-haze", "ghost-saved-line"]) {
      if (map.getLayer(id)) map.setPaintProperty(id, "line-color", ghostColor);
    }
    // A friend's trail is gold, unless your own trail is gold: then teal.
    const friendColor = ghostColor === "#e2b15a" ? "#3dbebf" : "#e2b15a";
    for (const id of ["friend-haze", "friend-line"]) {
      if (map.getLayer(id)) map.setPaintProperty(id, "line-color", friendColor);
    }
  }, [ghostColor, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (prevState.current === stateAbbr) return;
    const was = prevState.current;
    prevState.current = stateAbbr;
    const following = keepView.current;
    keepView.current = false;
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
      // Switching from one state to the next while zoomed in keeps the view:
      // you tapped (or panned) into the neighbor to look at something there,
      // not to see the whole state.
      if (following || (was && map.getZoom() >= base - 0.2)) return;
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
      map.fitBounds(USA, { padding: usaPadding(), duration: duration() });
    }
  }, [ready, selected, stateAbbr, states, you]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    applyFilters(map);
  }, [hiddenKinds, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !fitTo?.points.length) return;
    const xs = fitTo.points.map((p) => p[0]);
    const ys = fitTo.points.map((p) => p[1]);
    map.fitBounds(
      [
        [Math.min(...xs), Math.min(...ys)],
        [Math.max(...xs), Math.max(...ys)],
      ],
      { padding: 60, maxZoom: fitTo.maxZoom, duration: duration() },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitTo?.tick, ready]);

  // Spotlight: hide the app's own layers (the base map stays for streets and names) and mark the one place.
  // While it's on, the other effects' visibility changes are remembered and applied when it ends.
  const spotHidden = useRef<Map<string, string>>(new Map());
  const spotPatched = useRef<MlMap["setLayoutProperty"] | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const restore = () => {
      if (spotPatched.current) {
        map.setLayoutProperty = spotPatched.current;
        spotPatched.current = null;
      }
      for (const [id, vis] of spotHidden.current) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis as "visible" | "none");
      spotHidden.current.clear();
      (map.getSource("spotlight") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] });
    };
    if (!spotlight) {
      restore();
      return;
    }
    if (!map.getSource("spotlight")) {
      const accentSpot = tokenColor("--color-accent", "#e23d2b");
      map.addSource("spotlight", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "spotlight-halo", type: "circle", source: "spotlight", paint: { "circle-radius": 26, "circle-color": accentSpot, "circle-opacity": 0.22, "circle-stroke-width": 2, "circle-stroke-color": accentSpot, "circle-stroke-opacity": 0.6 } });
      map.addLayer({ id: "spotlight-dot", type: "circle", source: "spotlight", paint: { "circle-radius": 9, "circle-color": accentSpot, "circle-stroke-width": 3, "circle-stroke-color": "#ffffff" } });
    }
    if (!spotPatched.current) {
      const original = map.setLayoutProperty.bind(map);
      spotPatched.current = map.setLayoutProperty;
      for (const id of SPOT_HIDE) {
        if (!map.getLayer(id)) continue;
        spotHidden.current.set(id, (map.getLayoutProperty(id, "visibility") as string | undefined) ?? "visible");
        original(id, "visibility", "none");
      }
      map.setLayoutProperty = ((id: string, name: string, value: unknown, options?: unknown) => {
        if (name === "visibility" && SPOT_HIDE.includes(id)) {
          spotHidden.current.set(id, String(value));
          return map;
        }
        return original(id, name as never, value as never, options as never);
      }) as MlMap["setLayoutProperty"];
    }
    (map.getSource("spotlight") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [spotlight.lon, spotlight.lat] } }],
    });
    // The card takes the bottom of the screen; wait for the map to settle into the space above it.
    const timer = window.setTimeout(() => {
      map.resize();
      map.easeTo({ center: [spotlight.lon, spotlight.lat], zoom: 15, duration: duration() });
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotlight?.id, spotlight?.lon, spotlight?.lat, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focusTick || !stateAbbr) return;
    const box = states.find((state) => state.abbr === stateAbbr);
    if (box)
      map.fitBounds(
        [
          [box.w, box.s],
          [box.e, box.n],
        ],
        { padding: 36, duration: duration(), maxZoom: 7.2 },
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick, ready]);

  // The whole country, below the card and chips at the top and above the buttons at the bottom.
  const insetRef = useRef(topInset);
  insetRef.current = topInset;
  const usaPadding = useCallback(() => {
    const map = mapRef.current;
    const height = map?.getContainer().clientHeight ?? 0;
    const bottom = 64;
    // Leave the country at least 110 px, even on a short map.
    const top = Math.max(28, Math.min(insetRef.current + 10, height - bottom - 110));
    return { top, bottom, left: 18, right: 18 };
  }, []);
  // Opening: fit it that way once the overlays are measured, but only while the
  // atlas is opening: not after you've moved the map, and not once anything else
  // has (a place opened from a chat, a spot, a state), or it would snap back out.
  const touched = useRef(false);
  const readyAt = useRef(0);
  useEffect(() => {
    if (ready && !readyAt.current) readyAt.current = Date.now();
  }, [ready]);
  useEffect(() => {
    if (spotlight || fitTo || selected || stateAbbr) touched.current = true;
  }, [spotlight, fitTo, selected, stateAbbr]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const mark = (event: { originalEvent?: unknown }) => {
      if (event.originalEvent) touched.current = true;
    };
    map.on("movestart", mark);
    return () => {
      map.off("movestart", mark);
    };
  }, [ready]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !topInset || touched.current || viewRef.current.stateAbbr || selectedRef.current) return;
    if (Date.now() - readyAt.current > 4000) return;
    map.fitBounds(USA, { padding: usaPadding(), duration: 0 });
  }, [topInset, ready, usaPadding]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !homeTick) return;
    baseRef.current = null;
    applyFilters(map);
    map.fitBounds(USA, { padding: usaPadding(), duration: duration() });
  }, [homeTick, ready]);

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


  // The "you" dot glides from fix to fix (every fix while tracking, not just the
  // app's slower updates), so it moves with the ghost trail's head. While driving
  // the camera glides with it instead of jumping every few seconds.
  const dotShown = useRef<[number, number] | null>(null);
  const dotAnim = useRef(0);
  const dotAt = useRef(0);
  const dotOn = useRef(false);
  const followRef = useRef<number | undefined>(followZoom);
  followRef.current = followZoom;
  const bearingRef = useRef<number | null>(followBearing);
  bearingRef.current = followBearing;
  const padRef = useRef<MapPad | null>(followPadding);
  padRef.current = followPadding;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // The locate button. "you": following you (until you drag the map); "friend": looking at a friend.
  const locateRef = useRef<"off" | "you" | "friend">("off");
  const locateEls = useRef<{ button: HTMLButtonElement; chip: HTMLButtonElement } | null>(null);
  const locateTap = useRef<() => void>(() => undefined);
  const locateChip = useRef<() => void>(() => undefined);
  const tapTimer = useRef(0);
  const chipTimer = useRef(0);
  const friendOrder = useRef<string[]>([]);
  const friendAt = useRef(-1);
  const pinsRef = useRef(friendPins);
  pinsRef.current = friendPins;
  const youRef = useRef(you);
  youRef.current = you;
  const setLocate = (mode: "off" | "you" | "friend", chip: string | null = null) => {
    locateRef.current = mode;
    const els = locateEls.current;
    if (!els) return;
    els.button.setAttribute("aria-pressed", mode === "you" ? "true" : "false");
    els.button.dataset.mode = mode;
    window.clearTimeout(chipTimer.current);
    els.chip.hidden = !chip;
    els.chip.textContent = chip ?? "";
    if (chip) chipTimer.current = window.setTimeout(() => locateEls.current && (locateEls.current.chip.hidden = true), 6000);
  };
  /** Single tap: you, a little below the middle, facing the way you're going. */
  const showMe = () => {
    const map = mapRef.current;
    if (!map) return;
    const live = latestLiveFix();
    const at = dotShown.current ?? (live ? [live.lon, live.lat] : youRef.current ? [youRef.current.lon, youRef.current.lat] : null);
    friendAt.current = -1;
    if (!at) {
      setLocate("off", "Location isn't on");
      return;
    }
    setLocate("you");
    const mph = speedMph();
    map.easeTo({
      center: at as [number, number],
      zoom: (mph ?? 0) >= 5 ? zoomForSpeed(mph, map.getZoom()) : Math.max(map.getZoom(), 15),
      bearing: bearingAhead(map.getBearing()),
      offset: aheadOffset(map),
      duration: duration(),
    });
  };
  /** Double tap: the next friend on the map (nearest first), one by one. */
  const nextFriend = () => {
    const map = mapRef.current;
    if (!map) return;
    const pins = pinsRef.current;
    if (!pins.length) {
      setLocate(locateRef.current, "No friends on the map right now");
      return;
    }
    // A fresh round starts from whoever's closest.
    if (friendAt.current < 0 || friendOrder.current.some((id) => !pins.find((pin) => pin.id === id)) || friendOrder.current.length !== pins.length) {
      const c = map.getCenter();
      friendOrder.current = [...pins].sort((a, b) => Math.hypot(a.lon - c.lng, a.lat - c.lat) - Math.hypot(b.lon - c.lng, b.lat - c.lat)).map((pin) => pin.id);
      friendAt.current = -1;
    }
    friendAt.current = (friendAt.current + 1) % friendOrder.current.length;
    const pin = pins.find((row) => row.id === friendOrder.current[friendAt.current]);
    if (!pin) return;
    const seen = pin.live === false && pin.seenAt ? ` · seen ${seenAgo(pin.seenAt)}` : "";
    setLocate("friend", (pins.length > 1 ? `${pin.name} · ${friendAt.current + 1} of ${pins.length}` : pin.name) + seen);
    const far = Math.abs(map.getCenter().lng - pin.lon) + Math.abs(map.getCenter().lat - pin.lat) > 3;
    const move = { center: [pin.lon, pin.lat] as [number, number], zoom: 14, bearing: 0, offset: [0, 0] as [number, number] };
    if (far && !reducedMotion()) map.flyTo({ ...move, duration: 1800 });
    else map.easeTo({ ...move, duration: duration() });
  };
  locateTap.current = () => {
    if (tapTimer.current) {
      window.clearTimeout(tapTimer.current);
      tapTimer.current = 0;
      nextFriend();
      return;
    }
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = 0;
      showMe();
    }, 260);
  };
  const locateDrag = useRef<() => void>(() => undefined);
  locateDrag.current = () => setLocate("off");
  locateChip.current = () => {
    const id = friendOrder.current[friendAt.current];
    if (locateRef.current === "friend" && id) propsRef.current.onFriend(id);
  };
  const placeDot = useCallback((coords: [number, number] | null) => {
    const map = mapRef.current;
    const source = map?.getSource("you") as GeoJSONSource | undefined;
    if (!source) return;
    dotShown.current = coords;
    source.setData(
      coords
        ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: coords } }] }
        : { type: "FeatureCollection", features: [] },
    );
  }, []);
  const glideTo = useCallback(
    (lon: number, lat: number) => {
      const map = mapRef.current;
      if (!map) return;
      cancelAnimationFrame(dotAnim.current);
      const from = dotShown.current;
      const now = performance.now();
      // As long as the gap since the last fix (so it's still moving when the next one comes), within reason.
      const span = Math.max(250, Math.min(now - (dotAt.current || now - 1000), 1600));
      dotAt.current = now;
      const far = from ? Math.abs(from[0] - lon) + Math.abs(from[1] - lat) > 0.2 : true;
      if (!from || far || reducedMotion()) placeDot([lon, lat]);
      else {
        const step = (t: number) => {
          const k = Math.min(1, (t - now) / span);
          placeDot([from[0] + (lon - from[0]) * k, from[1] + (lat - from[1]) * k]);
          if (k < 1) dotAnim.current = requestAnimationFrame(step);
        };
        dotAnim.current = requestAnimationFrame(step);
      }
      if (followRef.current != null && !selectedRef.current) {
        map.easeTo({
          center: [lon, lat],
          zoom: followRef.current,
          bearing: bearingRef.current ?? 0,
          padding: padRef.current ?? NO_PAD,
          duration: far || reducedMotion() ? 0 : span,
          easing: (t) => t,
        });
      } else if (locateRef.current === "you" && !selectedRef.current) {
        // The locate button's follow: same glide, facing the way you're going.
        map.easeTo({
          center: [lon, lat],
          bearing: bearingAhead(map.getBearing()),
          offset: aheadOffset(map),
          duration: far || reducedMotion() ? 0 : span,
          easing: (t) => t,
        });
      }
    },
    [placeDot],
  );
  useEffect(() => {
    if (!ready) return;
    dotOn.current = !!dot;
    if (!dot) {
      cancelAnimationFrame(dotAnim.current);
      placeDot(null);
      return;
    }
    // Whichever is newer: this position, or the last fix that came straight to the map.
    // (Always draw one: after the dot was cleared, e.g. tracking restarting when the app
    // comes back, sitting still sends no new fixes to bring it back.)
    const live = latestLiveFix();
    // (A position without a time was just read, so it's now.)
    const here = live && (live.t ?? 0) > (dot.t ?? Date.now()) ? live : dot;
    if (dotShown.current && dotShown.current[0] === here.lon && dotShown.current[1] === here.lat) return;
    glideTo(here.lon, here.lat);
  }, [dot, ready, glideTo, placeDot]);
  useEffect(() => {
    const stop = onLiveFix((fix) => {
      // In the background there's nothing to glide: the dot goes to the newest spot when you're back.
      if (dotOn.current && document.visibilityState !== "hidden") glideTo(fix.lon, fix.lat);
    });
    const onShow = () => {
      const fix = latestLiveFix();
      if (fix && dotOn.current && document.visibilityState === "visible") glideTo(fix.lon, fix.lat);
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [glideTo]);
  useEffect(() => () => cancelAnimationFrame(dotAnim.current), []);

  const friendIcons = useRef(new Map<string, string>());
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const features = [];
    for (const pin of friendPins) {
      const imageId = `fy-${pin.id}`;
      const key = `${pin.icon}|${pin.color}`;
      if (friendIcons.current.get(pin.id) !== key) {
        const image = youMarkerImage(pin.icon, pin.color);
        if (map.hasImage(imageId)) map.updateImage(imageId, image);
        else map.addImage(imageId, image, { pixelRatio: 2 });
        friendIcons.current.set(pin.id, key);
      }
      features.push({
        type: "Feature" as const,
        properties: { id: pin.id, name: pin.name, icon: imageId, stale: pin.live === false },
        geometry: { type: "Point" as const, coordinates: [pin.lon, pin.lat] },
      });
    }
    (map.getSource("friend-people") as GeoJSONSource).setData({ type: "FeatureCollection", features });
  }, [friendPins, ready]);

  const photoKeys = useRef(new Map<string, string>());
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    let dead = false;
    void Promise.all(
      photoPins.map(async (pin) => {
        const imageId = `ph-${pin.id}`;
        const key = `${pin.friendId ?? ""}:${pin.thumb.length}:${pin.thumb.slice(20, 60)}`;
        if (photoKeys.current.get(pin.id) !== key) {
          const image = await roundPhoto(pin.thumb, pin.friendId ? "#e2b15a" : "#1c1915");
          if (dead) return null;
          if (map.hasImage(imageId)) map.updateImage(imageId, image);
          else map.addImage(imageId, image, { pixelRatio: 2 });
          photoKeys.current.set(pin.id, key);
        }
        return {
          type: "Feature" as const,
          properties: { id: pin.id, poiId: pin.poiId, friendId: pin.friendId ?? "", icon: imageId },
          geometry: { type: "Point" as const, coordinates: [pin.lon, pin.lat] as [number, number] },
        };
      }),
    ).then((features) => {
      if (dead) return;
      const readyFeatures = features.filter((feature) => feature !== null);
      (map.getSource("photo-pins") as GeoJSONSource).setData({ type: "FeatureCollection", features: readyFeatures });
    });
    return () => {
      dead = true;
    };
  }, [photoPins, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !map.hasImage("you-marker")) return;
    map.updateImage("you-marker", youMarkerImage(markerIcon, markerColor));
  }, [markerColor, markerIcon, ready]);

  useEffect(() => {
    const map = mapRef.current;
    // Driving follows the tracking dot (it moves with every fix); otherwise your last located spot.
    const here = followZoom != null ? (dot ?? you) : you;
    if (!ready || !map || !here || (selected && followZoom == null)) return;
    const key = `${here.lat.toFixed(3)},${here.lon.toFixed(3)}`;
    if (prevYou.current === key && followZoom == null) return;
    prevYou.current = key;
    const go = () =>
      map.easeTo({
        center: [here.lon, here.lat],
        zoom: followZoom ?? Math.max(map.getZoom(), 8),
        ...(followZoom != null ? { bearing: bearingRef.current ?? 0, padding: padRef.current ?? NO_PAD } : {}),
        duration: duration(),
      });
    if (followZoom == null) {
      prevFollow.current = undefined;
      go();
      return;
    }
    // Driving: after the first move, the dot's glide keeps the camera on you.
    if (prevFollow.current === followZoom) return;
    prevFollow.current = followZoom;
    // Entering the driving view resizes the map (the menu goes away): move once that's done.
    map.resize();
    const timer = window.setTimeout(() => {
      map.resize();
      go();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [followZoom, ready, selected, you, dot]);

  // Out of Drive mode (or heading-up turned off): north back up, and the whole map in use again.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const pad = map.getPadding();
    const padded = followZoom == null && !!(pad.top || pad.left || pad.right || pad.bottom);
    const turned = (followZoom == null || followBearing == null) && Math.abs(map.getBearing()) > 0.5;
    if (padded || turned) map.easeTo({ ...(turned ? { bearing: 0 } : {}), ...(padded ? { padding: NO_PAD } : {}), duration: duration() });
  }, [followZoom, followBearing, ready]);

  // The dashboard changed size (phone turned, a row came or went): keep you in the free part.
  const padKey = followPadding ? `${followPadding.top},${followPadding.left},${followPadding.right},${followPadding.bottom}` : "";
  useEffect(() => {
    const map = mapRef.current;
    const at = dotShown.current;
    if (!ready || !map || followRef.current == null || selectedRef.current || !at) return;
    map.easeTo({ center: at, padding: padRef.current ?? NO_PAD, duration: duration() });
  }, [padKey, ready]);

  return (
    <div className="relative h-full w-full">
      <div ref={host} className="h-full w-full" />
      <p className="pointer-events-none absolute right-1.5 bottom-0.5 z-[1] text-[8px] leading-none text-faint/70 select-none">
        © OpenStreetMap · OpenFreeMap
      </p>
    </div>
  );
}
