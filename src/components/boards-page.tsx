/**
 * Boards: make a to-do, a packing list, or a trip plan, and send it to a
 * friend. They check things off, or change the list, if you let them.
 *
 * Each kind has its own look: a to-do keeps what's left on top and folds
 * away what's done, a packing list has quick-add suggestions and an "unpack
 * all" for the next trip, and a trip plan is a numbered route with dates.
 * Changes are merged on the server (src/lib/boards.ts mergeDoc), so two
 * people can work on one board without undoing each other.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Gauge, ListTodo, Luggage, Map as MapIcon, Plus, Receipt, Search, Send, Star, Trash2, Users, Wrench } from "lucide-react";
import {
  BOARD_KINDS,
  createBoard,
  deleteBoard,
  listBoards,
  openBoard,
  saveBoard,
  sendBoardTo,
  type BoardDoc,
  type BoardInfo,
  type BoardItem,
  type BoardKind,
  type BoardOpen,
} from "@/lib/boards";
import { listFriends, type FriendRow } from "@/lib/friends";
import type { Thread } from "@/lib/messages";
import { useBackClose } from "@/lib/sheet-back";

/** Each kind's icon, colour (used small: the icon tile, checks, and the progress bar), and words. */
export const KIND_LOOK: Record<BoardKind, { icon: typeof ListTodo; tint: string; label: string; done: string; doneSection: string; empty: string; add: string }> = {
  todo: { icon: ListTodo, tint: "#8fb47c", label: "To-do", done: "done", doneSection: "Done", empty: "Nothing on the list yet.", add: "Add something to do" },
  pack: { icon: Luggage, tint: "#e0a640", label: "Packing list", done: "packed", doneSection: "In the bag", empty: "Nothing to pack yet.", add: "Add something to pack" },
  trip: { icon: MapIcon, tint: "#e8705f", label: "Trip plan", done: "been", doneSection: "Been", empty: "No stops yet. Add the first one.", add: "Add a stop" },
  wish: { icon: Star, tint: "#c39be6", label: "Wish list", done: "been", doneSection: "Been there", empty: "No places yet. Find one below; it ticks itself off when you get there.", add: "Search for a place" },
  car: { icon: Wrench, tint: "#74aee0", label: "Car care", done: "done", doneSection: "Done", empty: "Nothing to keep track of yet. Pick a few below.", add: "Add a job" },
  split: { icon: Receipt, tint: "#6fc3ad", label: "Split costs", done: "settled", doneSection: "Settled", empty: "No costs yet. Add the first one below.", add: "What was it for?" },
};

const PACK_IDEAS = ["Phone charger", "Car charger", "Toothbrush", "Jacket", "Snacks", "Water bottle", "Sunglasses", "Wallet & ID", "Meds", "Pillow", "Socks", "Swimsuit", "Headphones", "Rain gear", "First aid kit"];

/** The kind's icon on its own soft tile. */
export function BoardKindIcon({ kind, size = "md" }: { kind: BoardKind; size?: "sm" | "md" | "lg" }) {
  const look = KIND_LOOK[kind];
  const Icon = look.icon;
  const box = size === "lg" ? "size-12 rounded-2xl" : size === "sm" ? "size-9 rounded-xl" : "size-11 rounded-xl";
  return (
    <span className={"grid shrink-0 place-items-center " + box} style={{ background: `${look.tint}24`, color: look.tint }}>
      <Icon className={size === "lg" ? "size-6" : size === "sm" ? "size-4" : "size-5"} strokeWidth={1.9} />
    </span>
  );
}

