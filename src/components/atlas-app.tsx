import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Sun, Cloud, CloudFog, CloudRain, CloudLightning, CloudSnow, Snowflake } from "lucide-react";
import { Award, Car, ChartColumn, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleParking, CirclePlus, Compass, GripVertical, Images, ListTodo, Locate, LocateFixed, Mail, MapPinned, Navigation, Navigation2, Route as RouteIcon, Search, Settings, Users, Volume2, VolumeX, X } from "lucide-react";
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
import { sendToThread } from "@/lib/messages";
import { type Trip, type TripStop } from "@/lib/trips";
import { fallbackBlurb, lookupPlace, mapsUrl, type PlaceBlurb } from "@/lib/place-info";
import { categoryName, kindFor, kindVisible, placeKinds, tierForKind, tierForPlace } from "@/lib/place-kinds";
import { placeToMark, placesNear, readDeviceLocation, roadToMark, stateToMark, stopsAlong, closestPlace, milesBetween, type Fix, type NearMark } from "@/lib/nearby";
import { collectPassed, takeNativeFixes } from "@/lib/travel";
import { missedFixes, nativeDelivery, noteHandledFix } from "@/lib/native-tracking";
import { startChatChecks, useChat } from "@/lib/chat-store";
import { onNotificationOpen } from "@/lib/message-watch";
import { SendPlaceSheet, SendToSheet } from "@/components/chat-send";
import { MessageBoard } from "@/components/friend-chat";
import { BoardsPage } from "@/components/boards-page";
import { StopsLog, type GroupSpot } from "@/components/stops-log";
import { comingUp, type Ahead } from "@/lib/coming-up";
import { useDrive } from "@/lib/drive-settings";
import { bearing, heading, noteMotion, speedMph, turnBetween, zoomForSpeed } from "@/lib/motion";
import { announce, pointsText } from "@/lib/voice";
import { STATE_NAMES } from "@/lib/state-names";

import { nameHere, setHereStates } from "@/lib/here";
import { flushStops, forgetPendingStop, keepStop, noteStopFixes, pendingStops } from "@/lib/stop-detect";
import { listStops, removeStop, type GpsStop } from "@/lib/stops";
import { TripRecap, type TripCard } from "@/components/trip-recap";
import { flushTripTrack, noteTripFixes, trackLines } from "@/lib/trip-track";
import { AtlasSplash, LoginScreen } from "@/components/login-screen";
import { SettingsPage } from "@/components/settings-page";
import { GhostPanel } from "@/components/ghost-panel";
import { remindOnThisDay } from "@/lib/memories";
import { FriendsPanel } from "@/components/friends-panel";
import { nextCounty, type NextCounty } from "@/lib/next-county";
import { batteryInfo, lowPowerNext, setDriveScreenAwake, startDriveScreen, stopDriveScreen } from "@/lib/power";
import { PhotosPanel, PhotoViewer } from "@/components/photos-panel";
import { updateWidget } from "@/lib/widget";
import { latestLiveFix, noteLiveFix } from "@/lib/live-dot";
import { lastKnownFix, rememberFix } from "@/lib/nearby";
import { matchPlace, tripFor, type RecordingTrip } from "@/lib/photo-file";
import { choosePhotoPlace, loadParkShapes, matchPark } from "@/lib/park-photo";
import { UpdatePrompt } from "@/components/update-prompt";
import { RecapPanel } from "@/components/recap-panel";
import { loadCounties } from "@/lib/atlas-model";
import { nickOf, useLookVersion } from "@/lib/chat-look";
import { countyContaining, countyToMark, type CountyRec } from "@/lib/counties";
import { deviceId, flushDriveLog, localDay, logDrive, switchDriveLog, todayMiles } from "@/lib/drive-log";
import { clearTrackNote, noteTitle, onTrackNote, postNextFix, setTrackNote, stoppedFromNotification } from "@/lib/track-note";
import { saveMapsAhead } from "@/lib/maps-ahead";
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
import { COUNTY_COUNTS } from "@/lib/county-counts";
import { askNotifyOnce, notifyFriendLive } from "@/lib/live-notify";
import { notifyNote, notifyPlacesAdded } from "@/lib/place-notifications";
import { weatherAhead, weatherSpeech, type WeatherAhead, type WeatherKind } from "@/lib/weather-ahead";
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

/** Wish-list places you just got to: ticked off on the server; say so. */
async function checkWishes() {
  try {
    const { tickWishes } = await import("@/lib/boards");
    const { ticked } = await tickWishes();
    for (const row of ticked.slice(0, 3)) {
      announce(`Checked off ${row.place} on ${row.board}.`, "highlights", true);
      void notifyNote(`${row.place} ✓`, `Checked off on ${row.board}`);
    }
  } catch {
    // Next time.
  }
}

const WEATHER_ICON: Record<WeatherKind, typeof Sun> = { clear: Sun, cloud: Cloud, fog: CloudFog, rain: CloudRain, storm: CloudLightning, snow: CloudSnow, ice: Snowflake };
function WeatherIcon({ kind, className }: { kind: WeatherKind; className?: string }) {
  const Icon = WEATHER_ICON[kind];
  return <Icon className={className} aria-hidden="true" />;
}

/**
 * The live trail, as last seen on screen. With the app in the background the
 * trail still grows with nearly every fix; redrawing the whole app and
 * re-cutting the map's line for each point was work nobody could see.
 */
