import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Check, ChevronDown, ChevronLeft, ChevronUp, GripVertical, Locate, Mail, Search, Settings } from "lucide-react";
import { useCurrentUser, useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  loadMeta,
  loadPlaces,
  loadRegisterAlso,
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
import type { Thread } from "@/lib/messages";
import { type Trip, type TripStop } from "@/lib/trips";
import { fallbackBlurb, lookupPlace, mapsUrl, type PlaceBlurb } from "@/lib/place-info";
import { categoryName, kindFor, kindVisible, placeKinds, tierForKind, tierForPlace } from "@/lib/place-kinds";
import { placeToMark, placesNear, readDeviceLocation, roadToMark, stateToMark, stopsAlong, milesBetween, type Fix, type NearMark } from "@/lib/nearby";
import { collectPassed, takeNativeFixes } from "@/lib/travel";
import { missedFixes, nativeDelivery, noteHandledFix } from "@/lib/native-tracking";
import { startChatChecks, useChat } from "@/lib/chat-store";
import { SendPlaceSheet } from "@/components/chat-send";
import { MessageBoard } from "@/components/friend-chat";
import { AtlasSplash, LoginScreen } from "@/components/login-screen";
import { SettingsPage } from "@/components/settings-page";
import { GhostPanel } from "@/components/ghost-panel";
import { FriendsPanel } from "@/components/friends-panel";
import { PhotosPanel, PhotoViewer } from "@/components/photos-panel";
import { updateWidget } from "@/lib/widget";
import { matchPlace, tripFor, type RecordingTrip } from "@/lib/photo-file";
import { choosePhotoPlace, loadParkShapes, matchPark } from "@/lib/park-photo";
import { UpdatePrompt } from "@/components/update-prompt";
import { RecapPanel } from "@/components/recap-panel";
import { deviceId, flushDriveLog, localDay, logDrive, switchDriveLog } from "@/lib/drive-log";
import { acceptFriend, listFriends } from "@/lib/friends";
import { useSettingsRoute } from "@/lib/settings-route";
import { Tour } from "@/components/tour";
import { BadgeIcon } from "@/components/badge-icon";
import { resetAccountChoices, setSettingsOwner, settingsOwner, useSettings } from "@/lib/atlas-settings";
import { freshPoints, GHOST_KEEP_HOURS, loadGhost, mergeLiveCache, syncGhost, thinTrail, trailLines, useGhost, type GhostLines, type GhostPoint } from "@/lib/ghost-trail";
import { clearLiveTrail, incomingLive, pullLiveTrail, pushLiveTrail, useLiveShare, type LiveFriend } from "@/lib/live-share";
import { loadAccountSettings, saveAccountSettings, type AccountSettings } from "@/lib/account-settings";
import { clearGhostCache, pullGhostCache, pushGhostCache } from "@/lib/ghost-cache";
import { setTripRecording } from "@/lib/trips";
import { friendPhotoPins, listPhotos, savePhoto, deletePhoto, type FriendPhotoPin, type PhotoInfo } from "@/lib/photos";
import { deleteLocalPhoto } from "@/lib/photo-local";
import { readPhotoFile } from "@/lib/photo-file";
import { listLocalPhotos, setLocalPhotoOwner } from "@/lib/photo-local";
import { requestTrackingPermission } from "@/lib/background-location";
import { pushBack } from "@/lib/sheet-back";
import { isMarkerColor, isMarkerIcon } from "@/lib/you-marker";
import { useOfflinePack } from "@/lib/offline-pack";
import { nativeApp } from "@/lib/native";
import { askNotifyOnce, notifyFriendLive } from "@/lib/live-notify";
import { notifyPlacesAdded } from "@/lib/place-notifications";
import { countyToMark } from "@/lib/counties";
import { glyphUrl } from "@/lib/map-glyphs";
import { type Profile } from "@/lib/profile";
import { earnedPoints, ensureVisits, freshVisit, pointsForVisit, type Visit } from "@/lib/visits";
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
  ["recap", "Recap"],
  ["friends", "Friends"],
  ["photos", "Photos"],
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

function packTrail(points: GhostPoint[]) {
  return points.slice(-800).map((point) =>
    point.brk ? ([point.lat, point.lon, point.t, 1] as const) : ([point.lat, point.lon, point.t] as const),
  );
}

function pickSettings(state: AccountSettings): AccountSettings {
  return {
    icons: state.icons,
    stateBorder: state.stateBorder,
    countyColor: state.countyColor,
    fastAdd: state.fastAdd,
    showParks: state.showParks,
    showTowns: state.showTowns,
    showReservations: state.showReservations,
    showPhotos: state.showPhotos,
    showFriendPhotos: state.showFriendPhotos,
    followState: state.followState,
    townColor: state.townColor,
    reservationColor: state.reservationColor,
    ghostHours: state.ghostHours,
    ghostColor: state.ghostColor,
    keepGhost: state.keepGhost,
  };
}

function sameSettings(a: AccountSettings, b: AccountSettings) {
  const left = pickSettings(a);
  const right = pickSettings(b);
  return (Object.keys(left) as (keyof AccountSettings)[]).every((key) => left[key] === right[key]);
}

/** Places that are areas or lines, not spots; a trip's line skips them. */
const AREA_KINDS = new Set(["county", "route", "state", "reservation", "drive", "forest", "seashore"]);

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
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [livePins, setLivePins] = useState<LiveFriend[]>([]);
  const [photos, setPhotos] = useState<PhotoInfo[]>([]);
  const [viewing, setViewing] = useState<{ list: PhotoInfo[]; id: string } | null>(null);
  const closeViewer = useCallback(() => setViewing(null), []);
  // Back from a zoomed-in map or a picked state goes to the whole country first.
  const [homeTick, setHomeTick] = useState(0);
  const [focusTick, setFocusTick] = useState(0);
  const [mapAway, setMapAway] = useState(false);
  const keepGhost = useSettings((s) => s.keepGhost);
  const keptGhostBefore = useRef(keepGhost);
  // Turning "keep the trail on my account" off removes the copy already there.
  useEffect(() => {
    const was = keptGhostBefore.current;
    keptGhostBefore.current = keepGhost;
    if (was && !keepGhost && user?.id) void clearGhostCache().catch(() => {});
  }, [keepGhost, user?.id]);
  const recordingTrip = useMemo<RecordingTrip>(() => {
    const trip = trips.find((item) => item.id === recordingId);
    return trip ? { id: trip.id, places: trip.stops.map((stop) => stop.poiId) } : null;
  }, [trips, recordingId]);
  const [sharedShots, setSharedShots] = useState<FriendPhotoPin[]>([]);
  const [roads, setRoads] = useState<RoadRec[]>([]);
  const [catalog, setCatalog] = useState<CatalogPlace[]>([]);
  const [stateRoads, setStateRoads] = useState<RoadRec[]>([]);
  const [loadedPlaces, setLoadedPlaces] = useState<(CatalogPlace & { cat: string })[]>([]);
  const [focus, setFocus] = useState<Mark | null>(null);
  const [you, setYou] = useState<Fix | null>(null);
  const [tracker, setTracker] = useState<Fix | null>(null);
  const [near, setNear] = useState<NearMark[]>([]);
  const [nearNote, setNearNote] = useState<string | null>(null);
  const [nearBusy, setNearBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [badgeQuery, setBadgeQuery] = useState("");
  const [openGroup, setOpenGroup] = useState<string | null>("Milestones");
  const [sheet, setSheet] = useState(50);
  const [sheetInstant, setSheetInstant] = useState(false);
  const [mapCard, setMapCard] = useState(false);
  /** The map's place card tucked down to just its name. */
  const [cardSmall, setCardSmall] = useState(false);
  /** A place opened from a chat: shown alone on the map; closing it goes back to the chat. */
  const [spot, setSpot] = useState<{ id: string; lon: number; lat: number; from: Thread | null; sheet: number; viaMail?: boolean } | null>(null);
  /** The chat the mail page reopens (coming back from a place shown on the map). */
  const [mailThread, setMailThread] = useState<Thread | null>(null);
  const [resumeChat, setResumeChat] = useState<Thread | null>(null);
  const [viewZoom, setViewZoom] = useState(3);
  const [viewBase, setViewBase] = useState<number | null>(null);
  const [hiddenKinds, setHiddenKinds] = useState<string[]>([]);
  const [visitedOnly, setVisitedOnly] = useState(false);
  const [typesOpen, setTypesOpen] = useState(true);
  const [headerOpen, setHeaderOpen] = useState(true);
  const settingsRoute = useSettingsRoute();
  const settingsOpen = settingsRoute.page !== null;
  const [roadBack, setRoadBack] = useState<Mark | null>(null);
  const [profile, setProfile] = useState<Profile>({ name: "", photo: "", markerIcon: "", markerColor: "" });
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
  const shareOnly = useSettings((s) => s.shareOnly);
  const setShareOnly = useSettings((s) => s.setShareOnly);
  const liveViewers = useLiveShare((s) => s.viewers);
  // Location runs for tracking, or just to share it with picked friends.
  const sharingOnly = !trackTravel && shareOnly && liveViewers.length > 0;
  const locating = trackTravel || sharingOnly;
  const setTrackTravel = useSettings((s) => s.setTrackTravel);
  const fastAdd = useSettings((s) => s.fastAdd);
  const showParks = useSettings((s) => s.showParks);
  const showTowns = useSettings((s) => s.showTowns);
  const showReservations = useSettings((s) => s.showReservations);
  const followState = useSettings((s) => s.followState);
  const showPhotos = useSettings((s) => s.showPhotos);
  const showFriendPhotos = useSettings((s) => s.showFriendPhotos);
  const townColor = useSettings((s) => s.townColor);
  const reservationColor = useSettings((s) => s.reservationColor);
  const markerIcon = useSettings((s) => s.markerIcon);
  const markerColor = useSettings((s) => s.markerColor);
  const setMarkerIcon = useSettings((s) => s.setMarkerIcon);
  const setMarkerColor = useSettings((s) => s.setMarkerColor);
  const ghostHours = useSettings((s) => s.ghostHours);
  const setGhostHours = useSettings((s) => s.setGhostHours);
  const ghostColor = useSettings((s) => s.ghostColor);
  const setGhostColor = useSettings((s) => s.setGhostColor);
  const ghostLive = useGhost((s) => s.live);
  const ghostSaved = useGhost((s) => s.saved);
  const ghostHidden = useGhost((s) => s.hidden);
  const ghostFocus = useGhost((s) => s.focusId);
  const ghostLook = useGhost((s) => s.look);
  const [ghostOpen, setGhostOpen] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [friendId, setFriendId] = useState<string | null>(null);
  const [friendLines, setFriendLines] = useState<GhostLines>([]);
  const [friendFix, setFriendFix] = useState<{ id: string; lat: number; lon: number } | null>(null);
  const [friendLook, setFriendLook] = useState(0);
  const [friendLive, setFriendLive] = useState<{ id: string; name: string } | null>(null);
  const [friendNote, setFriendNote] = useState<string | null>(null);
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
  const friendCode = (useSearch({ strict: false }) as { friend?: string }).friend;
  const navigate = useNavigate();

  /** Saved places and trips have loaded (from the account, or the device when offline). */
  const loadedRef = useRef(false);
  useEffect(() => {
    let dead = false;
    loadedRef.current = false;
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
          loadedRef.current = true;
          setOffline(false);
          maybeTour(remote);
          const rows = await listBadgeProgress().catch(() => badgeViewsFromMarks(remote.marks));
          if (!dead) noteBadges(rows);
          return;
        }
        const local = await readVault();
        if (!dead) apply(local);
        loadedRef.current = true;
      })
      .catch(async () => {
        if (dead) return;
        setOffline(true);
        const local = await readVault().catch(() => null);
        if (!dead && local) apply(local);
        else if (!dead) setError("Your saved places didn't load.");
        // Don't hold up tracking forever; a place that's already saved is still never re-added (add()).
        loadedRef.current = !!local;
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
      "reservation",
      "forest",
      "refuge",
      "capitol",
      "beach",
      "stadium",
      "chain",
      "market",
      "museum",
      "historic",
      "register",
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
      "cemetery",
      "crossing",
      "stateline",
      "landmark",
      "hotspring",
      "peak",
      "pass",
      "dam",
      "lake",
      "ship",
      "railroad",
      "aviation",
      "space",
      "observatory",
      "geo",
      "ghost",
      "unesco",
      "ski",
      "college",
      "ferry",
      "tunnel",
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
      if (mark.state !== stateAbbr || mark.category !== "route") return mark;
      const road = byId.get(mark.id);
      if (!road?.paths?.length) return mark;
      // A saved road keeps a copy of its line; take the atlas's when it changed
      // (lines were rebuilt from OpenStreetMap, and many were missing or wrong).
      const count = (paths: number[][][]) => paths.reduce((n, line) => n + line.length, 0);
      const first = (paths: number[][][]) => paths[0]?.[0]?.join(",") ?? "";
      if (mark.paths.length === road.paths.length && count(mark.paths) === count(road.paths) && first(mark.paths) === first(road.paths)) return mark;
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
  // A different place opens with its whole card showing.
  useEffect(() => setCardSmall(false), [focus?.id]);

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

  /** Save a new place. Returns false if it was already saved or the save failed. */
  async function add(mark: Mark, quiet = false, visitedOn: string | null = null) {
    // Already saved: saving it again would replace its visits with one new one.
    if (marksRef.current.some((item) => item.id === mark.id)) {
      if (!quiet) choose(marksRef.current.find((item) => item.id === mark.id) as Mark);
      return false;
    }
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
      visits: [{ ...freshVisit(), visitedOn }],
    };
    setMarks((prev) => (prev.some((item) => item.id === clean.id) ? prev : [clean, ...prev]));
    marksRef.current = [clean, ...marksRef.current];
    if (!quiet) choose(clean);
    try {
      await vaultSaveMark(clean);
      noteBadges(badgeViewsFromMarks([clean, ...marks.filter((item) => item.id !== clean.id)]));
      setPendingSync((await readVault()).pending);
      await noteTrip(clean.id);
      return true;
    } catch {
      setMarks((prev) => prev.filter((item) => item.id !== clean.id));
      marksRef.current = marksRef.current.filter((item) => item.id !== clean.id);
      setError("Couldn't save that place.");
      return false;
    }
  }

  /**
   * For a camera-roll photo taken somewhere not on the atlas yet: the atlas
   * place it was taken at (a spot within a short walk, a park within 2 miles,
   * a town within 5), or null.
   */
  const suggestPhotoPlace = useCallback(
    async (lat: number, lon: number) => {
      if (!meta) return null;
      const rows = await placesNear({ lat, lon }, meta.states, 25);
      const spots = rows.filter((row) => !AREA_KINDS.has(row.category));
      // Inside a park's outline beats a nearer pin (a park's sub-area, a beach inside it).
      const shapes = await loadParkShapes().catch(() => null);
      const park = shapes ? matchPark(lat, lon, spots, shapes) : null;
      return choosePhotoPlace(lat, lon, matchPlace(lat, lon, spots), park);
    },
    [meta],
  );

  async function addPhotoPlace(place: { id: string }, takenAt: number | null) {
    const mark = place as Mark;
    if (marksRef.current.some((item) => item.id === mark.id)) return;
    const day = takenAt ? localDay(takenAt) : null;
    await add(mark, true, day);
  }

  const addRef = useRef(add);
  addRef.current = add;
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const tripsRef = useRef(trips);
  tripsRef.current = trips;
  const recordingRef = useRef(recordingId);
  recordingRef.current = recordingId;
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const userIdRef = useRef("");
  userIdRef.current = user?.id ?? "";
  // Unread messages and thumbs-up, checked while signed in.
  useEffect(() => {
    if (!user?.id) return;
    return startChatChecks();
  }, [user?.id]);
  // The home-screen widget (Android): today's new places, this month's points, tracking.
  useEffect(() => {
    if (!user?.id) return;
    updateWidget(marks, trackTravel);
  }, [marks, trackTravel, user?.id]);
  const unreadTotal = useChat(
    (state) =>
      Object.values(state.summary.friends).reduce((a, b) => a + b, 0) +
      Object.values(state.summary.groups).reduce((a, b) => a + b, 0) +
      state.summary.likes,
  );
  const [sendPlace, setSendPlace] = useState<Mark | null>(null);
  const [fitTo, setFitTo] = useState<{ tick: number; points: [number, number][]; maxZoom: number } | null>(null);

  async function noteTrip(poiId: string) {
    const tripId = recordingRef.current;
    if (!tripId) return;
    const trip = tripsRef.current.find((item) => item.id === tripId);
    if (!trip || trip.stops.some((stop) => stop.poiId === poiId)) return;
    const stop = { id: `stop:${crypto.randomUUID()}`, poiId };
    tripsRef.current = tripsRef.current.map((item) => (item.id === tripId ? { ...item, stops: [...item.stops, stop] } : item));
    setTrips(tripsRef.current);
    await vaultTripStop(tripId, poiId, true).catch(() => setError("Couldn't add that place to the trip."));
  }

  useEffect(() => {
    if (!locating) return;
    // Sharing only: the position goes to friends, but no places are added and no miles logged.
    const adding = trackTravel;
    if (!nativeApp && (typeof navigator === "undefined" || !navigator.geolocation)) {
      setTrackTravel(false);
      setShareOnly(false);
      setError("This device can't share a location.");
      return;
    }
    let dead = false;
    let last: Fix | null = null;
    let busy = false;
    let lastDotAt = 0;
    const pending: Fix[] = [];
    let passSeeded = false;
    const passInside = new Set<string>();
    function noteAgain(marksHere: Mark[]) {
      if (!passSeeded) {
        for (const mark of marksHere) passInside.add(mark.id);
        passSeeded = true;
        return [] as Mark[];
      }
      const now = new Set(marksHere.map((mark) => mark.id));
      const entered = marksHere.filter((mark) => !passInside.has(mark.id));
      for (const mark of entered) passInside.add(mark.id);
      for (const id of passInside) if (!now.has(id)) passInside.delete(id);
      return entered;
    }

    function paintTracker(fix: Fix, force = false) {
      const now = Date.now();
      if (!force && now - lastDotAt < 8000) return;
      lastDotAt = now;
      setTracker(fix);
    }

    async function run(fix: Fix) {
      const atlas = metaRef.current;
      if (!atlas || dead) return;
      if (last && milesBetween(last.lat, last.lon, fix.lat, fix.lon) < 0.08) return;
      last = fix;
      const saved = new Set(marksRef.current.map((mark) => mark.id));
      const visited: Mark[] = [];
      const again: Mark[] = [];
      const found = await collectPassed(fix, atlas.states, saved, recordingRef.current ? visited : undefined, again);
      if (dead) return;
      if (!found.length && !visited.length && !again.length) return;
      // A fix read back from the phone's log keeps the day it was taken.
      const day = fix.t && localDay(fix.t) !== localDay(Date.now()) ? localDay(fix.t) : null;
      const added: Mark[] = [];
      for (const mark of found) {
        saved.add(mark.id);
        if (await addRef.current(mark, true, day)) added.push(mark);
      }
      for (const mark of visited) await noteTrip(mark.id);
      const reentered: Mark[] = [];
      for (const mark of noteAgain(again)) if (await revisitRef.current(mark, day)) reentered.push(mark);
      if (!added.length && !reentered.length) return;
      const label = added.length
        ? added.length === 1
          ? `Added ${added[0]?.name}`
          : `Added ${added.length} places from the drive`
        : reentered.length === 1
          ? `Visited ${reentered[0]?.name} again`
          : `Visited ${reentered.length} places again`;
      setPassedNote(label);
      if (added.length) void notifyPlacesAdded(added);
    }

    let waited = 0;
    async function pump() {
      if (busy || dead) return;
      // Not before saved places and trips have loaded, and a trip that was
      // recording is recording again: otherwise places already saved look new
      // and the trip misses its stops.
      const resuming = tripsRef.current.some((trip) => trip.recording) && !recordingRef.current && waited < 50;
      if (!loadedRef.current || resuming) {
        waited += 1;
        window.setTimeout(() => void pump(), 400);
        return;
      }
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

    let lastShare = 0;
    function shareLive(force = false) {
      if (!useLiveShare.getState().viewers.length) {
        if (lastShare) {
          lastShare = 0;
          void clearLiveTrail({ data: { deviceId: deviceId() } }).catch(() => {});
        }
        return;
      }
      const now = Date.now();
      if (!force && now - lastShare < 12000) return;
      const trail = thinTrail(freshPoints(useGhost.getState().live, useSettings.getState().ghostHours), 90);
      // One fix is enough for the marker. The line appears once there's a second point.
      const here = useGhost.getState().live.at(-1);
      const points = trail.length >= 1 ? trail : here ? [here] : [];
      if (!points.length) return;
      lastShare = now;
      const packed = points.slice(-600).map((point) =>
        point.brk ? ([point.lat, point.lon, point.t, 1] as const) : ([point.lat, point.lon, point.t] as const),
      );
      void pushLiveTrail({ data: { points: packed, deviceId: deviceId() } }).catch(() => {
        lastShare = 0;
      });
    }

    let lastCache = 0;
    function shareCache() {
      if (!useSettings.getState().keepGhost) return;
      const now = Date.now();
      if (now - lastCache < 20000) return;
      const points = thinTrail(freshPoints(useGhost.getState().live, 24), 80);
      if (points.length < 2) return;
      lastCache = now;
      void pushGhostCache({ data: packTrail(points) }).catch(() => {
        lastCache = 0;
      });
    }

    // While the app reads back what the phone logged while it was closed,
    // new fixes wait, so the trail and the places stay in order.
    let catchingUp = false;
    const held: Fix[] = [];
    function push(fixes: Fix[], forceDot = false) {
      if (catchingUp) {
        held.push(...fixes);
        return;
      }
      const latest = fixes[fixes.length - 1];
      if (latest) paintTracker(latest, forceDot);
      useGhost.getState().record(fixes);
      shareLive();
      if (!adding) return;
      logDrive(fixes);
      shareCache();
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
            setShareOnly(false);
            setError("Location is blocked. Allow it for The American Atlas, then turn tracking back on.");
          },
          { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
        );
    async function catchUp() {
      if (!nativeApp || catchingUp || dead) return;
      catchingUp = true;
      let missed: Fix[] = [];
      try {
        missed = await missedFixes();
      } catch {
        missed = [];
      }
      catchingUp = false;
      if (dead) return;
      if (missed.length) push(missed, true);
      if (held.length) push(held.splice(0), true);
    }
    if (nativeApp) {
      void Promise.all([import("@capgo/background-geolocation"), nativeDelivery(userIdRef.current, deviceId())]).then(([{ BackgroundGeolocation }, delivery]) => {
        if (dead) return;
        void BackgroundGeolocation.start(
          {
            // Posting natively (delivery.url) is what keeps the location service
            // running after Android closes the app; every fix also goes into the
            // phone's log, which catchUp() reads when the app opens again.
            ...delivery,
            locationLog: true,
            locationLogMaxEntries: 60000,
            backgroundTitle: "The American Atlas",
            backgroundMessage: adding
              ? "Adding towns, reservations, counties, roads, and places as you go."
              : "Sharing your location with the friends you picked.",
            requestPermissions: true,
            stale: false,
            distanceFilter: 80,
          },
          (location, error) => {
            if (dead) return;
            if (error) {
              if (error.code === "NOT_AUTHORIZED" || error.code === "PERMISSION_DENIED") {
                setTrackTravel(false);
                setShareOnly(false);
                setError("Location is blocked. Allow it all the time for The American Atlas, then turn tracking back on.");
              }
              return;
            }
            if (!location) return;
            const t = Number(location.time) || Date.now();
            if (!catchingUp) noteHandledFix(t);
            push([{ lat: location.latitude, lon: location.longitude, t }]);
          },
        );
      });
    }
    const host = window as Window & { atlasPushFixes?: (fixes: Fix[]) => void };
    host.atlasPushFixes = (fixes) => push(fixes);
    const refreshDot = () => {
      if (document.visibilityState === "hidden") return;
      void catchUp();
      const queued = takeNativeFixes();
      if (queued.length) push(queued, true);
      void readDeviceLocation()
        .then((fix) => {
          if (dead) return;
          if (catchingUp) {
            held.push(fix);
            return;
          }
          paintTracker(fix, true);
          useGhost.getState().record([fix]);
          shareLive();
          if (!adding) return;
          logDrive([fix]);
          shareCache();
        })
        .catch(() => {});
    };
    push(takeNativeFixes());
    refreshDot();
    const beat = window.setInterval(() => shareLive(), 12000);
    const unsubLive = useLiveShare.subscribe((state, prev) => {
      if (state.viewers.join() !== prev.viewers.join()) shareLive(true);
    });
    window.addEventListener("focus", refreshDot);
    document.addEventListener("visibilitychange", refreshDot);
    return () => {
      dead = true;
      setTracker(null);
      if (nativeApp) void import("@capgo/background-geolocation").then(({ BackgroundGeolocation }) => BackgroundGeolocation.stop());
      else navigator.geolocation.clearWatch(watch);
      delete host.atlasPushFixes;
      window.removeEventListener("focus", refreshDot);
      document.removeEventListener("visibilitychange", refreshDot);
      window.clearInterval(beat);
      unsubLive();
      void clearLiveTrail({ data: { deviceId: deviceId() } }).catch(() => {});
    };
  }, [setTrackTravel, setShareOnly, trackTravel, locating]);

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

  /** One more visit when tracking enters a place already on the atlas. Twelve is the most kept. */
  async function revisit(mark: Mark, day: string | null) {
    const current = marksRef.current.find((item) => item.id === mark.id);
    if (!current) return false;
    const visits = current.visits.length ? current.visits : ensureVisits(current).visits;
    if (visits.length >= 12) return false;
    // One visit a day: wobbling GPS at a town or county line, or crossing it back and forth, isn't a new visit.
    const on = day ?? localDay(Date.now());
    if (visits.some((visit) => visit.visitedOn === on)) return false;
    await saveVisits(current.id, [...visits, { ...freshVisit(), visitedOn: on }]);
    return true;
  }

  const revisitRef = useRef(revisit);
  revisitRef.current = revisit;

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

  async function ensureTracking() {
    if (useSettings.getState().trackTravel) return true;
    if (nativeApp) {
      const result = await requestTrackingPermission();
      if (result === "denied") {
        setError("Allow location all the time, then start the trip again.");
        return false;
      }
    }
    setTrackTravel(true);
    return true;
  }

  async function beginRecording(id: string) {
    setRecordingId(id);
    setActiveTrip(id);
    setTrips((prev) => prev.map((trip) => ({ ...trip, recording: trip.id === id })));
    setTab("trips");
    try {
      await setTripRecording({ data: { id, on: true } });
    } catch {
      setError("Couldn't start that trip.");
    }
  }

  async function startTrip(name: string) {
    if (!(await ensureTracking())) return;
    const id = await makeTrip(name);
    await beginRecording(id);
  }

  async function restartTrip(id: string) {
    if (!(await ensureTracking())) return;
    await beginRecording(id);
  }

  async function endTrip() {
    const id = recordingId;
    setRecordingId(null);
    if (!id) return;
    setTrips((prev) => prev.map((trip) => (trip.id === id ? { ...trip, recording: false } : trip)));
    try {
      await setTripRecording({ data: { id, on: false } });
    } catch {
      setError("Couldn't end that trip.");
    }
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
    if (recordingId === id) setRecordingId(null);
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
    const trip = trips.find((item) => item.id === (recordingId ?? activeTrip));
    if (!trip) return [] as [number, number][];
    const byId = new Map(marks.map((mark) => [mark.id, mark]));
    const line: [number, number][] = [];
    for (const stop of trip.stops) {
      const mark = byId.get(stop.poiId);
      // Counties, roads, states and other large areas only have a middle
      // point, often miles from where you went; joining those drew lines out
      // into nowhere. The line connects the places you actually stop at.
      if (!mark || AREA_KINDS.has(mark.category)) continue;
      if (mark.lon != null && mark.lat != null) line.push([mark.lon, mark.lat]);
    }
    return line;
  }, [activeTrip, marks, recordingId, trips]);

  const photoPins = useMemo(() => {
    const pins: { id: string; poiId: string; lat: number; lon: number; thumb: string; friendId?: string }[] = [];
    if (showPhotos) {
      const byPlace = new Map<string, PhotoInfo>();
      for (const photo of photos) {
        const prev = byPlace.get(photo.poiId);
        if (!prev || (photo.takenAt ?? 0) > (prev.takenAt ?? 0)) byPlace.set(photo.poiId, photo);
      }
      for (const photo of byPlace.values()) {
        const mark = marks.find((item) => item.id === photo.poiId);
        const lat = photo.lat ?? mark?.lat ?? null;
        const lon = photo.lon ?? mark?.lon ?? null;
        if (lat == null || lon == null) continue;
        pins.push({ id: photo.id, poiId: photo.poiId, lat, lon, thumb: photo.thumb });
      }
    }
    if (showFriendPhotos) {
      const seen = new Set<string>();
      for (const photo of sharedShots) {
        const key = `${photo.friendId}:${photo.poiId}`;
        if (seen.has(key) || photo.lat == null || photo.lon == null) continue;
        seen.add(key);
        pins.push({ id: photo.id, poiId: photo.poiId, lat: photo.lat, lon: photo.lon, thumb: photo.thumb, friendId: photo.friendId });
      }
    }
    return pins;
  }, [marks, photos, sharedShots, showPhotos, showFriendPhotos]);

  async function addPlacePhoto(mark: Mark, file: File) {
    const read = await readPhotoFile(file);
    const id = `ph-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const row: PhotoInfo = {
      id,
      poiId: mark.id,
      tripId: tripFor(recordingTrip, mark.id),
      caption: "",
      takenAt: read.gps?.takenAt ?? (file.lastModified || Date.now()),
      lat: mark.lat,
      lon: mark.lon,
      shared: false,
      thumb: read.thumb,
    };
    await savePhoto({
      data: { ...row, image: read.image },
    });
    setPhotos((prev) => [row, ...prev]);
  }

  async function removePlacePhoto(id: string) {
    const previous = photos;
    setPhotos((prev) => prev.filter((photo) => photo.id !== id));
    setViewing((cur) => {
      if (!cur) return cur;
      const list = cur.list.filter((photo) => photo.id !== id);
      if (!list.length) return null;
      const still = list.some((photo) => photo.id === cur.id);
      return { list, id: still ? cur.id : list[0]!.id };
    });
    try {
      if (nativeApp) await deleteLocalPhoto(id).catch(() => {});
      await deletePhoto({ data: id });
    } catch (err) {
      setPhotos(previous);
      setError(err instanceof Error ? err.message : "Couldn't remove that photo.");
    }
  }

  async function locate() {
    if (!meta) return;
    setNearBusy(true);
    setNearNote(null);
    try {
      const fix = await readDeviceLocation();
      setYou(fix);
      if (locating) setTracker(fix);
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
        return { ...placeToMark(place, place.cat, stateAbbr), tier: tierForPlace(kind, place.name) };
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

  // Trails belong to the signed-in account: load its copy, keep 24 hours of
  // live trail (the slider only changes what's drawn), and sync saved trails
  // when the app comes back online or into view.
  const ghostUserId = user?.id ?? null;
  useEffect(() => {
    loadGhost(ghostUserId);
    switchDriveLog(ghostUserId);
  }, [ghostUserId]);
  useEffect(() => {
    const prune = window.setInterval(() => useGhost.getState().prune(GHOST_KEEP_HOURS), 30_000);
    const sync = () => {
      if (document.visibilityState === "visible") void syncGhost();
      // Going to the background: send today's miles so other devices see them.
      else void flushDriveLog();
    };
    window.addEventListener("online", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearInterval(prune);
      window.removeEventListener("online", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  // Joined across gaps up to a few hundred miles (lost signal, screen off); a longer jump, like a flight, stays split.
  const ghostLiveLines = useMemo(() => trailLines(freshPoints(ghostLive, ghostHours), 300), [ghostHours, ghostLive]);
  const ghostSavedLines = useMemo(
    () =>
      ghostSaved
        .filter((trail) => !ghostHidden.includes(trail.id))
        .map((trail) => ({
          id: trail.id,
          focus: ghostFocus === trail.id,
          lines: trailLines(trail.points, 300),
        })),
    [ghostFocus, ghostHidden, ghostSaved],
  );

  useEffect(() => {
    if (isMarkerIcon(profile.markerIcon)) setMarkerIcon(profile.markerIcon);
    if (isMarkerColor(profile.markerColor)) setMarkerColor(profile.markerColor);
  }, [profile.markerColor, profile.markerIcon, setMarkerColor, setMarkerIcon]);

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

  // The spotlit place's card closed: back into the chat it came from. Another place picked: just drop it.
  useEffect(() => {
    if (!spot || selected === spot.id) return;
    setSpot(null);
    if (selected === null && spot.from && spot.viaMail) {
      setMailThread(spot.from);
      setMailOpen(true);
    } else if (selected === null && spot.from) {
      setTab("friends");
      setResumeChat(spot.from);
      setSheetInstant(true);
      setSheet(spot.sheet);
      window.setTimeout(() => setSheetInstant(false), 80);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, spot]);

  const sheetBack = useRef<() => boolean>(() => false);
  sheetBack.current = () => {
    // A place card (from the list or the map) closes first, at any sheet height.
    if (focus || mapCard || roadBack) {
      closeCard();
      return true;
    }
    if (sheet > 20) {
      if (tab === "friends" && friendId) {
        setFriendId(null);
        setFriendLines([]);
        setFriendLive(null);
        return true;
      }
      setSheetInstant(true);
      setSheet(8);
      window.setTimeout(() => setSheetInstant(false), 80);
      return true;
    }
    if (ghostOpen) {
      setGhostOpen(false);
      return true;
    }
    // Zoomed in past a state's view: back to the whole state first, then the country.
    if (stateAbbr && viewBase != null && viewZoom > viewBase + 0.3) {
      setFocusTick((n) => n + 1);
      return true;
    }
    if (stateAbbr || mapAway) {
      chooseState(null);
      setHomeTick((n) => n + 1);
      return true;
    }
    return false;
  };
  useEffect(() => pushBack(() => sheetBack.current()), []);

  useEffect(() => {
    if (!user?.id) return;
    void useLiveShare.getState().load().catch(() => {});
  }, [user?.id]);

  const settingsReady = useRef(false);
  useEffect(() => {
    let dead = false;
    settingsReady.current = false;
    const userId = user?.id;
    if (!userId) return;
    loadAccountSettings()
      .then(async (saved) => {
        if (dead) return;
        // This device last held another account's choices: start from the defaults, never copy them over.
        const owner = settingsOwner();
        const fromOther = owner !== null && owner !== userId;
        if (fromOther) resetAccountChoices();
        if (Object.keys(saved).length) useSettings.getState().apply(saved);
        else if (!fromOther) await saveAccountSettings({ data: pickSettings(useSettings.getState()) }).catch(() => {});
        if (dead) return;
        setSettingsOwner(userId);
        settingsReady.current = true;
        if (!useSettings.getState().keepGhost) return;
        const packed = await pullGhostCache().catch(() => []);
        if (dead || !packed.length) return;
        mergeLiveCache(
          packed.map((point) =>
            point[3] === 1 ? { lat: point[0], lon: point[1], t: point[2], brk: true } : { lat: point[0], lon: point[1], t: point[2] },
          ),
        );
      })
      .catch(() => {
        // Offline: changes still upload later if these are already this account's choices.
        if (!dead && settingsOwner() === userId) settingsReady.current = true;
      });
    return () => {
      dead = true;
    };
  }, [user?.id]);

  useEffect(() => {
    let timer = 0;
    const unsub = useSettings.subscribe((state, prev) => {
      if (!settingsReady.current || sameSettings(state, prev)) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void saveAccountSettings({ data: pickSettings(useSettings.getState()) }).catch(() => {});
      }, 700);
    });
    return () => {
      unsub();
      window.clearTimeout(timer);
    };
  }, [user?.id]);

  const resumedTrip = useRef(false);
  useEffect(() => {
    if (resumedTrip.current) return;
    const live = trips.find((trip) => trip.recording);
    if (!live) return;
    resumedTrip.current = true;
    setRecordingId(live.id);
    setActiveTrip(live.id);
  }, [trips]);

  // Friends sharing with me. Checked every 12 seconds while someone is live
  // and the app is on screen, every 45 seconds otherwise, every 90 in the
  // background. A friend who starts sharing gets a phone notification.
  useEffect(() => {
    if (!user?.id) return;
    let dead = false;
    let timer = 0;
    let first = true;
    let seen = new Set<string>();
    let anyone = false;
    const schedule = () => {
      window.clearTimeout(timer);
      if (dead) return;
      const hidden = document.visibilityState === "hidden";
      timer = window.setTimeout(pull, hidden ? 90_000 : anyone ? 12_000 : 45_000);
    };
    const pull = () => {
      incomingLive()
        .then((rows) => {
          if (dead) return;
          setLivePins(rows);
          anyone = rows.length > 0;
          const now = new Set(rows.map((row) => row.id));
          // Not on the first check: friends already live when the app opens show on the map.
          if (!first) for (const row of rows) if (!seen.has(row.id)) void notifyFriendLive(row.name);
          seen = now;
          first = false;
        })
        .catch(() => {
          if (!dead) setLivePins([]);
        })
        .finally(schedule);
    };
    const onShow = () => {
      if (document.visibilityState === "visible") pull();
    };
    pull();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      dead = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [user?.id]);

  // Anyone with friends is asked once for notifications, so "X is sharing their location" can reach them.
  useEffect(() => {
    if (!user?.id || !nativeApp) return;
    void listFriends()
      .then((rows) => {
        if (rows.length) void askNotifyOnce();
      })
      .catch(() => {});
  }, [user?.id]);

  // Picking nobody turns "share without tracking" off, so picking someone later doesn't start it silently.
  const liveLoaded = useLiveShare((s) => s.loaded);
  useEffect(() => {
    if (liveLoaded && shareOnly && !liveViewers.length) setShareOnly(false);
  }, [liveLoaded, shareOnly, liveViewers.length, setShareOnly]);

  useEffect(() => {
    let dead = false;
    setLocalPhotoOwner(user?.id ?? null);
    // Photos on the account, plus ones kept only on this phone, so both show on the map.
    Promise.all([listPhotos().catch(() => [] as PhotoInfo[]), nativeApp ? listLocalPhotos().catch(() => []) : []])
      .then(([rows, local]) => {
        if (dead) return;
        const seen = new Set(rows.map((row) => row.id));
        const phoneOnly = local
          .filter((row) => !seen.has(row.id))
          .map(({ image: _image, uploaded: _uploaded, uri: _uri, ...info }) => info);
        setPhotos([...rows, ...phoneOnly]);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [user?.id]);

  // Friends' shared photos on the map: fetched when the app opens, every two
  // minutes while it's on screen, and whenever you come back to it, so a photo
  // a friend shares (or stops sharing) shows up without restarting.
  useEffect(() => {
    if (!user?.id) return;
    let dead = false;
    const pull = () => {
      if (document.visibilityState === "hidden") return;
      friendPhotoPins()
        .then((rows) => {
          if (!dead) setSharedShots(rows);
        })
        .catch(() => {});
    };
    pull();
    const timer = window.setInterval(pull, 120_000);
    const onShow = () => {
      if (document.visibilityState === "visible") pull();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      dead = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!friendLive) {
      setFriendFix(null);
      return;
    }
    let dead = false;
    const pull = () => {
      pullLiveTrail({ data: friendLive.id })
        .then((points) => {
          if (dead) return;
          const ghosts = points.map((point) =>
            point[3] === 1
              ? { lat: point[0], lon: point[1], t: point[2], brk: true }
              : { lat: point[0], lon: point[1], t: point[2] },
          );
          const last = ghosts.at(-1);
          let lines = trailLines(ghosts, 300);
          if (last) {
            const tip: [number, number] = [last.lon, last.lat];
            const end = lines.at(-1);
            const prev = end?.at(-1);
            if (end && (!prev || prev[0] !== tip[0] || prev[1] !== tip[1])) {
              lines = [...lines.slice(0, -1), [...end, tip]];
            }
            setFriendFix({ id: friendLive.id, lat: last.lat, lon: last.lon });
          } else {
            setFriendFix(null);
          }
          setFriendLines(lines);
        })
        .catch(() => {
          if (!dead) setFriendLines([]);
        });
    };
    pull();
    const id = window.setInterval(pull, 10000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [friendLive]);

  useEffect(() => {
    if (!friendCode) return;
    let dead = false;
    acceptFriend({ data: friendCode })
      .then((friend) => {
        if (dead) return;
        setFriendNote(friend.already ? `You and ${friend.name} are already friends.` : `${friend.name} is a friend now.`);
        void askNotifyOnce();
        setFriendId(friend.id);
        setTab("friends");
      })
      .catch((err) => {
        if (dead) return;
        setFriendNote(err instanceof Error ? err.message : "Couldn't add that friend.");
        setTab("friends");
      })
      .finally(() => {
        if (!dead) void navigate({ to: "/", search: {}, replace: true });
      });
    return () => {
      dead = true;
    };
  }, [friendCode, navigate, setTab]);

  const shownPins = useMemo(() => {
    if (!friendFix) return livePins;
    return livePins.map((pin) => (pin.id === friendFix.id ? { ...pin, lat: friendFix.lat, lon: friendFix.lon } : pin));
  }, [livePins, friendFix]);

  if (settingsOpen) {
    return (
      <SettingsPage
        profile={{
          name: profile.name || user?.displayName || "",
          photo: profile.photo || user?.profileImageUrl || "",
          markerIcon: profile.markerIcon,
          markerColor: profile.markerColor,
        }}
        email={user?.primaryEmail ?? null}
        page={settingsRoute.page ?? "menu"}
        onPage={settingsRoute.open}
        onBack={settingsRoute.back}
        onSaved={setProfile}
        onSync={syncAccount}
        onTour={() => {
          setTourStep(0);
          setTourOpen(true);
          settingsRoute.close();
        }}
        marks={marks}
        trip={recordingTrip}
        onPhotosSaved={(rows) => setPhotos((prev) => [...rows, ...prev])}
        onPhotoRemoved={(id) => setPhotos((prev) => prev.filter((photo) => photo.id !== id))}
      />
    );
  }

  const popped = pops[0];

  return (
    <main
      className={"app-shell bg-bg text-ink" + (sheetInstant ? " sheet-drag" : "") + (cardOnly ? " sheet-card" : "")}
      style={cardOnly ? undefined : { ["--sheet" as string]: sheet <= 12 ? "var(--sheet-peek)" : `${sheet}dvh` }}
    >
      {popped ? null : <UpdatePrompt />}
      {viewing ? (
        <PhotoViewer
          photos={viewing.list}
          startId={viewing.id}
          title={marks.find((mark) => mark.id === viewing.list[0]?.poiId)?.name ?? "Photos"}
          onClose={closeViewer}
        />
      ) : null}
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
              showParks={showParks}
              showTowns={showTowns}
              showReservations={showReservations}
              followState={followState}
              townColor={townColor}
              reservationColor={reservationColor}
              markerIcon={markerIcon}
              markerColor={markerColor}
              offers={offers}
              tripLine={tripLine}
              ghostLive={ghostLiveLines}
              ghostSaved={ghostSavedLines}
              ghostFocus={ghostFocus}
              ghostLook={ghostLook}
              ghostColor={ghostColor}
              friendLines={friendLines}
              friendLook={friendLook}
              friendLive={friendLive != null}
              friendPins={shownPins}
              photoPins={photoPins}
              you={you}
              dot={locating ? (tracker ?? you) : you}
              onPress={() => {
                if (mapCard) closeCard();
                else setSheet(50);
              }}
              onFriend={(id) => {
                const pin = livePins.find((item) => item.id === id);
                setFriendId(id);
                setTab("friends");
                setSheet(58);
                if (pin) setFriendNote(null);
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
              onPark={(park) => {
                const saved = marks.find((item) => item.id === park.id);
                const offered = offers.find((item) => item.id === park.id);
                const mark =
                  saved ??
                  offered ??
                  placeToMark(
                    { id: park.id, name: park.name, lat: park.lat, lon: park.lon, pts: park.pts },
                    park.cat,
                    park.st,
                  );
                if (saved || !fastAdd) openFromMap(mark);
                else quickAdd(mark);
              }}
              onSelect={(id) => {
                const mark = marks.find((item) => item.id === id) ?? (focus?.id === id ? focus : null);
                if (mark) openFromMap(mark);
                else setSelected(id);
              }}
              homeTick={homeTick}
              focusTick={focusTick}
              fitTo={fitTo}
              spotlight={spot}
              onAway={setMapAway}
              onView={(zoom, base) => {
                setViewZoom(zoom);
                setViewBase(base);
              }}
            />
          </Suspense>
        ) : (
          <div className="grid h-full place-items-center px-6 text-center text-muted">{error ?? "Unfolding the atlas…"}</div>
        )}
        <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2">
          <button
            type="button"
            aria-expanded={ghostOpen}
            onClick={() => {
              if (!ghostOpen && sheet > 8) setSheet(8);
              setGhostOpen(!ghostOpen);
            }}
            className="flex h-11 items-center gap-2 rounded-full border border-line bg-surface/95 px-3 text-sm shadow-sm backdrop-blur-sm"
          >
            <span className={"ghost-dot size-2 rounded-full " + (locating ? "is-live" : "opacity-60")} style={{ background: ghostColor }} />
            Ghost trail
          </button>
          {user?.id ? (
            <button
              type="button"
              aria-label={unreadTotal ? `Messages, ${unreadTotal} new` : "Messages"}
              onClick={() => {
                if (sheet > 8) setSheet(8);
                setGhostOpen(false);
                setMailOpen(true);
              }}
              className="relative grid h-11 w-11 place-items-center rounded-full border border-line bg-surface/95 shadow-sm backdrop-blur-sm"
            >
              <Mail className="size-5" />
              {unreadTotal ? (
                <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-medium text-accent-ink">
                  {unreadTotal > 99 ? "99+" : unreadTotal}
                </span>
              ) : null}
            </button>
          ) : null}
          {locating && liveViewers.length ? (
            <button
              type="button"
              onClick={() => {
                if (sheet > 8) setSheet(8);
                setGhostOpen(true);
              }}
              aria-label={`Sharing your location with ${liveViewers.length} ${liveViewers.length === 1 ? "friend" : "friends"}. Open to change.`}
              className="flex h-11 items-center gap-2 rounded-full border border-accent/60 bg-surface/95 px-3 text-sm shadow-sm backdrop-blur-sm"
            >
              <span className="size-2 animate-pulse rounded-full bg-accent" />
              Live to {liveViewers.length}
            </button>
          ) : null}
        </div>
        {friendLive || friendLines.length ? (
          <button
            type="button"
            onClick={() => {
              setFriendLines([]);
              setFriendLive(null);
              setFriendFix(null);
            }}
            className="absolute bottom-16 left-3 z-10 h-11 rounded-full border border-line bg-surface/95 px-3 text-sm shadow-sm backdrop-blur-sm"
          >
            {friendLive ? `${friendLive.name} · live · Hide` : "Friend's trail · Hide"}
          </button>
        ) : null}
        <GhostPanel
          open={ghostOpen}
          hours={ghostHours}
          color={ghostColor}
          tracking={trackTravel}
          onHours={setGhostHours}
          onColor={setGhostColor}
          onClose={() => setGhostOpen(false)}
        />
        {mailOpen && user?.id ? (
          <MessageBoard
            meId={user.id}
            places={marks.map((mark) => ({
              id: mark.id,
              name: mark.name,
              state: mark.state,
              category: mark.category,
              lat: mark.lat,
              lon: mark.lon,
              visitedOn: [...mark.visits].map((visit) => visit.visitedOn).filter(Boolean).sort().at(-1) ?? null,
            }))}
            initial={mailThread}
            onClose={() => {
              setMailOpen(false);
              setMailThread(null);
            }}
            onOpenPlace={(place, from) => {
              setMailOpen(false);
              setMailThread(null);
              const mark: Mark = marks.find((item) => item.id === place.id) ?? {
                id: place.id,
                name: place.name,
                category: place.category,
                state: place.state,
                lat: place.lat,
                lon: place.lon,
                points: place.points,
                sys: "",
                paths: [],
                visitedOn: null,
                note: "",
                photo: "",
                visits: [],
              };
              const lat = place.lat ?? mark.lat;
              const lon = place.lon ?? mark.lon;
              setSpot(lat != null && lon != null ? { id: mark.id, lat, lon, from: from ?? null, sheet, viaMail: true } : null);
              chooseState(place.state);
              openFromMap(mark);
              setSheetInstant(true);
              setSheet(8);
              window.setTimeout(() => setSheetInstant(false), 80);
            }}
            onAddToMap={async (photo, place) => {
              const id = `ph-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
              const row: PhotoInfo = {
                id,
                poiId: place.id,
                tripId: "",
                caption: "",
                takenAt: photo.takenAt ?? Date.now(),
                lat: photo.lat ?? place.lat,
                lon: photo.lon ?? place.lon,
                shared: false,
                thumb: photo.thumb,
              };
              await savePhoto({ data: { ...row, image: photo.image } });
              setPhotos((prev) => [row, ...prev]);
            }}
          />
        ) : null}
        <div className="pointer-events-none absolute top-safe left-3 z-10 flex flex-col items-start gap-2">
          {sendPlace ? <SendPlaceSheet mark={sendPlace} onClose={() => setSendPlace(null)} /> : null}
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
              className={"flex h-8 items-center gap-1 rounded-full border px-2.5 text-[11px] " + (showRoads ? "border-line bg-surface text-ink" : "border-line/40 bg-surface/70 text-faint")}
            >
              <span className="size-2 rounded-full bg-[#3d7ab5]" />
              Roads
            </button>
            <button
              type="button"
              aria-pressed={showCounties}
              onClick={toggleCounties}
              className={"flex h-8 items-center gap-1 rounded-full border px-2.5 text-[11px] " + (showCounties ? "border-line bg-surface text-ink" : "border-line/40 bg-surface/70 text-faint")}
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
            small={cardSmall}
            onShrink={setCardSmall}
            onSend={user?.id ? () => setSendPlace(focus) : undefined}
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
            placePhotos={photos.filter((photo) => photo.poiId === focus.id)}
            onOpenPhoto={(id) => setViewing({ list: photos.filter((photo) => photo.poiId === focus.id), id })}
            onDeletePhoto={(id) => void removePlacePhoto(id)}
            onAddPhoto={(file) => addPlacePhoto(focus, file)}
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
                    onClick={() => settingsRoute.open("menu")}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line text-ink"
                  >
                    <Settings className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => settingsRoute.open("menu")}
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
            <div className="flex min-w-0 gap-1 overflow-x-auto">
              {TABS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={tab === id}
                  onClick={() => {
                    setTab(id);
                    // With the menu lowered only the tabs show; a tab opens it so you see what you picked.
                    if (sheet < 40) setSheet(50);
                  }}
                  className={"h-11 shrink-0 rounded-lg px-2.5 text-xs " + (tab === id ? "bg-elevated text-ink" : "text-faint")}
                >
                  {label}
                  {id === "friends" && unreadTotal ? (
                    <span aria-label={`${unreadTotal} new`} className="ml-1 inline-grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-medium text-accent-ink">
                      {unreadTotal > 99 ? "99+" : unreadTotal}
                    </span>
                  ) : null}
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

        {tab !== "badges" && tab !== "trips" && tab !== "recap" && tab !== "friends" && tab !== "photos" ? (
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
              recordingId={recordingId}
              onOpen={(id) => setActiveTrip(id)}
              onCreate={() => makeTrip("New trip")}
              onStart={(name) => void startTrip(name)}
              onEnd={() => void endTrip()}
              onRestart={(id) => void restartTrip(id)}
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
          {tab === "recap" ? <RecapPanel name={profile.name || user?.displayName || ""} /> : null}
          {tab === "friends" ? (
            <FriendsPanel
              openId={friendId}
              note={friendNote}
              liveNow={livePins}
              onOpen={(id) => {
                setFriendId(id);
                setFriendLines([]);
                setFriendLive(null);
              }}
              onClose={() => {
                setFriendId(null);
                setFriendLines([]);
                setFriendLive(null);
              }}
              onShow={(lines) => {
                setFriendLive(null);
                setFriendLines(lines);
                setFriendLook((n) => n + 1);
                setSheetInstant(true);
                setSheet(8);
                window.setTimeout(() => setSheetInstant(false), 80);
              }}
              onWatch={(friend) => {
                setFriendLive(friend);
                setFriendLook((n) => n + 1);
                setSheetInstant(true);
                setSheet(8);
                window.setTimeout(() => setSheetInstant(false), 80);
              }}
              meId={user?.id ?? ""}
              places={marks.map((mark) => ({
                id: mark.id,
                name: mark.name,
                state: mark.state,
                category: mark.category,
                lat: mark.lat,
                lon: mark.lon,
                visitedOn: [...mark.visits].map((visit) => visit.visitedOn).filter(Boolean).sort().at(-1) ?? null,
              }))}
              resume={resumeChat}
              onResumed={() => setResumeChat(null)}
              onOpenPlace={(place, from) => {
                const mark: Mark = marks.find((item) => item.id === place.id) ?? {
                  id: place.id,
                  name: place.name,
                  category: place.category,
                  state: place.state,
                  lat: place.lat,
                  lon: place.lon,
                  points: place.points,
                  sys: "",
                  paths: [],
                  visitedOn: null,
                  note: "",
                  photo: "",
                  visits: [],
                };
                const lat = place.lat ?? mark.lat;
                const lon = place.lon ?? mark.lon;
                setSpot(lat != null && lon != null ? { id: mark.id, lat, lon, from: from ?? null, sheet } : null);
                chooseState(place.state);
                openFromMap(mark);
                setSheetInstant(true);
                setSheet(8);
                window.setTimeout(() => setSheetInstant(false), 80);
              }}
              onShowGroup={(ids) => {
                const pins = livePins.filter((pin) => ids.includes(pin.id));
                if (!pins.length) return 0;
                setFitTo((cur) => ({ tick: (cur?.tick ?? 0) + 1, points: pins.map((pin) => [pin.lon, pin.lat]), maxZoom: 10 }));
                setSheetInstant(true);
                setSheet(8);
                window.setTimeout(() => setSheetInstant(false), 80);
                return pins.length;
              }}
              onShareLive={async (ids) => {
                try {
                  // The group first; anyone you were already sharing with keeps a spot if there's room.
                  const shared = await useLiveShare.getState().setAll([...ids, ...useLiveShare.getState().viewers]);
                  if (!trackTravel && !shareOnly) setShareOnly(true);
                  const inGroup = shared.filter((id) => ids.includes(id)).length;
                  return inGroup < ids.length
                    ? `Sharing your location with ${inGroup} of them (3 friends at a time is the most).`
                    : `Sharing your location with ${inGroup === 1 ? "them" : `all ${inGroup}`}. Turn it off in the Ghost trail panel.`;
                } catch (err) {
                  return err instanceof Error ? err.message : "Couldn't share your location.";
                }
              }}
              onAddToMap={async (photo, place) => {
                const id = `ph-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
                const row: PhotoInfo = {
                  id,
                  poiId: place.id,
                  tripId: "",
                  caption: "",
                  // Where and when the photo was taken, when the chat kept that; else the place and now.
                  takenAt: photo.takenAt ?? Date.now(),
                  lat: photo.lat ?? place.lat,
                  lon: photo.lon ?? place.lon,
                  shared: false,
                  thumb: photo.thumb,
                };
                await savePhoto({ data: { ...row, image: photo.image } });
                setPhotos((prev) => [row, ...prev]);
              }}
            />
          ) : null}
          {tab === "photos" ? (
            <PhotosPanel
              photos={photos}
              marks={marks}
              trips={trips}
              trip={recordingTrip}
              onChange={setPhotos}
              suggest={suggestPhotoPlace}
              addPlace={addPhotoPlace}
            />
          ) : null}
        </div>

        {focus && selected === focus.id && tab !== "badges" && tab !== "trips" && tab !== "friends" && tab !== "photos" ? (
          <Detail
            onSend={user?.id ? () => setSendPlace(focus) : undefined}
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
            placePhotos={photos.filter((photo) => photo.poiId === focus.id)}
            onOpenPhoto={(id) => setViewing({ list: photos.filter((photo) => photo.poiId === focus.id), id })}
            onDeletePhoto={(id) => void removePlacePhoto(id)}
            onAddPhoto={(file) => addPlacePhoto(focus, file)}
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
  recordingId,
  onOpen,
  onCreate,
  onStart,
  onEnd,
  onRestart,
  onDelete,
  onRename,
  onOrder,
}: {
  trips: Trip[];
  marks: Mark[];
  active: string | null;
  recordingId: string | null;
  onOpen: (id: string) => void;
  onCreate: () => Promise<string>;
  onStart: (name: string) => void;
  onEnd: () => void;
  onRestart: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onOrder: (id: string, stops: TripStop[]) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<TripStop[] | null>(null);
  const [name, setName] = useState("");
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState("");
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
          {recordingId ? (
            <button type="button" onClick={onEnd} className="h-11 shrink-0 rounded-lg bg-accent px-3 text-sm text-accent-ink">
              End trip
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraft("");
                setNaming(true);
              }}
              className="h-11 shrink-0 rounded-lg border border-ink bg-elevated px-3 text-sm"
            >
              Start a trip
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-muted">
          Start a trip and it asks for a name, turns tracking on, and adds each place you pass until you end it. The line stays on the map.
        </p>
        {naming ? (
          <form
            className="mt-3 rounded-lg border border-line px-3 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              const next = draft.trim();
              if (!next) return;
              setNaming(false);
              onStart(next);
            }}
          >
            <label className="block text-xs text-muted">
              Name
              <input
                autoFocus
                value={draft}
                placeholder="Lake Superior loop"
                enterKeyHint="go"
                onChange={(event) => setDraft(event.target.value.slice(0, 80))}
                className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-base text-ink outline-none placeholder:text-faint"
              />
            </label>
            <div className="mt-2 flex gap-2">
              <button
                type="submit"
                disabled={!draft.trim()}
                className="h-11 flex-1 rounded-lg border border-ink bg-elevated text-sm disabled:border-line disabled:text-faint"
              >
                Start
              </button>
              <button type="button" onClick={() => setNaming(false)} className="h-11 flex-1 rounded-lg border border-line text-sm">
                Not now
              </button>
            </div>
          </form>
        ) : null}
        <button
          type="button"
          onClick={() => {
            void onCreate().then((id) => {
              setSearch("");
              setEditing(id);
              onOpen(id);
            });
          }}
          className="mt-3 h-11 w-full rounded-lg border border-line text-sm text-muted"
        >
          Or plan one by hand
        </button>
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
                <span className="text-xs text-faint">
                  {" "}
                  · {item.stops.length}
                  {recordingId === item.id ? " · recording" : ""}
                </span>
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
      {recordingId === trip.id ? (
        <button type="button" onClick={onEnd} className="mt-3 h-11 w-full rounded-lg bg-accent text-sm text-accent-ink">
          End trip
        </button>
      ) : (
        <button type="button" onClick={() => onRestart(trip.id)} className="mt-3 h-11 w-full rounded-lg border border-ink bg-elevated text-sm">
          Restart trip
        </button>
      )}
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
  placePhotos = [],
  onOpenPhoto,
  onDeletePhoto,
  onAddPhoto,
  onSend,
  solo = false,
  small = false,
  onShrink,
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
  placePhotos?: PhotoInfo[];
  onOpenPhoto?: (id: string) => void;
  onDeletePhoto?: (id: string) => void;
  onAddPhoto?: (file: File) => Promise<void>;
  /** Send this place to a friend or a trip chat. */
  onSend?: () => void;
  solo?: boolean;
  /** Tucked down to just its name (with the chevrons, like the main menu). */
  small?: boolean;
  onShrink?: (small: boolean) => void;
}) {
  const road = mark.category === "route" || mark.category === "drive";
  const line = road ? (mark.paths.length ? "Drawn as a thin line along the road." : "This road's line isn't in the atlas yet.") : null;
  const [blurb, setBlurb] = useState<PlaceBlurb | null | undefined>(undefined);
  const [along, setAlong] = useState<Mark[]>([]);
  const [draft, setDraft] = useState<Visit[]>(mark.visits.length ? mark.visits : [freshVisit()]);
  const [which, setWhich] = useState(0);
  const [detailNote, setDetailNote] = useState<string | null>(null);
  const [addingPhoto, setAddingPhoto] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dropPhoto, setDropPhoto] = useState<string | null>(null);
  const [onRegister, setOnRegister] = useState(mark.category === "register");
  const visitKey = mark.visits.map((visit) => visit.id).join(",");

  useEffect(() => {
    setDraft(mark.visits.length ? mark.visits : [freshVisit()]);
    setWhich((mark.visits.length ? mark.visits : [freshVisit()]).length - 1);
    setDetailNote(null);
    setEditing(false);
    setDropPhoto(null);
  }, [mark.id, visitKey]);

  useEffect(() => {
    let dead = false;
    setOnRegister(mark.category === "register");
    if (mark.category !== "register") {
      void loadRegisterAlso().then((also) => {
        if (!dead && (also[mark.id] || Object.values(also).includes(mark.id))) setOnRegister(true);
      });
    }
    return () => {
      dead = true;
    };
  }, [mark.id, mark.category]);

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
  useEffect(() => {
    if (!editing) return;
    return pushBack(() => {
      setEditing(false);
      return true;
    });
  }, [editing]);
  if (editing && saved && current) {
    // Its own full screen: inside the card it was squeezed into the lower half
    // and scrolled out of view, especially with the keyboard up.
    return (
      <div role="dialog" aria-label="Visit details" className="fixed inset-0 z-50 overflow-y-auto bg-surface px-4 pb-6 screen-top safe-bottom">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setEditing(false)} className="h-11 shrink-0 px-1 text-sm text-muted">
            ‹ Place
          </button>
          <h2 className="min-w-0 flex-1 truncate text-right font-serif text-xl leading-tight">Visit details</h2>
        </div>
        <p className="mt-1 truncate text-xs text-muted">{mark.name}</p>
        <p className="mt-3 text-xs text-faint">First visit 100%, then 85%, 50%, 25%, 10%, then none.</p>
        {draft.length > 1 ? (
          <label className="mt-3 block text-xs text-muted">
            Visit
            <select
              value={which}
              onChange={(event) => setWhich(Number(event.target.value))}
              className="mt-1 h-11 w-full rounded-lg border border-line bg-surface px-2 text-sm text-ink"
            >
              {draft.map((visit, index) => (
                <option key={visit.id} value={index}>
                  Visit {index + 1} · {pointsForVisit(mark.points, index)} pts
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="mt-3 block text-xs text-muted">
          Date
          <input
            type="date"
            value={current.visitedOn ?? ""}
            onChange={(event) => patchVisit({ visitedOn: event.target.value || null })}
            className="mt-1 h-11 w-full rounded-lg border border-line bg-surface px-2 text-sm text-ink"
          />
        </label>
        <label className="mt-3 block text-xs text-muted">
          Note
          <textarea
            value={current.note}
            onChange={(event) => patchVisit({ note: event.target.value.slice(0, 500) })}
            rows={3}
            placeholder="What you remember"
            className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-2 text-sm text-ink outline-none"
          />
        </label>
        <p className="mt-3 text-xs text-muted">Photo for this visit</p>
        <label className="mt-1 flex h-11 cursor-pointer items-center justify-center rounded-lg border border-line text-sm text-muted">
          {current.photo ? "Change the visit photo" : "Choose a visit photo"}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
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
        {current.photo ? <img src={current.photo} alt="" className="mt-2 h-28 w-full rounded-lg object-cover" /> : null}
        {current.photo ? (
          <button type="button" onClick={() => patchVisit({ photo: "" })} className="mt-1 text-xs text-faint">
            Remove photo
          </button>
        ) : null}
        {trips.length ? (
          <label className="mt-3 block text-xs text-muted">
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
              className="mt-1 h-11 w-full rounded-lg border border-line bg-surface px-2 text-sm text-ink"
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
          onClick={() => {
            onSave(draft.map((visit, index) => (index === which ? { ...current, note: current.note.trim() } : visit)));
            setEditing(false);
          }}
          className="mt-4 flex h-11 w-full items-center justify-center rounded-lg border border-ink bg-elevated text-sm"
        >
          Save details
        </button>
        {detailNote ? <p className="mt-2 text-xs text-accent">{detailNote}</p> : null}
      </div>
    );
  }
  return (
    <div className={(solo ? "safe-bottom bg-surface px-4 pb-3" + (onShrink ? "" : " pt-3") : "safe-bottom max-h-[58%] shrink-0 overflow-y-auto border-t border-line bg-elevated px-4 py-3")}>
      {onShrink ? (
        // Like the main menu: down tucks the card away to just its name, up brings it back.
        <div className="sheet-handle -mb-1">
          <button
            type="button"
            aria-label="Show the whole card"
            disabled={!small}
            onClick={() => onShrink(false)}
            className="flex h-11 w-11 items-center justify-center rounded-full text-ink disabled:text-faint"
          >
            <ChevronUp className="size-5" />
          </button>
          <button
            type="button"
            aria-label="Shrink the card"
            disabled={small}
            onClick={() => onShrink(true)}
            className="flex h-11 w-11 items-center justify-center rounded-full text-ink disabled:text-faint"
          >
            <ChevronDown className="size-5" />
          </button>
        </div>
      ) : null}
      <div className="flex items-start gap-3">
        <Shield sys={mark.category === "route" ? ((mark.sys as System) || "SR") : "place"} label={mark.category === "route" ? mark.id.split(":")[3] || mark.sys : "P"} />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">
            {categoryName(mark.category, mark.name)} · {stateName}
          </p>
          <h2 className="truncate font-serif text-xl leading-tight">{mark.name}</h2>
          {onRegister && mark.category !== "register" ? (
            <p className="mt-1 inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">
              <span aria-hidden="true">🏛</span> Also on the National Register of Historic Places
            </p>
          ) : null}
        </div>
        <button type="button" onClick={onClose} className="h-11 shrink-0 rounded-lg border border-line bg-bg px-4 text-base font-medium">
          Close
        </button>
      </div>
      <div className={small ? "hidden" : ""}>
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
      {onSend ? (
        <button type="button" onClick={onSend} className="mt-2 h-11 w-full rounded-card border border-line bg-bg text-sm">
          Send to a friend
        </button>
      ) : null}
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
      <div className="mt-3">
        <p className="text-xs text-muted">
          {placePhotos.length
            ? `${placePhotos.length} ${placePhotos.length === 1 ? "photo" : "photos"} in your gallery`
            : "No photos of this place yet"}
        </p>
        {placePhotos.length ? (
          <div className="mt-1 flex gap-2 overflow-x-auto pb-1">
            {placePhotos.map((photo) => (
              <div key={photo.id} className="relative shrink-0">
                <button
                  type="button"
                  aria-label="Open photo"
                  onClick={() => onOpenPhoto?.(photo.id)}
                  className="block overflow-hidden rounded-md"
                >
                  <img src={photo.thumb} alt="" className="size-20 object-cover" />
                </button>
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={() => setDropPhoto(photo.id)}
                  className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-bg/90 text-sm leading-none"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {dropPhoto ? (
          <div className="mt-2 rounded-lg border border-line px-3 py-2">
            <p className="text-sm">Remove this photo? It leaves your gallery too.</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  onDeletePhoto?.(dropPhoto);
                  setDropPhoto(null);
                }}
                className="h-11 flex-1 rounded-lg border border-ink bg-elevated text-sm"
              >
                Remove
              </button>
              <button type="button" onClick={() => setDropPhoto(null)} className="h-11 flex-1 rounded-lg border border-line text-sm">
                Keep
              </button>
            </div>
          </div>
        ) : null}
        {onAddPhoto ? (
          <label
            className={
              "mt-2 flex h-11 cursor-pointer items-center justify-center rounded-lg border border-line text-sm " +
              (addingPhoto ? "text-faint" : "text-muted")
            }
          >
            {addingPhoto ? "Adding the photo…" : "Add a photo of this place"}
            <input
              type="file"
              accept="image/*"
              disabled={addingPhoto}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setAddingPhoto(true);
                setDetailNote(null);
                void onAddPhoto(file)
                  .then(() => setDetailNote("Added to your photos. It stays private until you share it."))
                  .catch((err: unknown) => {
                    setDetailNote(err instanceof Error ? err.message : "Couldn't add that photo");
                  })
                  .finally(() => setAddingPhoto(false));
              }}
            />
          </label>
        ) : null}
        {detailNote && !editing ? <p className="mt-1 text-xs text-accent">{detailNote}</p> : null}
      </div>
      {saved ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-2 flex h-11 w-full items-center justify-center rounded-card border border-line bg-bg text-sm"
        >
          Visit details
        </button>
      ) : null}
      {along.length ? (
        <div className="mt-3">
          <p className="text-xs tracking-widest text-faint uppercase">
            Along this road{along.length > 4 ? ` · ${along.length}` : ""}
          </p>
          {/* About four rows show; the rest scroll inside the box so the card stays short. */}
          <ul
            className={"mt-1 " + (along.length > 4 ? "max-h-[11.5rem] overflow-y-auto overscroll-contain rounded-lg border border-line px-2" : "")}
            style={along.length > 4 ? { maskImage: "linear-gradient(to bottom, black 80%, transparent)", WebkitMaskImage: "linear-gradient(to bottom, black 80%, transparent)" } : undefined}
          >
            {along.map((stop) => (
              <li key={stop.id} className="flex items-center gap-2 py-1">
                <span className="min-w-0 flex-1 truncate text-sm">{stop.name}</span>
                <button type="button" onClick={() => onAddAlong(stop)} className="h-9 shrink-0 rounded-lg border border-line px-2 text-xs">
                  Add
                </button>
              </li>
            ))}
            {along.length > 4 ? <li aria-hidden="true" className="h-6" /> : null}
          </ul>
        </div>
      ) : null}
      </div>
    </div>
  );
}