function itemId() {
  return `bi-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function agoText(ms: number) {
  const gap = Date.now() - ms;
  if (gap < 60_000) return "just now";
  if (gap < 3_600_000) return `${Math.floor(gap / 60_000)}m ago`;
  if (gap < 86_400_000) return `${Math.floor(gap / 3_600_000)}h ago`;
  if (gap < 7 * 86_400_000) return `${Math.floor(gap / 86_400_000)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dayLabel(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function dayCount(start: string | null, end: string | null) {
  if (!start || !end) return null;
  const a = Date.parse(`${start}T12:00:00`);
  const b = Date.parse(`${end}T12:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}

function progressWords(kind: BoardKind, done: number, total: number) {
  if (!total) return kind === "trip" ? "No stops yet" : "Empty";
  if (done === total) return kind === "pack" ? "All packed" : kind === "trip" ? "Every stop done" : kind === "wish" ? "Been everywhere on it" : "All done";
  if (kind === "wish") return `${done} of ${total} visited`;
  return kind === "trip" ? `${done} of ${total} stops` : `${done} of ${total} ${KIND_LOOK[kind].done}`;
}

function Bar({ kind, done, total }: { kind: BoardKind; done: number; total: number }) {
  const share = total ? done / total : 0;
  return (
    <span className="block h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
      <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.round(share * 100)}%`, background: KIND_LOOK[kind].tint }} />
    </span>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <p className="text-[11px] tracking-[0.14em] text-faint uppercase">{children}</p>;
}

export function BoardsPage({
  focusId = null,
  thread = null,
  onClose,
  onSent,
}: {
  /** Open this board straight away (from a chat card). */
  focusId?: string | null;
  /** When set, Send puts the board in this chat instead of picking a friend. */
  thread?: Thread | null;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [rows, setRows] = useState<BoardInfo[] | null>(null);
  const [open, setOpen] = useState<BoardOpen | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useBackClose(onClose);

  function refresh() {
    return listBoards()
      .then(setRows)
      .catch((err) => setNote(err instanceof Error ? err.message : "Couldn't open boards."));
  }

  function show(id: string) {
    setNote(null);
    return openBoard({ data: { id } })
      .then(setOpen)
      .catch((err) => setNote(err instanceof Error ? err.message : "Couldn't open that board."));
  }

  useEffect(() => {
    void refresh();
    if (focusId) void show(focusId);
  }, [focusId]);

  async function make(kind: BoardKind) {
    setBusy(true);
    setNote(null);
    try {
      setOpen(await createBoard({ data: { kind } }));
      void refresh();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't make that.");
    } finally {
      setBusy(false);
    }
  }

  const mine = (rows ?? []).filter((row) => row.role === "owner");
  const shared = (rows ?? []).filter((row) => row.role !== "owner");

  return createPortal(
    <div role="dialog" aria-label="Boards" className="screen-top fixed inset-0 z-50 flex flex-col bg-bg">
      <header className="flex shrink-0 items-center gap-1 border-b border-line bg-surface px-2 pb-2">
        <button
          type="button"
          aria-label="Back"
          onClick={() => {
            if (open && !focusId) {
              setOpen(null);
              setNote(null);
              void refresh();
            } else onClose();
          }}
          className="grid h-11 w-11 place-items-center rounded-full text-ink active:bg-elevated"
        >
          <ChevronLeft className="size-6" />
        </button>
        <p className="font-serif text-xl leading-tight">{open ? KIND_LOOK[open.kind].label : "Boards"}</p>
      </header>
      {note ? <p className="shrink-0 border-b border-line px-4 py-2 text-sm text-muted">{note}</p> : null}
      {open ? (
        <BoardEditor
          key={open.id}
          board={open}
          thread={thread}
          onChange={setOpen}
          onNote={setNote}
          onGone={() => {
            setOpen(null);
            void refresh();
            if (focusId) onClose();
          }}
          onSent={() => {
            setNote("Sent.");
            onSent?.();
          }}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-10">
          <Label>Start a board</Label>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {BOARD_KINDS.map((kind) => (
              <button
                key={kind.id}
                type="button"
                disabled={busy}
                onClick={() => void make(kind.id)}
                className="flex flex-col items-start gap-3 rounded-2xl border border-line bg-surface p-3 text-left active:bg-elevated disabled:opacity-60"
              >
                <BoardKindIcon kind={kind.id} />
                <span className="flex w-full items-center justify-between gap-1">
                  <span className="text-[14px] leading-tight">{kind.name}</span>
                  <Plus className="size-4 shrink-0 text-faint" />
                </span>
              </button>
            ))}
          </div>

          {rows === null ? <p className="mt-6 text-sm text-faint">Loading…</p> : null}
          {rows && !rows.length ? (
            <div className="mt-6 rounded-2xl border border-dashed border-line px-4 py-6 text-center">
              <p className="font-serif text-lg">No boards yet</p>
              <p className="mt-1 text-sm text-muted">Start one above, then send it to whoever's coming.</p>
            </div>
          ) : null}
          {mine.length ? <BoardList title="Yours" rows={mine} onOpen={(id) => void show(id)} /> : null}
          {shared.length ? <BoardList title="Shared with you" rows={shared} onOpen={(id) => void show(id)} /> : null}
        </div>
      )}
    </div>,
    document.body,
  );
}

function BoardList({ title, rows, onOpen }: { title: string; rows: BoardInfo[]; onOpen: (id: string) => void }) {
  return (
    <section className="mt-6">
      <Label>{title}</Label>
      <ul className="mt-2 grid gap-2">
        {rows.map((row) => {
          const days = row.kind === "trip" ? dayCount(row.start, row.end) : null;
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onOpen(row.id)}
                className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-3 text-left active:bg-elevated"
              >
                <BoardKindIcon kind={row.kind} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate font-serif text-[17px] leading-tight">{row.title}</span>
                    <span className="shrink-0 text-xs text-faint">{agoText(row.updatedAt)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted">
                    {row.kind === "trip" && row.start ? `${dayLabel(row.start)}${days ? ` · ${days} ${days === 1 ? "day" : "days"}` : ""} · ` : ""}
                    {row.kind === "car"
                      ? row.total
                        ? row.due
                          ? `${row.due} due soon`
                          : `${row.total} ${row.total === 1 ? "job" : "jobs"} · nothing due`
                        : "Nothing tracked yet"
                      : row.kind === "split"
                        ? `${money(row.spent ?? 0)} spent`
                        : progressWords(row.kind, row.done, row.total)}
                    {row.role === "edit" ? " · you can change it" : row.role === "check" ? " · you can check off" : ""}
                  </span>
                  {row.total && row.kind !== "car" && row.kind !== "split" ? (
                    <span className="mt-2 block">
                      <Bar kind={row.kind} done={row.done} total={row.total} />
                    </span>
                  ) : null}
                </span>
                <ChevronRight className="size-4 shrink-0 text-faint" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function BoardEditor({
  board,
  thread,
  onChange,
  onNote,
  onGone,
  onSent,
}: {
  board: BoardOpen;
  thread: Thread | null;
  onChange: (board: BoardOpen) => void;
  onNote: (note: string | null) => void;
  onGone: () => void;
  onSent: () => void;
}) {
  const canEdit = board.role === "owner" || board.role === "edit";
  const look = KIND_LOOK[board.kind];
  const [text, setText] = useState("");
  const [title, setTitle] = useState(board.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  // What the server last said: changes are sent as "from this, to this", so
  // the server can merge them with anyone else's.
  const base = useRef<BoardDoc>(board.doc);
  const pending = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef(board);
  latest.current = board;

  useEffect(() => {
    if (!editingTitle) setTitle(board.title);
  }, [board.title, editingTitle]);

  // Someone else's changes, every few seconds while it's on screen (not while
  // a change of ours is on its way, and not in the background).
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || pending.current) return;
      void openBoard({ data: { id: board.id } })
        .then((next) => {
          if (pending.current || next.id !== latest.current.id) return;
          base.current = next.doc;
          if (next.updatedAt !== latest.current.updatedAt || next.title !== latest.current.title) onChange(next);
        })
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [board.id, onChange]);

  function write(next: BoardOpen) {
    latest.current = next;
    onChange(next);
    pending.current += 1;
    setSaving(true);
    queue.current = queue.current
      .then(async () => {
        // Everything changed here so far, against what the server last said.
        const now = latest.current;
        const saved = await saveBoard({ data: { id: now.id, title: now.title, doc: now.doc, base: base.current } });
        base.current = saved.doc;
        // Only show the server's version once nothing else of ours is on the way.
        if (pending.current === 1) onChange(saved);
      })
      .catch((err) => onNote(err instanceof Error ? err.message : "Couldn't save that."))
      .finally(() => {
        pending.current -= 1;
        if (!pending.current) setSaving(false);
      });
  }

  function setItems(items: BoardItem[]) {
    write({ ...latest.current, doc: { ...latest.current.doc, items } });
  }
  const items = board.doc.items;
  const now = () => latest.current.doc.items;
  const update = (id: string, patch: Partial<BoardItem>) => setItems(now().map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const remove = (id: string) => setItems(now().filter((row) => row.id !== id));
  const move = (id: string, by: -1 | 1) => {
    const list = now().slice();
    const at = list.findIndex((row) => row.id === id);
    const to = at + by;
    if (at < 0 || to < 0 || to >= list.length) return;
    [list[at], list[to]] = [list[to], list[at]];
    setItems(list);
  };
  function add(line: string, extra: Partial<BoardItem> = {}) {
    const clean = line.trim().slice(0, 80);
    if (!clean || !canEdit) return;
    setItems([...now(), { id: itemId(), text: clean, note: "", done: false, ...extra }]);
  }

  const done = items.filter((row) => row.done).length;
  const left = items.filter((row) => !row.done);
  const finished = items.filter((row) => row.done);
  const days = dayCount(board.doc.start, board.doc.end);
  const ideas = useMemo(() => {
    if (board.kind !== "pack") return [];
    const have = new Set(items.map((row) => row.text.toLowerCase()));
    return PACK_IDEAS.filter((idea) => !have.has(idea.toLowerCase())).slice(0, 10);
  }, [board.kind, items]);

  const rowProps = (item: BoardItem, index: number) => ({
    item,
    kind: board.kind,
    index,
    count: items.length,
    canEdit,
    open: expanded === item.id,
    onOpen: () => setExpanded((cur) => (cur === item.id ? null : item.id)),
    onToggle: () => update(item.id, { done: !item.done }),
    onSave: (patch: Partial<BoardItem>) => update(item.id, patch),
    onRemove: () => {
      setExpanded(null);
      remove(item.id);
    },
    onMove: (by: -1 | 1) => move(item.id, by),
  });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-12">
      {/* The board's card: what it is, its name, how far along. */}
      <section className="mx-4 mt-4 rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-start gap-3">
          <BoardKindIcon kind={board.kind} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Label>{look.label}</Label>
              {saving ? <span className="text-[11px] text-faint">Saving…</span> : null}
            </div>
            {canEdit ? (
              <input
                value={title}
                aria-label="Name"
                onFocus={() => setEditingTitle(true)}
                onChange={(event) => setTitle(event.target.value.slice(0, 60))}
                onBlur={() => {
                  setEditingTitle(false);
                  const next = title.trim() || board.title;
                  setTitle(next);
                  if (next !== board.title) write({ ...latest.current, title: next });
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                className="mt-0.5 w-full border-b border-transparent bg-transparent pb-0.5 font-serif text-2xl leading-tight text-ink outline-none focus:border-line"
              />
            ) : (
              <p className="mt-0.5 font-serif text-2xl leading-tight">{board.title}</p>
            )}
          </div>
        </div>
        {board.kind === "trip" ? (
          <TripDates board={board} canEdit={canEdit} days={days} onDates={(doc) => write({ ...latest.current, doc: { ...latest.current.doc, ...doc } })} />
        ) : null}
        {board.kind === "car" ? (
          <Odometer board={board} canEdit={canEdit} onCar={(car) => write({ ...latest.current, doc: { ...latest.current.doc, car } })} />
        ) : board.kind === "split" ? (
          <SplitSummary board={board} canEdit={canEdit} onSettle={(from, to, cents) => add("Paid back", { amount: cents, paidBy: from, among: [to], payment: true })} />
        ) : (
          <>
            <div className="mt-4 flex items-baseline justify-between gap-2 text-sm">
              <span>{progressWords(board.kind, done, items.length)}</span>
              {items.length ? <span className="text-xs text-faint">{Math.round((done / items.length) * 100)}%</span> : null}
            </div>
            <div className="mt-2">
              <Bar kind={board.kind} done={done} total={items.length} />
            </div>
          </>
        )}
        {!canEdit ? <p className="mt-3 text-xs text-faint">You can check things off. The list itself is theirs to change.</p> : null}
      </section>

      {/* The list. */}
      {!items.length ? <p className="mx-4 mt-5 text-sm text-muted">{look.empty}</p> : null}
      {board.kind === "car" ? (
        <CarJobs board={board} canEdit={canEdit} onSave={update} onRemove={remove} />
      ) : board.kind === "split" ? (
        <SplitList board={board} canEdit={canEdit} onSave={update} onRemove={remove} />
      ) : board.kind === "trip" ? (
        <ol className="mx-4 mt-4">
          {items.map((item, index) => (
            <TripStop key={item.id} {...rowProps(item, index)} last={index === items.length - 1} />
          ))}
        </ol>
      ) : (
        <>
          {left.length ? (
            <ul className="mx-4 mt-4 overflow-hidden rounded-2xl border border-line bg-surface">
              {left.map((item) => (
                <ListRow key={item.id} {...rowProps(item, items.indexOf(item))} />
              ))}
            </ul>
          ) : items.length ? (
            <p className="mx-4 mt-5 text-center font-serif text-lg">{board.kind === "pack" ? "Everything's in the bag." : board.kind === "wish" ? "Been everywhere on the list." : "All done. Nice."}</p>
          ) : null}
          {finished.length ? (
            <div className="mx-4 mt-3">
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone} className="flex h-11 min-w-0 flex-1 items-center gap-2 text-left text-sm text-muted">
                  <ChevronDown className={"size-4 transition-transform " + (showDone ? "" : "-rotate-90")} />
                  {look.doneSection} · {finished.length}
                </button>
                {board.kind === "pack" && canEdit ? (
                  <button type="button" onClick={() => setItems(now().map((row) => ({ ...row, done: false })))} className="h-9 shrink-0 rounded-full border border-line px-3 text-xs text-muted">
                    Unpack all
                  </button>
                ) : null}
              </div>
              {showDone ? (
                <ul className="overflow-hidden rounded-2xl border border-line bg-surface/60">
                  {finished.map((item) => (
                    <ListRow key={item.id} {...rowProps(item, items.indexOf(item))} />
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {/* Adding. */}
      {canEdit && board.kind === "wish" ? <WishPicker board={board} onAdd={add} /> : null}
      {canEdit && board.kind === "car" ? <CarAdd board={board} onAdd={add} /> : null}
      {canEdit && board.kind === "split" ? <SplitAdd board={board} onAdd={add} /> : null}
      {canEdit && board.kind !== "wish" && board.kind !== "car" && board.kind !== "split" ? (
        <div className="mx-4 mt-4">
          <form
            className="flex items-center gap-1 rounded-full border border-line bg-surface py-1 pr-1 pl-4 focus-within:border-muted/60"
            onSubmit={(event) => {
              event.preventDefault();
              add(text);
              setText("");
            }}
          >
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={look.add}
              enterKeyHint="done"
              className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-faint"
            />
            <button type="submit" aria-label="Add" disabled={!text.trim()} className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-bg disabled:bg-elevated disabled:text-faint">
              <Plus className="size-5" />
            </button>
          </form>
          {ideas.length ? (
            <div className="mt-3">
              <Label>Quick add</Label>
              <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
                {ideas.map((idea) => (
                  <button key={idea} type="button" onClick={() => add(idea)} className="flex h-9 shrink-0 items-center gap-1 rounded-full border border-line bg-surface px-3 text-sm text-muted active:bg-elevated">
                    <Plus className="size-3.5" />
                    {idea}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {board.role === "owner" ? <ShareCard board={board} thread={thread} onNote={onNote} onSent={onSent} /> : null}

      {board.role === "owner" ? (
        <div className="mx-4 mt-6">
          {confirmDelete ? (
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmDelete(false)} className="h-11 flex-1 rounded-lg border border-line text-sm">
                Keep it
              </button>
              <button
                type="button"
                onClick={() => {
                  void deleteBoard({ data: { id: board.id } })
                    .then(onGone)
                    .catch((err) => onNote(err instanceof Error ? err.message : "Couldn't delete that."));
                }}
                className="h-11 flex-1 rounded-lg border border-accent text-sm text-accent"
              >
                Delete for everyone
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm text-faint">
              <Trash2 className="size-4" />
              Delete this board
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TripDates({ board, canEdit, days, onDates }: { board: BoardOpen; canEdit: boolean; days: number | null; onDates: (doc: Partial<BoardDoc>) => void }) {
  const { start, end } = board.doc;
  if (!canEdit) {
    if (!start && !end) return null;
    return (
      <p className="mt-3 flex items-center gap-2 text-sm text-muted">
        <CalendarDays className="size-4" />
        {[start, end].filter(Boolean).map((day) => dayLabel(day as string)).join(" → ")}
        {days ? ` · ${days} ${days === 1 ? "day" : "days"}` : ""}
      </p>
    );
  }
  const field = (label: string, value: string | null, set: (day: string | null) => void, min?: string | null) => (
    <label className="relative flex min-w-0 flex-1 flex-col rounded-xl border border-line bg-bg/60 px-3 py-2">
      <span className="text-[11px] tracking-[0.14em] text-faint uppercase">{label}</span>
      <span className={"truncate text-sm " + (value ? "" : "text-faint")}>{value ? dayLabel(value) : "Pick a day"}</span>
      <input
        type="date"
        value={value ?? ""}
        min={min ?? undefined}
        onChange={(event) => set(event.target.value || null)}
        className="absolute inset-0 opacity-0"
        aria-label={label}
      />
    </label>
  );
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        {field("Leave", start, (day) => onDates({ start: day, ...(day && end && end < day ? { end: day } : {}) }))}
        <ChevronRight className="size-4 shrink-0 text-faint" />
        {field("Return", end, (day) => onDates({ end: day }), start)}
      </div>
      {days ? <p className="mt-2 text-xs text-faint">{days} {days === 1 ? "day" : "days"}</p> : null}
    </div>
  );
}

type RowProps = {
  item: BoardItem;
  kind: BoardKind;
  index: number;
  count: number;
  canEdit: boolean;
  open: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onSave: (patch: Partial<BoardItem>) => void;
  onRemove: () => void;
  onMove: (by: -1 | 1) => void;
};

function CheckButton({ item, kind, onToggle, children }: { item: BoardItem; kind: BoardKind; onToggle: () => void; children?: ReactNode }) {
  const look = KIND_LOOK[kind];
  return (
    <button
      type="button"
      aria-pressed={item.done}
      aria-label={item.done ? `Not ${look.done}` : `Mark ${look.done}`}
      onClick={onToggle}
      className="grid size-11 shrink-0 place-items-center"
    >
      <span
        className={"grid size-7 place-items-center rounded-full border-2 transition-colors " + (item.done ? "" : "border-line")}
        style={item.done ? { background: look.tint, borderColor: look.tint, color: "#121410" } : undefined}
      >
        {children ?? (item.done ? <Check className="size-4" strokeWidth={3} /> : null)}
      </span>
    </button>
  );
}

/** Opened row: change the words, add a note, move it, or remove it. */
function RowEditor({ item, kind, index, count, onSave, onRemove, onMove }: RowProps) {
  const [text, setText] = useState(item.text);
  const [note, setNote] = useState(item.note);
  const save = () => {
    const clean = text.trim();
    if (clean && (clean !== item.text || note.trim() !== item.note)) onSave({ text: clean.slice(0, 80), note: note.trim().slice(0, 140) });
  };
  return (
    <div className="grid gap-2 px-3 pb-3">
      <input value={text} onChange={(event) => setText(event.target.value)} onBlur={save} aria-label="Name" className="h-11 rounded-lg border border-line bg-bg px-3 text-base outline-none focus:border-muted/60" />
      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onBlur={save}
        placeholder={kind === "trip" ? "A note: time, address, who's driving" : kind === "pack" ? "A note: how many, whose bag" : "A note"}
        aria-label="Note"
        className="h-11 rounded-lg border border-line bg-bg px-3 text-sm outline-none placeholder:text-faint focus:border-muted/60"
      />
      <div className="flex gap-2">
        <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)} className="grid h-10 w-12 place-items-center rounded-lg border border-line text-muted disabled:text-line">
          <ArrowUp className="size-4" />
        </button>
        <button type="button" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(1)} className="grid h-10 w-12 place-items-center rounded-lg border border-line text-muted disabled:text-line">
          <ArrowDown className="size-4" />
        </button>
        <button type="button" onClick={onRemove} className="ml-auto flex h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm text-muted">
          <Trash2 className="size-4" />
          Remove
        </button>
      </div>
    </div>
  );
}

function ListRow(props: RowProps) {
  const { item, kind, canEdit, open, onOpen, onToggle } = props;
  return (
    <li className="border-b border-line last:border-b-0">
      <div className="flex items-center pr-2">
        <CheckButton item={item} kind={kind} onToggle={onToggle} />
        <button type="button" disabled={!canEdit} onClick={onOpen} className="min-w-0 flex-1 py-2.5 text-left">
          <span className={"block text-[15px] leading-snug " + (item.done && kind !== "wish" ? "text-faint line-through" : item.done ? "text-muted" : "")}>{item.text}</span>
          {item.place ? (
            <span className="mt-0.5 block text-xs text-faint">
              {[item.place.state, categoryWord(item.place.category)].filter(Boolean).join(" · ")}
              {item.done && item.doneOn ? ` · been there ${dayLabel(item.doneOn)}` : ""}
            </span>
          ) : null}
          {item.note ? <span className="mt-0.5 block text-xs text-muted">{item.note}</span> : null}
        </button>
        {canEdit ? <ChevronDown className={"size-4 shrink-0 text-faint transition-transform " + (open ? "rotate-180" : "")} aria-hidden="true" /> : null}
      </div>
      {open && canEdit ? <RowEditor {...props} /> : null}
    </li>
  );
}

/** A trip stop: a numbered point on the route, joined to the next one. */
function TripStop(props: RowProps & { last: boolean }) {
  const { item, kind, index, canEdit, open, onOpen, onToggle, last } = props;
  const tint = KIND_LOOK[kind].tint;
  return (
    <li className="relative flex gap-1">
      {!last ? <span className="absolute top-11 bottom-0 left-[21px] w-0.5 rounded-full" style={{ background: item.done ? tint : "var(--color-line)" }} aria-hidden="true" /> : null}
      <CheckButton item={item} kind={kind} onToggle={onToggle}>
        {item.done ? <Check className="size-4" strokeWidth={3} /> : <span className="text-xs text-muted tabular-nums">{index + 1}</span>}
      </CheckButton>
      <div className="mb-3 min-w-0 flex-1 rounded-2xl border border-line bg-surface">
        <button type="button" disabled={!canEdit} onClick={onOpen} className="flex w-full items-center gap-2 px-3 py-3 text-left">
          <span className="min-w-0 flex-1">
            <span className={"block text-[15px] leading-snug " + (item.done ? "text-muted" : "")}>{item.text}</span>
            {item.note ? <span className="mt-0.5 block text-xs text-muted">{item.note}</span> : null}
          </span>
          {canEdit ? <ChevronDown className={"size-4 shrink-0 text-faint transition-transform " + (open ? "rotate-180" : "")} aria-hidden="true" /> : null}
        </button>
        {open && canEdit ? <RowEditor {...props} /> : null}
      </div>
    </li>
  );
}

function ShareCard({ board, thread, onNote, onSent }: { board: BoardOpen; thread: Thread | null; onNote: (note: string | null) => void; onSent: () => void }) {
  const [role, setRole] = useState<"check" | "edit">(board.kind === "split" || board.kind === "wish" ? "edit" : "check");
  const [friends, setFriends] = useState<FriendRow[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());

  async function send(to: Thread, key: string) {
    setSending(key);
    onNote(null);
    try {
      await sendBoardTo({ data: { id: board.id, thread: to, role } });
      setSentTo((cur) => new Set(cur).add(key));
      onSent();
    } catch (err) {
      onNote(err instanceof Error ? err.message : "Couldn't send that.");
    } finally {
      setSending(null);
    }
  }

  return (
    <section className="mx-4 mt-6 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2">
        <Users className="size-4 text-muted" />
        <p className="text-sm">Share this board</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-bg/60 p-1" role="radiogroup" aria-label="What they can do">
        {(
          [
            ["check", "Check off"],
            ["edit", "Change it too"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={role === id}
            onClick={() => setRole(id)}
            className={"h-10 rounded-lg text-sm transition-colors " + (role === id ? "bg-elevated text-ink shadow-sm" : "text-faint")}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-faint">{role === "check" ? "They can tick things off; only you change the list." : "They can add, rename, move and remove things."}</p>
      {thread ? (
        <button
          type="button"
          disabled={!!sending}
          onClick={() => void send(thread, "here")}
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-ink text-sm text-bg disabled:opacity-60"
        >
          <Send className="size-4" />
          {sentTo.has("here") ? "Sent. Send again" : "Send in this chat"}
        </button>
      ) : picking ? (
        <ul className="mt-3 grid gap-1">
          {friends === null ? <li className="text-sm text-faint">Loading friends…</li> : null}
          {(friends ?? []).map((friend) => {
            const sent = sentTo.has(friend.id);
            return (
              <li key={friend.id}>
                <button
                  type="button"
                  disabled={!!sending || sent}
                  onClick={() => void send({ kind: "friend", id: friend.id }, friend.id)}
                  className="flex h-12 w-full items-center gap-3 rounded-xl px-2 text-left active:bg-elevated disabled:opacity-80"
                >
                  {friend.photo ? (
                    <img src={friend.photo} alt="" className="size-9 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-elevated text-sm">{friend.name.slice(0, 1).toUpperCase()}</span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-[15px]">{friend.name}</span>
                  <span className={"rounded-full px-3 py-1 text-xs " + (sent ? "text-muted" : "border border-line")}>{sending === friend.id ? "Sending…" : sent ? "Sent" : "Send"}</span>
                </button>
              </li>
            );
          })}
          {friends && !friends.length ? <li className="text-sm text-muted">No friends yet.</li> : null}
        </ul>
      ) : (
        <button
          type="button"
          onClick={() => {
            setPicking(true);
            void listFriends()
              .then(setFriends)
              .catch((err) => onNote(err instanceof Error ? err.message : "Couldn't load friends."));
          }}
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-ink text-sm text-bg"
        >
          <Send className="size-4" />
          Send to a friend
        </button>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- wish list */

function categoryWord(category: string) {
  return category;
}

/** Find a place in the atlas (state by state) and put it on the list. */
function WishPicker({ board, onAdd }: { board: BoardOpen; onAdd: (line: string, extra: Partial<BoardItem>) => void }) {
  const [states, setStates] = useState<{ abbr: string; name: string }[]>([]);
  const [labels, setLabels] = useState<Map<string, string>>(new Map());
  const [state, setState] = useState<string>("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ place: { id: string; name: string; lat: number | null; lon: number | null; pts: number }; category: string }[]>([]);
  const [looking, setLooking] = useState(false);
  const have = useMemo(() => new Set(board.doc.items.map((item) => item.place?.id).filter(Boolean)), [board.doc.items]);

  useEffect(() => {
    void (async () => {
      const [{ loadMeta }, { lastKnownFix }] = await Promise.all([import("@/lib/atlas-model"), import("@/lib/nearby")]);
      const meta = await loadMeta();
      const sorted = meta.states.map((row) => ({ abbr: row.abbr, name: row.name })).sort((a, b) => a.name.localeCompare(b.name));
      setStates(sorted);
      setLabels(new Map(meta.categories.map((cat) => [cat.id, cat.label])));
      // Start in the state you're in (or the last one on the list).
      const fix = lastKnownFix();
      const here = fix ? meta.states.find((row) => fix.lat >= row.s && fix.lat <= row.n && fix.lon >= row.w && fix.lon <= row.e) : null;
      const lastOnList = [...board.doc.items].reverse().find((item) => item.place?.state)?.place?.state;
      setState((cur) => cur || here?.abbr || lastOnList || sorted[0]?.abbr || "");
    })().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!state || query.trim().length < 2) {
      setHits([]);
      return;
    }
    let live = true;
    setLooking(true);
    const timer = window.setTimeout(() => {
      void import("@/lib/atlas-model")
        .then(({ searchStatePlaces }) => searchStatePlaces(state, query, 25))
        .then((rows) => live && setHits(rows))
        .finally(() => live && setLooking(false));
    }, 200);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [state, query]);

  return (
    <section className="mx-4 mt-4 rounded-2xl border border-line bg-surface p-3">
      <div className="flex items-center gap-2">
        <label className="relative shrink-0">
          <span className="sr-only">State</span>
          <select
            value={state}
            onChange={(event) => setState(event.target.value)}
            className="h-11 appearance-none rounded-full border border-line bg-bg pr-7 pl-3 text-sm text-ink outline-none"
          >
            {states.map((row) => (
              <option key={row.abbr} value={row.abbr}>
                {row.abbr}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-faint" />
        </label>
        <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-bg px-3 focus-within:border-muted/60">
          <Search className="size-4 shrink-0 text-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search for a place"
            enterKeyHint="search"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-faint"
          />
        </div>
      </div>
      {query.trim().length >= 2 ? (
        <ul className="mt-2 max-h-80 overflow-y-auto">
          {hits.map(({ place, category }) => {
            const on = have.has(place.id);
            return (
              <li key={place.id}>
                <button
                  type="button"
                  disabled={on}
                  onClick={() => {
                    onAdd(place.name, { place: { id: place.id, name: place.name, state, lat: place.lat, lon: place.lon, category: labels.get(category) ?? category } });
                    setQuery("");
                  }}
                  className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left active:bg-elevated disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px]">{place.name}</span>
                    <span className="block truncate text-xs text-faint">
                      {labels.get(category) ?? category}
                      {place.pts ? ` · ${place.pts} pts` : ""}
                    </span>
                  </span>
                  <span className={"shrink-0 rounded-full px-3 py-1 text-xs " + (on ? "text-muted" : "border border-line")}>{on ? "On the list" : "Add"}</span>
                </button>
              </li>
            );
          })}
          {!looking && !hits.length ? <li className="px-2 py-3 text-sm text-muted">Nothing by that name in {state}. Try another state.</li> : null}
        </ul>
      ) : (
        <p className="mt-2 px-1 text-xs text-faint">It ticks itself off when you, or anyone on this list, gets there.</p>
      )}
    </section>
  );
}

/* -------------------------------------------------------------- car care */

const CAR_JOBS: { text: string; everyMiles: number | null; everyMonths: number | null }[] = [
  { text: "Oil change", everyMiles: 5000, everyMonths: 6 },
  { text: "Tire rotation", everyMiles: 6000, everyMonths: null },
  { text: "Engine air filter", everyMiles: 15000, everyMonths: 12 },
  { text: "Cabin air filter", everyMiles: 15000, everyMonths: 12 },
  { text: "Wiper blades", everyMiles: null, everyMonths: 12 },
  { text: "Brake check", everyMiles: 12000, everyMonths: 12 },
  { text: "Registration", everyMiles: null, everyMonths: 12 },
  { text: "Inspection", everyMiles: null, everyMonths: 12 },
];

const todayDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function estOdometer(board: BoardOpen) {
  return board.doc.car ? board.doc.car.odometer + (board.milesSince ?? 0) : null;
}

type JobState = { tone: "ok" | "soon" | "over" | "unknown"; line: string; used: number };

/** Where a job stands: by miles (from the odometer) or by time, whichever comes first. */
export function jobState(item: BoardItem, odometer: number | null, now = Date.now()): JobState {
  const milesLeft = item.everyMiles && item.lastMiles != null && odometer != null ? item.lastMiles + item.everyMiles - odometer : null;
  const due = item.everyMonths && item.lastDate ? Date.parse(`${item.lastDate}T12:00:00`) + item.everyMonths * 30.44 * 86_400_000 : null;
  const daysLeft = due != null ? Math.round((due - now) / 86_400_000) : null;
  if (milesLeft == null && daysLeft == null) {
    return { tone: "unknown", line: item.everyMiles || item.everyMonths ? "When was it last done?" : "Set how often", used: 0 };
  }
  const usedMiles = milesLeft != null && item.everyMiles ? 1 - milesLeft / item.everyMiles : 0;
  const usedTime = daysLeft != null && item.everyMonths ? 1 - daysLeft / (item.everyMonths * 30.44) : 0;
  const used = Math.max(0, Math.min(1, Math.max(usedMiles, usedTime)));
  const over = (milesLeft != null && milesLeft <= 0) || (daysLeft != null && daysLeft <= 0);
  if (over) {
    const parts = [milesLeft != null && milesLeft <= 0 ? `${Math.abs(milesLeft).toLocaleString()} mi` : null, daysLeft != null && daysLeft <= 0 ? `${Math.abs(daysLeft)} days` : null].filter(Boolean);
    return { tone: "over", line: `Overdue by ${parts[0]}`, used: 1 };
  }
  const soon = (milesLeft != null && milesLeft <= 300) || (daysLeft != null && daysLeft <= 21);
  const byMiles = milesLeft != null ? `${milesLeft.toLocaleString()} mi` : null;
  const byTime = daysLeft != null ? (daysLeft > 60 ? `${Math.round(daysLeft / 30.44)} months` : `${daysLeft} days`) : null;
  return { tone: soon ? "soon" : "ok", line: `Due in ${[byMiles, byTime].filter(Boolean).join(" or ")}`, used };
}

function everyWords(item: BoardItem) {
  const parts = [item.everyMiles ? `${item.everyMiles.toLocaleString()} mi` : null, item.everyMonths ? `${item.everyMonths} mo` : null].filter(Boolean);
  return parts.length ? `Every ${parts.join(" or ")}` : "";
}

function Odometer({ board, canEdit, onCar }: { board: BoardOpen; canEdit: boolean; onCar: (car: { odometer: number; at: string }) => void }) {
  const est = estOdometer(board);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const due = board.doc.items.filter((item) => {
    const tone = jobState(item, est).tone;
    return tone === "over" || tone === "soon";
  }).length;
  const save = () => {
    const n = Math.round(Number(value.replace(/[^\d.]/g, "")));
    if (!Number.isFinite(n) || n <= 0 || n > 3_000_000) return;
    onCar({ odometer: n, at: todayDay() });
    setEditing(false);
  };
  return (
    <div className="mt-4">
      {editing || (!board.doc.car && canEdit) ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-bg/60 px-3">
            <Gauge className="size-4 shrink-0 text-faint" />
            <input
              inputMode="numeric"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="What's the odometer now?"
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-faint"
            />
            <span className="text-xs text-faint">mi</span>
          </div>
          <button type="submit" className="h-11 shrink-0 rounded-lg bg-ink px-4 text-sm text-bg">
            Save
          </button>
        </form>
      ) : board.doc.car && est != null ? (
        <div className="flex items-center gap-3">
          <Gauge className="size-5 shrink-0 text-muted" />
          <div className="min-w-0 flex-1">
            <p className="text-lg leading-tight tabular-nums">~{est.toLocaleString()} mi</p>
            <p className="text-xs text-faint">
              {board.doc.car.odometer.toLocaleString()} on {dayLabel(board.doc.car.at)}
              {board.milesSince ? ` + ${board.milesSince.toLocaleString()} tracked` : ""}
            </p>
          </div>
          {canEdit ? (
            <button
              type="button"
              onClick={() => {
                setValue(String(est));
                setEditing(true);
              }}
              className="h-9 shrink-0 rounded-full border border-line px-3 text-xs text-muted"
            >
              Update
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted">No odometer reading yet.</p>
      )}
      <p className="mt-3 text-sm">{board.doc.items.length ? (due ? `${due} ${due === 1 ? "job" : "jobs"} due soon` : "Nothing due soon") : "Nothing to track yet"}</p>
    </div>
  );
}

function CarJobs({ board, canEdit, onSave, onRemove }: { board: BoardOpen; canEdit: boolean; onSave: (id: string, patch: Partial<BoardItem>) => void; onRemove: (id: string) => void }) {
  const est = estOdometer(board);
  const [open, setOpen] = useState<string | null>(null);
  const order = { over: 0, soon: 1, unknown: 2, ok: 3 } as const;
  const rows = board.doc.items.map((item) => ({ item, state: jobState(item, est) })).sort((a, b) => order[a.state.tone] - order[b.state.tone]);
  if (!rows.length) return null;
  return (
    <ul className="mx-4 mt-4 grid gap-2">
      {rows.map(({ item, state }) => (
        <li key={item.id} className="rounded-2xl border border-line bg-surface">
          <button type="button" disabled={!canEdit} onClick={() => setOpen((cur) => (cur === item.id ? null : item.id))} className="block w-full px-3 pt-3 text-left">
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-[15px]">{item.text}</span>
              <span className={"flex shrink-0 items-center gap-1.5 text-xs " + (state.tone === "over" || state.tone === "soon" ? "text-ink" : "text-faint")}>
                {state.tone === "over" ? <span className="size-2 rounded-full bg-accent" aria-hidden="true" /> : null}
                {state.line}
              </span>
            </span>
            <span className="mt-0.5 block text-xs text-faint">
              {everyWords(item)}
              {item.lastDate ? ` · last ${dayLabel(item.lastDate)}${item.lastMiles != null ? ` at ${item.lastMiles.toLocaleString()} mi` : ""}` : ""}
            </span>
            <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
              <span
                className="block h-full rounded-full"
                style={{ width: `${Math.round(state.used * 100)}%`, background: state.tone === "over" ? "var(--color-accent)" : KIND_LOOK.car.tint }}
              />
            </span>
          </button>
          <div className="flex items-center gap-2 px-3 pt-2 pb-3">
            {canEdit ? (
              <button
                type="button"
                onClick={() => onSave(item.id, { lastDate: todayDay(), lastMiles: est })}
                className={"h-9 rounded-full px-3 text-xs " + (state.tone === "over" || state.tone === "soon" || state.tone === "unknown" ? "bg-ink text-bg" : "border border-line text-muted")}
              >
                <Check className="mr-1 inline size-3.5" />
                Done today
              </button>
            ) : null}
            {canEdit ? <ChevronDown className={"ml-auto size-4 text-faint transition-transform " + (open === item.id ? "rotate-180" : "")} aria-hidden="true" /> : null}
          </div>
          {open === item.id && canEdit ? <JobEditor item={item} onSave={(patch) => onSave(item.id, patch)} onRemove={() => onRemove(item.id)} /> : null}
        </li>
      ))}
    </ul>
  );
}

function NumberField({ label, value, onCommit, unit }: { label: string; value: number | null | undefined; onCommit: (n: number | null) => void; unit: string }) {
  const [text, setText] = useState(value != null ? String(value) : "");
  return (
    <label className="flex min-w-0 flex-col rounded-xl border border-line bg-bg/60 px-3 py-1.5">
      <span className="text-[11px] tracking-[0.14em] text-faint uppercase">{label}</span>
      <span className="flex items-center gap-1">
        <input
          inputMode="numeric"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => {
            const n = Math.round(Number(text.replace(/[^\d]/g, "")));
            onCommit(text.trim() && Number.isFinite(n) ? n : null);
          }}
          className="h-7 min-w-0 flex-1 bg-transparent text-base outline-none"
        />
        <span className="text-xs text-faint">{unit}</span>
      </span>
    </label>
  );
}

function JobEditor({ item, onSave, onRemove }: { item: BoardItem; onSave: (patch: Partial<BoardItem>) => void; onRemove: () => void }) {
  return (
    <div className="grid gap-2 border-t border-line px-3 pt-3 pb-3">
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Every" value={item.everyMiles} unit="mi" onCommit={(n) => onSave({ everyMiles: n })} />
        <NumberField label="Or every" value={item.everyMonths} unit="months" onCommit={(n) => onSave({ everyMonths: n })} />
        <NumberField label="Last done at" value={item.lastMiles} unit="mi" onCommit={(n) => onSave({ lastMiles: n })} />
        <label className="relative flex min-w-0 flex-col rounded-xl border border-line bg-bg/60 px-3 py-1.5">
          <span className="text-[11px] tracking-[0.14em] text-faint uppercase">Last done on</span>
          <span className={"h-7 truncate text-sm leading-7 " + (item.lastDate ? "" : "text-faint")}>{item.lastDate ? dayLabel(item.lastDate) : "Pick a day"}</span>
          <input type="date" aria-label="Last done on" value={item.lastDate ?? ""} max={todayDay()} onChange={(event) => onSave({ lastDate: event.target.value || null })} className="absolute inset-0 opacity-0" />
        </label>
      </div>
      <button type="button" onClick={onRemove} className="flex h-10 items-center justify-center gap-2 rounded-lg border border-line text-sm text-muted">
        <Trash2 className="size-4" />
        Remove
      </button>
    </div>
  );
}

function CarAdd({ board, onAdd }: { board: BoardOpen; onAdd: (line: string, extra: Partial<BoardItem>) => void }) {
  const [text, setText] = useState("");
  const have = new Set(board.doc.items.map((item) => item.text.toLowerCase()));
  const ideas = CAR_JOBS.filter((job) => !have.has(job.text.toLowerCase()));
  return (
    <div className="mx-4 mt-4">
      <form
        className="flex items-center gap-1 rounded-full border border-line bg-surface py-1 pr-1 pl-4 focus-within:border-muted/60"
        onSubmit={(event) => {
          event.preventDefault();
          onAdd(text, {});
          setText("");
        }}
      >
        <input value={text} onChange={(event) => setText(event.target.value)} placeholder="Add a job" className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-faint" />
        <button type="submit" aria-label="Add" disabled={!text.trim()} className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-bg disabled:bg-elevated disabled:text-faint">
          <Plus className="size-5" />
        </button>
      </form>
      {ideas.length ? (
        <div className="mt-3">
          <Label>Quick add</Label>
          <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
            {ideas.map((job) => (
              <button
                key={job.text}
                type="button"
                onClick={() => onAdd(job.text, { everyMiles: job.everyMiles, everyMonths: job.everyMonths })}
                className="flex h-9 shrink-0 items-center gap-1 rounded-full border border-line bg-surface px-3 text-sm text-muted active:bg-elevated"
              >
                <Plus className="size-3.5" />
                {job.text}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <p className="mt-3 px-1 text-xs text-faint">Miles count from what tracking logs on your phone, so update the odometer now and then.</p>
    </div>
  );
}

/* ----------------------------------------------------------- split costs */

export function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function parseMoney(text: string) {
  const n = Number(text.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

/** Each person's balance in cents: + they're owed, − they owe. */
export function balances(items: BoardItem[], people: string[]) {
  const out = new Map(people.map((id) => [id, 0]));
  for (const item of items) {
    if (!item.amount || !item.paidBy) continue;
    const among = item.among?.length ? item.among : people;
    if (!among.length) continue;
    out.set(item.paidBy, (out.get(item.paidBy) ?? 0) + item.amount);
    const share = Math.floor(item.amount / among.length);
    let extra = item.amount - share * among.length;
    for (const who of among) {
      const part = share + (extra > 0 ? 1 : 0);
      if (extra > 0) extra -= 1;
      out.set(who, (out.get(who) ?? 0) - part);
    }
  }
  return out;
}

/** The fewest payments that settle everyone up. */
export function settleUp(balance: Map<string, number>) {
  const owe = [...balance].filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v })).sort((a, b) => b.v - a.v);
  const owed = [...balance].filter(([, v]) => v > 0).map(([id, v]) => ({ id, v })).sort((a, b) => b.v - a.v);
  const out: { from: string; to: string; cents: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < owe.length && j < owed.length) {
    const cents = Math.min(owe[i].v, owed[j].v);
    if (cents > 0) out.push({ from: owe[i].id, to: owed[j].id, cents });
    owe[i].v -= cents;
    owed[j].v -= cents;
    if (owe[i].v <= 0) i += 1;
    if (owed[j].v <= 0) j += 1;
  }
  return out;
}

function namer(board: BoardOpen) {
  const names = new Map((board.people ?? []).map((person) => [person.id, person.name]));
  return (id: string | null | undefined) => (!id ? "Someone" : id === board.me ? "You" : names.get(id) ?? "Friend");
}

function SplitSummary({ board, canEdit, onSettle }: { board: BoardOpen; canEdit: boolean; onSettle: (from: string, to: string, cents: number) => void }) {
  const people = (board.people ?? []).map((person) => person.id);
  const name = namer(board);
  const spent = board.doc.items.reduce((sum, item) => sum + (item.payment ? 0 : item.amount ?? 0), 0);
  const balance = balances(board.doc.items, people);
  const moves = settleUp(balance);
  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-2xl leading-tight tabular-nums">{money(spent)}</p>
        <p className="text-xs text-faint">
          spent{people.length > 1 ? ` · ${money(Math.round(spent / people.length))} each` : ""}
        </p>
      </div>
      {people.length < 2 ? <p className="mt-2 text-xs text-faint">Send it to whoever's splitting with you, then add costs as they come.</p> : null}
      {people.length > 1 ? (
        <ul className="mt-3 grid gap-1">
          {people.map((id) => {
            const v = balance.get(id) ?? 0;
            return (
              <li key={id} className="flex items-center justify-between text-sm">
                <span>{name(id)}</span>
                <span className={"tabular-nums " + (v > 0 ? "text-ink" : v < 0 ? "text-muted" : "text-faint")}>
                  {v > 0 ? `gets back ${money(v)}` : v < 0 ? `owes ${money(-v)}` : "even"}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {moves.length ? (
        <div className="mt-3 rounded-xl bg-bg/60 p-2">
          <Label>To settle up</Label>
          <ul className="mt-1 grid gap-1">
            {moves.map((move) => (
              <li key={`${move.from}-${move.to}`} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1">
                  {name(move.from)} → {name(move.to)} <span className="tabular-nums">{money(move.cents)}</span>
                </span>
                {canEdit ? (
                  <button type="button" onClick={() => onSettle(move.from, move.to, move.cents)} className="h-9 shrink-0 rounded-full border border-line px-3 text-xs text-muted">
                    Mark paid
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : spent && people.length > 1 ? (
        <p className="mt-3 text-sm text-muted">All square.</p>
      ) : null}
    </div>
  );
}

function SplitList({ board, canEdit, onSave, onRemove }: { board: BoardOpen; canEdit: boolean; onSave: (id: string, patch: Partial<BoardItem>) => void; onRemove: (id: string) => void }) {
  const name = namer(board);
  const people = board.people ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const rows = [...board.doc.items].reverse();
  if (!rows.length) return null;
  return (
    <ul className="mx-4 mt-4 overflow-hidden rounded-2xl border border-line bg-surface">
      {rows.map((item) => {
        const among = item.among?.length ? item.among : people.map((person) => person.id);
        return (
          <li key={item.id} className="border-b border-line last:border-b-0">
            <button type="button" disabled={!canEdit} onClick={() => setOpen((cur) => (cur === item.id ? null : item.id))} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
              <span className="min-w-0 flex-1">
                <span className={"block truncate text-[15px] " + (item.payment ? "text-muted" : "")}>{item.payment ? `${name(item.paidBy)} paid ${name(among[0])} back` : item.text}</span>
                {!item.payment ? (
                  <span className="block truncate text-xs text-faint">
                    {name(item.paidBy)} paid · {among.length === people.length || !item.among?.length ? "split by everyone" : `for ${among.map(name).join(", ")}`}
                  </span>
                ) : null}
                {item.note ? <span className="block truncate text-xs text-muted">{item.note}</span> : null}
              </span>
              <span className={"shrink-0 tabular-nums " + (item.payment ? "text-sm text-muted" : "text-[15px]")}>{money(item.amount ?? 0)}</span>
            </button>
            {open === item.id && canEdit ? (
              <div className="flex gap-2 px-3 pb-3">
                <input
                  defaultValue={item.note}
                  placeholder="A note"
                  onBlur={(event) => event.target.value.trim() !== item.note && onSave(item.id, { note: event.target.value.trim().slice(0, 140) })}
                  className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-sm outline-none placeholder:text-faint"
                />
                <button
                  type="button"
                  onClick={() => {
                    setOpen(null);
                    onRemove(item.id);
                  }}
                  className="flex h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm text-muted"
                >
                  <Trash2 className="size-4" />
                  Remove
                </button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function SplitAdd({ board, onAdd }: { board: BoardOpen; onAdd: (line: string, extra: Partial<BoardItem>) => void }) {
  const people = board.people ?? [];
  const name = namer(board);
  const [text, setText] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState(board.me ?? people[0]?.id ?? "");
  const [among, setAmong] = useState<string[]>([]);
  const cents = parseMoney(amount);
  const everyone = !among.length || among.length === people.length;
  return (
    <form
      className="mx-4 mt-4 rounded-2xl border border-line bg-surface p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim() || !cents) return;
        onAdd(text, { amount: cents, paidBy, among: everyone ? [] : among });
        setText("");
        setAmount("");
        setAmong([]);
      }}
    >
      <div className="flex gap-2">
        <input value={text} onChange={(event) => setText(event.target.value)} placeholder="What was it for?" className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-base outline-none placeholder:text-faint" />
        <div className="flex h-11 w-28 items-center rounded-lg border border-line bg-bg px-2">
          <span className="text-muted">$</span>
          <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" aria-label="Amount" className="min-w-0 flex-1 bg-transparent pl-1 text-base tabular-nums outline-none placeholder:text-faint" />
        </div>
      </div>
      {people.length > 1 ? (
        <>
          <p className="mt-3 text-[11px] tracking-[0.14em] text-faint uppercase">Paid by</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {people.map((person) => (
              <button
                key={person.id}
                type="button"
                aria-pressed={paidBy === person.id}
                onClick={() => setPaidBy(person.id)}
                className={"h-9 rounded-full px-3 text-sm " + (paidBy === person.id ? "bg-ink text-bg" : "border border-line text-muted")}
              >
                {name(person.id)}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11px] tracking-[0.14em] text-faint uppercase">Split between</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <button type="button" aria-pressed={everyone} onClick={() => setAmong([])} className={"h-9 rounded-full px-3 text-sm " + (everyone ? "bg-ink text-bg" : "border border-line text-muted")}>
              Everyone
            </button>
            {people.map((person) => {
              const on = !everyone && among.includes(person.id);
              return (
                <button
                  key={person.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setAmong((cur) => (everyone ? [person.id] : cur.includes(person.id) ? cur.filter((id) => id !== person.id) : [...cur, person.id]))}
                  className={"h-9 rounded-full px-3 text-sm " + (on ? "bg-ink text-bg" : "border border-line text-muted")}
                >
                  {name(person.id)}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
      <button type="submit" disabled={!text.trim() || !cents} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-ink text-sm text-bg disabled:bg-elevated disabled:text-faint">
        <Plus className="size-4" />
        Add {cents ? money(cents) : "cost"}
      </button>
    </form>
  );
}
