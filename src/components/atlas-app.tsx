import { lazy, Suspense, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronUp, GripVertical, Locate, Search, Settings } from "lucide-react";
import { useCurrentUser, useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  loadMeta,
  loadPlaces,
  loadRoads,
  placeMatches,
  refRank,
  roadMatches,
  type AtlasMeta,
  type CatalogPlace,
  type RoadRec,
  type System,
} from "@/lib/atlas-model";
import { useAtlas } from "@/lib/atlas-store";
import { badgeViewsFromMarks, listBadgeProgress, type BadgeView } from "@/lib/badges";
import { type Mark } from "@/lib/marks";
import { type Trip, type TripStop } from "@/lib/trips";
import { fallbackBlurb, lookupPlace, mapsUrl, type PlaceBlurb } from "@/lib/place-info";
import { kindFor, kindVisible, placeKinds, tierForKind } from "@/lib/place-kinds";
import { placeToMark, placesNear, readDeviceLocation, roadToMark, stateToMark, stopsAlong, milesBetween, type Fix, type NearMark } from "@/lib/nearby";
import { collectPassed, takeNativeFixes } from "@/lib/travel";
import { AtlasSplash, LoginScreen } from "@/components/login-screen";
import { SettingsPage } from "@/components/settings-page";
import { Tour } from "@/components/tour";
import { BadgeIcon } from "@/components/badge-icon";
import { useSettings } from "@/lib/atlas-settings";
import { useOfflinePack } from "@/lib/offline-pack";
import { nativeApp } from "@/lib/native";
import { notifyPlacesAdded } from "@/lib/place-notifications";
import { countyToMark } from "@/lib/counties";
import { glyphUrl } from "@/lib/map-glyphs";
import { type Profile } from "@/lib/profile";
import { earnedPoints, freshVisit, pointsForVisit, type Visit } from "@/lib/visits";
import {
  flushVault,
  readVault,
  refreshVault,
  vaultCreateTrip,
  vaultDeleteTrip,
  vaultOrderStops,
  vaultRemoveMark,
  vaultRenameTrip,
  vaultSaveMark,
  vaultSaveProfile,
  vaultTripStop,
  vaultVisits,
} from "@/lib/vault";

const AtlasMap = lazy(() => import("@/components/atlas-map").then((mod) => ({ default: mod.AtlasMap })));

const TABS = [
  ["yours", "Yours"],
  ["add", "Add"],
  ["near", "Near"],
  ["trips", "Trips"],
  ["badges", "Badges"],
] as const;

function Shield({ sys, label }: { sys: System | "place"; label: string }) {
  const short = label.length > 4 ? label.slice(0, 4) : label;
  if (sys === "I") {
    return (
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-t-md rounded-b-lg bg-interstate text-xs font-semibold text-ink">
        {short}
      </span>
    );
  }
  if (sys === "US") {
    return (
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-sm border border-ink bg-ink text-xs font-semibold text-bg">
        {short}
      </span>
    );
  }
  if (sys === "place") {
    return <span className="mt-1 size-2.5 shrink-0 rounded-full bg-place" />;
  }
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-state text-xs font-semibold text-state">
      {short}
    </span>
  );
}

export function AtlasApp() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) return <AtlasSplash label="Opening the atlas…" />;
  if (!user) return <LoginScreen />;
  return <AtlasShell />;
}

