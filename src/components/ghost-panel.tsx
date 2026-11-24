import { useEffect, useState } from "react";
import { GHOST_COLORS, useSettings } from "@/lib/atlas-settings";
import { requestTrackingPermission } from "@/lib/background-location";
import { nativeApp } from "@/lib/native";
import { askBatteryUnrestricted, batteryUnrestricted } from "@/lib/power";
import { formatMiles, freshPoints, suggestTrailName, trailMiles, useGhost } from "@/lib/ghost-trail";
import { listFriends, type FriendRow } from "@/lib/friends";
import { MAX_LIVE_FRIENDS, useLiveShare } from "@/lib/live-share";

export function GhostColors({ color, onChange }: { color: string; onChange: (color: string) => void }) {
  const label = GHOST_COLORS.find((item) => item.id === color)?.label ?? "Mist";
  return (
    <div className="mt-3">
      <p className="text-sm text-muted">Color · {label}. It stays faint either way.</p>
      <div className="mt-2 grid grid-cols-5 gap-2">
        {GHOST_COLORS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-label={item.label}
            aria-pressed={color === item.id}
            onClick={() => onChange(item.id)}
            className={"flex h-11 items-center justify-center rounded-lg border " + (color === item.id ? "border-ink bg-elevated" : "border-line")}
          >
            <span className="size-3 rounded-full" style={{ background: item.id }} />
          </button>
        ))}
      </div>
    </div>
  );
}

export function GhostHours({ hours, onChange }: { hours: number; onChange: (hours: number) => void }) {
  return (
    <label className="mt-3 block">
      <span className="flex items-baseline justify-between gap-3">
        <span className="font-serif text-4xl leading-none">{hours}</span>
        <span className="text-sm text-muted">{hours === 1 ? "hour on the map" : "hours on the map"}</span>
      </span>
      <input
        type="range"
        min={1}
        max={24}
        step={1}
        value={hours}
        aria-label="Hours the ghost trail stays"
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-3 h-11 w-full accent-ghost"
      />
    </label>
  );
}

