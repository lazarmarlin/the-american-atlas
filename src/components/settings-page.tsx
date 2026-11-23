import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { BORDER_COLORS, useSettings } from "@/lib/atlas-settings";
import { authEnabled, signOut } from "@/lib/auth/client";
import { clearGhostLocal } from "@/lib/ghost-trail";
import { clearGhostCache } from "@/lib/ghost-cache";
import { hasGateSessionMarker } from "@/lib/auth/gate-session-marker";
import { useOfflinePack } from "@/lib/offline-pack";
import { nativeApp } from "@/lib/native";
import type { SettingsPageId } from "@/lib/settings-route";
import { requestTrackingPermission } from "@/lib/background-location";
import { type Profile } from "@/lib/profile";
import { vaultSaveMarker, vaultSaveProfile } from "@/lib/vault";
import { YouMarkerFace } from "@/components/you-marker-face";
import { GhostColors, GhostHours } from "@/components/ghost-panel";
import { PhotoFinder } from "@/components/photos-panel";
import { isMarkerColor, isMarkerIcon, MARKER_COLORS, MARKER_ICONS, markerLabel } from "@/lib/you-marker";
import type { PhotoInfo } from "@/lib/photos";

export function SettingsPage({
  profile,
  email,
  page,
  onPage,
  onBack,
  onSaved,
  onSync,
  onTour,
  marks,
  tripId,
  onPhotosSaved,
}: {
  profile: Profile;
  email: string | null;
  page: SettingsPageId;
  onPage: (page: SettingsPageId) => void;
  onBack: () => void;
  onSaved: (profile: Profile) => void;
  onSync: () => Promise<void>;
  onTour: () => void;
  marks: { id: string; name: string; lat: number | null; lon: number | null; category: string }[];
  tripId: string | null;
  onPhotosSaved: (rows: PhotoInfo[]) => void;
}) {
  const icons = useSettings((s) => s.icons);
  const stateBorder = useSettings((s) => s.stateBorder);
  const countyColor = useSettings((s) => s.countyColor);
  const trackTravel = useSettings((s) => s.trackTravel);
  const setIcons = useSettings((s) => s.setIcons);
  const setStateBorder = useSettings((s) => s.setStateBorder);
  const setCountyColor = useSettings((s) => s.setCountyColor);
  const setTrackTravel = useSettings((s) => s.setTrackTravel);
  const fastAdd = useSettings((s) => s.fastAdd);
  const setFastAdd = useSettings((s) => s.setFastAdd);
  const showParks = useSettings((s) => s.showParks);
  const showTowns = useSettings((s) => s.showTowns);
  const showReservations = useSettings((s) => s.showReservations);
  const showPhotos = useSettings((s) => s.showPhotos);
  const townColor = useSettings((s) => s.townColor);
  const reservationColor = useSettings((s) => s.reservationColor);
  const setShowParks = useSettings((s) => s.setShowParks);
  const setShowTowns = useSettings((s) => s.setShowTowns);
  const setShowReservations = useSettings((s) => s.setShowReservations);
  const setShowPhotos = useSettings((s) => s.setShowPhotos);
  const setTownColor = useSettings((s) => s.setTownColor);
  const setReservationColor = useSettings((s) => s.setReservationColor);
  const markerIcon = useSettings((s) => s.markerIcon);
  const markerColor = useSettings((s) => s.markerColor);
  const setMarkerIcon = useSettings((s) => s.setMarkerIcon);
  const setMarkerColor = useSettings((s) => s.setMarkerColor);
  const ghostHours = useSettings((s) => s.ghostHours);
  const setGhostHours = useSettings((s) => s.setGhostHours);
  const ghostColor = useSettings((s) => s.ghostColor);
  const setGhostColor = useSettings((s) => s.setGhostColor);
  const keepGhost = useSettings((s) => s.keepGhost);
  const setKeepGhost = useSettings((s) => s.setKeepGhost);
  const pack = useOfflinePack();
  const packPct = pack.total ? Math.min(100, Math.round((pack.done / pack.total) * 100)) : 0;
  const [name, setName] = useState(profile.name);
  const [photo, setPhoto] = useState(profile.photo);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [trackNote, setTrackNote] = useState<string | null>(null);
  const [pendingIcon, setPendingIcon] = useState<string | null>(null);
  const [markerNote, setMarkerNote] = useState<string | null>(null);

  useEffect(() => {
    setName(profile.name);
    setPhoto(profile.photo);
  }, [profile.name, profile.photo]);

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const next = { name: name.trim(), photo, markerIcon: profile.markerIcon, markerColor: profile.markerColor };
      if (!next.name) throw new Error("Add a name");
      await vaultSaveProfile(next);
      onSaved(next);
      setNote(typeof navigator !== "undefined" && navigator.onLine ? "Saved" : "Saved on this device. It will sync when you're back online.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't save that.");
    } finally {
      setBusy(false);
    }
  }

  async function commitMarker(icon: string, color: string) {
    if (!isMarkerIcon(icon) || !isMarkerColor(color)) return;
    setMarkerIcon(icon);
    setMarkerColor(color);
    setPendingIcon(null);
    const next = { name: profile.name, photo: profile.photo, markerIcon: icon, markerColor: color };
    try {
      await vaultSaveMarker(icon, color);
      onSaved(next);
      setMarkerNote(
        typeof navigator !== "undefined" && navigator.onLine
          ? "Saved to your account"
          : "Saved on this device. It will sync when you're back online.",
      );
    } catch (err) {
      setMarkerNote(err instanceof Error ? err.message : "Couldn't save that marker.");
    }
  }

  return (
    <main className="safe-top safe-bottom mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg px-4 text-ink">
      <button
        type="button"
        onClick={onBack}
        className="mt-3 flex h-11 items-center gap-1 text-sm text-muted"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        {page === "menu" ? "Map" : "Settings"}
      </button>
      <p className="mt-2 text-xs tracking-widest text-faint uppercase">{nativeApp ? "Android app" : "Field atlas"}</p>
      <h1 className="font-serif text-4xl leading-none">
        {page === "account" ? "Account" : page === "tracking" ? "Tracking" : page === "map" ? "Map" : page === "photos" ? "Photos" : page === "atlas" ? "Atlas" : "Settings"}
      </h1>

      {page === "menu" ? (
        <nav className="mt-8 grid gap-2">
          {(
            [
              ["account", "Account", "Sync and profile"],
              ["tracking", "Tracking", "Travel tracking, ghost trail, your marker, and fast add"],
              ["map", "Map", "Markers, borders, and overlays"],
              ["photos", "Photos", "Camera roll and the map"],
              ["atlas", "Atlas", nativeApp ? "The tour" : "Offline atlas and the tour"],
            ] as const
          ).map(([id, label, detail]) => (
            <button
              key={id}
              type="button"
              onClick={() => onPage(id)}
              className="flex min-h-16 flex-col items-start justify-center rounded-lg border border-line px-3 py-3 text-left"
            >
              <span className="font-serif text-2xl leading-none">{label}</span>
              <span className="mt-1 text-sm text-muted">{detail}</span>
            </button>
          ))}
        </nav>
      ) : null}

      {page === "account" ? (
      <>
      <section className="mt-8">
        <h2 className="font-serif text-2xl">Sync</h2>
        <p className="mt-1 text-sm text-muted">
          Send your places, trips, and notes to your account, then download the atlas again so any new places are on this device.
        </p>
        <button
          type="button"
          disabled={syncing || pack.running}
          onClick={() => {
            setSyncing(true);
            setSyncNote(null);
            void (async () => {
              try {
                await onSync();
              } catch (err) {
                setSyncNote(err instanceof Error ? err.message : "Couldn't sync the account.");
                return;
              } finally {
                setSyncing(false);
              }
              const problem = nativeApp ? null : await pack.refresh();
              setSyncNote(
                nativeApp
                  ? "Synced. Your account is up to date."
                  : problem
                    ? `Account synced. ${problem}`
                    : "Synced. Your account and the atlas are up to date.",
              );
            })();
          }}
          className="mt-3 flex h-12 w-full items-center justify-center rounded-lg border border-ink bg-elevated text-sm disabled:text-faint"
        >
          {syncing ? "Syncing your account…" : pack.running ? `Updating the atlas… ${packPct}%` : "Sync everything"}
        </button>
        {pack.running ? (
          <div className="mt-3">
            <div className="h-2 overflow-hidden rounded-full bg-elevated">
              <div className="h-full bg-accent" style={{ width: `${packPct}%` }} />
            </div>
            <p className="mt-1 text-xs text-faint">
              {pack.done.toLocaleString()} of {pack.total.toLocaleString()} lists
            </p>
          </div>
        ) : null}
        {syncNote ? <p className="mt-2 text-sm text-muted">{syncNote}</p> : null}
      </section>

      <section className="mt-8">
        <h2 className="font-serif text-2xl">Profile</h2>
        <p className="mt-1 text-sm text-muted">This name and photo show on your atlas. They're saved on this device and sync to your account when you're online.</p>
        <div className="mt-4 flex items-center gap-3">
          {photo ? (
            <img src={photo} alt="" className="size-16 rounded-full object-cover" />
          ) : (
            <span className="grid size-16 place-items-center rounded-full bg-elevated font-serif text-2xl">
              {(name || "?").charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <label className="flex h-11 cursor-pointer items-center rounded-lg border border-line px-3 text-sm">
              Choose photo
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  shrinkPhoto(file).then(setPhoto).catch((err: unknown) => {
                    setNote(err instanceof Error ? err.message : "Couldn't use that photo");
                  });
                }}
              />
            </label>
            {photo ? (
              <button type="button" onClick={() => setPhoto("")} className="mt-1 text-xs text-faint">
                Remove photo
              </button>
            ) : null}
          </div>
        </div>
        <label className="mt-4 block text-xs text-muted">
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value.slice(0, 40))}
            className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-base text-ink outline-none"
          />
        </label>
        {email ? <p className="mt-2 text-xs text-faint">{email}</p> : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="mt-3 flex h-11 w-full items-center justify-center rounded-lg border border-line text-sm disabled:text-faint"
        >
          {busy ? "Saving…" : "Save profile"}
        </button>
        {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
        {authEnabled && !hasGateSessionMarker() ? (
          <button
            type="button"
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true);
              // Trails are on the account; take this account's copy off the device first.
              void clearGhostLocal()
                .then(() => signOut())
                .catch(() => setSigningOut(false));
            }}
            className="mt-3 text-sm text-faint underline-offset-4 hover:underline disabled:no-underline"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        ) : null}
      </section>
      </>
      ) : null}

      {page === "tracking" ? (
      <>
      <section className="mt-8">
        <h2 className="font-serif text-2xl">Travel tracking</h2>
        <p className="mt-1 text-sm text-muted">
          {nativeApp
            ? "When this is on, a town or city you pass through, an Indian reservation you cross, the county you are in, a road you are driving, or a site within a quarter mile is added for you. It keeps going with the screen off. Turning it on asks Android to allow location all the time."
            : "When this is on, a town or city you pass through, an Indian reservation you cross, the county you are in, a road you are driving, or a site within a quarter mile is added for you. The open app can do that now. Background tracking, with the screen off, needs the installed phone app."}
        </p>
        <button
          type="button"
          aria-pressed={trackTravel}
          onClick={() => {
            if (trackTravel) {
              setTrackNote(null);
              setTrackTravel(false);
              return;
            }
            if (!nativeApp) {
              setTrackTravel(true);
              return;
            }
            void requestTrackingPermission().then(async (result) => {
              if (result === "denied") {
                setTrackNote("Android didn't allow location. Allow it all the time for The American Atlas, then turn tracking on again.");
                const { BackgroundGeolocation } = await import("@capgo/background-geolocation");
                await BackgroundGeolocation.openSettings().catch(() => {});
                return;
              }
              if (result !== "always") {
                setTrackNote("To keep tracking with the screen off, choose Allow all the time.");
                const { BackgroundGeolocation } = await import("@capgo/background-geolocation");
                await BackgroundGeolocation.openSettings().catch(() => {});
              } else {
                setTrackNote(null);
              }
              setTrackTravel(true);
            });
          }}
          className={"mt-3 h-12 w-full rounded-lg border text-sm " + (trackTravel ? "border-ink bg-elevated" : "border-line")}
        >
          {trackTravel ? "Tracking on" : "Tracking off"}
        </button>
        <p className="mt-2 text-xs text-faint">Only on this device. Signing in somewhere else doesn't turn it on there.</p>
        {trackNote ? <p className="mt-2 text-sm text-muted">{trackNote}</p> : null}
      </section>

      <section className="mt-8">
        <h2 className="font-serif text-2xl">Ghost trail</h2>
        <p className="mt-1 text-sm text-muted">
          While tracking, a wispy path stays behind you, then fades. Pick how many hours of it to show, up to 24, and a color. The color stays faint. The Ghost trail button on the map is where you save one for good; saved trails stay on your account and show up on all your devices.
        </p>
        <GhostHours hours={ghostHours} onChange={setGhostHours} />
        <GhostColors color={ghostColor} onChange={setGhostColor} />
        <button
          type="button"
          aria-pressed={keepGhost}
          onClick={() => {
            const next = !keepGhost;
            setKeepGhost(next);
            if (!next) void clearGhostCache().catch(() => {});
          }}
          className={"mt-3 h-12 w-full rounded-lg border text-sm " + (keepGhost ? "border-ink bg-elevated" : "border-line")}
        >
          {keepGhost ? "Live trail kept on your account" : "Keep the live trail on your account"}
        </button>
        <p className="mt-2 text-sm text-muted">
          Off unless you turn it on. The last 24 hours of the fading trail stays with your account, so a reinstall can pick it up. Saved trails are separate and always stay.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="font-serif text-2xl">Your location</h2>
        <p className="mt-1 text-sm text-muted">
          The marker that follows you while tracking is on. Pick a color, then a picture. It is saved to your account.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <YouMarkerFace icon={markerIcon} color={markerColor} size={64} />
          <p className="text-sm text-muted">
            Now: {markerLabel(markerIcon)}
          </p>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {MARKER_COLORS.map((color) => (
            <button
              key={color.id}
              type="button"
              aria-pressed={markerColor.toLowerCase() === color.id}
              onClick={() => {
                setMarkerColor(color.id);
                if (isMarkerIcon(markerIcon)) void commitMarker(markerIcon, color.id);
              }}
              className={
                "flex h-12 items-center justify-center gap-2 rounded-lg border text-sm " +
                (markerColor.toLowerCase() === color.id ? "border-ink bg-elevated" : "border-line")
              }
            >
              <span className="size-3 rounded-full" style={{ background: color.id }} />
              {color.label}
            </button>
          ))}
        </div>
        <div className="mt-3 h-72 overflow-y-auto rounded-lg border border-line p-2">
          <div className="grid grid-cols-3 gap-2">
            {MARKER_ICONS.map((icon) => (
              <button
                key={icon.id}
                type="button"
                aria-pressed={markerIcon === icon.id}
                onClick={() => setPendingIcon(icon.id)}
                className={
                  "flex flex-col items-center rounded-lg border px-1 py-2 " +
                  (markerIcon === icon.id ? "border-ink bg-elevated" : "border-line")
                }
              >
                <YouMarkerFace icon={icon.id} color={markerColor} size={48} />
                <span className="mt-1 text-xs text-muted">{icon.label}</span>
              </button>
            ))}
          </div>
        </div>
        {markerNote ? <p className="mt-2 text-sm text-muted">{markerNote}</p> : null}
      </section>

      <section className="mt-8">
        <h2 className="font-serif text-2xl">Fast add</h2>
        <p className="mt-1 text-sm text-muted">
          Tap a place, road, or county and it is added right away. A note at the top opens the card. Tap the same spot again to open it too.
        </p>
        <button
          type="button"
          aria-pressed={fastAdd}
          onClick={() => setFastAdd(!fastAdd)}
          className={"mt-3 h-12 w-full rounded-lg border text-sm " + (fastAdd ? "border-ink bg-elevated" : "border-line")}
        >
          {fastAdd ? "Fast add on" : "Fast add off"}
        </button>
      </section>
      </>
      ) : null}

      {page === "atlas" ? (
      <>
      {nativeApp ? null : (
      <section className="mt-8">
        <h2 className="font-serif text-2xl">Offline atlas</h2>
        <p className="mt-1 text-sm text-muted">
          Save every place, town, and road on this device so the lists still open with no signal. A download runs once, then stays here.
        </p>
        <button
          type="button"
          aria-pressed={pack.ready || pack.running}
          onClick={() => void (pack.ready || pack.running ? pack.clear() : pack.start())}
          className={"mt-3 h-12 w-full rounded-lg border text-sm " + (pack.ready || pack.running ? "border-ink bg-elevated" : "border-line")}
        >
          {pack.running ? `Saving the atlas… ${packPct}%` : pack.ready ? "Offline atlas on" : "Offline atlas off"}
        </button>
        {pack.running || (pack.done > 0 && !pack.ready) ? (
          <div className="mt-3">
            <div className="h-2 overflow-hidden rounded-full bg-elevated">
              <div className="h-full bg-accent" style={{ width: `${packPct}%` }} />
            </div>
            <p className="mt-1 text-xs text-faint">
              {pack.done.toLocaleString()} of {pack.total.toLocaleString()} lists
            </p>
          </div>
        ) : null}
        {pack.error ? <p className="mt-2 text-sm text-accent">{pack.error}</p> : null}
      </section>
      )}

      <section className="mt-8">
        <h2 className="font-serif text-2xl">Tour</h2>
        <p className="mt-1 text-sm text-muted">The first-time walkthrough. Play it again whenever the map starts to feel crowded.</p>
        <button type="button" onClick={onTour} className="mt-3 h-12 w-full rounded-lg border border-line text-sm">
          Replay the tour
        </button>
      </section>
      </>
      ) : null}

      {page === "photos" ? (
        <section className="mt-8">
          <h2 className="font-serif text-2xl">Camera roll</h2>
          <p className="mt-1 text-sm text-muted">
            On the phone, choose the pictures to check. The website can only see the ones you pick. A match needs a location on the photo and a place you have already added.
          </p>
          <div className="mt-3">
            <PhotoFinder marks={marks} tripId={tripId} onSaved={onPhotosSaved} />
          </div>
          <button
            type="button"
            aria-pressed={showPhotos}
            onClick={() => setShowPhotos(!showPhotos)}
            className={"mt-6 h-12 w-full rounded-lg border text-sm " + (showPhotos ? "border-ink bg-elevated" : "border-line")}
          >
            {showPhotos ? "Photos on the map" : "Photos hidden on the map"}
          </button>
        </section>
      ) : null}

      {page === "map" ? (
      <>
      <p className="mt-3 text-sm text-muted">These stay with your account, including county colors, so a new install picks them up.</p>
      <section className="mt-8">
        <h2 className="font-serif text-2xl">Map markers</h2>
        <p className="mt-1 text-sm text-muted">Icons use the same colors as the place types. Dots are the plain circles.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            aria-pressed={icons}
            onClick={() => setIcons(true)}
            className={"h-12 rounded-lg border text-sm " + (icons ? "border-ink bg-elevated" : "border-line")}
          >
            Icons
          </button>
          <button
            type="button"
            aria-pressed={!icons}
            onClick={() => setIcons(false)}
            className={"h-12 rounded-lg border text-sm " + (!icons ? "border-ink bg-elevated" : "border-line")}
          >
            Dots
          </button>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-serif text-2xl">States you've been to</h2>
        <p className="mt-1 text-sm text-muted">The outline of a state changes after you add it, or anything in it.</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {BORDER_COLORS.map((color) => (
            <button
              key={color.id}
              type="button"
              aria-pressed={stateBorder.toLowerCase() === color.id}
              onClick={() => setStateBorder(color.id)}
              className={
                "flex h-12 items-center justify-center gap-2 rounded-lg border text-sm " +
                (stateBorder.toLowerCase() === color.id ? "border-ink bg-elevated" : "border-line")
              }
            >
              <span className="size-3 rounded-full" style={{ background: color.id }} />
              {color.label}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-serif text-2xl">Counties you've been to</h2>
        <p className="mt-1 text-sm text-muted">The fill on a county after you add it. Outlines of the ones you haven't added stay light.</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {BORDER_COLORS.map((color) => (
            <button
              key={color.id}
              type="button"
              aria-pressed={countyColor.toLowerCase() === color.id}
              onClick={() => setCountyColor(color.id)}
              className={
                "flex h-12 items-center justify-center gap-2 rounded-lg border text-sm " +
                (countyColor.toLowerCase() === color.id ? "border-ink bg-elevated" : "border-line")
              }
            >
              <span className="size-3 rounded-full" style={{ background: color.id }} />
              {color.label}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-serif text-2xl">Parks</h2>
        <p className="mt-1 text-sm text-muted">
          Deeper green is a national park. Lighter green is a state park. Tap either shape to open it, the same as its pin.
        </p>
        <button
          type="button"
          aria-pressed={showParks}
          onClick={() => setShowParks(!showParks)}
          className={"mt-3 h-12 w-full rounded-lg border text-sm " + (showParks ? "border-ink bg-elevated" : "border-line")}
        >
          {showParks ? "Parks on" : "Parks off"}
        </button>
      </section>

      <section className="mt-8">
        <h2 className="font-serif text-2xl">Cities and towns</h2>
        <p className="mt-1 text-sm text-muted">A faint wash over city and town boundaries. Tapping it does nothing.</p>
        <button
          type="button"
          aria-pressed={showTowns}
          onClick={() => setShowTowns(!showTowns)}
          className={"mt-3 h-12 w-full rounded-lg border text-sm " + (showTowns ? "border-ink bg-elevated" : "border-line")}
        >
          {showTowns ? "Towns on" : "Towns off"}
        </button>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {BORDER_COLORS.map((color) => (
            <button
              key={color.id}
              type="button"
              aria-pressed={townColor.toLowerCase() === color.id}
              onClick={() => setTownColor(color.id)}
              className={
                "flex h-12 items-center justify-center gap-2 rounded-lg border text-sm " +
                (townColor.toLowerCase() === color.id ? "border-ink bg-elevated" : "border-line")
              }
            >
              <span className="size-3 rounded-full" style={{ background: color.id }} />
              {color.label}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-serif text-2xl">Reservations</h2>
        <p className="mt-1 text-sm text-muted">
          A wash over Indian reservation boundaries. Tap one to add it, the same as a park. Driving through one adds it while tracking is on. Each reservation has its own points.
        </p>
        <button
          type="button"
          aria-pressed={showReservations}
          onClick={() => setShowReservations(!showReservations)}
          className={"mt-3 h-12 w-full rounded-lg border text-sm " + (showReservations ? "border-ink bg-elevated" : "border-line")}
        >
          {showReservations ? "Reservations on" : "Reservations off"}
        </button>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {BORDER_COLORS.map((color) => (
            <button
              key={color.id}
              type="button"
              aria-pressed={reservationColor.toLowerCase() === color.id}
              onClick={() => setReservationColor(color.id)}
              className={
                "flex h-12 items-center justify-center gap-2 rounded-lg border text-sm " +
                (reservationColor.toLowerCase() === color.id ? "border-ink bg-elevated" : "border-line")
              }
            >
              <span className="size-3 rounded-full" style={{ background: color.id }} />
              {color.label}
            </button>
          ))}
        </div>
      </section>
      </>
      ) : null}
      {pendingIcon ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="marker-confirm-title"
        >
          <div className="w-full max-w-xs rounded-xl border border-line bg-bg p-5 text-center">
            <div className="flex justify-center">
              <YouMarkerFace icon={pendingIcon} color={markerColor} size={112} />
            </div>
            <h2 id="marker-confirm-title" className="mt-3 font-serif text-3xl">
              Use this marker?
            </h2>
            <p className="mt-1 text-sm text-muted">{markerLabel(pendingIcon)}</p>
            <button
              type="button"
              onClick={() => void commitMarker(pendingIcon, markerColor)}
              className="mt-4 h-12 w-full rounded-lg border border-ink bg-elevated text-sm"
            >
              Yes, that's the one
            </button>
            <button
              type="button"
              onClick={() => setPendingIcon(null)}
              className="mt-2 h-12 w-full rounded-lg border border-line text-sm"
            >
              Pick a different one
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function shrinkPhoto(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that photo"));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 480 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const g = canvas.getContext("2d");
        if (!g) {
          reject(new Error("Couldn't read that photo"));
          return;
        }
        g.drawImage(img, 0, 0, canvas.width, canvas.height);
        const url = canvas.toDataURL("image/jpeg", 0.72);
        if (url.length > 140000) reject(new Error("Use a smaller photo"));
        else resolve(url);
      };
      img.onerror = () => reject(new Error("Couldn't read that photo"));
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
