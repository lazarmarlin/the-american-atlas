import { ChevronLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { ChatScreen, Sheet, type ChatPhoto, type ChatPlaceOption } from "@/components/friend-chat";
import { useChat } from "@/lib/chat-store";
import { createGroup, leaveGroup, listGroups, type ChatGroup } from "@/lib/chat-groups";
import { sendToThread, type ChatPlace, type Thread } from "@/lib/messages";
import { sharedTrip, type SharedTraveler } from "@/lib/trips";
import { reactionsOn, react, recentLikes, type Like } from "@/lib/reactions";
import { pushBack } from "@/lib/sheet-back";
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
  you = null,
  onAddToMap,
  onOpenPlace,
  onOpenHere,
  onShowGroup,
  onShareLive,
  resume = null,
  onResumed,
  watchingLive = null,
  sharedRecording = null,
  onStartShared,
  onEndShared,
  onShowShared,
}: {
  openId: string | null;
  note: string | null;
  liveNow: LiveFriend[];
  onOpen: (id: string) => void;
  onClose: () => void;
  onShow: (lines: GhostLines) => void;
  onWatch: (friend: { id: string; name: string }) => void;
  meId: string;
  places: ChatPlaceOption[];
  you?: { lat: number; lon: number; t?: number } | null;
  onAddToMap: (photo: ChatPhoto, place: ChatPlaceOption) => Promise<void>;
  /** Show a place from a chat; `from` is the chat to come back to. */
  onOpenPlace: (place: ChatPlace, from?: Thread) => void;
  onOpenHere?: (lat: number, lon: number) => void;
  /** The friend whose live trail is on the map. */
  watchingLive?: string | null;
  /** A chat to reopen (coming back from a place shown on the map). */
  resume?: Thread | null;
  onResumed?: () => void;
  /** Fit the map to these friends' live dots; returns how many are sharing. */
  onShowGroup: (memberIds: string[]) => number;
  /** Share your live location with these friends; returns a note to show. */
  onShareLive: (memberIds: string[]) => Promise<string>;
  /** The trip chat your recording trip is shared in, if any. */
  sharedRecording?: string | null;
  /** Start (or join) the shared trip of a trip chat. */
  onStartShared?: (groupId: string, name: string) => Promise<void>;
  onEndShared?: () => void;
  /** Draw everyone's routes on the shared trip; returns how many travelers there are. */
  onShowShared?: (groupId: string, name: string, travelers: SharedTraveler[]) => number;
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
  const [part, setPart] = useState<"badges" | "photos" | "trails">("badges");
  const [chatOpen, setChatOpen] = useState(false);
  const unread = useChat((state) => state.summary);
  const [groups, setGroups] = useState<ChatGroup[] | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupPick, setGroupPick] = useState<string[]>([]);
  const [groupNote, setGroupNote] = useState<string | null>(null);
  const [travelers, setTravelers] = useState<SharedTraveler[]>([]);
  async function loadTravelers(id: string) {
    try {
      setTravelers(await sharedTrip({ data: id }));
    } catch {
      setTravelers([]);
    }
  }
  useEffect(() => {
    setTravelers([]);
    if (groupId) void loadTravelers(groupId);
  }, [groupId]);
  const [leaving, setLeaving] = useState(false);
  const [likes, setLikes] = useState<Like[] | null>(null);
  const [likesOpen, setLikesOpen] = useState(false);
  const [thumbs, setThumbs] = useState<Map<string, { count: number; mine: boolean }>>(new Map());
  const openGroup = groups?.find((g) => g.id === groupId) ?? null;

  function loadGroups() {
    listGroups()
      .then(setGroups)
      .catch(() => setGroups([]));
  }
  useEffect(loadGroups, []);
  // Back closes an open group chat (and the new-chat form).
  useEffect(() => {
    if (!groupId && !making) return;
    return pushBack(() => {
      if (making) setMaking(false);
      else setGroupId(null);
      setLeaving(false);
      setGroupNote(null);
      return true;
    });
  }, [groupId, making]);

  async function makeGroup() {
    setGroupNote(null);
    try {
      const { id } = await createGroup({ data: { name: groupName, members: groupPick } });
      setMaking(false);
      setGroupName("");
      setGroupPick([]);
      const rows = await listGroups();
      setGroups(rows);
      setGroupId(id);
    } catch (err) {
      setGroupNote(err instanceof Error ? err.message : "Couldn't make that chat.");
    }
  }

  async function leave(id: string) {
    try {
      await leaveGroup({ data: { id } });
      setGroupId(null);
      setLeaving(false);
      loadGroups();
    } catch (err) {
      setGroupNote(err instanceof Error ? err.message : "Couldn't leave.");
    }
  }

  async function thumb(ownerId: string, target: string) {
    const cur = thumbs.get(target) ?? { count: 0, mine: false };
    const next = { count: cur.count + (cur.mine ? -1 : 1), mine: !cur.mine };
    setThumbs((m) => new Map(m).set(target, next));
    try {
      await react({ data: { ownerId, target, on: next.mine } });
    } catch {
      setThumbs((m) => new Map(m).set(target, cur));
    }
  }

  /** How many at the top of the list are new (they were unread when the Friends tab opened). */
  const [newLikes, setNewLikes] = useState(0);
  // New thumbs-up: opening the Friends tab shows them straight away, which
  // also counts as seen, so the count clears without another tap.
  const likesWaiting = unread.likes;
  useEffect(() => {
    if (!likesWaiting || likesOpen) return;
    setNewLikes(likesWaiting);
    setLikesOpen(true);
    recentLikes()
      .then((rows) => {
        setLikes(rows);
        void useChat.getState().refresh();
      })
      .catch(() => setLikes([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [likesWaiting]);

  function showLikes() {
    if (likesOpen) setNewLikes(0);
    setLikesOpen((open) => !open);
    recentLikes()
      .then((rows) => {
        setLikes(rows);
        void useChat.getState().refresh();
      })
      .catch(() => setLikes([]));
  }
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
      setChatOpen(false);
      return;
    }
    let dead = false;
    setPage(null);
    setShots([]);
    setBigShot(null);
    setPart("badges");
    // Something new from them: straight into the conversation.
    setChatOpen(!!useChat.getState().summary.friends[openId]);
    setError(null);
    setThumbs(new Map());
    reactionsOn({ data: { ownerId: openId } })
      .then((rows) => {
        if (!dead) setThumbs(new Map(rows.map((row) => [row.target, { count: row.count, mine: row.mine }])));
      })
      .catch(() => {});
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
  // Back from a place someone sent: straight back into that conversation.
  useEffect(() => {
    if (!resume) return;
    if (resume.kind === "group") setGroupId(resume.id);
    else if (resume.id === openId) setChatOpen(true);
    onResumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume, openId]);

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
        <button type="button" onClick={onClose} className="-ml-1 flex h-11 items-center gap-0.5 rounded-full pr-3 pl-1 text-sm text-muted active:bg-elevated">
          <ChevronLeft className="size-5" aria-hidden />
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
                className={"mt-4 h-11 w-full rounded-lg border text-sm " + (shown === "live" || watchingLive === page.id ? "border-ink bg-elevated" : "border-line")}
              >
                {shown === "live" || watchingLive === page.id ? "Watching their live trail · Show on map" : "Watch live trail"}
              </button>
            ) : (
              <p className="mt-4 px-2 text-sm text-muted">They aren't sharing a live trail right now.</p>
            )}

            <button
              type="button"
              onClick={() => setChatOpen(true)}
              className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-ink bg-elevated text-sm"
            >
              Message {page.name.split(" ")[0]}
              {unread.friends[page.id] ? <Count n={unread.friends[page.id] ?? 0} label="new messages" /> : null}
            </button>

            {page.places ? (
              <CompareCard
                mine={places}
                theirs={page.places}
                name={page.name.split(" ")[0] || "They"}
                onOpen={(place) => onOpenPlace(place, { kind: "friend", id: page.id })}
              />
            ) : null}

            <div className="mt-4 flex gap-1 px-2">
              {(
                [
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

            {chatOpen && openId ? (
              <ChatScreen
                title={page.name}
                subtitle={liveNow.some((row) => row.id === page.id) ? "Sharing a live trail" : undefined}
                onClose={() => setChatOpen(false)}
                thread={{ kind: "friend", id: openId }}
                meId={meId}
                places={places}
                onAddToMap={onAddToMap}
                onOpenPlace={(place) => {
                  setChatOpen(false);
                  onOpenPlace(place, { kind: "friend", id: openId });
                }}
                onOpenTrail={(lines) => {
                  setChatOpen(false);
                  onShow(lines);
                }}
                onOpenHere={onOpenHere}
                you={you}
              />
            ) : null}

            {part === "badges" ? (
              <>
            {page.recent?.length ? (
              <>
                <h3 className="mt-5 px-2 font-serif text-xl">Recent check-ins</h3>
                <ul className="mt-2 grid gap-2">
                  {page.recent.map((visit) => (
                    <li key={visit.target} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{visit.name}</span>
                        <span className="block text-xs text-faint">
                          {visit.state} · {visit.points} pts ·{" "}
                          {new Date(`${visit.visitedOn}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </span>
                      </span>
                      <Thumb state={thumbs.get(visit.target)} onClick={() => void thumb(page.id, visit.target)} />
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <h3 className="mt-5 px-2 font-serif text-xl">Badges</h3>
            {page.badges.length ? (
              <ul className="mt-2 grid gap-2">
                {page.badges.map((badge: FriendBadge) => (
                  <li key={badge.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
                    <BadgeIcon group={badge.group} earned />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm">{badge.name}</span>
                      <span className="block text-xs text-faint">{badge.detail}</span>
                    </span>
                    <Thumb state={thumbs.get(`badge:${badge.id}`)} onClick={() => void thumb(page.id, `badge:${badge.id}`)} />
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
            <p className="mt-1 px-2 text-sm text-muted">Start and end are hidden.</p>
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
              <div className="mt-12 rounded-lg border border-line bg-bg px-3 py-3">
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
              <div className="mt-12 border-t border-line pt-4">
                <button type="button" onClick={() => setDrop(true)} className="h-11 px-2 text-sm text-faint">
                  Remove {page.name.split(" ")[0]} as a friend…
                </button>
              </div>
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
          Send a link to add a friend.
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
          <p className="text-sm">Make a new link? The old one stops working.</p>
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
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{friend.name}</span>
                  <span className="block text-xs text-faint">
                    {liveNow.some((row) => row.id === friend.id) ? "Live trail · " : ""}
                    {friend.trails} {friend.trails === 1 ? "shared trail" : "shared trails"}
                  </span>
                </span>
                {unread.friends[friend.id] ? <Count n={unread.friends[friend.id] ?? 0} label="new messages" /> : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      {friends && friends.length > 0 ? (
        <div className="mt-6 px-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-serif text-xl">Trip chats</h3>
            <button type="button" onClick={() => setMaking(true)} className="h-11 rounded-lg border border-line px-3 text-sm">
              New chat
            </button>
          </div>
          <p className="mt-1 text-xs text-muted">Group chat with everyone's live dots on one map.</p>
          {groups?.length ? (
            <ul className="mt-2 grid gap-2">
              {groups.map((g) => (
                <li key={g.id}>
                  <button type="button" onClick={() => setGroupId(g.id)} className="flex w-full items-center gap-3 rounded-lg border border-line px-3 py-2 text-left">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{g.name}</span>
                      <span className="block truncate text-xs text-faint">{g.members.map((m) => m.name).join(", ")}</span>
                    </span>
                    {unread.groups[g.id] ? <Count n={unread.groups[g.id] ?? 0} label="new messages" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {friends && friends.length > 0 ? (
        <div className="mt-6 px-2">
          <h3 className="font-serif text-xl">Thumbs-up</h3>
          <button type="button" onClick={showLikes} className="mt-2 flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-line px-3 text-sm">
            <span>{likesOpen ? "Hide" : "See who gave you a thumbs-up"}</span>
            {unread.likes ? <Count n={unread.likes} label="new" /> : null}
          </button>
          {likesOpen ? (
            likes === null ? (
              <p className="mt-2 text-sm text-muted">Loading…</p>
            ) : likes.length ? (
              <ul className="mt-2 grid gap-1">
                {likes.map((like, i) => (
                  <li
                    key={`${like.fromId}:${like.target}`}
                    className={"flex items-center gap-2 rounded-lg border px-3 py-2 text-sm " + (i < newLikes ? "border-accent/60 bg-accent/10" : "border-line")}
                  >
                    <span className="min-w-0 flex-1">
                      👍 <span className="text-ink">{like.from}</span> <span className="text-muted">liked {like.label}</span>
                    </span>
                    {i < newLikes ? <span className="shrink-0 text-[10px] font-semibold tracking-wider text-accent uppercase">New</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">None yet.</p>
            )
          ) : null}
        </div>
      ) : null}

      {openGroup ? (
        <ChatScreen
          title={openGroup.name}
          subtitle={openGroup.members.map((m) => m.name).join(", ")}
          note={groupNote ?? sharedNote(travelers, meId)}
          onClose={() => {
            setGroupId(null);
            setGroupNote(null);
          }}
          actions={[
            ...(sharedRecording === openGroup.id
              ? [{ label: "End my part of the shared trip", onClick: () => onEndShared?.() }]
              : [
                  {
                    label: travelers.some((t) => t.recording && t.userId !== meId) ? "Join the shared trip" : "Start a shared trip",
                    onClick: () => {
                      const joining = travelers.some((t) => t.recording && t.userId !== meId);
                      void onStartShared?.(openGroup.id, openGroup.name).then(async () => {
                        if (!joining) {
                          await sendToThread({
                            data: {
                              thread: { kind: "group", id: openGroup.id },
                              id: `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
                              kind: "text",
                              body: "I started a shared trip. Tap ··· and Join the shared trip to add your route and places to it.",
                            },
                          }).catch(() => {});
                        }
                        setGroupNote(joining ? "You're on the shared trip. Places you pass go on it." : "Shared trip started. Places you pass go on it.");
                        void loadTravelers(openGroup.id);
                      });
                    },
                  },
                ]),
            ...(travelers.length
              ? [
                  {
                    label: "See everyone's routes",
                    onClick: async () => {
                      // Fresh routes: they keep coming in while people drive.
                      const latest = await sharedTrip({ data: openGroup.id }).catch(() => travelers);
                      setTravelers(latest);
                      if (onShowShared?.(openGroup.id, openGroup.name, latest)) {
                        setGroupId(null);
                        setGroupNote(null);
                      } else setGroupNote("No routes yet. They show up once someone on the trip has driven a bit.");
                    },
                  },
                ]
              : []),
            {
              label: "Everyone on the map",
              onClick: () => {
                const others = openGroup.members.filter((m) => m.id !== meId).map((m) => m.id);
                if (onShowGroup(others)) {
                  setGroupId(null);
                  setGroupNote(null);
                } else setGroupNote("Nobody in this chat is sharing a live location with you right now.");
              },
            },
            {
              label: "Share my location with the group",
              onClick: () => void onShareLive(openGroup.members.filter((m) => m.id !== meId).map((m) => m.id)).then(setGroupNote),
            },
            { label: "Leave this chat", danger: true, onClick: () => setLeaving(true) },
          ]}
          thread={{ kind: "group", id: openGroup.id }}
          meId={meId}
          places={places}
          onAddToMap={onAddToMap}
          onOpenPlace={(place) => {
            const from = { kind: "group" as const, id: openGroup.id };
            setGroupId(null);
            onOpenPlace(place, from);
          }}
          onOpenTrail={(lines) => {
            setGroupId(null);
            onShow(lines);
          }}
          onOpenHere={onOpenHere}
          you={you}
        />
      ) : null}
      {openGroup && leaving ? (
        <Sheet label={`Leave ${openGroup.name}?`} onClose={() => setLeaving(false)}>
          <p className="text-sm text-muted">You won't see its messages any more.</p>
          <button type="button" onClick={() => void leave(openGroup.id)} className="mt-3 h-11 w-full rounded-lg border border-ink bg-elevated text-sm text-accent">
            Leave
          </button>
        </Sheet>
      ) : null}

      {making ? (
        <Sheet label="New trip chat" onClose={() => setMaking(false)}>
          <input
            autoFocus
            value={groupName}
            onChange={(event) => setGroupName(event.target.value.slice(0, 60))}
            placeholder="Name it (Route 66 trip)"
            className="h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-ink outline-none"
          />
          <ul className="mt-2 grid max-h-56 gap-1 overflow-y-auto">
            {(friends ?? []).map((friend) => {
              const on = groupPick.includes(friend.id);
              return (
                <li key={friend.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => setGroupPick((cur) => (on ? cur.filter((id) => id !== friend.id) : [...cur, friend.id]))}
                    className={"flex h-11 w-full items-center gap-3 rounded-lg border px-3 text-sm " + (on ? "border-ink bg-elevated" : "border-line")}
                  >
                    <span className={"grid size-5 place-items-center rounded border text-xs " + (on ? "border-ink" : "border-line")}>{on ? "✓" : ""}</span>
                    <span className="truncate">{friend.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {groupNote ? <p className="mt-2 text-sm text-accent">{groupNote}</p> : null}
          <button
            type="button"
            disabled={!groupName.trim() || !groupPick.length}
            onClick={() => void makeGroup()}
            className="mt-2 h-11 w-full rounded-lg border border-ink bg-elevated text-sm disabled:border-line disabled:text-faint"
          >
            Start chat
          </button>
        </Sheet>
      ) : null}

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

function Count({ n, label }: { n: number; label: string }) {
  return (
    <span aria-label={`${n} ${label}`} className="grid h-6 min-w-6 shrink-0 place-items-center rounded-full bg-accent px-1.5 text-xs font-medium text-accent-ink">
      {n > 99 ? "99+" : n}
    </span>
  );
}

function Thumb({ state, onClick }: { state?: { count: number; mine: boolean }; onClick: () => void }) {
  const mine = state?.mine ?? false;
  return (
    <button
      type="button"
      aria-pressed={mine}
      aria-label={mine ? "Take back your thumbs-up" : "Thumbs-up"}
      onClick={onClick}
      className={"flex h-11 shrink-0 items-center gap-1 rounded-lg border px-3 text-sm " + (mine ? "border-ink bg-elevated" : "border-line text-muted")}
    >
      👍{state?.count ? <span className="text-xs">{state.count}</span> : null}
    </button>
  );
}

/** A line about a trip chat's shared trip, or nothing if there isn't one. */
function sharedNote(travelers: SharedTraveler[], meId: string) {
  if (!travelers.length) return null;
  const going = travelers.filter((t) => t.recording);
  const names = going.map((t) => (t.userId === meId ? "you" : t.name.split(" ")[0]));
  const stops = new Set(travelers.flatMap((t) => t.stops)).size;
  return going.length
    ? `Shared trip: ${names.join(", ")} ${going.length === 1 && names[0] !== "you" ? "is" : "are"} on it · ${stops} ${stops === 1 ? "place" : "places"} so far. ··· to see everyone's routes.`
    : `Shared trip · ${stops} ${stops === 1 ? "place" : "places"}. ··· to see everyone's routes.`;
}

/** You and a friend side by side: places you've both been, and ones only one of you has. */
function CompareCard({
  mine,
  theirs,
  name,
  onOpen,
}: {
  mine: { id: string; name: string; state?: string; category?: string; lat?: number | null; lon?: number | null }[];
  theirs: { id: string; name: string; state: string; category: string; lat?: number | null; lon?: number | null }[];
  name: string;
  onOpen?: (place: ChatPlace) => void;
}) {
  const [list, setList] = useState<"both" | "theirs" | null>(null);
  const { both, onlyMe, onlyThem, sharedStates, sharedCounties } = useMemo(() => {
    const myIds = new Set(mine.map((p) => p.id));
    const theirIds = new Set(theirs.map((p) => p.id));
    const bothRows = theirs.filter((p) => myIds.has(p.id));
    const myStates = new Set(mine.map((p) => p.state ?? "").filter(Boolean));
    return {
      both: bothRows.sort((a, b) => (a.category === "county" ? 0 : 1) - (b.category === "county" ? 0 : 1) || a.state.localeCompare(b.state) || a.name.localeCompare(b.name)),
      onlyMe: mine.filter((p) => !theirIds.has(p.id)).length,
      onlyThem: theirs.filter((p) => !myIds.has(p.id)).sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name)),
      sharedStates: new Set(theirs.map((p) => p.state).filter((s) => s && myStates.has(s))).size,
      sharedCounties: bothRows.filter((p) => p.category === "county").length,
    };
  }, [mine, theirs]);
  const shown = list === "both" ? both : list === "theirs" ? onlyThem : [];
  return (
    <section className="mt-4 rounded-card border border-line bg-surface/60 p-3">
      <p className="font-serif text-lg leading-tight">
        {both.length ? `You've both been to ${both.length.toLocaleString()} ${both.length === 1 ? "place" : "places"}` : `No places in common with ${name} yet`}
      </p>
      {both.length ? (
        <p className="text-xs text-muted">
          {sharedStates} {sharedStates === 1 ? "state" : "states"} in common{sharedCounties ? ` · ${sharedCounties} ${sharedCounties === 1 ? "county" : "counties"}` : ""}
        </p>
      ) : null}
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        {(
          [
            ["both", both.length, "Both"],
            [null, onlyMe, "Only you"],
            ["theirs", onlyThem.length, `Only ${name}`],
          ] as const
        ).map(([id, count, label]) => (
          <button
            key={label}
            type="button"
            disabled={!id || !count}
            onClick={() => setList((cur) => (cur === id ? null : id))}
            aria-pressed={id ? list === id : undefined}
            className={"rounded-lg border px-1 py-2 " + (id && list === id ? "border-ink bg-elevated" : "border-line")}
          >
            <span className="block font-serif text-2xl leading-none">{count.toLocaleString()}</span>
            <span className="mt-1 block truncate text-[11px] text-muted">{label}</span>
          </button>
        ))}
      </div>
      {shown.length ? (
        <ul className="mt-2 max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {shown.slice(0, 200).map((p) => {
            const own = mine.find((item) => item.id === p.id);
            const lat = own?.lat ?? p.lat ?? null;
            const lon = own?.lon ?? p.lon ?? null;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={lat == null || lon == null || !onOpen}
                  onClick={() =>
                    onOpen?.({
                      id: p.id,
                      name: p.name,
                      category: p.category,
                      state: p.state,
                      lat,
                      lon,
                      points: 0,
                      visitedOn: null,
                      visited: true,
                    })
                  }
                  className="flex h-11 w-full items-center gap-2 px-3 text-left text-sm disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {p.category === "county" ? <span className="text-faint">County · </span> : null}
                    {p.name}
                  </span>
                  <span className="shrink-0 text-xs text-faint">{p.state}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
