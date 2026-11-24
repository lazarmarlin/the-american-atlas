import { useEffect, useState } from "react";
import { BadgeIcon } from "@/components/badge-icon";
import {
  friendTrail,
  listFriends,
  loadFriend,
  myFriendCode,
  removeFriend,
  resetFriendCode,
  type FriendBadge,
  type FriendPage,
  type FriendRow,
  type FriendTrailInfo,
} from "@/lib/friends";
import { formatMiles, trailLines, type GhostLines } from "@/lib/ghost-trail";
import type { PackedPoint } from "@/lib/ghost-sync";
import { apiOrigin, nativeApp } from "@/lib/native";
import { friendPhotos, loadFriendPhoto, type PhotoInfo } from "@/lib/photos";
import { FriendChat } from "@/components/friend-chat";
import { type LiveFriend } from "@/lib/live-share";
import { friendsLeaderboard, periodRange, type LeaderRow } from "@/lib/recap";

function friendUrl(code: string) {
  const origin = nativeApp && apiOrigin ? apiOrigin : window.location.origin;
  return `${origin}/?friend=${code}`;
}

function unpack(points: PackedPoint[]): GhostLines {
  return trailLines(
    points.map((p) => (p[3] === 1 ? { lat: p[0], lon: p[1], t: p[2], brk: true } : { lat: p[0], lon: p[1], t: p[2] })),
    300,
  );
}

function Face({ name, photo }: { name: string; photo: string }) {
  if (photo) return <img src={photo} alt="" className="size-9 shrink-0 rounded-full object-cover" />;
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-elevated text-sm">
      {(name || "F").charAt(0).toUpperCase()}
    </span>
  );
}