export function GhostPanel({
  open,
  hours,
  color,
  tracking,
  onHours,
  onColor,
  onClose,
}: {
  open: boolean;
  hours: number;
  color: string;
  tracking: boolean;
  onHours: (hours: number) => void;
  onColor: (color: string) => void;
  onClose: () => void;
}) {
  const live = useGhost((s) => s.live);
  const saved = useGhost((s) => s.saved);
  const hidden = useGhost((s) => s.hidden);
  const focusId = useGhost((s) => s.focusId);
  const saveLive = useGhost((s) => s.saveLive);
  const removeSaved = useGhost((s) => s.removeSaved);
  const toggleHidden = useGhost((s) => s.toggleHidden);
  const sharedIds = useGhost((s) => s.shared);
  const toggleShared = useGhost((s) => s.toggleShared);
  const lookAt = useGhost((s) => s.lookAt);
  const [now, setNow] = useState(() => Date.now());
  const [asking, setAsking] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [open]);

  if (!open) return null;

  const fresh = freshPoints(live, hours, now);
  const miles = trailMiles(fresh);
  const started = fresh[0]?.t;

  function beginSave() {
    setNote(null);
    setName(suggestTrailName(fresh[0]?.t ?? Date.now()));
    setAsking(true);
  }

  function commitSave() {
    const result = saveLive(name, hours);
    if (result === "short") {
      setNote("Move a little farther. A trail needs more than one point.");
      setAsking(false);
      return;
    }
    if (result === "full") {
      setNote("Thirty trails are saved. Remove one before keeping another.");
      setAsking(false);
      return;
    }
    setAsking(false);
    setNote("Saved on the atlas. It stays after this one fades.");
  }

  return (
    <div
      role="dialog"
      aria-label="Ghost trail"
      className="absolute inset-x-2 bottom-2 z-20 flex max-h-[calc(100%-3.5rem)] flex-col overflow-hidden rounded-card border border-line bg-surface/95 shadow-lg backdrop-blur-md"
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 pt-4 pb-3">
        <div>
          <h2 className="font-serif text-2xl leading-none">Ghost trail</h2>
          <p className="mt-1 text-sm text-muted">A wisp of where you went while tracking.</p>
        </div>
        <button type="button" onClick={onClose} className="h-11 shrink-0 px-2 text-sm text-muted">
          Close
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-4">
        <GhostHours
          hours={hours}
          onChange={(next) => {
            onHours(next);
            setNow(Date.now());
          }}
        />
        <GhostColors color={color} onChange={onColor} />
        <div className="mt-4 rounded-lg border border-line px-3 py-3">
          <div className="flex items-center gap-2">
            <span className={"ghost-dot size-2 rounded-full " + (tracking ? "is-live" : "opacity-50")} style={{ background: color }} />
            <span className="text-xs tracking-widest text-faint uppercase">Right now</span>
          </div>
          {fresh.length >= 2 ? (
            <>
              <p className="mt-2 font-serif text-xl leading-tight">{formatMiles(miles)}</p>
              <p className="mt-1 text-sm text-muted">
                Since {new Date(started ?? now).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                {tracking ? "" : " · Tracking is off, so it isn't growing"}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">
              {tracking
                ? "Keep going. The trail shows up once you've moved a short way."
                : "Turn tracking on and this will follow where you go."}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={fresh.length < 2}
              onClick={() => lookAt("live")}
              className="h-11 flex-1 rounded-lg border border-line text-sm disabled:text-faint"
            >
              Show on map
            </button>
            <button
              type="button"
              disabled={fresh.length < 2}
              onClick={beginSave}
              className="h-11 flex-1 rounded-lg border border-ink bg-elevated text-sm disabled:border-line disabled:text-faint"
            >
              Save on the atlas
            </button>
          </div>
          {asking ? (
            <div className="mt-3 rounded-lg border border-line bg-bg px-3 py-3">
              <p className="text-sm">Keep this trail on the atlas? It stays after the live one fades.</p>
              <label className="mt-2 block text-xs text-muted">
                Name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value.slice(0, 40))}
                  className="mt-1 h-11 w-full rounded-lg border border-line bg-surface px-3 text-base text-ink outline-none"
                />
              </label>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={commitSave} className="h-11 flex-1 rounded-lg border border-ink bg-elevated text-sm">
                  Save it
                </button>
                <button type="button" onClick={() => setAsking(false)} className="h-11 flex-1 rounded-lg border border-line text-sm">
                  Not now
                </button>
              </div>
            </div>
          ) : null}
          {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
        </div>

        <LiveFriends />

        <h3 className="mt-5 font-serif text-xl">Previous trails</h3>
        <p className="mt-1 text-xs text-muted">
          Saved trails are private until you share one. Friends see a shared trail without its first and last half
          kilometer, and only the day it was made.
        </p>
        {saved.length ? (
          <ul className="mt-2 grid gap-2">
            {saved.map((trail) => {
              const off = hidden.includes(trail.id);
              const shared = sharedIds.includes(trail.id);
              const focused = focusId === trail.id;
              return (
                <li key={trail.id} className={"rounded-lg border px-3 py-2 " + (focused ? "border-ink bg-elevated" : "border-line")}>
                  <button
                    type="button"
                    onClick={() => {
                      if (off) toggleHidden(trail.id);
                      lookAt(trail.id);
                    }}
                    className="block w-full text-left"
                  >
                    <span className="block font-serif text-lg leading-tight">{trail.name}</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {formatMiles(trailMiles(trail.points))} ·{" "}
                      {new Date(trail.startedAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </button>
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => toggleHidden(trail.id)} className="h-11 flex-1 rounded-lg border border-line text-xs">
                      {off ? "Show" : "Hide"}
                    </button>
                    <button
                      type="button"
                      aria-pressed={shared}
                      onClick={() => toggleShared(trail.id)}
                      aria-label={shared ? "Shared with friends. Tap to make private" : "Share with friends"}
                      className={"h-11 flex-1 rounded-lg border text-xs " + (shared ? "border-ink bg-elevated text-ink" : "border-line text-muted")}
                    >
                      {shared ? "Shared" : "Share"}
                    </button>
                    {dropId === trail.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            removeSaved(trail.id);
                            setDropId(null);
                          }}
                          className="h-11 flex-1 rounded-lg border border-line text-xs"
                        >
                          Remove
                        </button>
                        <button type="button" onClick={() => setDropId(null)} className="h-11 px-2 text-xs text-faint">
                          Keep
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => setDropId(trail.id)} className="h-11 px-3 text-xs text-faint">
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted">Trails you save stay on the atlas. They don't fade.</p>
        )}
      </div>
    </div>
  );
}

function LiveFriends() {
  const viewers = useLiveShare((s) => s.viewers);
  const tracking = useSettings((s) => s.trackTravel);
  const shareOnly = useSettings((s) => s.shareOnly);
  const setShareOnly = useSettings((s) => s.setShareOnly);
  const [unrestricted, setUnrestricted] = useState(true);
  const live = viewers.length > 0 && (tracking || shareOnly);

  // Re-check the battery setting whenever the app comes back (after Android's prompt).
  useEffect(() => {
    const check = () => void batteryUnrestricted().then(setUnrestricted);
    check();
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, []);

  async function startSharing() {
    setNote(null);
    if (nativeApp) {
      const result = await requestTrackingPermission();
      if (result === "denied") {
        setNote("Allow location all the time, then try again.");
        return;
      }
    }
    setShareOnly(true);
  }
  const load = useLiveShare((s) => s.load);
  const toggle = useLiveShare((s) => s.toggle);
  const [friends, setFriends] = useState<FriendRow[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    void load().catch(() => {});
    listFriends()
      .then((rows) => {
        if (!dead) setFriends(rows);
      })
      .catch(() => {
        if (!dead) setFriends([]);
      });
    return () => {
      dead = true;
    };
  }, [load]);

  async function pick(id: string) {
    setNote(null);
    try {
      await toggle(id);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't update that.");
    }
  }

  return (
    <div className="mt-5">
      <h3 className="font-serif text-xl">Live with friends</h3>
      <p className="mt-1 text-xs text-muted">
        Pick up to {MAX_LIVE_FRIENDS}. They see your marker and trail while tracking is on, or while you share your
        location without tracking. They get a notification when you start. It drops off a few minutes after you stop.
      </p>
      <p className="mt-2 text-sm">
        {live ? (
          <span className="text-ink">● Live now to {viewers.length} {viewers.length === 1 ? "friend" : "friends"}</span>
        ) : (
          <span className="text-muted">
            {viewers.length} of {MAX_LIVE_FRIENDS} picked{viewers.length ? " · not sharing right now" : ""}
          </span>
        )}
      </p>
      {viewers.length && !tracking ? (
        shareOnly ? (
          <button
            type="button"
            onClick={() => setShareOnly(false)}
            className="mt-2 h-11 w-full rounded-lg border border-ink bg-elevated text-sm"
          >
            Stop sharing my location
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void startSharing()}
              className="mt-2 h-11 w-full rounded-lg border border-ink bg-elevated text-sm"
            >
              Share my location without tracking
            </button>
            <p className="mt-1 text-xs text-faint">Only sends where you are. Nothing is added to your atlas.</p>
          </>
        )
      ) : null}
      {live && !unrestricted ? (
        <div className="mt-2 rounded-lg border border-line px-3 py-2">
          <p className="text-xs text-muted">
            Android may pause your location with the screen off, and friends would lose you after a few minutes.
          </p>
          <button
            type="button"
            onClick={() => void askBatteryUnrestricted()}
            className="mt-2 h-11 w-full rounded-lg border border-line text-sm"
          >
            Keep sharing with the screen off
          </button>
        </div>
      ) : null}
      {note ? <p className="mt-1 text-sm text-accent">{note}</p> : null}
      {friends === null ? (
        <p className="mt-2 text-sm text-muted">Loading friends…</p>
      ) : friends.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Add a friend from the Friends tab, then choose them here.</p>
      ) : (
        <ul className="mt-2 grid gap-2">
          {friends.map((friend) => {
            const on = viewers.includes(friend.id);
            const full = !on && viewers.length >= MAX_LIVE_FRIENDS;
            return (
              <li key={friend.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  disabled={full}
                  onClick={() => void pick(friend.id)}
                  className={"flex h-11 w-full items-center justify-between rounded-lg border px-3 text-left text-sm disabled:text-faint " + (on ? "border-ink bg-elevated" : "border-line")}
                >
                  <span>{friend.name}</span>
                  <span className="text-xs text-muted">{on ? "Can watch" : full ? "3 already picked" : "Off"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
