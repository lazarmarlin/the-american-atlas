/**
 * One screen for how a chat looks on this phone: both bubble colors, how
 * see-through they are, wallpaper strength or a plain color, text size, a
 * private name, quiet, and a shared color pair.
 */
import { ScreenHeader } from "@/components/screen-header";
import { useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BellOff, ChevronRight, Image, Plus, SunMedium, Users } from "lucide-react";
import { WallpaperScreen } from "@/components/chat-wallpaper";
import { LOOK_DEFAULT, writeLook, type ChatLook } from "@/lib/chat-look";
import type { Thread } from "@/lib/messages";
import { useBackClose } from "@/lib/sheet-back";
import { saveTheme, type SharedTheme } from "@/lib/chat-theme";

const COLORS = ["#243044", "#1c3d36", "#1e3a5f", "#3a2748", "#4a2430", "#3d3218", "#16383a", "#3a2a22"];

export function applyShared(local: ChatLook, theme: SharedTheme, meId: string): ChatLook {
  const swap = theme.owner !== meId;
  return {
    ...local,
    mine: swap ? theme.theirs : theme.mine,
    their: swap ? theme.mine : theme.theirs,
    mineFade: swap ? theme.theirFade : theme.mineFade,
    theirFade: swap ? theme.mineFade : theme.theirFade,
    shared: theme.owner === meId || local.shared,
  };
}