function AtlasShell() {
  const user = useCurrentUser();
  const [meta, setMeta] = useState<AtlasMeta | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [badges, setBadges] = useState<BadgeView[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [activeTrip, setActiveTrip] = useState<string | null>(null);
  const [roads, setRoads] = useState<RoadRec[]>([]);
  const [catalog, setCatalog] = useState<CatalogPlace[]>([]);
  const [stateRoads, setStateRoads] = useState<RoadRec[]>([]);
  const [loadedPlaces, setLoadedPlaces] = useState<(CatalogPlace & { cat: string })[]>([]);
  const [focus, setFocus] = useState<Mark | null>(null);
  const [you, setYou] = useState<Fix | null>(null);
  const [near, setNear] = useState<NearMark[]>([]);
  const [nearNote, setNearNote] = useState<string | null>(null);
  const [nearBusy, setNearBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [badgeQuery, setBadgeQuery] = useState("");
  const [openGroup, setOpenGroup] = useState<string | null>("Milestones");
  const [sheet, setSheet] = useState(50);
  const [sheetInstant, setSheetInstant] = useState(false);
  const [mapCard, setMapCard] = useState(false);
  const [viewZoom, setViewZoom] = useState(3);
  const [viewBase, setViewBase] = useState<number | null>(null);
  const [hiddenKinds, setHiddenKinds] = useState<string[]>([]);
  const [visitedOnly, setVisitedOnly] = useState(false);
  const [typesOpen, setTypesOpen] = useState(true);
  const [headerOpen, setHeaderOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [roadBack, setRoadBack] = useState<Mark | null>(null);
  const [profile, setProfile] = useState<Profile>({ name: "", photo: "" });
  const [offline, setOffline] = useState(false);
  const [pendingSync, setPendingSync] = useState(0);
  const [passedNote, setPassedNote] = useState<string | null>(null);
  const [addedFlash, setAddedFlash] = useState<Mark | null>(null);
  const [pops, setPops] = useState<BadgeView[]>([]);
  const [packStamp, setPackStamp] = useState(0);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const earnedRef = useRef<Set<string> | null>(null);
  const tourChecked = useRef(false);
  const useIcons = useSettings((s) => s.icons);
  const stateBorder = useSettings((s) => s.stateBorder);
  const countyColor = useSettings((s) => s.countyColor);
  const trackTravel = useSettings((s) => s.trackTravel);
  const setTrackTravel = useSettings((s) => s.setTrackTravel);
  const fastAdd = useSettings((s) => s.fastAdd);
  const pack = useOfflinePack();
  const packPct = pack.total ? Math.min(100, Math.round((pack.done / pack.total) * 100)) : 0;

  const stateAbbr = useAtlas((s) => s.stateAbbr);
  const category = useAtlas((s) => s.category);
  const query = useAtlas((s) => s.query);
  const selected = useAtlas((s) => s.selected);
  const tab = useAtlas((s) => s.tab);
  const showRoads = useAtlas((s) => s.showRoads);
  const showCounties = useAtlas((s) => s.showCounties);
  const setStateAbbr = useAtlas((s) => s.setStateAbbr);
  const setCategory = useAtlas((s) => s.setCategory);
  const setQuery = useAtlas((s) => s.setQuery);
  const setSelected = useAtlas((s) => s.setSelected);
  const setTab = useAtlas((s) => s.setTab);
  const toggleRoads = useAtlas((s) => s.toggleRoads);
  const toggleCounties = useAtlas((s) => s.toggleCounties);

  useEffect(() => {
    let dead = false;
    const apply = (snap: { marks: Mark[]; trips: Trip[]; profile: Profile; pending: number }, badges = true) => {
      setMarks(snap.marks);
      setTrips(snap.trips);
      setProfile(snap.profile);
      setPendingSync(snap.pending);
      if (badges) noteBadges(badgeViewsFromMarks(snap.marks));
    };
    readVault()
      .then(async (snap) => {
        if (dead) return;
        if (snap.marks.length || snap.trips.length || snap.profile.name || snap.pending) apply(snap);
        setOffline(typeof navigator !== "undefined" && !navigator.onLine);
        maybeTour(snap);
        const remote = await refreshVault();
        if (dead) return;
        if (remote) {
          apply(remote, false);
          setOffline(false);
          maybeTour(remote);
          const rows = await listBadgeProgress().catch(() => badgeViewsFromMarks(remote.marks));
          if (!dead) noteBadges(rows);
          return;
        }
        const local = await readVault();
        if (!dead) apply(local);
      })
      .catch(async () => {
        if (dead) return;
        setOffline(true);
        const local = await readVault().catch(() => null);
        if (!dead && local) apply(local);
        else if (!dead) setError("Your saved places didn't load.");
      });
    const onOnline = () => {
      setOffline(false);
      void flushVault().then(() => refreshVault()).then((snap) => {
        if (!dead && snap) apply(snap, false);
      });
    };
    const onOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    loadMeta()
      .then((next) => {
        if (!dead) setMeta(next);
      })
      .catch((err: unknown) => {
        if (!dead) setError(err instanceof Error ? err.message : "The atlas didn't load.");
      });
    return () => {
      dead = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    const onPack = () => setPackStamp((n) => n + 1);
    window.addEventListener("atlas-pack", onPack);
    return () => window.removeEventListener("atlas-pack", onPack);
  }, []);

  useEffect(() => {
    if (!stateAbbr || category !== "route") return;
    let dead = false;
    loadRoads(stateAbbr).then((rows) => {
      if (!dead) setRoads(rows);
    });
    return () => {
      dead = true;
    };
  }, [category, packStamp, stateAbbr]);

  useEffect(() => {
    if (!stateAbbr || !category || category === "route") return;
    let dead = false;
    loadPlaces(category, stateAbbr).then((rows) => {
      if (!dead) setCatalog(rows);
    });
    return () => {
      dead = true;
    };
  }, [category, packStamp, stateAbbr]);

  useEffect(() => {
    if (!stateAbbr) {
      setStateRoads([]);
      setLoadedPlaces([]);
      return;
    }
    let dead = false;
    const cats = [
      "town",
      "park",
      "forest",
      "refuge",
      "capitol",
      "beach",
      "stadium",
      "chain",
      "market",
      "museum",
      "historic",
      "zoo",
      "brewery",
      "lighthouse",
      "bridge",
      "span",
      "airport",
      "garden",
      "amusement",
      "food",
      "mall",
      "roadside",
      "highpoint",
      "seashore",
      "battlefield",
      "drive",
      "waterfall",
      "cave",
      "president",
      "fort",
      "winery",
      "distillery",
      "drivein",
      "diner",
    ];
    loadRoads(stateAbbr).then((rows) => {
      if (!dead) setStateRoads(rows);
    });
    Promise.all(
      cats.map(async (cat) => {
        const rows = await loadPlaces(cat, stateAbbr);
        return rows.map((place) => ({ ...place, cat }));
      }),
    ).then((groups) => {
      if (!dead) setLoadedPlaces(groups.flat());
    });
    return () => {
      dead = true;
    };
  }, [packStamp, stateAbbr]);

  useEffect(() => {
    if (!stateAbbr || stateRoads.length === 0) return;
    const byId = new Map(stateRoads.map((road) => [road.id, road]));
    const healed: Mark[] = [];
    const next = marks.map((mark) => {
      if (mark.paths.length || mark.state !== stateAbbr || mark.category !== "route") return mark;
      const road = byId.get(mark.id);
      if (!road?.paths?.length) return mark;
      const updated = { ...mark, paths: road.paths };
      healed.push(updated);
      return updated;
    });
    if (!healed.length) return;
    setMarks(next);
    for (const mark of healed) void vaultSaveMark(mark);
  }, [marks, stateRoads, stateAbbr]);

  const savedIds = useMemo(() => new Set(marks.map((mark) => mark.id)), [marks]);
  const stats = useMemo(() => {
    const states = new Set(marks.map((mark) => mark.state).filter(Boolean));
    const points = marks.reduce((sum, mark) => sum + earnedPoints(mark), 0);
    const earned = badges.filter((badge) => badge.earned).length;
    return { places: marks.length, points, states: states.size, earned };
  }, [badges, marks]);

  const stateName = meta?.states.find((state) => state.abbr === stateAbbr)?.name ?? stateAbbr;
  const preview = focus && focus.id === selected ? focus : null;

  function noteBadges(next: BadgeView[]) {
    const ids = new Set(next.filter((badge) => badge.earned).map((badge) => badge.id));
    if (earnedRef.current) {
      const fresh = next.filter((badge) => badge.earned && !earnedRef.current?.has(badge.id));
      if (fresh.length) setPops((queue) => [...queue, ...fresh]);
    }
    earnedRef.current = ids;
    setBadges(next);
  }

  function stepSheet(direction: 1 | -1) {
    const current = sheet >= 80 ? 100 : sheet <= 20 ? 8 : 50;
    const stops = [8, 50, 100];
    const index = stops.indexOf(current);
    setSheet(stops[Math.min(stops.length - 1, Math.max(0, index + direction))] ?? current);
  }

  function chooseState(abbr: string | null) {
    setMapCard(false);
    setFocus(null);
    setStateAbbr(abbr);
  }

  function choose(mark: Mark) {
    setFocus(mark);
    setSelected(mark.id);
  }

  function closeCard() {
    if (roadBack) {
      const prev = roadBack;
      setRoadBack(null);
      choose(prev);
      return;
    }
    const fromMap = mapCard;
    setMapCard(false);
    setFocus(null);
    setSelected(null);
    if (!fromMap) return;
    setSheetInstant(true);
    setSheet(8);
    window.setTimeout(() => setSheetInstant(false), 80);
  }

  function openFromMap(mark: Mark) {
    choose(mark);
    setMapCard(true);
  }

  function quickAdd(mark: Mark) {
    const already = marks.find((item) => item.id === mark.id);
    if (already) {
      openFromMap(already);
      return;
    }
    void add(mark, true);
    setAddedFlash(mark);
  }

  async function add(mark: Mark, quiet = false) {
    const clean: Mark = {
      id: mark.id,
      name: mark.name,
      category: mark.category,
      state: mark.state,
      lat: mark.lat,
      lon: mark.lon,
      points: mark.points,
      sys: mark.sys,
      paths: mark.paths,
      visitedOn: null,
      note: "",
      photo: "",
      visits: [freshVisit()],
    };
    setMarks((prev) => (prev.some((item) => item.id === clean.id) ? prev : [clean, ...prev]));
    if (!quiet) choose(clean);
    try {
      await vaultSaveMark(clean);
      noteBadges(badgeViewsFromMarks([clean, ...marks.filter((item) => item.id !== clean.id)]));
      setPendingSync((await readVault()).pending);
    } catch {
      setMarks((prev) => prev.filter((item) => item.id !== clean.id));
      setError("Couldn't save that place.");
    }
  }

  const addRef = useRef(add);
  addRef.current = add;
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const metaRef = useRef(meta);
  metaRef.current = meta;

  useEffect(() => {
    if (!trackTravel) return;
    if (!nativeApp && (typeof navigator === "undefined" || !navigator.geolocation)) {
      setTrackTravel(false);
      setError("This device can't share a location.");
      return;
    }
    let dead = false;
    let last: Fix | null = null;
    let busy = false;
    const pending: Fix[] = [];

    async function run(fix: Fix) {
      const atlas = metaRef.current;
      if (!atlas || dead) return;
      if (last && milesBetween(last.lat, last.lon, fix.lat, fix.lon) < 0.08) return;
      last = fix;
      const saved = new Set(marksRef.current.map((mark) => mark.id));
      const found = await collectPassed(fix, atlas.states, saved);
      if (dead || !found.length) return;
      for (const mark of found) {
        saved.add(mark.id);
        await addRef.current(mark, true);
      }
      const label = found.length === 1 ? `Added ${found[0]?.name}` : `Added ${found.length} places from the drive`;
      setPassedNote(label);
      void notifyPlacesAdded(found);
    }

    async function pump() {
      if (busy || dead) return;
      const next = pending.shift();
      if (!next) return;
      busy = true;
      try {
        await run(next);
      } finally {
        busy = false;
        if (pending.length) void pump();
      }
    }

    function push(fixes: Fix[]) {
      pending.push(...fixes);
      void pump();
    }

    const watch = nativeApp
      ? 0
      : navigator.geolocation.watchPosition(
          (pos) => push([{ lat: pos.coords.latitude, lon: pos.coords.longitude }]),
          (err) => {
            if (dead || err.code !== 1) return;
            setTrackTravel(false);
            setError("Location is blocked. Allow it for The American Atlas, then turn tracking back on.");
          },
          { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
        );
    if (nativeApp) {
      void import("@capgo/background-geolocation").then(({ BackgroundGeolocation }) => {
        if (dead) return;
        void BackgroundGeolocation.start(
          {
            backgroundTitle: "The American Atlas",
            backgroundMessage: "Adding counties, roads, and places as you go.",
            requestPermissions: true,
            stale: false,
            distanceFilter: 80,
          },
          (location, error) => {
            if (dead) return;
            if (error) {
              if (error.code === "NOT_AUTHORIZED" || error.code === "PERMISSION_DENIED") {
                setTrackTravel(false);
                setError("Location is blocked. Allow it all the time for The American Atlas, then turn tracking back on.");
              }
              return;
            }
            if (!location) return;
            push([{ lat: location.latitude, lon: location.longitude }]);
          },
        );
      });
    }
    const host = window as Window & { atlasPushFixes?: (fixes: Fix[]) => void };
    host.atlasPushFixes = push;
    push(takeNativeFixes());
    const onShow = () => push(takeNativeFixes());
    window.addEventListener("focus", onShow);
    document.addEventListener("visibilitychange", onShow);
    return () => {
      dead = true;
      if (nativeApp) void import("@capgo/background-geolocation").then(({ BackgroundGeolocation }) => BackgroundGeolocation.stop());
      else navigator.geolocation.clearWatch(watch);
      delete host.atlasPushFixes;
      window.removeEventListener("focus", onShow);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [setTrackTravel, trackTravel]);

  async function remove(id: string) {
    const previous = marks;
    setMarks((prev) => prev.filter((item) => item.id !== id));
    setTrips((prev) => prev.map((trip) => ({ ...trip, stops: trip.stops.filter((stop) => stop.poiId !== id) })));
    try {
      await vaultRemoveMark(id);
      noteBadges(badgeViewsFromMarks(previous.filter((item) => item.id !== id)));
      setPendingSync((await readVault()).pending);
    } catch {
      setMarks(previous);
      setError("Couldn't remove that place.");
    }
  }

  async function saveVisits(id: string, visits: Visit[]) {
    const latest = visits[visits.length - 1];
    const apply = (item: Mark) =>
      item.id === id
        ? { ...item, visits, visitedOn: latest?.visitedOn ?? null, note: latest?.note ?? "", photo: latest?.photo ?? "" }
        : item;
    setMarks((prev) => prev.map(apply));
    setFocus((prev) => (prev && prev.id === id ? apply(prev) : prev));
    try {
      await vaultVisits(id, visits);
      noteBadges(badgeViewsFromMarks(marksRef.current.map(apply)));
      setPendingSync((await readVault()).pending);
    } catch {
      setError("Couldn't save those visits.");
    }
  }

  function maybeTour(snap: { marks: Mark[]; trips: Trip[] }) {
    if (tourChecked.current) {
      if (snap.marks.length || snap.trips.length) {
        localStorage.setItem("atlas-tour", "done");
        setTourOpen(false);
      }
      return;
    }
    tourChecked.current = true;
    if (localStorage.getItem("atlas-tour") === "done") return;
    if (snap.marks.length || snap.trips.length) {
      localStorage.setItem("atlas-tour", "done");
      return;
    }
    setTourStep(0);
    setTourOpen(true);
  }

  function finishTour() {
    localStorage.setItem("atlas-tour", "done");
    setTourOpen(false);
  }

  async function syncAccount() {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new Error("You're offline. Your places stay on this device until you have a signal.");
    }
    const snap = await refreshVault();
    if (!snap) throw new Error("Couldn't sync the account. Your places are still on this device.");
    setMarks(snap.marks);
    setTrips(snap.trips);
    setProfile(snap.profile);
    setPendingSync(0);
    const rows = await listBadgeProgress().catch(() => badgeViewsFromMarks(snap.marks));
    noteBadges(rows);
  }

  async function makeTrip(name: string) {
    const trip = await vaultCreateTrip(name);
    setTrips((prev) => [{ id: trip.id, name: trip.name, stops: [] }, ...prev.filter((item) => item.id !== trip.id)]);
    setActiveTrip(trip.id);
    return trip.id;
  }

  async function renameTrip(id: string, name: string) {
    const next = name.trim().slice(0, 80);
    if (!next) return;
    setTrips((prev) => prev.map((trip) => (trip.id === id ? { ...trip, name: next } : trip)));
    try {
      await vaultRenameTrip(id, next);
    } catch {
      setError("Couldn't rename that trip.");
    }
  }

  async function orderStops(tripId: string, stops: TripStop[]) {
    setTrips((prev) => prev.map((trip) => (trip.id === tripId ? { ...trip, stops } : trip)));
    try {
      await vaultOrderStops(tripId, stops);
    } catch {
      setError("Couldn't update that trip.");
    }
  }

  async function dropTrip(id: string) {
    setTrips((prev) => prev.filter((item) => item.id !== id));
    if (activeTrip === id) setActiveTrip(null);
    try {
      await vaultDeleteTrip(id);
    } catch {
      setError("Couldn't remove that trip.");
    }
  }

  async function toggleStop(tripId: string, poiId: string, on: boolean) {
    setTrips((prev) =>
      prev.map((trip) => {
        if (trip.id !== tripId) return trip;
        const without = trip.stops.filter((stop) => stop.poiId !== poiId);
        if (!on) return { ...trip, stops: without };
        if (trip.stops.some((stop) => stop.poiId === poiId)) return trip;
        return { ...trip, stops: [...trip.stops, { id: `stop:${crypto.randomUUID()}`, poiId }] };
      }),
    );
    try {
      await vaultTripStop(tripId, poiId, on);
    } catch {
      setError("Couldn't update that trip.");
    }
  }

  const tripLine = useMemo(() => {
    const trip = trips.find((item) => item.id === activeTrip);
    if (!trip) return [] as [number, number][];
    const byId = new Map(marks.map((mark) => [mark.id, mark]));
    const line: [number, number][] = [];
    for (const stop of trip.stops) {
      const mark = byId.get(stop.poiId);
      if (mark?.lon != null && mark.lat != null) line.push([mark.lon, mark.lat]);
    }
    return line;
  }, [activeTrip, marks, trips]);

  async function locate() {
    if (!meta) return;
    setNearBusy(true);
    setNearNote(null);
    try {
      const fix = await readDeviceLocation();
      setYou(fix);
      const rows = await placesNear(fix, meta.states);
      setNear(rows);
      setNearNote(rows.length ? null : "Nothing in the atlas within 80 miles.");
      setTab("near");
    } catch (err) {
      setNearNote(err instanceof Error ? err.message : "Couldn't read a location.");
    } finally {
      setNearBusy(false);
    }
  }

  const yours = marks.filter((mark) => {
    if (stateAbbr && mark.state !== stateAbbr) return false;
    if (!query.trim()) return true;
    return mark.name.toLowerCase().includes(query.trim().toLowerCase());
  });

  const addRows = useMemo(() => {
    if (category === "route") {
      return roads
        .filter((road) => roadMatches(road, query))
        .sort((a, b) => a.sys.localeCompare(b.sys) || refRank(a.ref) - refRank(b.ref) || a.ref.localeCompare(b.ref));
    }
    return catalog.filter((place) => placeMatches(place, query));
  }, [catalog, category, query, roads]);

  const offers = useMemo(() => {
    if (!stateAbbr) return [];
    const places = loadedPlaces
      .filter((place) => !savedIds.has(place.id))
      .map((place) => {
        const kind = kindFor(place.cat, place.name, place.pts);
        return { ...placeToMark(place, place.cat, stateAbbr), tier: tierForKind(kind) };
      });
    const routes = stateRoads
      .filter((road) => !savedIds.has(road.id))
      .map((road) => {
        const kind = kindFor("route", road.name, road.pts, road.sys);
        return { ...roadToMark(road, stateAbbr), tier: tierForKind(kind) };
      });
    return [...routes, ...places];
  }, [loadedPlaces, savedIds, stateAbbr, stateRoads]);

  const badgeGroups = useMemo(() => {
    const q = badgeQuery.trim().toLowerCase();
    const filtered = q
      ? badges.filter((badge) => badge.name.toLowerCase().includes(q) || badge.detail.toLowerCase().includes(q))
      : badges;
    const groups = new Map<string, BadgeView[]>();
    for (const badge of filtered) {
      const list = groups.get(badge.group) ?? [];
      list.push(badge);
      groups.set(badge.group, list);
    }
    return [...groups.entries()];
  }, [badgeQuery, badges]);

  const legend = useMemo(() => {
    const ids = new Set<string>();
    for (const mark of marks) {
      if (mark.category === "state" || mark.category === "route") continue;
      const id = kindFor(mark.category, mark.name, mark.points, mark.sys);
      if (!id.startsWith("route")) ids.add(id);
    }
    if (stateAbbr && viewBase != null) {
      for (const offer of offers) {
        if (offer.category === "route") continue;
        const id = kindFor(offer.category, offer.name, offer.points, offer.sys);
        if (kindVisible(offer.tier ?? 2, viewZoom, viewBase)) ids.add(id);
      }
    }
    return placeKinds.filter((kind) => kind.legend && ids.has(kind.id));
  }, [marks, offers, stateAbbr, viewBase, viewZoom]);

  const cardOnly = mapCard && focus != null;

  useEffect(() => {
    if (!addedFlash) return;
    const timer = window.setTimeout(() => setAddedFlash(null), 4500);
    return () => window.clearTimeout(timer);
  }, [addedFlash]);

  useEffect(() => {
    if (!pops.length) return;
    const timer = window.setTimeout(() => setPops((queue) => queue.slice(1)), 3400);
    return () => window.clearTimeout(timer);
  }, [pops]);

  if (settingsOpen) {
    return (
      <SettingsPage
        profile={{ name: profile.name || user?.displayName || "", photo: profile.photo || user?.profileImageUrl || "" }}
        email={user?.primaryEmail ?? null}
        onBack={() => setSettingsOpen(false)}
        onSaved={setProfile}
        onSync={syncAccount}
        onTour={() => {
          setTourStep(0);
          setTourOpen(true);
          setSettingsOpen(false);
        }}
      />
    );
  }

  const popped = pops[0];

  return (
    <main
      className={"app-shell bg-bg text-ink" + (sheetInstant ? " sheet-drag" : "") + (cardOnly ? " sheet-card" : "")}
      style={cardOnly ? undefined : { ["--sheet" as string]: sheet <= 12 ? "var(--sheet-peek)" : `${sheet}dvh` }}
    >
      {popped ? (
        <div className="pointer-events-none absolute inset-x-0 top-safe z-30 flex justify-center px-4 pt-3">
          <button
            type="button"
            onClick={() => setPops((queue) => queue.slice(1))}
            className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-card border border-line bg-surface px-3 py-3 text-left shadow-lg"
          >
            <BadgeIcon group={popped.group} earned />
            <span>
              <span className="block text-xs tracking-widest text-faint uppercase">Badge unlocked</span>
              <span className="block font-serif text-xl leading-tight">{popped.name}</span>
              <span className="block text-xs text-muted">{popped.detail}</span>
            </span>
          </button>
        </div>
      ) : null}
      <section className="app-map relative min-h-0">
        {meta ? (
          <Suspense fallback={<div className="grid h-full place-items-center text-muted">Opening the map…</div>}>
            <AtlasMap
              states={meta.states}
              marks={marks}
              preview={preview}
              stateAbbr={stateAbbr}
              selected={selected}
              showRoads={showRoads}
              showCounties={showCounties}
              hiddenKinds={hiddenKinds}
              useIcons={useIcons}
              visitedOnly={visitedOnly}
              stateBorder={stateBorder}
              countyColor={countyColor}
              offers={offers}
              tripLine={tripLine}
              you={you}
              onPress={() => {
                if (mapCard) closeCard();
                else setSheet(50);
              }}
              onOffer={(id) => {
                const mark = offers.find((item) => item.id === id);
                if (!mark) return;
                if (fastAdd) quickAdd(mark);
                else openFromMap(mark);
              }}
              onState={(abbr) => {
                chooseState(abbr);
                setTab("add");
              }}
              onCounty={(county) => {
                const saved = marks.find((item) => item.id === county.id);
                const mark =
                  saved ??
                  countyToMark(
                    { id: county.id, name: county.name, lat: county.lat, lon: county.lon },
                    county.st,
                  );
                if (saved || !fastAdd) openFromMap(mark);
                else quickAdd(mark);
              }}
              onSelect={(id) => {
                const mark = marks.find((item) => item.id === id) ?? (focus?.id === id ? focus : null);
                if (mark) openFromMap(mark);
                else setSelected(id);
              }}
              onView={(zoom, base) => {
                setViewZoom(zoom);
                setViewBase(base);
              }}
            />
          </Suspense>
        ) : (
          <div className="grid h-full place-items-center px-6 text-center text-muted">{error ?? "Unfolding the atlas…"}</div>
        )}
        <div className="pointer-events-none absolute top-safe left-3 z-10 flex flex-col items-start gap-2">
          {addedFlash ? (
            <button
              type="button"
              onClick={() => {
                const mark = marks.find((item) => item.id === addedFlash.id) ?? addedFlash;
                setAddedFlash(null);
                openFromMap(mark);
              }}
              className="pointer-events-auto rounded-full border border-line bg-surface/95 px-3 py-2 text-sm shadow-sm backdrop-blur-sm"
            >
              Added {addedFlash.name}
            </button>
          ) : null}
          <div className="pointer-events-auto rounded-card border border-line bg-surface/95 px-3 py-2 backdrop-blur-sm">
            <div className="font-serif text-lg leading-none">{stats.places.toLocaleString()} on the map</div>
            <div className="mt-1 text-xs text-muted">
              {stateAbbr
                ? visitedOnly
                  ? "Only places you've added. Switch to All to see the rest."
                  : "Major cities, highways, and parks are on the map. Zoom in for smaller places."
                : stats.places === 0
                  ? "Clear until you add a place"
                  : `${stats.points.toLocaleString()} pts · ${stats.states} states`}
              {offline ? " · Offline, kept on this device" : pendingSync ? " · Waiting to sync" : ""}
              {trackTravel ? " · Tracking" : ""}
              {passedNote ? ` · ${passedNote}` : ""}
            </div>
          </div>
          {pack.running ? (
            <div className="pointer-events-auto w-full max-w-[14.5rem] rounded-card border border-line bg-surface/95 px-3 py-2 backdrop-blur-sm">
              <div className="mb-1 flex items-center justify-between text-[11px] text-muted">
                <span>Saving atlas</span>
                <span>{packPct}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
                <div className="h-full bg-accent" style={{ width: `${packPct}%` }} />
              </div>
            </div>
          ) : null}
          <div className="pointer-events-auto flex max-w-[14.5rem] flex-wrap gap-1">
            <div className="flex h-8 overflow-hidden rounded-full border border-line bg-surface text-[11px]">
              <button
                type="button"
                aria-pressed={!visitedOnly}
                onClick={() => setVisitedOnly(false)}
                className={"px-2.5 " + (!visitedOnly ? "bg-elevated text-ink" : "text-faint")}
              >
                All
              </button>
              <button
                type="button"
                aria-pressed={visitedOnly}
                onClick={() => setVisitedOnly(true)}
                className={"px-2.5 " + (visitedOnly ? "bg-elevated text-ink" : "text-faint")}
              >
                Visited
              </button>
            </div>
            <button
              type="button"
              aria-pressed={showRoads}
              onClick={toggleRoads}
              className={"flex h-8 items-center gap-1 rounded-full border px-2.5 text-[11px] " + (showRoads ? "border-line bg-surface text-ink" : "border-transparent text-faint")}
            >
              <span className="size-2 rounded-full bg-[#3d7ab5]" />
              Roads
            </button>
            <button
              type="button"
              aria-pressed={showCounties}
              onClick={toggleCounties}
              className={"flex h-8 items-center gap-1 rounded-full border px-2.5 text-[11px] " + (showCounties ? "border-line bg-surface text-ink" : "border-transparent text-faint")}
            >
              <span className="size-2 rounded-full" style={{ background: countyColor }} />
              Counties
            </button>
            {legend.length ? (
              <div className="flex basis-full items-center gap-1">
                <button
                  type="button"
                  aria-expanded={typesOpen}
                  onClick={() => setTypesOpen((open) => !open)}
                  className="flex h-8 min-w-0 flex-1 items-center justify-between gap-1 rounded-full border border-ink/40 bg-elevated px-2.5 text-[11px] font-medium tracking-wide text-ink"
                >
                  {typesOpen ? "Hide types" : "Show place types"}
                  <ChevronDown className={"size-3.5 shrink-0 transition-transform " + (typesOpen ? "rotate-180" : "")} />
                </button>
                {typesOpen ? (
                  <>
                    <button
                      type="button"
                      aria-label="Select all place types"
                      onClick={() => {
                        const ids = new Set(legend.map((kind) => kind.id));
                        setHiddenKinds((current) => current.filter((id) => !ids.has(id)));
                      }}
                      className="h-8 shrink-0 rounded-full border border-line bg-surface px-2 text-[11px] text-ink"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      aria-label="Deselect all place types"
                      onClick={() => {
                        const ids = legend.map((kind) => kind.id);
                        setHiddenKinds((current) => [...new Set([...current, ...ids])]);
                      }}
                      className="h-8 shrink-0 rounded-full border border-line bg-surface px-2 text-[11px] text-ink"
                    >
                      None
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
            {typesOpen && legend.length ? (
              <div className="place-scroll flex basis-full flex-wrap content-start gap-1 pr-1">
                {legend.map((kind) => {
                  const on = !hiddenKinds.includes(kind.id);
                  return (
                    <button
                      key={kind.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setHiddenKinds((current) =>
                          current.includes(kind.id) ? current.filter((id) => id !== kind.id) : [...current, kind.id],
                        )
                      }
                      className={"flex h-8 items-center gap-1 rounded-full border px-2.5 text-[11px] " + (on ? "border-line bg-surface text-ink" : "border-transparent text-faint")}
                    >
                      {useIcons ? (
                        <img src={glyphUrl(kind.id, kind.color)} alt="" className="size-4 shrink-0" />
                      ) : (
                        <span className="size-2 rounded-full" style={{ background: kind.color }} />
                      )}
                      {kind.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          {stateAbbr ? (
            <button
              type="button"
              onClick={() => chooseState(null)}
              className="pointer-events-auto rounded-full border border-line bg-surface px-3 py-2 text-sm"
            >
              United States
            </button>
          ) : null}
        </div>
      </section>

      <aside className={"app-sheet flex min-h-0 flex-col bg-surface" + (sheet >= 92 ? " sheet-full" : "")}>
        {cardOnly && focus ? (
          <Detail
            solo
            mark={focus}
            saved={savedIds.has(focus.id)}
            stateName={meta?.states.find((state) => state.abbr === focus.state)?.name ?? focus.state}
            onAdd={() => void add(focus)}
            onRemove={() => void remove(focus.id)}
            onSave={(visits) => void saveVisits(focus.id, visits)}
            trips={trips}
            onTrip={(tripId, on) => void toggleStop(tripId, focus.id, on)}
            savedIds={savedIds}
            onAddAlong={(mark) => {
              if (focus) setRoadBack(focus);
              void add(mark);
            }}
            onClose={closeCard}
          />
        ) : (
          <>
        <div className="sheet-handle">
          <button
            type="button"
            aria-label="Move the menu up"
            disabled={sheet >= 80}
            onClick={() => stepSheet(1)}
            className="flex h-11 w-11 items-center justify-center rounded-full text-ink disabled:text-faint"
          >
            <ChevronUp className="size-5" />
          </button>
          <button
            type="button"
            aria-label="Move the menu down"
            disabled={sheet <= 20}
            onClick={() => stepSheet(-1)}
            className="flex h-11 w-11 items-center justify-center rounded-full text-ink disabled:text-faint"
          >
            <ChevronDown className="size-5" />
          </button>
        </div>
        <header className="safe-top shrink-0 px-4 pb-3">
          {headerOpen ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs tracking-widest text-faint uppercase">Field atlas</p>
                  <h1 className="font-serif text-2xl leading-tight">The American Atlas</h1>
                </div>
                <div className="flex max-w-[58%] items-center gap-1 text-ink">
                  <button
                    type="button"
                    aria-label="Settings"
                    onClick={() => setSettingsOpen(true)}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line text-ink"
                  >
                    <Settings className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(true)}
                    className="flex min-w-0 items-center gap-2 rounded-full py-1 pr-2 text-left"
                  >
                    {profile.photo || user?.profileImageUrl ? (
                      <img src={profile.photo || user?.profileImageUrl || ""} alt="" className="size-8 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-elevated text-sm">
                        {(profile.name || user?.displayName || user?.primaryEmail || "A").charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="truncate text-sm">
                      {profile.name || user?.displayName || user?.primaryEmail || "Account"}
                    </span>
                  </button>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <Stat value={stats.places.toLocaleString()} label="Places" />
                <Stat value={stats.points.toLocaleString()} label="Points" />
                <Stat value={String(stats.earned)} label="Badges" />
              </div>
            </>
          ) : null}
          <div className={"grid grid-cols-[1fr_auto] items-center gap-1 " + (headerOpen ? "mt-4" : "")}>
            <div className="grid grid-cols-5 gap-1">
              {TABS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={tab === id}
                  onClick={() => setTab(id)}
                  className={"h-11 rounded-lg text-xs " + (tab === id ? "bg-elevated text-ink" : "text-faint")}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-expanded={headerOpen}
              aria-label={headerOpen ? "Hide the header" : "Show the header"}
              onClick={() => setHeaderOpen((open) => !open)}
              className="flex h-11 w-11 items-center justify-center rounded-lg border border-line text-ink"
            >
              <ChevronDown className={"size-4 " + (headerOpen ? "rotate-180" : "")} />
            </button>
          </div>
        </header>

        {tab !== "badges" && tab !== "trips" ? (
          <div className="shrink-0 px-4 pb-3">
            <label className="flex items-center gap-2 rounded-card border border-line bg-bg px-3">
              <Search className="size-4 shrink-0 text-faint" aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={tab === "near" ? "Filter nearby" : stateAbbr ? "Search this state" : "Search your places"}
                className="h-11 w-full bg-transparent text-base text-ink outline-none placeholder:text-faint"
              />
            </label>
          </div>
        ) : null}

        <div data-scroller className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {error ? <p className="px-2 pb-2 text-sm text-accent">{error}</p> : null}
          {tab === "yours" ? (
            <Yours
              marks={yours}
              stateAbbr={stateAbbr}
              stateName={stateName}
              selected={selected}
              onBack={() => chooseState(null)}
              onOpen={choose}
            />
          ) : null}
          {tab === "add" && meta ? (
            <AddList
              meta={meta}
              stateAbbr={stateAbbr}
              stateName={stateName}
              category={category}
              query={query}
              rows={addRows}
              savedIds={savedIds}
              covered={new Set(marks.map((mark) => mark.state).filter(Boolean))}
              selected={selected}
              onState={chooseState}
              onCategory={setCategory}
              onOpen={(mark) => choose(mark)}
              onAdd={(mark) => void add(mark)}
            />
          ) : null}
          {tab === "near" ? (
            <NearList
              rows={near.filter((item) => !query.trim() || item.name.toLowerCase().includes(query.trim().toLowerCase()))}
              note={nearNote}
              busy={nearBusy}
              savedIds={savedIds}
              selected={selected}
              onLocate={() => void locate()}
              onOpen={choose}
              onAdd={(mark) => void add(mark)}
            />
          ) : null}
          {tab === "trips" ? (
            <TripsPanel
              trips={trips}
              marks={marks}
              active={activeTrip}
              onOpen={(id) => setActiveTrip(id)}
              onCreate={() => makeTrip("New trip")}
              onDelete={(id) => void dropTrip(id)}
              onRename={(id, name) => void renameTrip(id, name)}
              onOrder={(id, stops) => void orderStops(id, stops)}
            />
          ) : null}
          {tab === "badges" ? (
            <BadgeList
              name={profile.name || user?.displayName || user?.primaryEmail || "Your atlas"}
              photo={profile.photo || user?.profileImageUrl || ""}
              earned={stats.earned}
              total={badges.length}
              marks={marks}
              meta={meta}
              query={badgeQuery}
              onQuery={setBadgeQuery}
              groups={badgeGroups}
              openGroup={openGroup}
              onToggle={(group) => setOpenGroup(openGroup === group ? null : group)}
            />
          ) : null}
        </div>

        {focus && selected === focus.id && tab !== "badges" && tab !== "trips" ? (
          <Detail
            mark={focus}
            saved={savedIds.has(focus.id)}
            stateName={meta?.states.find((state) => state.abbr === focus.state)?.name ?? focus.state}
            onAdd={() => void add(focus)}
            onRemove={() => void remove(focus.id)}
            onSave={(visits) => void saveVisits(focus.id, visits)}
            trips={trips}
            onTrip={(tripId, on) => void toggleStop(tripId, focus.id, on)}
            savedIds={savedIds}
            onAddAlong={(mark) => {
              if (focus) setRoadBack(focus);
              void add(mark);
            }}
            onClose={closeCard}
          />
        ) : null}
          </>
        )}
      </aside>
      {tourOpen ? <Tour step={tourStep} onStep={setTourStep} onDone={finishTour} /> : null}
    </main>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-serif text-2xl leading-none">{value}</div>
      <div className="mt-1 text-xs tracking-wide text-muted uppercase">{label}</div>
    </div>
  );
}

function Yours({
  marks,
  stateAbbr,
  stateName,
  selected,
  onBack,
  onOpen,
}: {
  marks: Mark[];
  stateAbbr: string | null;
  stateName: string | null;
  selected: string | null;
  onBack: () => void;
  onOpen: (mark: Mark) => void;
}) {
  if (marks.length === 0) {
    return (
      <div className="px-2 py-6">
        {stateAbbr ? (
          <button type="button" onClick={onBack} className="mb-3 flex h-11 items-center gap-1 text-sm text-muted">
            <ChevronLeft className="size-4" aria-hidden="true" />
            All states
          </button>
        ) : null}
        <p className="font-serif text-xl">The map is clear.</p>
        <p className="mt-2 text-sm text-muted">
          Add a beach, a stadium, a road, or a store. It shows up here and as a small mark on the map. Roads draw as a thin line.
        </p>
      </div>
    );
  }
  return (
    <div>
      {stateAbbr ? (
        <button type="button" onClick={onBack} className="mb-2 flex h-11 items-center gap-1 px-2 text-sm text-muted">
          <ChevronLeft className="size-4" aria-hidden="true" />
          {stateName}
        </button>
      ) : null}
      <ul>
        {marks.map((mark) => (
          <Row
            key={mark.id}
            mark={mark}
            active={mark.id === selected}
            saved
            onOpen={() => onOpen(mark)}
          />
        ))}
      </ul>
    </div>
  );
}

function AddList({
  meta,
  stateAbbr,
  stateName,
  category,
  query,
  rows,
  savedIds,
  covered,
  selected,
  onState,
  onCategory,
  onOpen,
  onAdd,
}: {
  meta: AtlasMeta;
  stateAbbr: string | null;
  stateName: string | null;
  category: string | null;
  query: string;
  rows: RoadRec[] | CatalogPlace[];
  savedIds: Set<string>;
  covered: Set<string>;
  selected: string | null;
  onState: (abbr: string | null) => void;
  onCategory: (category: string | null) => void;
  onOpen: (mark: Mark) => void;
  onAdd: (mark: Mark) => void;
}) {
  const [shown, setShown] = useState(60);
  const sentinel = useRef<HTMLLIElement>(null);

  useEffect(() => {
    setShown(60);
  }, [category, query, stateAbbr]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || shown >= rows.length) return;
    const root = node.closest("[data-scroller]");
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setShown((count) => count + 80);
      },
      { root: root instanceof Element ? root : null, rootMargin: "280px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [category, query, rows.length, shown, stateAbbr]);

  if (!stateAbbr) {
    const q = query.trim().toLowerCase();
    const states = meta.states.filter((state) => !q || state.name.toLowerCase().includes(q) || state.abbr.toLowerCase().includes(q));
    return (
      <ul>
        {states.map((state) => {
          const added = covered.has(state.abbr);
          return (
            <li key={state.abbr} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onState(state.abbr)}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-elevated"
              >
                <span className="w-8 font-serif text-lg">{state.abbr}</span>
                <span className="text-sm">{state.name}</span>
              </button>
              {added ? (
                <span className="mr-2 flex items-center gap-1 text-xs text-muted">
                  <Check className="size-4 text-accent" aria-hidden="true" />
                  Added
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onAdd(stateToMark(state))}
                  className="mr-1 h-10 shrink-0 rounded-lg border border-line px-3 text-xs"
                >
                  Add
                </button>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  if (!category) {
    return (
      <div>
        <button type="button" onClick={() => onState(null)} className="mb-2 flex h-11 items-center gap-1 px-2 text-sm text-muted">
          <ChevronLeft className="size-4" aria-hidden="true" />
          All states
        </button>
        <div className="flex items-center justify-between gap-3 px-2">
          <h2 className="font-serif text-2xl">{stateName}</h2>
          {covered.has(stateAbbr) ? (
            <span className="flex h-10 shrink-0 items-center gap-1 rounded-lg border border-line px-3 text-xs">
              <Check className="size-4 text-accent" aria-hidden="true" />
              Added
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                const state = meta.states.find((item) => item.abbr === stateAbbr);
                if (state) onAdd(stateToMark(state));
              }}
              className="h-10 shrink-0 rounded-lg border border-line bg-bg px-3 text-xs"
            >
              Add state
            </button>
          )}
        </div>
        <p className="px-2 pt-1 pb-3 text-xs text-muted">
          Pick a category, or tap a city or highway on the map. The card is where you add it.
        </p>
        <div className="place-scroll grid max-h-[46vh] grid-cols-2 content-start gap-1.5 overflow-y-auto px-1">
          {meta.categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => onCategory(cat.id)}
              className="min-h-11 rounded-lg border border-line bg-bg px-3 py-2 text-left text-sm hover:bg-elevated"
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const label = meta.categories.find((cat) => cat.id === category)?.label ?? category;
  const capped = rows.slice(0, shown);
  return (
    <div>
      <button type="button" onClick={() => onCategory(null)} className="mb-2 flex h-11 items-center gap-1 px-2 text-sm text-muted">
        <ChevronLeft className="size-4" aria-hidden="true" />
        {stateName}
      </button>
      <h2 className="px-2 pb-2 font-serif text-2xl">{label}</h2>
      {capped.length === 0 ? <p className="px-2 py-4 text-sm text-muted">Nothing in this list.</p> : null}
      <ul>
        {category === "route"
          ? (capped as RoadRec[]).map((road) => {
              const mark = roadToMark(road, stateAbbr);
              return (
                <Row
                  key={road.id}
                  mark={mark}
                  active={road.id === selected}
                  saved={savedIds.has(road.id)}
                  onOpen={() => onOpen(mark)}
                  onAdd={() => onAdd(mark)}
                />
              );
            })
          : (capped as CatalogPlace[]).map((place) => {
              const mark = placeToMark(place, category, stateAbbr);
              return (
                <Row
                  key={place.id}
                  mark={mark}
                  active={place.id === selected}
                  saved={savedIds.has(place.id)}
                  onOpen={() => onOpen(mark)}
                  onAdd={() => onAdd(mark)}
                />
              );
            })}
        {shown < rows.length ? (
          <li ref={sentinel} className="px-2 py-3 text-xs text-muted">
            Loading more…
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function NearList({
  rows,
  note,
  busy,
  savedIds,
  selected,
  onLocate,
  onOpen,
  onAdd,
}: {
  rows: NearMark[];
  note: string | null;
  busy: boolean;
  savedIds: Set<string>;
  selected: string | null;
  onLocate: () => void;
  onOpen: (mark: Mark) => void;
  onAdd: (mark: Mark) => void;
}) {
  return (
    <div>
      <div className="px-2 pb-3">
        <button
          type="button"
          onClick={onLocate}
          disabled={busy}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-card bg-accent text-sm font-medium text-accent-ink disabled:opacity-60"
        >
          <Locate className="size-4" aria-hidden="true" />
          {busy ? "Finding you…" : "Places near me"}
        </button>
        <p className="mt-2 text-xs text-muted">Uses this device's location. If The American Atlas is inside another app, allow location for that app.</p>
        {note ? <p className="mt-2 text-sm text-accent">{note}</p> : null}
      </div>
      <ul>
        {rows.map((item) => (
          <Row
            key={item.id}
            mark={item}
            active={item.id === selected}
            saved={savedIds.has(item.id)}
            extra={`${item.miles} mi`}
            onOpen={() => onOpen(item)}
            onAdd={() => onAdd(item)}
          />
        ))}
      </ul>
    </div>
  );
}

function BadgeList({
  name,
  photo,
  earned,
  total,
  marks,
  meta,
  query,
  onQuery,
  groups,
  openGroup,
  onToggle,
}: {
  name: string;
  photo: string;
  earned: number;
  total: number;
  marks: Mark[];
  meta: AtlasMeta | null;
  query: string;
  onQuery: (value: string) => void;
  groups: [string, BadgeView[]][];
  openGroup: string | null;
  onToggle: (group: string) => void;
}) {
  const progress = collectProgress(marks, meta);
  return (
    <div className="px-2">
      <div className="flex items-center gap-3">
        {photo ? (
          <img src={photo} alt="" className="size-14 rounded-full object-cover" />
        ) : (
          <span className="grid size-14 place-items-center rounded-full bg-elevated font-serif text-2xl">{name.charAt(0).toUpperCase()}</span>
        )}
        <div className="min-w-0">
          <p className="text-xs tracking-widest text-faint uppercase">Profile</p>
          <h2 className="truncate font-serif text-2xl leading-tight">{name}</h2>
        </div>
      </div>
      <p className="mt-1 text-sm text-muted">
        {earned} of {total} badges. They unlock from the places you add and stay on your account.
      </p>
      <div className="mt-3 space-y-2">
        {progress.map((row) => (
          <div key={row.label}>
            <div className="flex items-baseline justify-between text-xs text-muted">
              <span>{row.label}</span>
              <span>
                {row.have} of {row.total}
              </span>
            </div>
            <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-line">
              <span className="block h-1.5 rounded-full bg-accent" style={{ width: `${row.total ? Math.min(100, (row.have / row.total) * 100) : 0}%` }} />
            </span>
          </div>
        ))}
      </div>
      <label className="mt-3 flex items-center gap-2 rounded-card border border-line bg-bg px-3">
        <Search className="size-4 shrink-0 text-faint" aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search badges"
          className="h-11 w-full bg-transparent text-base outline-none placeholder:text-faint"
        />
      </label>
      <div className="mt-3 space-y-2">
        {groups.map(([group, items]) => {
          const got = items.filter((item) => item.earned).length;
          const open = openGroup === group || query.trim().length > 0;
          const shown = open ? items.slice(0, query.trim() ? 40 : 80) : [];
          return (
            <section key={group} className="rounded-card border border-line bg-bg">
              <button type="button" onClick={() => onToggle(group)} className="flex min-h-11 w-full items-center justify-between px-3 text-left">
                <span className="text-sm">{group}</span>
                <span className="text-xs text-muted">
                  {got}/{items.length}
                </span>
              </button>
              {open ? (
                <ul className="border-t border-line">
                  {shown.map((badge) => (
                    <li key={badge.id} className="flex items-center gap-2 px-3 py-2">
                      <BadgeIcon group={group} earned={badge.earned} />
                      <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={"text-sm " + (badge.earned ? "text-ink" : "text-muted")}>{badge.name}</span>
                        <span className="shrink-0 text-xs text-faint">
                          {badge.earned ? "Earned" : `${badge.have}/${badge.total}`}
                        </span>
                      </div>
                      <p className="text-xs text-faint">{badge.detail}</p>
                      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-line">
                        <span
                          className={"block h-1 rounded-full " + (badge.earned ? "bg-accent" : "bg-state")}
                          style={{ width: `${Math.min(100, (badge.have / badge.total) * 100)}%` }}
                        />
                      </span>
                      </div>
                    </li>
                  ))}
                  {items.length > shown.length ? (
                    <li className="px-3 py-2 text-xs text-muted">Search to see the rest of this set.</li>
                  ) : null}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Row({
  mark,
  active,
  saved,
  extra,
  onOpen,
  onAdd,
}: {
  mark: Mark;
  active: boolean;
  saved: boolean;
  extra?: string;
  onOpen: () => void;
  onAdd?: () => void;
}) {
  const sys = mark.category === "route" ? (mark.sys as System) || "SR" : "place";
  const label = mark.category === "route" ? mark.id.split(":")[3] || mark.sys : "P";
  return (
    <li className={"flex items-center gap-1 rounded-lg pr-1 " + (active ? "bg-elevated" : "")}>
      <button type="button" onClick={onOpen} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 px-2 py-1.5 text-left">
        <Shield sys={sys} label={label} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{mark.name}</span>
          <span className="text-xs text-muted">
            {mark.state}
            {extra ? ` · ${extra}` : ""} · {saved && mark.visits.length > 1 ? `${earnedPoints(mark)} pts · ${mark.visits.length} visits` : `${mark.points} pts`}
          </span>
        </span>
      </button>
      {saved ? (
        <Check className="mr-2 size-4 shrink-0 text-accent" aria-label="Added" />
      ) : onAdd ? (
        <button type="button" onClick={onAdd} className="h-10 shrink-0 rounded-lg border border-line px-3 text-xs">
          Add
        </button>
      ) : null}
    </li>
  );
}

function collectProgress(marks: Mark[], meta: AtlasMeta | null) {
  const have = (cat: string) => marks.filter((mark) => mark.category === cat).length;
  const total = (cat: string, fallback: number) => meta?.categories.find((item) => item.id === cat)?.count || fallback;
  const states = new Set(marks.map((mark) => mark.state).filter(Boolean)).size;
  const parks = marks.filter((mark) => mark.category === "park" && /national park$/i.test(mark.name) && !/tribal/i.test(mark.name)).length;
  return [
    { label: "States", have: states, total: meta?.states.length ?? 51 },
    { label: "National parks", have: Math.min(parks, 62), total: 62 },
    { label: "High points", have: have("highpoint"), total: total("highpoint", 50) },
    { label: "Scenic drives", have: have("drive"), total: total("drive", 20) },
  ];
}

function moveStop<T>(list: T[], from: number, to: number) {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function TripsPanel({
  trips,
  marks,
  active,
  onOpen,
  onCreate,
  onDelete,
  onRename,
  onOrder,
}: {
  trips: Trip[];
  marks: Mark[];
  active: string | null;
  onOpen: (id: string) => void;
  onCreate: () => Promise<string>;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onOrder: (id: string, stops: TripStop[]) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<TripStop[] | null>(null);
  const [name, setName] = useState("");
  const trip = trips.find((item) => item.id === editing) ?? null;
  const byId = useMemo(() => new Map(marks.map((mark) => [mark.id, mark])), [marks]);

  useEffect(() => {
    setName(trip?.name ?? "");
  }, [trip?.id, trip?.name]);

  if (!trip) {
    return (
      <div className="px-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-serif text-2xl">Trips</h2>
          <button
            type="button"
            onClick={() => {
              void onCreate().then((id) => {
                setSearch("");
                setEditing(id);
                onOpen(id);
              });
            }}
            className="h-10 shrink-0 rounded-lg border border-line bg-bg px-3 text-sm"
          >
            Add trip
          </button>
        </div>
        <p className="mt-1 text-sm text-muted">Name a trip, then pick the places you've already added. The same place can be on the route more than once.</p>
        {trips.length === 0 ? <p className="mt-4 text-sm text-muted">No trips yet.</p> : null}
        <ul className="mt-3 space-y-1">
          {trips.map((item) => (
            <li key={item.id} className="flex items-center gap-1">
              <button
                type="button"
                aria-pressed={active === item.id}
                onClick={() => {
                  setSearch("");
                  setEditing(item.id);
                  onOpen(item.id);
                }}
                className={"h-11 min-w-0 flex-1 truncate rounded-lg px-2 text-left text-sm " + (active === item.id ? "bg-elevated text-ink" : "text-muted")}
              >
                {item.name}
                <span className="text-xs text-faint"> · {item.stops.length}</span>
              </button>
              <button type="button" onClick={() => onDelete(item.id)} className="h-11 px-2 text-xs text-faint">
                Delete
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const stops = preview ?? trip.stops;
  const q = search.trim().toLowerCase();
  const results = marks.filter((mark) => !q || mark.name.toLowerCase().includes(q)).slice(0, 40);

  const startDrag = (index: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const base = trip.stops.slice();
    const startY = event.clientY;
    let to = index;
    setPreview(base);
    const move = (ev: PointerEvent) => {
      const shift = Math.round((ev.clientY - startY) / 48);
      const next = Math.max(0, Math.min(base.length - 1, index + shift));
      if (next === to) return;
      to = next;
      setPreview(moveStop(base, index, next));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPreview(null);
      if (to !== index) onOrder(trip.id, moveStop(base, index, to));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="px-2">
      <button
        type="button"
        onClick={() => setEditing(null)}
        className="mb-2 flex h-11 items-center gap-1 text-sm text-muted"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        All trips
      </button>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          if (name.trim() && name.trim() !== trip.name) onRename(trip.id, name);
          else setName(trip.name);
        }}
        aria-label="Trip name"
        className="h-11 w-full rounded-lg border border-line bg-bg px-3 font-serif text-xl outline-none"
      />
      <label className="mt-3 flex items-center gap-2 rounded-card border border-line bg-bg px-3">
        <Search className="size-4 shrink-0 text-faint" aria-hidden="true" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search your places"
          className="h-11 w-full bg-transparent text-base outline-none placeholder:text-faint"
        />
      </label>
      <p className="mt-3 text-xs tracking-widest text-faint uppercase">Order</p>
      {stops.length === 0 ? <p className="mt-1 text-sm text-muted">Nothing on this trip yet. Search below and tap a place. Tap it again to add the return.</p> : null}
      <ul className="mt-1">
        {stops.map((stop, index) => {
          const mark = byId.get(stop.poiId);
          return (
            <li key={stop.id} className="flex h-12 items-center gap-2">
              <button
                type="button"
                aria-label={`Drag ${mark?.name ?? "stop"} to reorder`}
                onPointerDown={(event) => startDrag(index, event)}
                className="grid h-11 w-8 shrink-0 cursor-grab place-items-center text-faint touch-none"
              >
                <GripVertical className="size-4" />
              </button>
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-medium text-accent-ink">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{mark?.name ?? "Removed place"}</span>
              <button
                type="button"
                onClick={() => onOrder(trip.id, stops.filter((item) => item.id !== stop.id))}
                className="h-11 px-2 text-xs text-faint"
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs tracking-widest text-faint uppercase">Your places</p>
      {marks.length === 0 ? <p className="mt-1 text-sm text-muted">Add a place to the atlas first.</p> : null}
      <ul>
        {results.map((mark) => {
          const count = stops.filter((stop) => stop.poiId === mark.id).length;
          return (
            <li key={mark.id}>
              <button
                type="button"
                onClick={() => onOrder(trip.id, [...stops, { id: `stop:${crypto.randomUUID()}`, poiId: mark.id }])}
                className="flex h-12 w-full items-center gap-2 text-left"
              >
                <span
                  className={
                    "grid size-6 shrink-0 place-items-center rounded-full text-xs font-medium " +
                    (count ? "bg-accent text-accent-ink" : "border border-line text-faint")
                  }
                >
                  {count || "+"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{mark.name}</span>
                  <span className="text-xs text-muted">{count ? `On this trip ×${count} · tap to add again` : mark.state}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function shrinkPhoto(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that photo"));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 640 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const g = canvas.getContext("2d");
        if (!g) {
          reject(new Error("Couldn't read that photo"));
          return;
        }
        g.drawImage(img, 0, 0, canvas.width, canvas.height);
        const url = canvas.toDataURL("image/jpeg", 0.7);
        if (url.length > 140000) reject(new Error("Use a smaller photo"));
        else resolve(url);
      };
      img.onerror = () => reject(new Error("Couldn't read that photo"));
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function Detail({
  mark,
  saved,
  stateName,
  onAdd,
  onRemove,
  onSave,
  trips,
  onTrip,
  savedIds,
  onAddAlong,
  onClose,
  solo = false,
}: {
  mark: Mark;
  saved: boolean;
  stateName: string;
  onAdd: () => void;
  onRemove: () => void;
  onSave: (visits: Visit[]) => void;
  trips: Trip[];
  onTrip: (tripId: string, on: boolean) => void;
  savedIds: Set<string>;
  onAddAlong: (mark: Mark) => void;
  onClose: () => void;
  solo?: boolean;
}) {
  const road = mark.category === "route" || mark.category === "drive";
  const line = road ? (mark.paths.length ? "Drawn as a thin line along the road." : "This road's line isn't in the atlas yet.") : null;
  const [blurb, setBlurb] = useState<PlaceBlurb | null | undefined>(undefined);
  const [along, setAlong] = useState<Mark[]>([]);
  const [draft, setDraft] = useState<Visit[]>(mark.visits.length ? mark.visits : [freshVisit()]);
  const [which, setWhich] = useState(0);
  const [detailNote, setDetailNote] = useState<string | null>(null);
  const visitKey = mark.visits.map((visit) => visit.id).join(",");

  useEffect(() => {
    setDraft(mark.visits.length ? mark.visits : [freshVisit()]);
    setWhich((mark.visits.length ? mark.visits : [freshVisit()]).length - 1);
    setDetailNote(null);
  }, [mark.id, visitKey]);

  useEffect(() => {
    let dead = false;
    setBlurb(undefined);
    lookupPlace(mark, stateName).then((next) => {
      if (!dead) setBlurb(next);
    });
    return () => {
      dead = true;
    };
  }, [mark, stateName]);

  useEffect(() => {
    let dead = false;
    setAlong([]);
    if (!mark.paths.length) return;
    stopsAlong(mark).then((rows) => {
      if (!dead) setAlong(rows.filter((row) => !savedIds.has(row.id)).slice(0, 8));
    });
    return () => {
      dead = true;
    };
  }, [mark, savedIds]);

  const about = blurb?.extract ?? (blurb === null ? fallbackBlurb(mark, stateName) : "Looking up a description…");
  const current = draft[Math.min(which, Math.max(0, draft.length - 1))] ?? draft[0];
  const nextPoints = pointsForVisit(mark.points, draft.length);
  const score = saved
    ? `${earnedPoints({ points: mark.points, visits: draft })} pts from ${draft.length} visit${draft.length === 1 ? "" : "s"}`
    : `${mark.points} pts`;
  function patchVisit(patch: Partial<Visit>) {
    setDraft((prev) => prev.map((visit, index) => (index === which ? { ...visit, ...patch } : visit)));
  }
  return (
    <div className={(solo ? "safe-bottom bg-surface px-4 pt-3 pb-3" : "safe-bottom max-h-[58%] shrink-0 overflow-y-auto border-t border-line bg-elevated px-4 py-3")}>
      <div className="flex items-start gap-3">
        <Shield sys={mark.category === "route" ? ((mark.sys as System) || "SR") : "place"} label={mark.category === "route" ? mark.id.split(":")[3] || mark.sys : "P"} />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">
            {mark.category} · {stateName}
          </p>
          <h2 className="truncate font-serif text-xl leading-tight">{mark.name}</h2>
        </div>
        <button type="button" onClick={onClose} className="h-11 shrink-0 rounded-lg border border-line bg-bg px-4 text-base font-medium">
          Close
        </button>
      </div>
      <div className={"mt-3 grid gap-2 " + (blurb?.url ? "grid-cols-2" : "grid-cols-1")}>
        {blurb?.url ? (
          <a
            href={blurb.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-11 items-center justify-center rounded-card border border-line bg-bg px-2 text-sm"
          >
            Wikipedia
          </a>
        ) : null}
        <a
          href={mapsUrl(mark, stateName)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-11 items-center justify-center rounded-card border border-line bg-bg px-2 text-center text-sm"
        >
          Find in Google Maps
        </a>
      </div>
      <p className="mt-2 line-clamp-3 text-sm leading-snug text-muted">{about}</p>
      <p className="mt-1 text-xs text-faint">
        {score}
        {saved ? (nextPoints > 0 ? ` · next visit ${nextPoints} pts` : " · later visits are tracked, worth 0 pts") : ""}
        {line ? ` · ${line}` : !saved && mark.lat == null ? " · Counted on your list, not pinned." : ""}
      </p>
      <button
        type="button"
        onClick={saved ? onRemove : onAdd}
        className={
          "mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-card text-sm font-medium " +
          (saved ? "bg-accent text-accent-ink" : "border border-line bg-bg text-ink")
        }
      >
        {saved ? "Remove from map" : "Add to map"}
      </button>
      {saved ? (
        <button
          type="button"
          onClick={() => {
            if (draft.length >= 12) {
              setDetailNote("That's enough visits to track for one place.");
              return;
            }
            const next = [...draft, freshVisit()];
            setDraft(next);
            setWhich(next.length - 1);
            onSave(next);
          }}
          className="mt-2 flex h-11 w-full items-center justify-center rounded-card border border-line bg-bg text-sm"
        >
          {nextPoints > 0 ? `Visit again · ${nextPoints} pts` : "Visit again · 0 pts"}
        </button>
      ) : null}
      {saved && current ? (
        <details className="mt-3 rounded-card border border-line bg-bg px-3 py-2">
          <summary className="cursor-pointer text-sm">Visit details, optional</summary>
          <p className="mt-2 text-xs text-faint">First visit 100%, then 85%, 50%, 25%, 10%, then none.</p>
          {draft.length > 1 ? (
            <label className="mt-2 block text-xs text-muted">
              Visit
              <select
                value={which}
                onChange={(event) => setWhich(Number(event.target.value))}
                className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-2 text-sm text-ink"
              >
                {draft.map((visit, index) => (
                  <option key={visit.id} value={index}>
                    Visit {index + 1} · {pointsForVisit(mark.points, index)} pts
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="mt-2 block text-xs text-muted">
            Date
            <input
              type="date"
              value={current.visitedOn ?? ""}
              onChange={(event) => patchVisit({ visitedOn: event.target.value || null })}
              className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-2 text-sm text-ink"
            />
          </label>
          <label className="mt-2 block text-xs text-muted">
            Note
            <textarea
              value={current.note}
              onChange={(event) => patchVisit({ note: event.target.value.slice(0, 500) })}
              rows={2}
              placeholder="What you remember"
              className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink outline-none"
            />
          </label>
          <label className="mt-2 block text-xs text-muted">
            Photo
            <input
              type="file"
              accept="image/*"
              className="mt-1 block w-full text-xs"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                shrinkPhoto(file).then((url) => patchVisit({ photo: url })).catch((err: unknown) => {
                  setDetailNote(err instanceof Error ? err.message : "Couldn't use that photo");
                });
              }}
            />
          </label>
          {current.photo ? <img src={current.photo} alt="" className="mt-2 h-24 w-full rounded-lg object-cover" /> : null}
          {current.photo ? (
            <button type="button" onClick={() => patchVisit({ photo: "" })} className="mt-1 text-xs text-faint">
              Remove photo
            </button>
          ) : null}
          {trips.length ? (
            <label className="mt-2 block text-xs text-muted">
              Trip
              <select
                value={trips.find((trip) => trip.stops.some((stop) => stop.poiId === mark.id))?.id ?? ""}
                onChange={(event) => {
                  const next = event.target.value;
                  for (const trip of trips) {
                    if (trip.stops.some((stop) => stop.poiId === mark.id) && trip.id !== next) onTrip(trip.id, false);
                  }
                  if (next) onTrip(next, true);
                }}
                className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-2 text-sm text-ink"
              >
                <option value="">Not on a trip</option>
                {trips.map((trip) => (
                  <option key={trip.id} value={trip.id}>
                    {trip.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            onClick={() => onSave(draft.map((visit, index) => (index === which ? { ...current, note: current.note.trim() } : visit)))}
            className="mt-3 flex h-10 w-full items-center justify-center rounded-lg border border-line text-sm"
          >
            Save details
          </button>
          {detailNote ? <p className="mt-1 text-xs text-accent">{detailNote}</p> : null}
        </details>
      ) : null}
      {along.length ? (
        <div className="mt-3">
          <p className="text-xs tracking-widest text-faint uppercase">Along this road</p>
          <ul className="mt-1">
            {along.map((stop) => (
              <li key={stop.id} className="flex items-center gap-2 py-1">
                <span className="min-w-0 flex-1 truncate text-sm">{stop.name}</span>
                <button type="button" onClick={() => onAddAlong(stop)} className="h-9 shrink-0 rounded-lg border border-line px-2 text-xs">
                  Add
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
