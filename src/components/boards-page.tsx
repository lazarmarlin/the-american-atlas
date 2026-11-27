/**
 * Boards: make a to-do, a packing list, or a trip plan, and send it to a
 * friend. They check things off, or change the list, if you let them.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ListTodo, Luggage, Map, Trash2 } from "lucide-react";
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

const KIND_ICON = { todo: ListTodo, pack: Luggage, trip: Map } as const;

function itemId() {
  return `bi-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
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

  useEffect(() => {
    void refresh();
    if (!focusId) return;
    void openBoard({ data: { id: focusId } })
      .then(setOpen)
      .catch((err) => setNote(err instanceof Error ? err.message : "Couldn't open that board."));
  }, [focusId]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => {
      void openBoard({ data: { id: open.id } })
        .then((next) => setOpen((cur) => (cur && cur.id === next.id ? next : cur)))
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [open?.id]);

  async function make(kind: BoardKind) {
    setBusy(true);
    setNote(null);
    try {
      const board = await createBoard({ data: { kind } });
      setOpen(board);
      void refresh();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't make that.");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div role="dialog" aria-label="Boards" className="screen-top fixed inset-0 z-50 flex flex-col bg-bg">
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-2 pb-2">
        <button
          type="button"
          aria-label="Back"
          onClick={() => (open && !focusId ? setOpen(null) : onClose())}
          className="grid h-11 w-11 place-items-center rounded-full text-ink"
        >
          <ChevronLeft className="size-6" />
        </button>
        <p className="font-serif text-xl leading-tight">{open ? open.title : "Boards"}</p>
      </header>
      {note ? <p className="shrink-0 border-b border-line px-3 py-2 text-sm text-muted">{note}</p> : null}
      {open ? (
        <BoardEditor
          board={open}
          thread={thread}
          busy={busy}
          onChange={setOpen}
          onBusy={setBusy}
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
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <p className="text-sm text-muted">A list you can send to a friend. They can check things off, or change it, if you let them.</p>
          <div className="mt-3 grid gap-2">
            {BOARD_KINDS.map((kind) => {
              const Icon = KIND_ICON[kind.id];
              return (
                <button
                  key={kind.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void make(kind.id)}
                  className="flex items-center gap-3 rounded-xl border border-line px-3 py-3 text-left active:bg-elevated disabled:opacity-60"
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
                    <Icon className="size-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[15px] font-medium">{kind.name}</span>
                    <span className="block text-xs text-muted">{kind.line}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <ul className="mt-4 grid gap-2">
            {(rows ?? []).map((row) => {
              const Icon = KIND_ICON[row.kind];
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => void openBoard({ data: { id: row.id } }).then(setOpen).catch((err) => setNote(err instanceof Error ? err.message : "Couldn't open that board."))}
                    className="flex w-full items-center gap-3 rounded-xl border border-line px-3 py-3 text-left active:bg-elevated"
                  >
                    <Icon className="size-5 shrink-0 text-accent" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px]">{row.title}</span>
                      <span className="block text-xs text-faint">{row.role === "owner" ? "Yours" : row.role === "edit" ? "You can change it" : "You can check things off"}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {rows && !rows.length ? <p className="mt-4 text-sm text-muted">None yet. Start one above.</p> : null}
        </div>
      )}
    </div>,
    document.body,
  );
}

function BoardEditor({
  board,
  thread,
  busy,
  onChange,
  onBusy,
  onNote,
  onGone,
  onSent,
}: {
  board: BoardOpen;
  thread: Thread | null;
  busy: boolean;
  onChange: (board: BoardOpen) => void;
  onBusy: (busy: boolean) => void;
  onNote: (note: string | null) => void;
  onGone: () => void;
  onSent: () => void;
}) {
  const canEdit = board.role === "owner" || board.role === "edit";
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [friends, setFriends] = useState<FriendRow[] | null>(null);
  const [role, setRole] = useState<"check" | "edit">("check");
  const doneWord = board.kind === "pack" ? "Packed" : "Done";

  async function write(next: BoardOpen) {
    onChange(next);
    onBusy(true);
    try {
      const saved = await saveBoard({ data: { id: next.id, title: next.title, doc: next.doc } });
      onChange(saved);
    } catch (err) {
      onNote(err instanceof Error ? err.message : "Couldn't save that.");
    } finally {
      onBusy(false);
    }
  }

  function withItems(items: BoardItem[]) {
    return { ...board, doc: { ...board.doc, items } };
  }

  async function add() {
    const line = text.trim();
    if (!line || !canEdit) return;
    setText("");
    await write(withItems([...board.doc.items, { id: itemId(), text: line.slice(0, 80), note: "", done: false }]));
  }

  async function send(to: Thread) {
    onBusy(true);
    onNote(null);
    try {
      await sendBoardTo({ data: { id: board.id, thread: to, role } });
      setSending(false);
      onSent();
    } catch (err) {
      onNote(err instanceof Error ? err.message : "Couldn't send that.");
    } finally {
      onBusy(false);
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      {canEdit ? (
        <input
          value={board.title}
          onChange={(event) => onChange({ ...board, title: event.target.value.slice(0, 60) })}
          onBlur={() => void write(board)}
          className="h-11 w-full rounded-lg border border-line bg-bg px-3 font-serif text-lg outline-none"
        />
      ) : (
        <p className="text-sm text-muted">{board.role === "check" ? "You can check things off." : "You can change this list."}</p>
      )}
      {board.kind === "trip" && canEdit ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="text-xs text-faint">
            Starts
            <input
              type="date"
              value={board.doc.start ?? ""}
              onChange={(event) => {
                const doc: BoardDoc = { ...board.doc, start: event.target.value || null };
                void write({ ...board, doc });
              }}
              className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-2 text-sm text-ink"
            />
          </label>
          <label className="text-xs text-faint">
            Ends
            <input
              type="date"
              value={board.doc.end ?? ""}
              onChange={(event) => {
                const doc: BoardDoc = { ...board.doc, end: event.target.value || null };
                void write({ ...board, doc });
              }}
              className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-2 text-sm text-ink"
            />
          </label>
        </div>
      ) : board.kind === "trip" && (board.doc.start || board.doc.end) ? (
        <p className="mt-1 text-sm text-muted">
          {[board.doc.start, board.doc.end].filter(Boolean).join(" – ")}
        </p>
      ) : null}
      <ul className="mt-3 grid gap-1">
        {board.doc.items.map((item) => (
          <li key={item.id} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5">
            <button
              type="button"
              aria-pressed={item.done}
              aria-label={item.done ? `Not ${doneWord.toLowerCase()}` : doneWord}
              onClick={() => void write(withItems(board.doc.items.map((row) => (row.id === item.id ? { ...row, done: !row.done } : row))))}
              className={"grid size-9 shrink-0 place-items-center rounded-full border " + (item.done ? "border-accent bg-accent/15 text-accent" : "border-line text-transparent")}
            >
              <Check className="size-4" />
            </button>
            <span className={"min-w-0 flex-1 truncate text-sm " + (item.done ? "text-faint line-through" : "")}>{item.text}</span>
            {canEdit ? (
              <button
                type="button"
                aria-label="Remove"
                onClick={() => void write(withItems(board.doc.items.filter((row) => row.id !== item.id)))}
                className="grid size-9 shrink-0 place-items-center text-faint"
              >
                <Trash2 className="size-4" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {!board.doc.items.length ? <p className="mt-3 text-sm text-muted">{board.kind === "pack" ? "Nothing to pack yet." : board.kind === "trip" ? "No stops yet." : "Nothing on the list yet."}</p> : null}
      {canEdit ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={board.kind === "pack" ? "Add something to pack" : board.kind === "trip" ? "Add a stop" : "Add something"}
            className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-base outline-none placeholder:text-faint"
          />
          <button type="submit" disabled={!text.trim() || busy} className="h-11 shrink-0 rounded-lg border border-line px-3 text-sm text-accent disabled:text-faint">
            Add
          </button>
        </form>
      ) : null}
      {board.role === "owner" ? (
        <div className="mt-6">
          <p className="text-sm text-muted">Send it, and they can open the same list.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(
              [
                ["check", "They check things off"],
                ["edit", "They can change it"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={role === id}
                onClick={() => setRole(id)}
                className={"h-11 rounded-lg border px-2 text-sm " + (role === id ? "border-ink bg-elevated" : "border-line text-muted")}
              >
                {label}
              </button>
            ))}
          </div>
          {thread ? (
            <button type="button" disabled={busy} onClick={() => void send(thread)} className="mt-2 h-11 w-full rounded-lg border border-line text-sm text-accent disabled:text-faint">
              Send in this chat
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setSending(true);
                void listFriends()
                  .then(setFriends)
                  .catch((err) => onNote(err instanceof Error ? err.message : "Couldn't load friends."));
              }}
              className="mt-2 h-11 w-full rounded-lg border border-line text-sm text-accent disabled:text-faint"
            >
              Send to a friend
            </button>
          )}
          {sending && !thread ? (
            <ul className="mt-2 grid gap-1">
              {(friends ?? []).map((friend) => (
                <li key={friend.id}>
                  <button type="button" onClick={() => void send({ kind: "friend", id: friend.id })} className="flex h-11 w-full items-center rounded-lg border border-line px-3 text-left text-sm active:bg-elevated">
                    {friend.name}
                  </button>
                </li>
              ))}
              {friends && !friends.length ? <li className="text-sm text-muted">No friends yet.</li> : null}
            </ul>
          ) : null}
          <button
            type="button"
            onClick={() => {
              void deleteBoard({ data: { id: board.id } })
                .then(onGone)
                .catch((err) => onNote(err instanceof Error ? err.message : "Couldn't delete that."));
            }}
            className="mt-4 h-11 w-full rounded-lg text-sm text-faint"
          >
            Delete this board
          </button>
        </div>
      ) : null}
    </div>
  );
}