export function FriendsPanel({
  openId,
  note,
  liveNow,
  onOpen,
  onClose,
  onShow,
  onWatch,
  meId,
  places,
  onAddToMap,
}: {
  openId: string | null;
  note: string | null;
  liveNow: LiveFriend[];
  onOpen: (id: string) => void;
  onClose: () => void;
  onShow: (lines: GhostLines) => void;
  onWatch: (friend: { id: string; name: string }) => void;
  meId: string;
  places: { id: string; name: string; state?: string; lat: number | null; lon: number | null }[];
  onAddToMap: (
    photo: { thumb: string; image: string },
    place: { id: string; name: string; state?: string; lat: number | null; lon: number | null },
  ) => Promise<void>;
}) {
  const [friends, setFriends] = useState<FriendRow[] | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [resetAsk, setResetAsk] = useState(false);

  async function resetLink() {
    setResetAsk(false);
    try {
      const row = await resetFriendCode();
      setCode(row.code);
      setLinkNote("New link ready. The old one no longer works.");
    } catch (err) {
      setLinkNote(err instanceof Error ? err.message : "Couldn't make a new link.");
    }
  }
  const [page, setPage] = useState<FriendPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkNote, setLinkNote] = useState<string | null>(null);
  const [drop, setDrop] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const [shots, setShots] = useState<PhotoInfo[]>([]);
  const [bigShot, setBigShot] = useState<{ id: string; image: string | null; thumb: string } | null>(null);
  const [part, setPart] = useState<"chat" | "badges" | "photos" | "trails">("badges");
  const [board, setBoard] = useState<LeaderRow[] | null>(null);
  const month = periodRange("month");

  useEffect(() => {
    let dead = false;
    const { from, to, tz } = periodRange("month");
    friendsLeaderboard({ data: { from, to, tz } })
      .then((rows) => {
        if (!dead) setBoard(rows);
      })
      .catch(() => {
        if (!dead) setBoard([]);
      });
    listFriends()
      .then((rows) => {
        if (!dead) setFriends(rows);
      })
      .catch(() => {
        if (!dead) setError("Couldn't load friends.");
      });
    myFriendCode()
      .then((row) => {
        if (!dead) setCode(row.code);
      })
      .catch(() => {
        if (!dead) setError("Couldn't make a friend link.");
      });
    return () => {
      dead = true;
    };
  }, []);

  useEffect(() => {
    if (!openId) {
      setPage(null);
      setDrop(false);
      setShown(null);
      setShots([]);
      setBigShot(null);
      setPart("badges");
      return;
    }
    let dead = false;
    setPage(null);
    setShots([]);
    setBigShot(null);
    setPart("badges");
    setError(null);
    loadFriend({ data: { id: openId } })
      .then((next) => {
        if (!dead) setPage(next);
      })
      .catch((err) => {
        if (!dead) setError(err instanceof Error ? err.message : "Couldn't open that friend.");
      });
    friendPhotos({ data: { id: openId } })
      .then((rows) => {
        if (!dead) setShots(rows);
      })
      .catch(() => {
        if (!dead) setShots([]);
      });
    return () => {
      dead = true;
    };
  }, [openId]);

  async function sendLink() {
    if (!code) return;
    const url = friendUrl(code);
    setLinkNote(null);
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: "Add me on The American Atlas", text: "Add me as a friend.", url });
        return;
      }
    } catch {
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setLinkNote("Link copied.");
    } catch {
      setLinkNote(url);
    }
  }

  async function copyLink() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(friendUrl(code));
      setLinkNote("Link copied.");
    } catch {
      setLinkNote(friendUrl(code));
    }
  }

  async function showTrail(trail: FriendTrailInfo) {
    if (!openId) return;
    setError(null);
    try {
      const points = await friendTrail({ data: { friendId: openId, id: trail.id } });
      const lines = unpack(points);
      if (!lines.length) {
        setError("That trail doesn't have enough of a path to draw.");
        return;
      }
      setShown(trail.id);
      onShow(lines);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't draw that trail.");
    }
  }

  async function dropFriend() {
    if (!page) return;
    try {
      await removeFriend({ data: page.id });
      setFriends((rows) => rows?.filter((row) => row.id !== page.id) ?? rows);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove them.");
    }
  }

  if (openId) {
    return (
      <div className="px-2 pb-4">
        <button type="button" onClick={onClose} className="h-11 px-2 text-sm text-muted">
          All friends
        </button>
        {!page ? (
          <p className="px-2 text-sm text-muted">{error ?? "Opening…"}</p>
        ) : (
          <>
            <div className="flex items-center gap-3 px-2">
              <Face name={page.name} photo={page.photo} />
              <div>
                <h2 className="font-serif text-2xl leading-tight">{page.name}</h2>
                <p className="text-sm text-muted">
                  {page.badges.length} {page.badges.length === 1 ? "badge" : "badges"} · {page.trails.length}{" "}
                  {page.trails.length === 1 ? "shared trail" : "shared trails"}
                </p>
              </div>
            </div>
            {error ? <p className="mt-2 px-2 text-sm text-accent">{error}</p> : null}

            {liveNow.some((row) => row.id === page.id) ? (
              <button
                type="button"
                onClick={() => {
                  setShown("live");
                  onWatch({ id: page.id, name: page.name });
                }}
                className={"mt-4 h-11 w-full rounded-lg border text-sm " + (shown === "live" ? "border-ink bg-elevated" : "border-line")}
              >
                {shown === "live" ? "Watching their live trail" : "Watch live trail"}
              </button>
            ) : (
              <p className="mt-4 px-2 text-sm text-muted">They aren't sharing a live trail right now.</p>
            )}

            <div className="mt-4 flex gap-1 px-2">
              {(
                [
                  ["chat", "Chat"],
                  ["badges", "Badges"],
                  ["photos", shots.length ? `Photos · ${shots.length}` : "Photos"],
                  ["trails", "Trails"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setPart(id);
                    setBigShot(null);
                  }}
                  className={"h-11 flex-1 rounded-lg text-sm " + (part === id ? "bg-elevated text-ink" : "text-faint")}
                >
                  {label}
                </button>
              ))}
            </div>

            {part === "chat" && openId ? (
              <FriendChat friendId={openId} meId={meId} places={places} onAddToMap={onAddToMap} />
            ) : null}

            {part === "badges" ? (
              <>
            <h3 className="mt-5 px-2 font-serif text-xl">Badges</h3>
            {page.badges.length ? (
              <ul className="mt-2 grid gap-2">
                {page.badges.map((badge: FriendBadge) => (
                  <li key={badge.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
                    <BadgeIcon group={badge.group} earned />
                    <span>
                      <span className="block text-sm">{badge.name}</span>
                      <span className="block text-xs text-faint">{badge.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 px-2 text-sm text-muted">No badges yet.</p>
            )}
              </>
            ) : null}

            {part === "photos" ? (
              <>
            <h3 className="mt-5 px-2 font-serif text-xl">Photos</h3>
            <p className="mt-1 px-2 text-sm text-muted">Pictures they chose to share. A gold edge on the map is one of theirs.</p>
            {shots.length ? (
              <ul className="mt-2 grid grid-cols-3 gap-2">
                {shots.map((photo) => (
                  <li key={photo.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (!openId) return;
                        setBigShot({ id: photo.id, image: null, thumb: photo.thumb });
                        loadFriendPhoto({ data: { friendId: openId, id: photo.id } })
                          .then((row) => setBigShot((cur) => (cur?.id === photo.id ? { ...cur, image: row.image } : cur)))
                          .catch(() => setBigShot(null));
                      }}
                      className="block w-full"
                    >
                      <img src={photo.thumb} alt={photo.caption || ""} className="aspect-square w-full rounded-md object-cover ring-1 ring-[#e2b15a]" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 px-2 text-sm text-muted">No shared photos.</p>
            )}
            {bigShot ? (
              <button type="button" onClick={() => setBigShot(null)} className="mt-3 block w-full px-2 text-left">
                <img
                  src={bigShot.image ?? bigShot.thumb}
                  alt=""
                  className={"max-h-[60dvh] w-full rounded-lg bg-bg object-contain " + (bigShot.image ? "" : "opacity-60 blur-sm")}
                />
                <span className="mt-1 block text-xs text-faint">Tap to close</span>
              </button>
            ) : null}
              </>
            ) : null}

            {part === "trails" ? (
              <>
            <h3 className="mt-5 px-2 font-serif text-xl">Ghost trails</h3>
            <p className="mt-1 px-2 text-sm text-muted">Saved trails they chose to share. The ends and the times are left off.</p>
            {page.trails.length ? (
              <ul className="mt-2 grid gap-2">
                {page.trails.map((trail) => (
                  <li key={trail.id} className={"rounded-lg border px-3 py-2 " + (shown === trail.id ? "border-ink bg-elevated" : "border-line")}>
                    <p className="font-serif text-lg leading-tight">{trail.name}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {formatMiles(trail.miles)} · {new Date(trail.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                    <button type="button" onClick={() => void showTrail(trail)} className="mt-2 h-11 w-full rounded-lg border border-line text-sm">
                      On the map
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 px-2 text-sm text-muted">Nothing shared yet.</p>
            )}
              </>
            ) : null}

            {drop ? (
              <div className="mt-4 rounded-lg border border-line bg-bg px-3 py-3">
                <p className="text-sm">Remove {page.name}? They won't see your badges or trails either.</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => void dropFriend()} className="h-11 flex-1 rounded-lg border border-ink bg-elevated text-sm">
                    Remove
                  </button>
                  <button type="button" onClick={() => setDrop(false)} className="h-11 flex-1 rounded-lg border border-line text-sm">
                    Keep
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setDrop(true)} className="mt-4 h-11 w-full rounded-lg border border-line text-sm text-muted">
                Remove friend
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="px-2 pb-4">
      <div className="px-2">
        <h2 className="font-serif text-2xl">Friends</h2>
        <p className="mt-1 text-sm text-muted">
          Send a link. Once they open it and sign in, you can both see earned badges and any saved ghost trails you
          choose to share. Live trails are picked in the Ghost trail panel.
        </p>
      </div>
      {note ? <p className="mt-3 px-2 text-sm text-ink">{note}</p> : null}
      {error ? <p className="mt-2 px-2 text-sm text-accent">{error}</p> : null}
      <div className="mt-3 flex gap-2 px-2">
        <button type="button" disabled={!code} onClick={() => void sendLink()} className="h-11 flex-1 rounded-lg border border-ink bg-elevated text-sm disabled:border-line disabled:text-faint">
          Send link
        </button>
        <button type="button" disabled={!code} onClick={() => void copyLink()} className="h-11 flex-1 rounded-lg border border-line text-sm disabled:text-faint">
          Copy link
        </button>
      </div>
      {linkNote ? <p className="mt-2 px-2 text-sm break-all text-muted">{linkNote}</p> : null}
      {resetAsk ? (
        <div className="mx-2 mt-2 rounded-lg border border-line px-3 py-3">
          <p className="text-sm">Make a new link? The old one stops working. Friends you already have stay.</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => void resetLink()} className="h-11 flex-1 rounded-lg border border-ink bg-elevated text-sm">
              New link
            </button>
            <button type="button" onClick={() => setResetAsk(false)} className="h-11 flex-1 rounded-lg border border-line text-sm">
              Keep this one
            </button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={!code} onClick={() => setResetAsk(true)} className="mt-1 h-11 px-2 text-xs text-faint disabled:opacity-50">
          Reset my link
        </button>
      )}

      {friends === null ? (
        <p className="mt-4 px-2 text-sm text-muted">Loading friends…</p>
      ) : friends.length === 0 ? (
        <p className="mt-4 px-2 text-sm text-muted">No friends yet. The link works for anyone with an account.</p>
      ) : (
        <ul className="mt-4 grid gap-2">
          {friends.map((friend) => (
            <li key={friend.id}>
              <button type="button" onClick={() => onOpen(friend.id)} className="flex w-full items-center gap-3 rounded-lg border border-line px-3 py-2 text-left">
                <Face name={friend.name} photo={friend.photo} />
                <span>
                  <span className="block text-sm">{friend.name}</span>
                  <span className="block text-xs text-faint">
                    {liveNow.some((row) => row.id === friend.id) ? "Live trail · " : ""}
                    {friend.trails} {friend.trails === 1 ? "shared trail" : "shared trails"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {friends && friends.length > 0 && board && board.length > 1 ? (
        <div className="mt-6 px-2">
          <h3 className="font-serif text-xl">{month.label}</h3>
          <p className="mt-1 text-xs text-muted">Points and new counties this month.</p>
          <ol className="mt-2 grid gap-1">
            {board.map((row, i) => (
              <li
                key={row.id}
                className={"flex items-center gap-3 rounded-lg border px-3 py-2 " + (row.me ? "border-ink bg-elevated" : "border-line")}
              >
                <span className="w-5 text-right font-serif text-lg text-muted">{i + 1}</span>
                <Face name={row.name} photo={row.photo} />
                <span className="min-w-0 flex-1 truncate text-sm">{row.me ? "You" : row.name}</span>
                <span className="text-right">
                  <span className="block text-sm">{row.points.toLocaleString()} pts</span>
                  <span className="block text-xs text-faint">
                    {row.counties} {row.counties === 1 ? "county" : "counties"}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