export function ChatLookScreen({
  meId,
  thread,
  name,
  look,
  onChange,
  onClose,
}: {
  meId: string;
  thread: Thread;
  name: string;
  look: ChatLook;
  onChange: (look: ChatLook) => void;
  onClose: () => void;
}) {
  const [wall, setWall] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useBackClose(onClose);

  function commit(next: ChatLook) {
    const saved = writeLook(meId, thread, next);
    onChange(saved);
    if (saved.shared || look.shared) {
      void saveTheme({
        data: { thread, mine: saved.mine, theirs: saved.their, mineFade: saved.mineFade, theirFade: saved.theirFade, shared: saved.shared },
      }).catch(() => setNote("Saved on this phone. It couldn't be shared."));
    }
  }

  const sizes = { sm: "text-[13px]", md: "text-[15px]", lg: "text-[18px]" } as const;
  return createPortal(
    <div role="dialog" aria-label="Chat settings" className="screen-top fixed inset-0 z-[70] flex flex-col bg-bg text-ink">
      <ScreenHeader title="Chat settings" subtitle={look.nick || name} onBack={onClose} backLabel="Back to the chat" />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-8">
        {/* What the chat will look like. */}
        <div
          className="overflow-hidden rounded-card border border-line px-3 py-4"
          style={{ background: look.plain || "var(--color-surface)", opacity: 1 }}
          aria-hidden="true"
        >
          <div className="flex justify-start">
            <div className={"max-w-[75%] rounded-2xl rounded-bl-md border border-line px-3 py-2 " + sizes[look.text]} style={bubblePreview(look.their, look.theirFade)}>
              Where are you?
            </div>
          </div>
          <div className="mt-2 flex justify-end">
            <div className={"max-w-[75%] rounded-2xl rounded-br-md border border-line bg-elevated px-3 py-2 " + sizes[look.text]} style={bubblePreview(look.mine, look.mineFade)}>
              Just crossed into Kansas
            </div>
          </div>
        </div>

        <Card label="Name">
          <input
            value={look.nick}
            placeholder={name}
            maxLength={40}
            aria-label="Name on this phone"
            onChange={(event) => commit({ ...look, nick: event.target.value })}
            className="h-11 w-full rounded-lg border border-line bg-bg px-3 text-base text-ink outline-none placeholder:text-faint focus:border-ink/50"
          />
          <p className="mt-1.5 text-xs text-faint">Only on this phone.</p>
        </Card>

        <Card label="Text size">
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-bg/60 p-1" role="radiogroup" aria-label="Text size">
            {(
              [
                ["sm", "Small"],
                ["md", "Normal"],
                ["lg", "Large"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={look.text === id}
                onClick={() => commit({ ...look, text: id })}
                className={"h-10 rounded-lg text-sm transition-colors " + (look.text === id ? "bg-elevated text-ink shadow-sm" : "text-faint active:bg-elevated/50")}
              >
                {label}
              </button>
            ))}
          </div>
        </Card>

        <Card label="Bubbles">
          <Swatches title="Yours" color={look.mine} fade={look.mineFade} onColor={(mine) => commit({ ...look, mine })} onFade={(mineFade) => commit({ ...look, mineFade })} />
          <div className="my-3 border-t border-line" />
          <Swatches title={thread.kind === "group" ? "Everyone else's" : `${name.split(" ")[0]}'s`} color={look.their} fade={look.theirFade} onColor={(their) => commit({ ...look, their })} onFade={(theirFade) => commit({ ...look, theirFade })} />
          <div className="my-3 border-t border-line" />
          <ToggleRow
            icon={<Users className="size-[18px]" aria-hidden="true" />}
            label="Same colors on their phone"
            hint={thread.kind === "group" ? "Everyone in this chat" : undefined}
            on={look.shared}
            onToggle={() => commit({ ...look, shared: !look.shared })}
          />
        </Card>

        <Card label="Background">
          <button type="button" onClick={() => setWall(true)} className="flex h-11 w-full items-center gap-3 text-left text-sm">
            <Image className="size-[18px] shrink-0 text-muted" aria-hidden="true" />
            <span className="min-w-0 flex-1">Wallpaper</span>
            <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden="true" />
          </button>
          <label className="mt-2 flex items-center gap-3 text-xs text-muted">
            <SunMedium className="size-4 shrink-0 text-faint" aria-hidden="true" />
            <span className="shrink-0">Strength</span>
            <input type="range" min={0} max={100} value={look.dim} onChange={(event) => commit({ ...look, dim: Number(event.target.value) })} className="min-w-0 flex-1 accent-ink" />
          </label>
          <div className="my-3 border-t border-line" />
          <p className="text-xs text-muted">Or a plain color</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Chip on={!look.plain} onClick={() => commit({ ...look, plain: "" })}>
              Picture
            </Chip>
            {COLORS.map((swatch) => (
              <Swatch key={swatch} color={swatch} on={look.plain.toLowerCase() === swatch} onPick={() => commit({ ...look, plain: swatch })} />
            ))}
            <CustomColor value={look.plain || "#1c1f18"} onPick={(plain) => commit({ ...look, plain })} />
          </div>
        </Card>

        <Card label="Notifications">
          <ToggleRow
            icon={<BellOff className="size-[18px]" aria-hidden="true" />}
            label="Quiet this chat"
            hint="No buzz. The count still shows."
            on={look.quiet}
            onToggle={() => commit({ ...look, quiet: !look.quiet })}
          />
        </Card>

        {note ? <p className="mt-3 text-sm text-muted">{note}</p> : null}
        <button type="button" onClick={() => commit({ ...LOOK_DEFAULT })} className="mt-5 h-11 w-full rounded-lg text-sm text-muted active:bg-elevated">
          Reset this chat
        </button>
      </div>
      {wall ? <WallpaperScreen meId={meId} thread={thread} onClose={() => setWall(false)} onSaved={() => setWall(false)} /> : null}
    </div>,
    document.body,
  );
}

/** A group of settings with a small label above it, like the rest of the app. */
function Card({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <p className="mb-2 px-1 text-xs tracking-widest text-faint uppercase">{label}</p>
      <div className="rounded-card border border-line bg-surface/60 p-3">{children}</div>
    </section>
  );
}

function ToggleRow({ icon, label, hint, on, onToggle }: { icon: ReactNode; label: string; hint?: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onToggle} className="flex min-h-11 w-full items-center gap-3 text-left">
      <span className={"shrink-0 " + (on ? "text-ink" : "text-muted")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{label}</span>
        {hint ? <span className="block text-xs text-faint">{hint}</span> : null}
      </span>
      <span className={"flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors " + (on ? "bg-ink" : "bg-line")}>
        <span className={"size-6 rounded-full shadow-sm transition-transform " + (on ? "translate-x-5 bg-bg" : "translate-x-0 bg-muted")} />
      </span>
    </button>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={"h-9 rounded-full px-4 text-sm transition-colors " + (on ? "bg-ink font-medium text-bg" : "border border-line text-muted")}
    >
      {children}
    </button>
  );
}

function Swatches({
  title,
  color,
  fade,
  onColor,
  onFade,
}: {
  title: string;
  color: string;
  fade: number;
  onColor: (color: string) => void;
  onFade: (fade: number) => void;
}) {
  return (
    <div>
      <p className="text-sm">{title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Chip on={!color} onClick={() => onColor("")}>
          Default
        </Chip>
        {COLORS.map((swatch) => (
          <Swatch key={swatch} color={swatch} on={color.toLowerCase() === swatch} onPick={() => onColor(swatch)} />
        ))}
        <CustomColor value={color || "#243044"} onPick={onColor} />
      </div>
      <label className="mt-3 flex items-center gap-3 text-xs text-muted">
        <span className="shrink-0">See-through</span>
        <input type="range" min={30} max={100} value={fade} onChange={(event) => onFade(Number(event.target.value))} className="min-w-0 flex-1 accent-ink" />
      </label>
    </div>
  );
}

function bubblePreview(color: string, fade: number): CSSProperties | undefined {
  if (!color && fade >= 100) return undefined;
  const base = color || "#262a22";
  const a = Math.round((fade / 100) * 255)
    .toString(16)
    .padStart(2, "0");
  return { backgroundColor: `${base}${a}`, borderColor: `${base}${a}` };
}

function Swatch({ color, on, onPick }: { color: string; on: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-label={color}
      aria-pressed={on}
      onClick={onPick}
      className={"size-9 rounded-full border border-white/10 transition-shadow " + (on ? "ring-2 ring-ink ring-offset-2 ring-offset-surface" : "")}
      style={{ backgroundColor: color }}
    />
  );
}

function CustomColor({ value, onPick }: { value: string; onPick: (color: string) => void }) {
  return (
    <label className="relative grid size-9 cursor-pointer place-items-center overflow-hidden rounded-full border border-dashed border-line text-muted">
      <Plus className="size-4" aria-hidden="true" />
      <input type="color" aria-label="Custom color" value={value} onChange={(event) => onPick(event.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
    </label>
  );
}