function useLiveTrailOnScreen() {
  const [live, setLive] = useState(() => useGhost.getState().live);
  useEffect(() => {
    const sync = () => {
      if (document.visibilityState !== "hidden") setLive(useGhost.getState().live);
    };
    sync();
    const stop = useGhost.subscribe(sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  return live;
}

// Your places, then your journeys, then your progress, then friends. All
// eight fit in one row (icon over a short label), so nothing scrolls sideways.
const TABS = [
  ["yours", "Yours"],
  ["near", "Near"],
  ["add", "Add"],
  ["trips", "Trips"],
  ["photos", "Photos"],
  ["badges", "Badges"],
  ["recap", "Recap"],
  ["friends", "Friends"],
] as const;

const TAB_ICONS: Record<(typeof TABS)[number][0], typeof Users> = {
  yours: MapPinned,
  near: Navigation,
  add: CirclePlus,
  trips: RouteIcon,
  photos: Images,
  badges: Award,
  recap: ChartColumn,
  friends: Users,
};

/** A small ring that fills as you add a state's counties (gold when they're all done). */
function CountyRing({ done, total }: { done: number; total: number }) {
  const share = total ? Math.min(1, done / total) : 0;
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 24 24" className="size-6 shrink-0 -rotate-90" aria-hidden>
      <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeWidth="3" className="text-line" />
      {share > 0 ? (
        <circle
          cx="12"
          cy="12"
          r={r}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          stroke={share >= 1 ? "#e2b15a" : "#7dcea0"}
          strokeDasharray={`${Math.max(1.5, share * c)} ${c}`}
        />
      ) : null}
    </svg>
  );
}

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

/** Say what tracking just added: a new state first, then new counties, then (Everything) the rest. */
function speakAdded(added: Mark[], statesBefore: Set<string>) {
  const newStates = [...new Set(added.map((mark) => mark.state).filter((st) => st && !statesBefore.has(st)))];
  for (const st of newStates) announce(`Welcome to ${STATE_NAMES[st] ?? st}. A new state!`, "highlights", true);
  const counties = added.filter((mark) => mark.category === "county");
  for (const county of counties) {
    const pts = pointsText(county.points);
    announce(`Entering ${county.name}${STATE_NAMES[county.state] ? `, ${STATE_NAMES[county.state]}` : ""}. New county${pts ? `, ${pts}` : ""}.`, "highlights", true);
  }
  const rest = added.filter((mark) => mark.category !== "county");
  if (!rest.length) return;
  const total = rest.reduce((sum, mark) => sum + (mark.points || 0), 0);
  const names = rest.slice(0, 3).map((mark) => mark.name);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  announce(`Added ${rest.length > 3 ? `${rest.length} places, including ${list}` : list}${total ? `. ${pointsText(total)}` : ""}.`, "all");
}

/**
 * Whether a place's point says which county you were in. Not for roads,
 * scenic drives or big areas (parks, forests, reservations, refuges, shores,
 * lakes): their point is just the middle, often a county you never set foot in.
 */
const AREA_CATEGORIES = new Set(["county", "route", "drive", "park", "reservation", "forest", "refuge", "seashore", "lake", "unesco"]);
function countyFromPoint(mark: Mark) {
  return !AREA_CATEGORIES.has(mark.category);
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
  const searchInput = useRef<HTMLInputElement>(null);
  const [focus, setFocus] = useState<Mark | null>(null);
  const [you, setYou] = useState<Fix | null>(null);
  const [tracker, setTracker] = useState<Fix | null>(null);
  /** While tracking: the closest county you haven't been to. */
  const [nextUp, setNextUp] = useState<NextCounty | null>(null);
  /** The "Next county" chip shows its name for a few seconds, then shrinks to just the distance. */
  const [nextWide, setNextWide] = useState(true);
  useEffect(() => {
    if (!nextUp?.name || !nextWide) return;
    const timer = window.setTimeout(() => setNextWide(false), 10_000);
    return () => window.clearTimeout(timer);
  }, [nextUp?.name, nextWide]);
  const nextName = nextUp?.name;
  useEffect(() => setNextWide(true), [nextName]);
  /** The same for the friend's live-trail chip: name for a few seconds, then just a dot and first name. */
  const [liveWide, setLiveWide] = useState(true);
  const nextAt = useRef<{ lat: number; lon: number; t: number } | null>(null);
  const nextAsk = useRef(0);
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
  /** `label`: an "I'm here" spot (no place card), shown in a card at the top with a close button. */
  const [spot, setSpot] = useState<{ id: string; lon: number; lat: number; from: Thread | null; sheet: number; viaMail?: boolean; label?: string } | null>(null);
  /** The chat the mail page reopens (coming back from a place shown on the map). */
  const [mailThread, setMailThread] = useState<Thread | null>(null);
  const [resumeChat, setResumeChat] = useState<Thread | null>(null);
  const [viewZoom, setViewZoom] = useState(3);
  const [viewBase, setViewBase] = useState<number | null>(null);
  const [hiddenKinds, setHiddenKinds] = useState<string[]>([]);
  const [visitedOnly, setVisitedOnly] = useState(false);
  /** How far down the map the card and chips at the top reach, so the whole-country view fits below them. */
  const topOverlay = useRef<HTMLDivElement>(null);
  const [topInset, setTopInset] = useState(0);
  useEffect(() => {
    const node = topOverlay.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () => setTopInset(Math.round(node.offsetTop + node.offsetHeight));
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(node);
    return () => watch.disconnect();
  }, []);
  // Closed when the atlas opens: the list covers the map.
  const [typesOpen, setTypesOpen] = useState(false);
  const [headerOpen, setHeaderOpen] = useState(true);
  const settingsRoute = useSettingsRoute();
  const settingsOpen = settingsRoute.page !== null;
  const [roadBack, setRoadBack] = useState<Mark | null>(null);
  const [profile, setProfile] = useState<Profile>({ name: "", photo: "", markerIcon: "", markerColor: "" });
  const [offline, setOffline] = useState(false);
  const [pendingSync, setPendingSync] = useState(0);
  // Changes saved on the phone but not uploaded yet: keep trying every 30 s.
  // On weak signal the phone often still says it's online, so waiting for
  // the "back online" event alone could leave them stuck until the next add.
  useEffect(() => {
    if (!pendingSync) return;
    const retry = () => {
      if (document.visibilityState !== "visible" && !nativeApp) return;
      void flushVault()
        .then(() => readVault())
        .then((snap) => setPendingSync(snap.pending))
        .catch(() => {});
    };
    const timer = window.setInterval(retry, 30_000);
    document.addEventListener("visibilitychange", retry);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", retry);
    };
  }, [pendingSync]);
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
  /** Battery at 20% or less: tracking takes fewer fixes until it's charging or above 30%. */
  const [lowPower, setLowPower] = useState(false);
  /** Plugged in (checked every few minutes while tracking). */
  const [charging, setCharging] = useState(false);
  /** Drive mode turned itself on (rather than by hand). */
  const [driveAuto, setDriveAuto] = useState(false);
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
  const ghostLive = useLiveTrailOnScreen();
  const ghostSaved = useGhost((s) => s.saved);
  const ghostHidden = useGhost((s) => s.hidden);
  const ghostFocus = useGhost((s) => s.focusId);
  const ghostLook = useGhost((s) => s.look);
  const [ghostOpen, setGhostOpen] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [boardsOpen, setBoardsOpen] = useState(false);
  // Car care due soon (a dot on the Boards button; a phone note once a day).
  const [carDue, setCarDue] = useState(0);
  useEffect(() => {
    if (!user?.id || boardsOpen) return;
    let live = true;
    void import("@/lib/boards")
      .then(({ listBoards }) => listBoards())
      .then((rows) => {
        if (!live) return;
        const due = rows.filter((row) => row.kind === "car" && row.role !== "check" && row.due);
        setCarDue(due.reduce((sum, row) => sum + (row.due ?? 0), 0));
        const day = localDay(Date.now());
        const key = `atlas.car-reminded.${user.id}`;
        if (!due.length || localStorage.getItem(key) === day) return;
        localStorage.setItem(key, day);
        const total = due.reduce((sum, row) => sum + (row.due ?? 0), 0);
        void notifyNote("Car care", `${total} ${total === 1 ? "job is" : "jobs are"} due soon on ${due.map((row) => row.title).join(", ")}.`);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [user?.id, boardsOpen]);
  const [boardFocus, setBoardFocus] = useState<string | null>(null);
  /** The map's bottom buttons tucked away behind the arrow (remembered on this phone). */
  const [toolsTucked, setToolsTucked] = useState(() => {
    try {
      return localStorage.getItem("atlas.tools-tucked") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("atlas.tools-tucked", toolsTucked ? "1" : "0");
    } catch {
      /* not remembered, then */
    }
  }, [toolsTucked]);
  const [driving, setDriving] = useState(false);
  const [hereOpen, setHereOpen] = useState(false);
  const [shareDay, setShareDay] = useState<string | null>(null);
  const [mph, setMph] = useState<number | null>(null);
  const [sideways, setSideways] = useState(true);
  const speedSample = useRef<{ lat: number; lon: number; t: number } | null>(null);
  /** A trip's recap on screen (right after it ends, or opened from the trips list). */
  const [recapTrip, setRecapTrip] = useState<{ id: string; justEnded: boolean } | null>(null);
  /** Trip routes on the map: one from a recap, or everyone's on a shared trip. */
  const [tripRoutes, setTripRoutes] = useState<{
    label: string;
    routes: { color: string; lines: [number, number][][]; dots?: [number, number][] }[];
    legend?: { name: string; color: string }[];
  } | null>(null);
  const [friendId, setFriendId] = useState<string | null>(null);
  const [friendLines, setFriendLines] = useState<GhostLines>([]);
  const [friendFix, setFriendFix] = useState<{ id: string; lat: number; lon: number } | null>(null);
  const [friendLook, setFriendLook] = useState(0);
  const [friendLive, setFriendLive] = useState<{ id: string; name: string } | null>(null);
  const liveKey = friendLive?.id ?? (friendLines.length ? "trail" : "");
  useEffect(() => setLiveWide(true), [liveKey]);
  useEffect(() => {
    if (!liveKey || !liveWide) return;
    const timer = window.setTimeout(() => setLiveWide(false), 10_000);
    return () => window.clearTimeout(timer);
  }, [liveKey, liveWide]);
  /** Live trails you've hidden: they stay hidden until that friend stops and starts sharing again. */
  const liveHidden = useRef(new Set<string>());
  /** A friend's saved trail is on the map: don't swap it for a live one. */
  const trailShown = useRef(false);
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
        if (!dead) {
          setMeta(next);
          setHereStates(next.states);
        }
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
    addedToday.current.add(clean.id);
    setMarks((prev) => (prev.some((item) => item.id === clean.id) ? prev : [clean, ...prev]));
    marksRef.current = [clean, ...marksRef.current];
    if (!quiet) choose(clean);
    try {
      await vaultSaveMark(clean);
      noteBadges(badgeViewsFromMarks([clean, ...marks.filter((item) => item.id !== clean.id)]));
      setPendingSync((await readVault()).pending);
      await noteTrip(clean.id);
      if (clean.category !== "county") void addCountyFor(clean, visitedOn);
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

  async function addCountyFor(mark: Mark, day: string | null = null) {
    if (mark.lat == null || mark.lon == null || !mark.state || !countyFromPoint(mark)) return;
    const rows = (await loadCounties(mark.state)) as CountyRec[];
    const hit = countyContaining(mark.lat, mark.lon, rows);
    if (!hit || marksRef.current.some((item) => item.id === hit.id)) return;
    await addRef.current(countyToMark(hit, mark.state), true, day);
  }

  const countyFilled = useRef(false);
  useEffect(() => {
    if (!user?.id || countyFilled.current || !marks.length) return;
    countyFilled.current = true;
    const saved = marksRef.current;
    void (async () => {
      const byState = new Map<string, Mark[]>();
      for (const mark of saved) {
        if (mark.lat == null || mark.lon == null || !mark.state || !countyFromPoint(mark)) continue;
        const list = byState.get(mark.state) ?? [];
        list.push(mark);
        byState.set(mark.state, list);
      }
      for (const [state, list] of byState) {
        const rows = (await loadCounties(state)) as CountyRec[];
        const have = new Set(marksRef.current.filter((item) => item.category === "county").map((item) => item.id));
        for (const mark of list) {
          const hit = countyContaining(mark.lat as number, mark.lon as number, rows);
          if (!hit || have.has(hit.id)) continue;
          have.add(hit.id);
          const day = mark.visits.map((visit) => visit.visitedOn).filter(Boolean).sort()[0] ?? mark.visitedOn;
          await addRef.current(countyToMark(hit, state), true, day);
        }
      }
    })();
  }, [user?.id, marks.length]);
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const tripsRef = useRef(trips);
  tripsRef.current = trips;
  const recordingRef = useRef(recordingId);
  recordingRef.current = recordingId;
  const metaRef = useRef(meta);
  metaRef.current = meta;
  // Stops found from GPS while tracking (the Stops view shows them with your places).
  const [gpsStops, setGpsStops] = useState<GpsStop[]>([]);
  useEffect(() => {
    if (!user?.id) return;
    let dead = false;
    const load = () =>
      listStops()
        .then((rows) => {
          if (dead) return;
          const waiting = pendingStops().filter((p) => !rows.some((r) => r.id === p.id));
          setGpsStops([...waiting, ...rows]);
        })
        .catch(() => {
          if (!dead) setGpsStops((cur) => (cur.length ? cur : pendingStops()));
        });
    void flushStops().finally(load);
    const retry = () => void flushStops();
    const timer = window.setInterval(retry, 60_000);
    window.addEventListener("online", retry);
    return () => {
      dead = true;
      window.clearInterval(timer);
      window.removeEventListener("online", retry);
    };
  }, [user?.id]);
  const userIdRef = useRef("");
  userIdRef.current = user?.id ?? "";
  // Once a day: a memory from this day in an earlier year, if there is one.
  const remindedRef = useRef(false);
  useEffect(() => {
    if (remindedRef.current || !marks.length) return;
    remindedRef.current = true;
    void remindOnThisDay(marks);
  }, [marks]);
  // Unread messages and thumbs-up, checked while signed in.
  useEffect(() => {
    if (!user?.id) return;
    return startChatChecks(user.id);
  }, [user?.id]);
  // A message notification tapped: straight into that chat (a thumbs-up one: the Friends tab).
  useEffect(() => {
    if (!user?.id) return;
    return onNotificationOpen((key) => {
      if (key === "likes") {
        setMailOpen(false);
        setTab("friends");
        if (sheet < 40) setSheet(50);
        return;
      }
      const [kind, id] = key.split(":");
      if ((kind !== "friend" && kind !== "group") || !id) return;
      setMailThread({ kind, id });
      setMailOpen(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  // The home-screen widget (Android): today's new places, this month's points, tracking.
  useEffect(() => {
    if (!user?.id) return;
    updateWidget(marks, trackTravel);
  }, [marks, trackTravel, user?.id]);
  // The tracking notification: today's tally and the next county, kept current
  // (only sent on when the words change, about once a mile at most).
  useEffect(() => {
    if (!nativeApp) return;
    if (!locating) {
      clearTrackNote();
      return;
    }
    if (!trackTravel) {
      setTrackNote("Sharing your location", "With the friends you picked.");
      return;
    }
    const today = localDay(Date.now());
    const added = marks.filter((mark) => mark.visits.some((visit) => visit.visitedOn === today));
    const title = noteTitle(
      added.length,
      added.reduce((sum, mark) => sum + (mark.points || 0), 0),
      todayMiles(),
    );
    const text = nextUp
      ? `Next new county: ${nextUp.name}, ${nextUp.state} · ${nextUp.miles < 1 ? "under a mile" : `${Math.round(nextUp.miles)} mi ${nextUp.toward}`}`
      : "Adding towns, counties, roads, and places as you go.";
    setTrackNote(title, text);
  }, [locating, trackTravel, marks, nextUp, tracker]);
  // Its buttons: "Stop tracking" (the location service already stopped) and "I'm here".
  useEffect(
    () =>
      onTrackNote({
        stopped: () => {
          setTrackTravel(false);
          setShareOnly(false);
        },
        here: () => setHereOpen(true),
      }),
    [setTrackTravel, setShareOnly],
  );
  // Tracking tells you what it added: make sure the phone lets it.
  useEffect(() => {
    if (user?.id && trackTravel) void askNotifyOnce();
  }, [trackTravel, user?.id]);
  const unreadTotal = useChat(
    (state) =>
      Object.values(state.summary.friends).reduce((a, b) => a + b, 0) +
      Object.values(state.summary.groups).reduce((a, b) => a + b, 0) +
      state.summary.likes,
  );
  // The nearest county still to get, rechecked every half mile or minute of travel.
  useEffect(() => {
    if (!trackTravel || !tracker) {
      if (!trackTravel) {
        nextAsk.current++;
        setNextUp(null);
      }
      return;
    }
    const meta = metaRef.current;
    if (!meta) return;
    const last = nextAt.current;
    const moved = last ? Math.hypot((tracker.lon - last.lon) * 53, (tracker.lat - last.lat) * 69) : Infinity;
    if (last && moved < 0.5 && Date.now() - last.t < 60000) return;
    nextAt.current = { lat: tracker.lat, lon: tracker.lon, t: Date.now() };
    const ask = ++nextAsk.current;
    const saved = new Set(marksRef.current.map((mark) => mark.id));
    void nextCounty(tracker.lat, tracker.lon, meta.states, saved).then((hit) => {
      // Newest look wins; a rerun before it lands (the next fix) doesn't drop it.
      if (ask === nextAsk.current) setNextUp(hit);
    });
  }, [tracker, trackTravel, marks.length]);

  // The screen stays on in Drive mode, except when it turned itself on and the
  // phone isn't plugged in (then it goes off as usual: the biggest battery use there is).
  const driveAwake = !driveAuto || charging;
  const driveAwakeRef = useRef(driveAwake);
  driveAwakeRef.current = driveAwake;
  useEffect(() => {
    if (!driving) return;
    startDriveScreen(driveAwakeRef.current);
    return () => {
      void stopDriveScreen();
    };
  }, [driving]);
  useEffect(() => {
    if (driving) setDriveScreenAwake(driveAwake);
    else setDriveAuto(false);
  }, [driving, driveAwake]);

  useEffect(() => {
    if (!driving) return;
    return pushBack(() => {
      endDrive();
      return true;
    });
  }, [driving]);

  useEffect(() => {
    if (!driving) {
      setMph(null);
      speedSample.current = null;
      return;
    }
    const read = () => setSideways(window.innerWidth > window.innerHeight);
    read();
    window.addEventListener("resize", read);
    window.addEventListener("orientationchange", read);
    return () => {
      window.removeEventListener("resize", read);
      window.removeEventListener("orientationchange", read);
    };
  }, [driving]);

  // Speed, heading and map zoom from the last minute of fixes (src/lib/motion.ts).
  const { autoDrive, headingUp, voice, mapsAhead } = useDrive();
  // Maps saved ahead (Settings › Offline maps): the state you're in, and the
  // ones close by or the way you're going. Looks every 10 minutes at most.
  const mapsAheadWas = useRef(mapsAhead);
  useEffect(() => {
    const changed = mapsAheadWas.current !== mapsAhead;
    mapsAheadWas.current = mapsAhead;
    const fix = tracker ?? you;
    const atlas = metaRef.current;
    if (!fix || !atlas || mapsAhead === "off" || document.visibilityState !== "visible") return;
    void saveMapsAhead(fix, (speedMph() ?? 0) >= 10 ? heading() : null, atlas.states, mapsAhead, changed);
  }, [tracker, you, mapsAhead]);
  const [driveBearing, setDriveBearing] = useState<number | null>(null);
  const [driveZoom, setDriveZoom] = useState<number>(15);
  /** Bumped as fixes come in, so speed-based things update between tracker repaints. */
  const [motionTick, setMotionTick] = useState(0);
  useEffect(() => {
    if (!tracker) return;
    const speed = speedMph();
    if (driving) {
      if (speed != null && speed < 130) setMph(Math.round(speed));
      setDriveZoom((cur) => zoomForSpeed(speed, cur));
      const going = heading();
      // Only turn the map for a clear change in direction, and not while (nearly) stopped.
      if (going != null && (speed ?? 0) >= 5) setDriveBearing((cur) => (cur == null || turnBetween(cur, going) >= 8 ? Math.round(going) : cur));
    }
  }, [driving, tracker, motionTick]);

  // Drive mode on by itself: tracking, the app on screen, and 15 mph or more
  // for a minute. Off again after 5 minutes parked (only if it turned itself
  // on). Done while moving keeps it off until you've stopped for a while.
  const autoEntered = useRef(false);
  const autoSnoozed = useRef(false);
  useEffect(() => {
    if (!autoDrive || !trackTravel || !tracker) return;
    const moving = speedMph(60_000, true);
    const parked = speedMph(5 * 60_000, true);
    if (autoSnoozed.current && parked != null && parked < 3) autoSnoozed.current = false;
    if (!driving && !autoSnoozed.current && document.visibilityState === "visible" && moving != null && moving >= 15) {
      autoEntered.current = true;
      setDriveAuto(true);
      setDriving(true);
    } else if (driving && autoEntered.current && parked != null && parked < 3) {
      autoEntered.current = false;
      setDriveAuto(false);
      setDriving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracker, motionTick, autoDrive, trackTravel]);
  // The dashboard covers part of the map: you and the road go in the bigger
  // free piece (beside it with the phone sideways, under it upright). Facing
  // the way you're going, you sit lower in it, so more of the road ahead shows.
  const driveCard = useRef<HTMLDivElement>(null);
  const [drivePad, setDrivePad] = useState<{ top: number; left: number; right: number; bottom: number } | null>(null);
  useEffect(() => {
    const card = driveCard.current;
    const host = card?.parentElement?.parentElement;
    if (!driving || !card || !host) {
      setDrivePad(null);
      return;
    }
    const measure = () => {
      const box = host.getBoundingClientRect();
      const at = card.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const beside = Math.max(0, box.right - at.right);
      const under = Math.max(0, box.bottom - at.bottom);
      const sideBySide = beside * box.height > under * box.width;
      const freeHeight = sideBySide ? box.height : under;
      const ahead = headingUp ? Math.round(freeHeight * 0.3) : 0;
      const next = sideBySide
        ? { top: ahead, left: Math.round(at.right - box.left), right: 0, bottom: 0 }
        : { top: Math.round(at.bottom - box.top) + ahead, left: 0, right: 0, bottom: 0 };
      setDrivePad((cur) => (cur && cur.top === next.top && cur.left === next.left ? cur : next));
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(card);
    watch.observe(host);
    return () => watch.disconnect();
  }, [driving, headingUp]);

  function endDrive() {
    // Turned off by hand while still moving: don't turn straight back on.
    if ((speedMph() ?? 0) >= 5) autoSnoozed.current = true;
    autoEntered.current = false;
    setDriveAuto(false);
    setDriving(false);
  }

  // Coming up ahead: unvisited places in the direction you're going (Drive
  // mode, or the voice set to Everything). At most every half mile or minute.
  const [ahead, setAhead] = useState<Ahead[]>([]);
  // Weather ahead (Drive mode): the next hour along the way you're going.
  const [weather, setWeather] = useState<WeatherAhead | null>(null);
  const weatherSaid = useRef("");
  useEffect(() => {
    if (!driving || !tracker || document.visibilityState !== "visible") return;
    const speed = speedMph() ?? 0;
    const going = speed >= 10 ? heading() : null;
    let live = true;
    void weatherAhead(tracker, going, speed).then((result) => {
      if (!live || !result) return;
      setWeather(result);
      // Said once per change (and not again for the same patch every 15 minutes).
      const key = result.heads ? `${result.kind}` : "";
      if (key && key !== weatherSaid.current) {
        const line = weatherSpeech(result);
        if (line) announce(line, "highlights", true);
      }
      weatherSaid.current = key;
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driving, tracker]);
  const aheadAt = useRef<{ lat: number; lon: number; t: number } | null>(null);
  const aheadSaid = useRef(new Set<string>());
  const aheadAsk = useRef(0);
  useEffect(() => {
    const fix = tracker;
    const atlas = metaRef.current;
    if (!fix || !atlas || !trackTravel || !(driving || voice === "all")) {
      if (!driving) setAhead([]);
      return;
    }
    const going = heading();
    if (going == null || (speedMph() ?? 0) < 10) return;
    const prev = aheadAt.current;
    if (prev && Date.now() - prev.t < 60_000 && milesBetween(prev.lat, prev.lon, fix.lat, fix.lon) < 0.5) {
      // Between refreshes: count the miles down, and give a heads-up close by.
      setAhead((cur) => cur.map((place) => ({ ...place, miles: Math.round(milesBetween(fix.lat, fix.lon, place.lat ?? fix.lat, place.lon ?? fix.lon) * 10) / 10 })));
      return;
    }
    aheadAt.current = { lat: fix.lat, lon: fix.lon, t: Date.now() };
    // Newest look wins (a slow first look can't land over a later one).
    const ask = ++aheadAsk.current;
    void comingUp(fix, going, atlas.states, new Set(marksRef.current.map((mark) => mark.id))).then((rows) => {
      if (ask === aheadAsk.current) setAhead(rows);
    });
  }, [tracker, motionTick, driving, voice, trackTravel]);
  useEffect(() => {
    const next = ahead[0];
    if (!next || next.miles > 2 || aheadSaid.current.has(next.id)) return;
    aheadSaid.current.add(next.id);
    announce(`Coming up: ${next.name}, in ${next.miles < 1 ? "less than a mile" : `${Math.round(next.miles)} miles`}.`, "all");
  }, [ahead]);

  const [sendPlace, setSendPlace] = useState<Mark | null>(null);
  const [fitTo, setFitTo] = useState<{ tick: number; points: [number, number][]; maxZoom: number } | null>(null);

  /** "I'm here" from Drive: the name of the spot, worked out when it opens. */
  const [hereLabel, setHereLabel] = useState<string | null>(null);
  useEffect(() => {
    if (!hereOpen) {
      setHereLabel(null);
      return;
    }
    const fix = tracker ?? you;
    if (!fix) return;
    let live = true;
    void nameHere(fix, marks).then((spot) => live && setHereLabel(spot.label + (spot.state ? `, ${spot.state}` : "")));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hereOpen]);

  /** A group from the Stops view on the map (its name and count replace the card at the top). */
  const [group, setGroup] = useState<{ label: string; spots: GroupSpot[] } | null>(null);
  /** The GPS stop tapped on the map, shown in that card. */
  const [groupPick, setGroupPick] = useState<GroupSpot | null>(null);
  const groupDots = useMemo(() => group?.spots ?? [], [group]);
  function showGroup(label: string, spots: GroupSpot[]) {
    setTripRoutes(null);
    setGroup({ label, spots });
    setGroupPick(spots.length === 1 && spots[0]?.kind === "stop" ? spots[0] : null);
    setSheetInstant(true);
    setSheet(8);
    window.setTimeout(() => setSheetInstant(false), 80);
    const points = spots.map((s) => [s.lon, s.lat] as [number, number]);
    if (points.length) window.setTimeout(() => setFitTo((cur) => ({ tick: (cur?.tick ?? 0) + 1, points, maxZoom: points.length > 1 ? 11 : 15 })), 350);
  }
  useEffect(() => {
    if (!group) return;
    return pushBack(() => {
      setGroup(null);
      setGroupPick(null);
      return true;
    });
  }, [group]);

  /** Draw trip routes on the map and fit them in view. */
  function showRoutes(
    label: string,
    routes: { color: string; lines: [number, number][][]; dots?: [number, number][] }[],
    legend?: { name: string; color: string }[],
    maxZoom = 11,
  ) {
    setGroup(null);
    setGroupPick(null);
    setTripRoutes({ label, routes, legend });
    // Fit the routes driven; stops only when there's no route yet.
    const driven = routes.flatMap((route) => route.lines.flat());
    const points = driven.length ? driven : routes.flatMap((route) => route.dots ?? []);
    setSheetInstant(true);
    setSheet(8);
    window.setTimeout(() => setSheetInstant(false), 80);
    // Once the map has taken the space the menu gave up.
    if (points.length) window.setTimeout(() => setFitTo((cur) => ({ tick: (cur?.tick ?? 0) + 1, points, maxZoom })), 350);
  }

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
    function noteAgain(marksHere: Mark[], justAdded: Mark[] = []) {
      for (const mark of justAdded) passInside.add(mark.id);
      if (!passSeeded) {
        for (const mark of marksHere) passInside.add(mark.id);
        passSeeded = true;
        return [] as Mark[];
      }
      const now = new Set([...marksHere, ...justAdded].map((mark) => mark.id));
      const entered = marksHere.filter((mark) => !passInside.has(mark.id));
      for (const mark of entered) passInside.add(mark.id);
      for (const id of passInside) if (!now.has(id)) passInside.delete(id);
      return entered;
    }

    let trackerT = 0;
    function paintTracker(fix: Fix, force = false) {
      const now = Date.now();
      // Never back to an older spot (fixes read back from the phone's log can be).
      const t = fix.t ?? now;
      if (t < trackerT) return;
      // In the background nothing is drawn: a look every 20 s keeps the next county
      // and the notification current without redrawing the app every 8.
      const every = document.visibilityState === "hidden" ? 20_000 : 8000;
      if (!force && now - lastDotAt < every) return;
      lastDotAt = now;
      trackerT = t;
      setTracker(fix);
    }

    async function run(fix: Fix) {
      const atlas = metaRef.current;
      if (!atlas || dead) return;
      if (last && milesBetween(last.lat, last.lon, fix.lat, fix.lon) < 0.08) return;
      last = fix;
      const saved = new Set(marksRef.current.map((mark) => mark.id));
      const statesBefore = new Set(marksRef.current.map((mark) => mark.state).filter(Boolean));
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
        // Dated (today, or the day the fix was taken) so it's clear when this visit was.
        if (await addRef.current(mark, true, day ?? localDay(fix.t ?? Date.now()))) added.push(mark);
      }
      for (const mark of visited) await noteTrip(mark.id);
      const reentered: Mark[] = [];
      // Places just added count as where you are, so the next fix inside them isn't "entering again".
      for (const mark of noteAgain(again, found)) if (await revisitRef.current(mark, day)) reentered.push(mark);
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
      if (added.length) speakAdded(added, statesBefore);
      if (added.length) void checkWishes();
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

    // Low battery: tracking eases off (the effect restarts with gentler settings).
    // Only while the app is on screen: Android won't let the location service
    // start again from the background, so a restart there could end tracking.
    let lastBattery = 0;
    function checkBattery(force = false) {
      if (!nativeApp || (!force && Date.now() - lastBattery < 3 * 60_000)) return;
      lastBattery = Date.now();
      void batteryInfo().then((info) => {
        if (dead) return;
        setCharging(!!info?.charging);
        if (document.visibilityState !== "visible") return;
        setLowPower((cur) => lowPowerNext(cur, info));
      });
    }
    checkBattery(true);
    const batteryOnShow = () => {
      if (document.visibilityState === "visible") checkBattery(true);
    };
    document.addEventListener("visibilitychange", batteryOnShow);

    let lastShare = 0;
    let lastSharedT = 0;
    function shareLive(force = false) {
      if (!useLiveShare.getState().viewers.length) {
        if (lastShare) {
          lastShare = 0;
          lastSharedT = 0;
          void clearLiveTrail({ data: { deviceId: deviceId() } }).catch(() => {});
        }
        return;
      }
      const now = Date.now();
      if (!force && now - lastShare < 12000) return;
      // One fix is enough for the marker. The line appears once there's a second point.
      const here = useGhost.getState().live.at(-1);
      // Nothing new (parked): just keep the trail from timing out for friends
      // (3 minutes), instead of re-sending the same points every 12 seconds.
      if (!force && here?.t != null && here.t === lastSharedT && now - lastShare < 60_000) return;
      const trail = thinTrail(freshPoints(useGhost.getState().live, useSettings.getState().ghostHours), 90);
      const points = trail.length >= 1 ? trail : here ? [here] : [];
      if (!points.length) return;
      lastShare = now;
      lastSharedT = here?.t ?? 0;
      const packed = points.slice(-600).map((point) =>
        point.brk ? ([point.lat, point.lon, point.t, 1] as const) : ([point.lat, point.lon, point.t] as const),
      );
      void pushLiveTrail({ data: { points: packed, deviceId: deviceId() } }).catch(() => {
        lastShare = 0;
      });
    }

    // "Keep the live trail on your account": the whole trail goes up each time, so
    // every 3 minutes (it was every 20 seconds) and when you leave the app.
    let lastCache = 0;
    function shareCache(force = false) {
      if (!useSettings.getState().keepGhost) return;
      const now = Date.now();
      if (now - lastCache < (force ? 20_000 : 180_000)) return;
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
    let lastMotionTick = 0;
    const held: Fix[] = [];
    // Fixes from the phone's location service come in time order. One older than
    // the newest already handled is a repeat: coming back to the app, the phone can
    // hand over fixes it had queued after the same stretch was read back from its
    // log. Going over them again doubled that stretch in the day's miles and put a
    // there-and-back in the trail and the trip.
    const serviceFixes = new WeakSet<Fix>();
    let serviceT = 0;
    function push(all: Fix[], forceDot = false) {
      if (catchingUp) {
        held.push(...all);
        return;
      }
      const fixes = all.filter((fix) => {
        if (!serviceFixes.has(fix)) return true;
        const t = fix.t ?? 0;
        if (t < serviceT) return false;
        serviceT = t;
        return true;
      });
      if (!fixes.length) return;
      const latest = fixes.reduce<Fix | null>((best, fix) => (!best || (fix.t ?? 0) >= (best.t ?? 0) ? fix : best), null);
      if (latest) paintTracker(latest, forceDot);
      if (latest) rememberFix(latest);
      // The map's dot follows every fix (the app itself only updates every few seconds):
      // the newest of them, whatever order they came in.
      if (latest) noteLiveFix(latest);
      checkBattery();
      noteMotion(fixes);
      // Speed and heading changed: driving bits look again (at most every 3 s,
      // and in the background only for spoken "coming up"s: no redraws for nothing).
      const motionWanted = document.visibilityState === "visible" || useDrive.getState().voice === "all";
      if (motionWanted && Date.now() - lastMotionTick > 3000) {
        lastMotionTick = Date.now();
        setMotionTick((n) => n + 1);
      }
      useGhost.getState().record(fixes);
      shareLive();
      if (!adding) return;
      logDrive(fixes);
      noteTripFixes(recordingRef.current, fixes);
      // Somewhere you stayed 10+ minutes: a stop, named and kept with your account.
      for (const found of noteStopFixes(fixes)) {
        void keepStop(found, metaRef.current?.states ?? []).then((row) =>
          setGpsStops((cur) => [row, ...cur.filter((s) => s.id !== row.id)]),
        );
      }
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
      for (const fix of missed) serviceFixes.add(fix);
      if (missed.length) push(missed, true);
      if (held.length) push(held.splice(0), true);
    }
    if (nativeApp) {
      void Promise.all([import("@capgo/background-geolocation"), nativeDelivery(userIdRef.current, deviceId()), stoppedFromNotification()]).then(([{ BackgroundGeolocation }, delivery, stopped]) => {
        if (dead) return;
        if (stopped) {
          // "Stop tracking" on the notification while the app was closed.
          setTrackTravel(false);
          setShareOnly(false);
          return;
        }
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
            // Low battery: a fix at most once a minute, and only after moving 250 m.
            ...(lowPower ? { distanceFilter: 250, minIntervalMs: 60_000 } : { distanceFilter: 80 }),
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
            const fix: Fix = { lat: location.latitude, lon: location.longitude, t };
            serviceFixes.add(fix);
            push([fix]);
          },
        );
      });
    }
    const host = window as Window & { atlasPushFixes?: (fixes: Fix[], fromService?: boolean) => void };
    host.atlasPushFixes = (fixes, fromService = false) => {
      if (fromService) for (const fix of fixes) serviceFixes.add(fix);
      push(fixes);
    };
    const refreshDot = () => {
      if (document.visibilityState === "hidden") return;
      void catchUp();
      const queued = takeNativeFixes();
      if (queued.length) push(queued, true);
      void readDeviceLocation()
        .then((fix) => {
          if (dead) return;
          // Tracking already has something newer (the phone answered with a spot it had
          // from before): going back to it would put a jag in the trail and count road twice.
          const newest = latestLiveFix();
          if (newest?.t && (fix.t ?? Date.now()) <= newest.t) return;
          // A rough network position: fine for showing where you are, never for the
          // trail, the miles, or adding places (it can be a town over).
          if (fix.rough) {
            if (!catchingUp) paintTracker(fix, true);
            return;
          }
          if (catchingUp) {
            // (On the phone the log being read back already ends where you are.)
            if (!nativeApp) held.push(fix);
            return;
          }
          paintTracker(fix, true);
          useGhost.getState().record([fix]);
          shareLive();
          if (!adding) return;
          // On the phone the location service's own fixes count the miles; this one
          // is timed by a different clock, so it stays out of that sum.
          if (!nativeApp) logDrive([fix]);
          shareCache();
        })
        .catch(() => {});
    };
    // Straight away, before any new location comes in: where you were last (it's
    // usually where you still are). Parked, the location service sends nothing new.
    const known = lastKnownFix();
    if (known) paintTracker(known, true);
    push(takeNativeFixes());
    refreshDot();
    const beat = window.setInterval(() => shareLive(), 12000);
    const unsubLive = useLiveShare.subscribe((state, prev) => {
      if (state.viewers.join() === prev.viewers.join()) return;
      shareLive(true);
      postNextFix();
    });
    const cacheOnLeave = () => {
      if (adding && document.visibilityState === "hidden") shareCache(true);
    };
    document.addEventListener("visibilitychange", cacheOnLeave);
    window.addEventListener("focus", refreshDot);
    document.addEventListener("visibilitychange", refreshDot);
    return () => {
      dead = true;
      document.removeEventListener("visibilitychange", cacheOnLeave);
      setTracker(null);
      if (nativeApp) void import("@capgo/background-geolocation").then(({ BackgroundGeolocation }) => BackgroundGeolocation.stop());
      else navigator.geolocation.clearWatch(watch);
      delete host.atlasPushFixes;
      document.removeEventListener("visibilitychange", batteryOnShow);
      window.removeEventListener("focus", refreshDot);
      document.removeEventListener("visibilitychange", refreshDot);
      window.clearInterval(beat);
      unsubLive();
      void clearLiveTrail({ data: { deviceId: deviceId() } }).catch(() => {});
    };
  }, [setTrackTravel, setShareOnly, trackTravel, locating, lowPower]);

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
    // No visits recorded yet means it was only just added: that was the visit.
    if (!current.visits.length) return false;
    const visits = current.visits;
    if (visits.length >= 12) return false;
    // One visit a day: wobbling GPS at a town or county line, or crossing it back and forth, isn't a new visit.
    const on = day ?? localDay(Date.now());
    if (visits.some((visit) => visit.visitedOn === on)) return false;
    // An undated visit is the first one, from before visits had dates (or a moment
    // ago): counting a second one on top of it the same day isn't a new visit.
    if (visits.length === 1 && !visits[0]?.visitedOn && addedToday.current.has(current.id)) return false;
    await saveVisits(current.id, [...visits, { ...freshVisit(), visitedOn: on }]);
    return true;
  }

  /** Places added during this session today, so their undated first visit counts as today's. */
  const addedToday = useRef(new Set<string>());
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
      throw new Error("Offline. Places will sync when you have signal.");
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

  async function beginRecording(id: string, groupId: string | null = null) {
    setRecordingId(id);
    setActiveTrip(id);
    const now = Date.now();
    setTrips((prev) =>
      prev.map((trip) =>
        trip.id === id
          ? { ...trip, recording: true, startedAt: trip.startedAt ?? now, endedAt: null, groupId: groupId ?? trip.groupId ?? null }
          : trip.recording
            ? { ...trip, recording: false, endedAt: now }
            : trip,
      ),
    );
    if (!groupId) setTab("trips");
    try {
      await setTripRecording({ data: { id, on: true, groupId } });
    } catch {
      setError("Couldn't start that trip.");
    }
  }

  async function startTrip(name: string, groupId: string | null = null) {
    if (!(await ensureTracking())) return;
    const id = await makeTrip(name);
    await beginRecording(id, groupId);
  }

  async function restartTrip(id: string) {
    if (!(await ensureTracking())) return;
    await beginRecording(id);
  }

  async function endTrip() {
    const id = recordingId;
    setRecordingId(null);
    if (!id) return;
    setTrips((prev) => prev.map((trip) => (trip.id === id ? { ...trip, recording: false, endedAt: Date.now() } : trip)));
    // The rest of the route goes up first, so the recap has all of it.
    void flushTripTrack().finally(() => setRecapTrip({ id, justEnded: true }));
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
  // Driving: a tapped place's card fills the screen and closes on its own after
  // 12 seconds untouched (any touch on it starts the count again).
  const [cardTouch, setCardTouch] = useState(0);
  useEffect(() => {
    if (!driving || !cardOnly) return;
    const timer = window.setTimeout(() => closeCard(), 12000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driving, cardOnly, focus?.id, cardTouch]);

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
    // An "I'm here" spot has no place card: it stays until it's closed (or another place is picked).
    if (!spot || selected === spot.id || (spot.label && selected === null)) return;
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
    if (spot?.label) {
      setSpot(null);
      return true;
    }
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
          // Live trails show by default: watch a friend who's sharing, unless you hid them
          // (that lasts until they stop sharing). The map doesn't move for it.
          for (const id of [...liveHidden.current]) if (!now.has(id)) liveHidden.current.delete(id);
          setFriendLive((cur) => {
            if (cur && !now.has(cur.id)) return null;
            if (cur || trailShown.current) return cur;
            const next = rows.find((row) => !liveHidden.current.has(row.id));
            return next ? { id: next.id, name: next.name } : null;
          });
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
    let timer = 0;
    // Every 10 s while their trail is changing; slowing to once a minute while
    // it isn't (they're parked); none while the app is off screen.
    let every = 10_000;
    let lastTip = "";
    const next = () => {
      window.clearTimeout(timer);
      if (!dead && document.visibilityState === "visible") timer = window.setTimeout(pull, every);
    };
    const pull = () => {
      if (document.visibilityState !== "visible") return;
      pullLiveTrail({ data: friendLive.id })
        .then((points) => {
          if (dead) return;
          const tipNow = points.length ? String(points.at(-1)) : "";
          every = tipNow && tipNow === lastTip ? Math.min(every * 2, 60_000) : 10_000;
          lastTip = tipNow;
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
        })
        .finally(next);
    };
    // Back on screen: straight away, at the quick pace.
    const onShow = () => {
      if (document.visibilityState !== "visible") return;
      every = 10_000;
      pull();
    };
    pull();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      dead = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
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

  const lookVersion = useLookVersion();
  const shownPins = useMemo(() => {
    const pins = !friendFix ? livePins : livePins.map((pin) => (pin.id === friendFix.id ? { ...pin, lat: friendFix.lat, lon: friendFix.lon } : pin));
    const me = user?.id;
    if (!me) return pins;
    return pins.map((pin) => ({ ...pin, name: nickOf(me, "friend", pin.id, pin.name) }));
  }, [livePins, friendFix, user?.id, lookVersion]);

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
        meId={user?.id ?? ""}
      />
    );
  }

  const popped = pops[0];

  return (
    <main
      className={"app-shell bg-bg text-ink" + (sheetInstant ? " sheet-drag" : "") + (cardOnly ? " sheet-card" : "") + (driving ? " drive-mode" : "")}
      style={cardOnly ? undefined : { ["--sheet" as string]: sheet <= 12 ? "var(--sheet-peek)" : `${sheet}dvh` }}
    >
      {popped ? null : <UpdatePrompt hold={driving} />}
      {viewing ? (
        <PhotoViewer
          photos={viewing.list}
          startId={viewing.id}
          title={marks.find((mark) => mark.id === viewing.list[0]?.poiId)?.name ?? "Photos"}
          onClose={closeViewer}
        />
      ) : null}
      {popped ? (
        <div
          className={
            "px-safe pointer-events-none absolute inset-x-0 z-30 flex justify-center " +
            // While driving, the top is the driving card: badges show along the bottom.
            (driving ? "bottom-safe" : "top-safe pt-3")
          }
        >
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
              followZoom={driving && !cardOnly ? driveZoom : undefined}
              followBearing={driving && !cardOnly && headingUp ? driveBearing : null}
              followPadding={driving && !cardOnly ? drivePad : null}
              bigIcons={driving}
              onPress={() => {
                if (driving) return;
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
              tripRoutes={tripRoutes?.routes ?? EMPTY_ROUTES}
              topInset={topInset}
              groupSpots={groupDots}
              onGroupStop={(id) => setGroupPick(group?.spots.find((s) => s.id === id) ?? null)}
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
        {driving ? (
          <div className="px-safe pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <div ref={driveCard} className="pointer-events-auto w-[min(78%,24rem)] overflow-hidden rounded-card border border-line bg-surface/95 shadow-sm backdrop-blur-sm">
              {/* Glance strip: speed, then today's tally. */}
              <div className="flex items-end gap-4 px-4 pt-3 pb-2">
                <p className="font-serif text-5xl leading-none tabular-nums">
                  {mph == null ? "—" : mph}
                  <span className="ml-1 font-sans text-base text-muted">mph</span>
                </p>
                <div className="ml-auto grid grid-cols-3 gap-3 text-right">
                  {(() => {
                    const today = localDay(Date.now());
                    const added = marks.filter((mark) => mark.visits.some((visit) => visit.visitedOn === today));
                    return (
                      [
                        [added.length, "places"],
                        [added.reduce((sum, mark) => sum + (mark.points || 0), 0), "pts"],
                        [Math.round(todayMiles()), "mi"],
                      ] as const
                    ).map(([n, label]) => (
                      <span key={label} className="leading-none">
                        <span className="block font-serif text-2xl tabular-nums">{n.toLocaleString()}</span>
                        <span className="text-[10px] tracking-widest text-faint uppercase">{label}</span>
                      </span>
                    ));
                  })()}
                </div>
              </div>
              {nextUp ? (
                <div className="flex items-center gap-3 border-t border-line px-4 py-2.5">
                  <Navigation2
                    className="size-6 shrink-0 text-accent transition-transform duration-500"
                    style={{
                      transform: `rotate(${(tracker ? bearing(tracker, { lat: nextUp.lat, lon: nextUp.lon }) : 0) - (headingUp && driveBearing != null ? driveBearing : 0)}deg)`,
                    }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] tracking-widest text-faint uppercase">Next county</span>
                    <span className="block truncate text-lg leading-tight">{nextUp.name}</span>
                  </span>
                  <span className="shrink-0 font-serif text-2xl tabular-nums">
                    {nextUp.miles < 1 ? "<1" : Math.round(nextUp.miles)}
                    <span className="ml-0.5 font-sans text-xs text-muted">mi</span>
                  </span>
                </div>
              ) : null}
              {weather ? (
                <div className="flex items-center gap-3 border-t border-line px-4 py-2">
                  <WeatherIcon kind={weather.kind} className={"size-5 shrink-0 " + (weather.heads ? "text-ink" : "text-muted")} />
                  <span className={"min-w-0 flex-1 truncate text-[15px] " + (weather.heads ? "" : "text-muted")}>{weather.line}</span>
                </div>
              ) : null}
              {ahead.length ? (
                <div className="border-t border-line px-4 py-2">
                  <p className="text-[10px] tracking-widest text-faint uppercase">Coming up</p>
                  <ul className="mt-1 grid gap-1">
                    {ahead.map((place) => (
                      <li key={place.id} className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-[15px]">{place.name}</span>
                        <span className="shrink-0 text-sm text-muted tabular-nums">{place.miles < 1 ? "<1" : Math.round(place.miles)} mi</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {passedNote ? <p className="truncate border-t border-line px-4 py-2 text-sm text-muted">{passedNote}</p> : null}
              <div className="flex gap-2 border-t border-line p-2">
                <button type="button" onClick={() => setHereOpen(true)} className="h-12 flex-1 rounded-lg border border-ink bg-elevated text-[15px]">
                  I'm here
                </button>
                <button
                  type="button"
                  onClick={() => useDrive.getState().set({ voice: voice === "off" ? "highlights" : "off" })}
                  aria-label={voice === "off" ? "Turn on spoken announcements" : "Turn off spoken announcements"}
                  aria-pressed={voice !== "off"}
                  className={"grid size-12 shrink-0 place-items-center rounded-lg border " + (voice !== "off" ? "border-ink bg-elevated text-ink" : "border-line text-muted")}
                >
                  {voice !== "off" ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
                </button>
                <button
                  type="button"
                  onClick={() => useDrive.getState().set({ headingUp: !headingUp })}
                  aria-label={headingUp ? "North up" : "Face the way you're going"}
                  aria-pressed={headingUp}
                  className={"grid size-12 shrink-0 place-items-center rounded-lg border " + (headingUp ? "border-ink bg-elevated text-ink" : "border-line text-muted")}
                >
                  <Compass className="size-5" style={{ transform: `rotate(${headingUp && driveBearing != null ? -driveBearing : 0}deg)` }} />
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={endDrive}
              className="pointer-events-auto h-14 shrink-0 rounded-full border border-line bg-surface/95 px-5 text-base shadow-sm backdrop-blur-sm"
            >
              Done
            </button>
          </div>
        ) : null}
        {/* Bottom left: chips stacked above the buttons (they never overlap), and the
            buttons in one row that tucks away behind the arrow. */}
        <div className="pointer-events-none absolute bottom-safe left-safe z-10 flex max-w-[calc(100%-4rem)] flex-col items-start gap-2">
          <div className="pointer-events-auto flex max-w-full flex-col items-start gap-2">
        {tripRoutes && !(friendLive || friendLines.length) ? (
          <button
            type="button"
            onClick={() => setTripRoutes(null)}
            className="h-11 max-w-[min(75vw,20rem)] truncate rounded-full border border-line bg-surface/95 px-3 text-sm shadow-sm backdrop-blur-sm"
          >
            {tripRoutes.legend?.length ? (
              <span className="mr-1 inline-flex items-center gap-2">
                {tripRoutes.legend.map((who) => (
                  <span key={who.name + who.color} className="inline-flex items-center gap-1">
                    <span className="size-2.5 rounded-full" style={{ background: who.color }} />
                    {who.name}
                  </span>
                ))}
              </span>
            ) : (
              tripRoutes.label
            )}{" "}
            · Hide
          </button>
        ) : null}
        {!driving ? (
          <>
        {/* The next county and a friend's live trail sit side by side. Tucking the
            map buttons away hides them too; otherwise each shrinks after a few
            seconds, and a tap shows it in full again. */}
        {!toolsTucked && ((nextUp && !tripRoutes && !selected) || friendLive || friendLines.length) ? (
          <div className="flex max-w-full items-center gap-1.5">
            {nextUp && !tripRoutes && !selected ? (
              <button
                type="button"
                onClick={() => {
                  if (!nextWide) {
                    setNextWide(true);
                    return;
                  }
                  const mark = countyToMark(nextUp, nextUp.state);
                  chooseState(nextUp.state);
                  openFromMap(mark);
                  setSheetInstant(true);
                  setSheet(8);
                  window.setTimeout(() => setSheetInstant(false), 80);
                }}
                aria-label={`Nearest new county: ${nextUp.name}, ${Math.max(1, Math.round(nextUp.miles))} miles ${nextUp.toward}`}
                className={
                  "flex h-10 min-w-0 shrink items-center gap-1.5 rounded-full border border-line bg-surface/95 text-sm whitespace-nowrap shadow-sm backdrop-blur-sm " +
                  (nextWide ? "px-3" : "shrink-0 px-2.5")
                }
              >
                <Compass className="size-4 shrink-0 text-accent" aria-hidden />
                {nextWide ? (
                  <>
                    <span className="shrink-0 text-xs text-faint">Next</span>
                    <span className="min-w-0 truncate">{nextUp.name}</span>
                  </>
                ) : null}
                <span className="shrink-0 text-xs text-muted">
                  {nextUp.miles < 1 ? "<1" : Math.round(nextUp.miles)} mi {nextUp.toward}
                </span>
              </button>
            ) : null}
            {friendLive || friendLines.length ? (
              <button
                type="button"
                onClick={() => {
                  if (!liveWide) {
                    setLiveWide(true);
                    return;
                  }
                  if (friendLive) liveHidden.current.add(friendLive.id);
                  trailShown.current = false;
                  setFriendLines([]);
                  setFriendLive(null);
                  setFriendFix(null);
                }}
                aria-label={friendLive ? `${friendLive.name}'s live trail${liveWide ? ": hide" : ""}` : `Friend's trail${liveWide ? ": hide" : ""}`}
                className={
                  "flex h-10 min-w-0 shrink items-center gap-1.5 rounded-full border border-line bg-surface/95 text-sm whitespace-nowrap shadow-sm backdrop-blur-sm " +
                  (liveWide ? "px-3" : "shrink-0 px-2.5")
                }
              >
                <span className={"size-2 shrink-0 rounded-full bg-accent " + (friendLive ? "animate-pulse" : "opacity-70")} aria-hidden />
                {liveWide ? (
                  <>
                    <span className="min-w-0 truncate">{friendLive ? friendLive.name : "Friend's trail"}</span>
                    <span className="shrink-0 text-xs text-muted">{friendLive ? "live · Hide" : "Hide"}</span>
                  </>
                ) : (
                  <span className="max-w-24 truncate text-xs text-muted">{friendLive ? friendLive.name.split(" ")[0] : "Trail"}</span>
                )}
              </button>
            ) : null}
          </div>
        ) : null}
          </>
        ) : null}
          </div>
          {!driving ? (
            <div className="pointer-events-auto flex max-w-full items-center gap-1.5 overflow-x-auto">
              <button
                type="button"
                onClick={() => setToolsTucked(!toolsTucked)}
                aria-label={toolsTucked ? "Show the map buttons" : "Tuck the map buttons away"}
                aria-expanded={!toolsTucked}
                className="flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface/95 px-2.5 shadow-sm backdrop-blur-sm"
              >
                {toolsTucked ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
                {toolsTucked ? (
                  <>
                    <span className={"ghost-dot size-2 rounded-full " + (locating ? "is-live" : "opacity-60")} style={{ background: ghostColor }} />
                    {locating && liveViewers.length ? <span className="size-2 animate-pulse rounded-full bg-accent" /> : null}
                    {unreadTotal ? (
                      <span className="grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-medium text-accent-ink">
                        {unreadTotal > 99 ? "99+" : unreadTotal}
                      </span>
                    ) : null}
                  </>
                ) : null}
              </button>
              {!toolsTucked ? (
                <>
          <button
            type="button"
            aria-expanded={ghostOpen}
            onClick={() => {
              if (!ghostOpen && sheet > 8) setSheet(8);
              setGhostOpen(!ghostOpen);
            }}
            aria-label={
              locating && liveViewers.length
                ? `Ghost trail. Sharing your location with ${liveViewers.length} ${liveViewers.length === 1 ? "friend" : "friends"}.`
                : undefined
            }
            className={
              "flex h-11 shrink-0 items-center gap-2 rounded-full border bg-surface/95 px-3 text-sm shadow-sm backdrop-blur-sm " +
              (locating && liveViewers.length ? "border-accent/60" : "border-line")
            }
          >
            {/* Sharing live: the same button (it opens the same panel) says so, saving a button's width. */}
            {locating && liveViewers.length ? (
              <>
                <span className="size-2 animate-pulse rounded-full bg-accent" />
                Live to {liveViewers.length}
              </>
            ) : (
              <>
                <span className={"ghost-dot size-2 rounded-full " + (locating ? "is-live" : "opacity-60")} style={{ background: ghostColor }} />
                Ghost trail
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setGhostOpen(false);
              setMailOpen(false);
              setSheet(8);
              setDriving(true);
              void ensureTracking();
            }}
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface/95 px-3 text-sm shadow-sm backdrop-blur-sm"
          >
            <Car className="size-4" />
            Drive
          </button>
          {user?.id ? (
            <button
              type="button"
              aria-label="Boards"
              onClick={() => {
                if (sheet > 8) setSheet(8);
                setGhostOpen(false);
                setBoardFocus(null);
                setBoardsOpen(true);
              }}
              className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line bg-surface/95 text-accent shadow-sm backdrop-blur-sm"
            >
              <ListTodo className="size-5" />
              {carDue ? <span className="absolute top-1.5 right-1.5 size-2.5 rounded-full border-2 border-surface bg-accent" aria-label="Car care due" /> : null}
            </button>
          ) : null}
          {user?.id ? (
            <button
              type="button"
              aria-label={unreadTotal ? `Messages, ${unreadTotal} new` : "Messages"}
              onClick={() => {
                if (sheet > 8) setSheet(8);
                setGhostOpen(false);
                setMailOpen(true);
              }}
              className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line bg-surface/95 shadow-sm backdrop-blur-sm"
            >
              <Mail className="size-5" />
              {unreadTotal ? (
                <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-medium text-accent-ink">
                  {unreadTotal > 99 ? "99+" : unreadTotal}
                </span>
              ) : null}
            </button>
          ) : null}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
        {recapTrip && trips.some((trip) => trip.id === recapTrip.id) ? (
          <TripRecap
            trip={trips.find((trip) => trip.id === recapTrip.id) as Trip}
            marks={marks}
            justEnded={recapTrip.justEnded}
            onClose={() => setRecapTrip(null)}
            onShowMap={(card: TripCard) => {
              setRecapTrip(null);
              showRoutes(card.name, [{ color: ghostColor, lines: card.lines, dots: card.dots.map((d) => [d[0], d[1]] as [number, number]) }]);
            }}
          />
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
            key={mailThread ? `${mailThread.kind}:${mailThread.id}` : "board"}
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
            onOpenTrail={(lines) => {
              setMailOpen(false);
              setMailThread(null);
              trailShown.current = true;
              setFriendLive(null);
              setFriendLines(lines);
              setFriendLook((n) => n + 1);
              setSheetInstant(true);
              setSheet(8);
              window.setTimeout(() => setSheetInstant(false), 80);
            }}
            onOpenHere={(lat, lon, label) => {
              setMailOpen(false);
              setMailThread(null);
              setSpot({ id: `here:${lat.toFixed(3)},${lon.toFixed(3)}`, lat, lon, from: null, sheet, label: label ?? "Here" });
              setSheetInstant(true);
              setSheet(8);
              window.setTimeout(() => setSheetInstant(false), 80);
            }}
            you={tracker ?? you}
            onOpenBoard={(id) => {
              setBoardFocus(id);
              setBoardsOpen(true);
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
        {boardsOpen && user?.id ? (
          <BoardsPage
            focusId={boardFocus}
            onClose={() => {
              setBoardsOpen(false);
              setBoardFocus(null);
            }}
          />
        ) : null}
        <div ref={topOverlay} className={"pointer-events-none absolute top-safe left-safe z-10 flex flex-col items-start gap-2 " + (driving ? "hidden" : "")}>
          {sendPlace ? <SendPlaceSheet mark={sendPlace} onClose={() => setSendPlace(null)} /> : null}
          {hereOpen ? (
            <SendToSheet
              label="I'm here"
              hint={hereLabel ?? (tracker ?? you ? "Finding where you are…" : "Location isn't on.")}
              onClose={() => setHereOpen(false)}
              onSend={async (thread) => {
                const fix = tracker ?? you;
                if (!fix) throw new Error("Location isn't on.");
                const id = `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
                await sendToThread({ data: { thread, id, kind: "here", here: await nameHere(fix, marks) } });
              }}
            />
          ) : null}
          {shareDay ? (
            <SendToSheet
              label="Send this day"
              hint={shareDay}
              onClose={() => setShareDay(null)}
              onSend={async (thread) => {
                const day = shareDay;
                const seen = new Set<string>();
                const places = [];
                for (const mark of marks) {
                  const days = mark.visits.length ? mark.visits.map((visit) => visit.visitedOn) : [mark.visitedOn];
                  const onDay = days.includes(day) || (!mark.visitedOn && mark.addedAt && localDay(mark.addedAt) === day);
                  if (!onDay || seen.has(mark.id)) continue;
                  seen.add(mark.id);
                  places.push({ id: mark.id, name: mark.name, state: mark.state, lat: mark.lat, lon: mark.lon });
                }
                const stops = gpsStops.filter((item) => localDay(item.start) === day).map((item) => ({ label: item.label, lat: item.lat, lon: item.lon }));
                const points = ghostLive.filter((point) => localDay(point.t) === day).slice(0, 800);
                await sendToThread({
                  data: {
                    thread,
                    id: `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
                    kind: "day",
                    day: {
                      day,
                      places,
                      stops,
                      trail: points.length >= 2 ? { name: "This day", points: points.map((point) => [point.lat, point.lon, point.brk ? 1 : 0]), day } : null,
                    },
                  },
                });
              }}
            />
          ) : null}
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
          {spot?.label ? (
            <div className="pointer-events-auto flex w-[min(20rem,calc(100vw-5.5rem))] items-center gap-2 rounded-card border border-line bg-surface/95 py-2 pr-1 pl-3 shadow-sm backdrop-blur-sm">
              <LocateFixed className="size-4 shrink-0 text-accent" aria-hidden />
              <span className="min-w-0 flex-1 text-sm leading-snug">{spot.label}</span>
              <button type="button" onClick={() => setSpot(null)} aria-label="Close" className="grid size-9 shrink-0 place-items-center rounded-full text-muted active:bg-elevated">
                <X className="size-4" />
              </button>
            </div>
          ) : null}
          {group ? (
            <div className="pointer-events-auto w-[min(20rem,calc(100vw-5.5rem))] rounded-card border border-line bg-surface/95 shadow-sm backdrop-blur-sm">
              <div className="flex items-start gap-2 py-2 pr-1 pl-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-serif text-lg leading-tight">{group.label}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    {(() => {
                      const places = group.spots.filter((s) => s.kind === "place").length;
                      const stops = group.spots.length - places;
                      return (
                        <>
                          {places ? (
                            <span className="flex items-center gap-1">
                              <span className="inline-block size-2.5 rounded-full border-2 border-ink/70" aria-hidden />
                              {places} {places === 1 ? "place" : "places"}
                            </span>
                          ) : null}
                          {stops ? (
                            <span className="flex items-center gap-1">
                              <span className="inline-block size-2 rounded-full bg-[#9aa7ff]" aria-hidden />
                              {stops} {stops === 1 ? "stop" : "stops"}
                            </span>
                          ) : null}
                        </>
                      );
                    })()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setGroup(null);
                    setGroupPick(null);
                  }}
                  aria-label={`Close ${group.label}`}
                  className="grid size-9 shrink-0 place-items-center rounded-full text-muted active:bg-elevated"
                >
                  <X className="size-4" />
                </button>
              </div>
              {groupPick ? (
                <div className="border-t border-line px-3 py-2">
                  <div className="flex items-center gap-1.5 text-sm">
                    <CircleParking className="size-4 shrink-0 text-[#9aa7ff]" aria-hidden />
                    <span className="truncate">{groupPick.name}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">{groupPick.sub}</div>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className={"pointer-events-auto rounded-card border border-line bg-surface/95 px-3 py-2 backdrop-blur-sm " + (group || spot?.label ? "hidden" : "")}>
            <div className="font-serif text-lg leading-none">{stats.places.toLocaleString()} on the map</div>
            <div className="mt-1 text-xs text-muted">
              {stateAbbr
                ? visitedOnly
                  ? "Only places you've added. Switch to All to see the rest."
                  : "Zoom in for smaller places."
                : stats.places === 0
                  ? "Clear until you add a place"
                  : `${stats.points.toLocaleString()} pts · ${stats.states} states`}
              {offline ? " · Offline, kept on this device" : pendingSync ? " · Waiting to sync" : ""}
              {lowPower && locating ? " · Low battery, tracking less often" : ""}
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
        </div>
      </section>

      <aside
        className={"app-sheet flex min-h-0 flex-col bg-surface" + (sheet >= 92 ? " sheet-full" : "")}
        onPointerDown={driving ? () => setCardTouch((n) => n + 1) : undefined}
        onScrollCapture={driving ? () => setCardTouch((n) => n + 1) : undefined}
      >
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
            placePhotos={photos.filter((photo) => photo.poiId === focus.id).sort((a, b) => (b.takenAt ?? -Infinity) - (a.takenAt ?? -Infinity) || 0)}
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
          <div className={"grid grid-cols-[1fr_auto] items-center gap-1.5 " + (headerOpen ? "mt-4" : "")}>
            <div className="-mx-1 grid min-w-0 grid-cols-8 rounded-xl bg-bg/60 p-0.5">
              {TABS.map(([id, label]) => {
                const Icon = TAB_ICONS[id];
                const on = tab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setTab(id);
                      // With the menu lowered only the tabs show; a tab opens it so you see what you picked.
                      if (sheet < 40) setSheet(50);
                    }}
                    className={
                      "relative flex h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-[10px] transition-colors " +
                      (on ? "bg-elevated text-ink shadow-sm" : "text-faint active:bg-elevated/50")
                    }
                  >
                    <Icon className={"size-[18px] " + (on ? "text-accent" : "")} strokeWidth={on ? 2.2 : 1.8} aria-hidden />
                    <span className="max-w-full truncate text-[9.5px] leading-none tracking-[-0.02em]">{label}</span>
                    {id === "friends" && unreadTotal ? (
                      <span
                        aria-label={`${unreadTotal} new`}
                        className="absolute top-0.5 right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-semibold text-accent-ink ring-2 ring-surface"
                      >
                        {unreadTotal > 99 ? "99+" : unreadTotal}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              aria-expanded={headerOpen}
              aria-label={headerOpen ? "Hide the header" : "Show the header"}
              onClick={() => setHeaderOpen((open) => !open)}
              className="flex h-12 w-7 items-center justify-center rounded-lg border border-line text-ink"
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
                ref={searchInput}
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
              gpsStops={gpsStops}
              onShowOnMap={showGroup}
              onRemoveStop={(id) => {
                setGpsStops((cur) => cur.filter((s) => s.id !== id));
                forgetPendingStop(id);
                void removeStop({ data: { id } }).catch(() => {});
              }}
              onShareDay={setShareDay}
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
              everything={loadedPlaces}
              stateRoads={stateRoads}
              onSearch={() => {
                searchInput.current?.focus();
                searchInput.current?.select();
              }}
              savedIds={savedIds}
              covered={new Set(marks.map((mark) => mark.state).filter(Boolean))}
              countyDone={marks.reduce<Record<string, number>>((acc, mark) => {
                if (mark.category === "county" && mark.state) acc[mark.state] = (acc[mark.state] ?? 0) + 1;
                return acc;
              }, {})}
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
              onRecap={(id) => setRecapTrip({ id, justEnded: false })}
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
          {tab === "recap" ? (
            <RecapPanel
              name={profile.name || user?.displayName || ""}
              marks={marks}
              onOpenPlace={(mark) => {
                chooseState(mark.state);
                openFromMap(mark);
                setSheetInstant(true);
                setSheet(8);
                window.setTimeout(() => setSheetInstant(false), 80);
              }}
            />
          ) : null}
          {tab === "friends" ? (
            <FriendsPanel
              openId={friendId}
              note={friendNote}
              liveNow={livePins}
              watchingLive={friendLive?.id ?? null}
              onOpen={(id) => {
                setFriendId(id);
                setFriendLines([]);
                trailShown.current = false;
                // Their live trail shows straight away if they're sharing.
                const live = livePins.find((row) => row.id === id);
                setFriendLive(live ? { id: live.id, name: live.name } : null);
              }}
              onClose={() => {
                setFriendId(null);
                setFriendLines([]);
              }}
              onShow={(lines) => {
                trailShown.current = true;
                setFriendLive(null);
                setFriendLines(lines);
                setFriendLook((n) => n + 1);
                setSheetInstant(true);
                setSheet(8);
                window.setTimeout(() => setSheetInstant(false), 80);
              }}
              onWatch={(friend) => {
                trailShown.current = false;
                liveHidden.current.delete(friend.id);
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
              you={tracker ?? you}
              onOpenHere={(lat, lon, label) => {
                setFriendId(null);
                setSpot({ id: `here:${lat.toFixed(3)},${lon.toFixed(3)}`, lat, lon, from: null, sheet, label: label ?? "Here" });
                setSheetInstant(true);
                setSheet(8);
                window.setTimeout(() => setSheetInstant(false), 80);
              }}
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
              sharedRecording={trips.find((trip) => trip.recording)?.groupId ?? null}
              onStartShared={async (groupId, name) => {
                const mine = trips.find((trip) => trip.groupId === groupId && !trip.recording);
                if (mine) {
                  if (await ensureTracking()) await beginRecording(mine.id, groupId);
                } else await startTrip(name, groupId);
              }}
              onEndShared={() => void endTrip()}
              onShowShared={(groupId, name, travelers) => {
                const routes = travelers
                  .map((traveler, index) => ({
                    who: traveler.userId === user?.id ? "You" : traveler.name.split(" ")[0] ?? "Friend",
                    color: TRAVELER_COLORS[index % TRAVELER_COLORS.length] as string,
                    lines: trackLines(traveler.track),
                    dots: traveler.spots.map((spot) => [spot[0], spot[1]] as [number, number]),
                  }))
                  .filter((route) => route.lines.length || route.dots.length);
                if (!routes.length) return 0;
                showRoutes(
                  `${name} · everyone's routes`,
                  routes,
                  routes.map((route) => ({ name: route.who, color: route.color })),
                );
                return routes.length;
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
            placePhotos={photos.filter((photo) => photo.poiId === focus.id).sort((a, b) => (b.takenAt ?? -Infinity) - (a.takenAt ?? -Infinity) || 0)}
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
  gpsStops,
  stateAbbr,
  stateName,
  selected,
  onBack,
  onOpen,
  onShowOnMap,
  onRemoveStop,
  onShareDay,
}: {
  marks: Mark[];
  gpsStops: GpsStop[];
  stateAbbr: string | null;
  stateName: string | null;
  selected: string | null;
  onBack: () => void;
  onOpen: (mark: Mark) => void;
  onShowOnMap: (label: string, spots: GroupSpot[]) => void;
  onRemoveStop: (id: string) => void;
  onShareDay: (day: string) => void;
}) {
  const [view, setView] = useState<"places" | "stops">(() => {
    try {
      return localStorage.getItem("atlas.yours-view") === "stops" ? "stops" : "places";
    } catch {
      return "places";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("atlas.yours-view", view);
    } catch {
      /* fine */
    }
  }, [view]);
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
          Add places from the Add tab.
        </p>
      </div>
    );
  }
  return (
    <div>
      {stateAbbr ? (
        <div className="mb-2 flex items-center gap-2 pr-2">
          <button type="button" onClick={onBack} className="flex h-11 min-w-0 flex-1 items-center gap-1 px-2 text-sm text-muted">
            <ChevronLeft className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{stateName}</span>
          </button>
          <CountyRing done={marks.filter((m) => m.category === "county").length} total={COUNTY_COUNTS[stateAbbr] ?? 0} />
          <span className="shrink-0 text-xs text-muted">
            {marks.filter((m) => m.category === "county").length}/{COUNTY_COUNTS[stateAbbr] ?? "?"} counties
          </span>
        </div>
      ) : null}
      {/* Places: one row per place. Stops: every visit, by day, week, month or state. */}
      <div className="mb-2 flex items-center gap-1 px-1" role="tablist" aria-label="Show">
        {(["places", "stops"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            className={
              "h-9 rounded-full px-4 text-sm transition-colors " +
              (view === id ? "bg-ink font-medium text-bg" : "border border-line text-muted")
            }
          >
            {id === "places" ? `Places · ${marks.length}` : "Stops"}
          </button>
        ))}
      </div>
      {view === "stops" ? (
        <StopsLog
          marks={marks}
          gpsStops={stateAbbr ? gpsStops.filter((s) => s.state === stateAbbr) : gpsStops}
          onOpen={onOpen}
          onShowOnMap={onShowOnMap}
          onRemoveStop={onRemoveStop}
          onShareDay={onShareDay}
        />
      ) : (
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
      )}
    </div>
  );
}

function AddList({
  meta,
  stateAbbr,
  stateName,
  category,
  query,
  everything,
  stateRoads,
  onSearch,
  rows,
  savedIds,
  covered,
  countyDone,
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
  /** Every place in the state (all categories), for searching the whole state. */
  everything: (CatalogPlace & { cat: string })[];
  stateRoads: RoadRec[];
  onSearch: () => void;
  rows: RoadRec[] | CatalogPlace[];
  savedIds: Set<string>;
  covered: Set<string>;
  /** Counties added, per state. */
  countyDone: Record<string, number>;
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
                <CountyRing done={countyDone[state.abbr] ?? 0} total={COUNTY_COUNTS[state.abbr] ?? 0} />
                <span className="w-8 font-serif text-lg">{state.abbr}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{state.name}</span>
                {countyDone[state.abbr] ? (
                  <span className="shrink-0 text-[11px] text-faint">
                    {countyDone[state.abbr]}/{COUNTY_COUNTS[state.abbr] ?? "?"} counties
                  </span>
                ) : null}
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
    const q = query.trim();
    return (
      <div>
        <button type="button" onClick={() => onState(null)} className="mb-2 flex h-11 items-center gap-1 px-2 text-sm text-muted">
          <ChevronLeft className="size-4" aria-hidden="true" />
          All states
        </button>
        <div className="flex items-center justify-between gap-3 px-2">
          <div className="flex min-w-0 items-center gap-1">
            <h2 className="truncate font-serif text-2xl">{stateName}</h2>
            <button
              type="button"
              onClick={onSearch}
              aria-label={`Search all of ${stateName}`}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted hover:bg-elevated"
            >
              <Search className="size-5" aria-hidden="true" />
            </button>
          </div>
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
        {q ? (
          <StateSearch
            query={q}
            stateAbbr={stateAbbr}
            stateName={stateName ?? stateAbbr}
            meta={meta}
            everything={everything}
            stateRoads={stateRoads}
            savedIds={savedIds}
            selected={selected}
            onOpen={onOpen}
            onAdd={onAdd}
          />
        ) : null}
        <p className={"px-2 pt-1 pb-3 text-xs text-muted " + (q ? "hidden" : "")}>
          Pick a category, search everything with the magnifying glass, or tap a city or highway on the map. The card is where you add it.
        </p>
        <div className={"place-scroll grid max-h-[46vh] grid-cols-2 content-start gap-1.5 overflow-y-auto px-1 " + (q ? "hidden" : "")}>
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

/** Everything in a state matching a search: places of every kind, roads, and counties. */
function StateSearch({
  query,
  stateAbbr,
  stateName,
  meta,
  everything,
  stateRoads,
  savedIds,
  selected,
  onOpen,
  onAdd,
}: {
  query: string;
  stateAbbr: string;
  stateName: string;
  meta: AtlasMeta;
  everything: (CatalogPlace & { cat: string })[];
  stateRoads: RoadRec[];
  savedIds: Set<string>;
  selected: string | null;
  onOpen: (mark: Mark) => void;
  onAdd: (mark: Mark) => void;
}) {
  const [counties, setCounties] = useState<CatalogPlace[]>([]);
  const [limit, setLimit] = useState(60);
  useEffect(() => {
    let dead = false;
    void loadPlaces("county", stateAbbr)
      .then((rows) => {
        if (!dead) setCounties(rows);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [stateAbbr]);
  useEffect(() => setLimit(60), [query]);
  const label = (cat: string) => meta.categories.find((item) => item.id === cat)?.label ?? cat;
  const q = query.toLowerCase();
  const results = useMemo(() => {
    const out: { mark: Mark; kind: string; rank: number }[] = [];
    // Names that start with the search come before ones that only contain it.
    const rank = (name: string) => (name.toLowerCase().startsWith(q) ? 0 : 1);
    for (const road of stateRoads) if (roadMatches(road, query)) out.push({ mark: roadToMark(road, stateAbbr), kind: "Road", rank: rank(road.name) });
    for (const county of counties) if (placeMatches(county, query)) out.push({ mark: placeToMark(county, "county", stateAbbr), kind: "County", rank: rank(county.name) });
    for (const place of everything) if (placeMatches(place, query)) out.push({ mark: placeToMark(place, place.cat, stateAbbr), kind: label(place.cat), rank: rank(place.name) });
    const seen = new Set<string>();
    return out
      .filter((row) => (seen.has(row.mark.id) ? false : (seen.add(row.mark.id), true)))
      .sort((a, b) => a.rank - b.rank || (b.mark.points ?? 0) - (a.mark.points ?? 0) || a.mark.name.localeCompare(b.mark.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, everything, stateRoads, counties, stateAbbr]);
  return (
    <div className="pt-2">
      <p className="px-2 pb-1 text-xs text-faint">
        {results.length ? `${results.length.toLocaleString()} in ${stateName}` : everything.length ? `Nothing in ${stateName} matches "${query}".` : "Loading the state…"}
      </p>
      <ul>
        {results.slice(0, limit).map((row) => (
          <Row
            key={row.mark.id}
            mark={row.mark}
            active={row.mark.id === selected}
            saved={savedIds.has(row.mark.id)}
            extra={row.kind}
            onOpen={() => onOpen(row.mark)}
            onAdd={() => onAdd(row.mark)}
          />
        ))}
      </ul>
      {results.length > limit ? (
        <button type="button" onClick={() => setLimit(limit + 100)} className="h-11 w-full text-sm text-muted">
          Show more
        </button>
      ) : null}
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
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-ink bg-elevated text-sm disabled:opacity-60"
        >
          <Locate className="size-4" aria-hidden="true" />
          {busy ? "Finding you…" : "Places near me"}
        </button>
        <p className="mt-2 text-xs text-muted">Needs location access.</p>
        {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
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
        {earned} of {total} badges
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

/** Each traveler on a shared trip gets one of these, in order. */
const TRAVELER_COLORS = ["#e8553a", "#3dbebf", "#e2b15a", "#9b7be0", "#6cc56b", "#e07bb4"];

const EMPTY_ROUTES: { color: string; lines: [number, number][][] }[] = [];

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
  onRecap,
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
  onRecap: (id: string) => void;
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
          Start a trip to record its route and every place you pass.
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
              {item.stops.length || item.startedAt ? (
                <button type="button" onClick={() => onRecap(item.id)} className="h-11 px-2 text-xs text-muted">
                  Recap
                </button>
              ) : null}
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
      {trip.stops.length || trip.startedAt ? (
        <button type="button" onClick={() => onRecap(trip.id)} className="mt-2 h-11 w-full rounded-lg border border-line text-sm">
          Trip recap
        </button>
      ) : null}
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
      {stops.length === 0 ? <p className="mt-1 text-sm text-muted">No stops yet. Search below to add one.</p> : null}
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
        {detailNote ? <p className="mt-2 text-xs text-muted">{detailNote}</p> : null}
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
        {detailNote && !editing ? <p className="mt-1 text-xs text-muted">{detailNote}</p> : null}
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
