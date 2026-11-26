/**
 * One screen for how a chat looks on this phone: both bubble colors, how
 * see-through they are, wallpaper strength or a plain color, text size, a
 * private name, quiet, and a shared color pair.
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BellOff, Image, SunMedium, Type, UserRound, Users } from "lucide-react";
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

  return createPortal(
    <div role="dialog" aria-label="Chat settings" className="screen-top fixed inset-0 z-[70] flex flex-col bg-bg text-ink">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-2">
        <button type="button" onClick={onClose} className="flex h-11 items-center gap-1 px-2 text-sm text-accent">
          ‹ Chat
        </button>
        <p className="min-w-0 flex-1 truncate text-right font-serif text-lg">Settings</p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <label className="block">
          <span className="flex items-center gap-2 text-sm text-accent">
            <UserRound className="size-4" aria-hidden="true" />
            Name on this phone
          </span>
          <input
            value={look.nick}
            placeholder={name}
            maxLength={40}
            onChange={(event) => commit({ ...look, nick: event.target.value })}
            className="mt-2 h-11 w-full rounded-lg border border-line bg-bg px-3 text-base text-ink outline-none placeholder:text-faint"
          />
          <span className="mt-1 block text-xs text-faint">{thread.kind === "group" ? "The trip chat keeps its real name for everyone else." : `${name} still sees their own name.`}</span>
        </label>

        <Section icon={<Type className="size-4" />} title="Text size">
          <div className="flex gap-2">
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
                aria-pressed={look.text === id}
                onClick={() => commit({ ...look, text: id })}
                className={"h-11 flex-1 rounded-lg border text-sm " + (look.text === id ? "border-accent text-accent" : "border-line text-muted")}
              >
                {label}
              </button>
            ))}
          </div>
        </Section>

        <Swatches
          title="Your bubbles"
          hint="Only you see this color on the messages you send."
          color={look.mine}
          fade={look.mineFade}
          align="end"
          onColor={(mine) => commit({ ...look, mine })}
          onFade={(mineFade) => commit({ ...look, mineFade })}
        />
        <Swatches
          title="Their bubbles"
          hint={`Only you see this. ${name} still sees the usual bubbles.`}
          color={look.their}
          fade={look.theirFade}
          align="start"
          onColor={(their) => commit({ ...look, their })}
          onFade={(theirFade) => commit({ ...look, theirFade })}
        />

        <button
          type="button"
          role="switch"
          aria-checked={look.shared}
          onClick={() => commit({ ...look, shared: !look.shared })}
          className="mt-4 flex w-full items-center gap-3 rounded-lg border border-line px-3 py-3 text-left"
        >
          <Users className="size-4 shrink-0 text-accent" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-accent">Same colors for both of us</span>
            <span className="block text-xs text-faint">{thread.kind === "group" ? "Everyone in this chat" : "A message you send stays one color on both phones"}</span>
          </span>
          <span className={"grid h-6 w-10 shrink-0 place-items-center rounded-full " + (look.shared ? "bg-accent" : "bg-line")}>
            <span className={"size-5 rounded-full bg-bg " + (look.shared ? "translate-x-2" : "-translate-x-2")} />
          </span>
        </button>

        <button type="button" onClick={() => setWall(true)} className="mt-3 flex h-12 w-full items-center gap-3 rounded-lg border border-line px-3 text-left text-sm text-accent">
          <Image className="size-4" aria-hidden="true" />
          Wallpaper
        </button>

        <Section icon={<SunMedium className="size-4" />} title="Wallpaper strength">
          <input
            type="range"
            min={0}
            max={100}
            value={look.dim}
            aria-label="Wallpaper strength"
            onChange={(event) => commit({ ...look, dim: Number(event.target.value) })}
            className="w-full accent-[#e23d2b]"
          />
          <span className="mt-1 block text-xs text-faint">Left is brighter. Right lets the picture sit further back.</span>
        </Section>

        <Section icon={<span className="size-4 rounded-sm border border-accent" />} title="Plain background">
          <p className="text-xs text-faint">A color instead of a picture. The wallpaper stays saved.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={!look.plain}
              onClick={() => commit({ ...look, plain: "" })}
              className={"h-11 rounded-full border px-3 text-sm " + (!look.plain ? "border-accent text-accent" : "border-line text-muted")}
            >
              Picture
            </button>
            {COLORS.map((swatch) => (
              <Swatch key={swatch} color={swatch} on={look.plain.toLowerCase() === swatch} onPick={() => commit({ ...look, plain: swatch })} />
            ))}
            <CustomColor value={look.plain || "#1c1f18"} onPick={(plain) => commit({ ...look, plain })} />
          </div>
        </Section>

        <button
          type="button"
          role="switch"
          aria-checked={look.quiet}
          onClick={() => commit({ ...look, quiet: !look.quiet })}
          className="mt-4 flex w-full items-center gap-3 rounded-lg border border-line px-3 py-3 text-left"
        >
          <BellOff className="size-4 shrink-0 text-accent" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-accent">Quiet this chat</span>
            <span className="block text-xs text-faint">No buzz unless you have it open. The count still shows.</span>
          </span>
          <span className={"grid h-6 w-10 shrink-0 place-items-center rounded-full " + (look.quiet ? "bg-accent" : "bg-line")}>
            <span className={"size-5 rounded-full bg-bg " + (look.quiet ? "translate-x-2" : "-translate-x-2")} />
          </span>
        </button>
        {note ? <p className="mt-3 text-sm text-muted">{note}</p> : null}
        <button type="button" onClick={() => commit({ ...LOOK_DEFAULT })} className="mt-4 mb-2 h-11 w-full rounded-lg border border-line text-sm text-accent">
          Reset this chat
        </button>
      </div>
      {wall ? <WallpaperScreen meId={meId} thread={thread} onClose={() => setWall(false)} onSaved={() => setWall(false)} /> : null}
    </div>,
    document.body,
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="flex items-center gap-2 font-serif text-xl text-accent">
        {icon}
        {title}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Swatches({
  title,
  hint,
  color,
  fade,
  align,
  onColor,
  onFade,
}: {
  title: string;
  hint: string;
  color: string;
  fade: number;
  align: "start" | "end";
  onColor: (color: string) => void;
  onFade: (fade: number) => void;
}) {
  return (
    <section className="mt-5">
      <h2 className="font-serif text-xl">{title}</h2>
      <p className="mt-1 text-xs text-faint">{hint}</p>
      <div className={"mt-3 flex " + (align === "end" ? "justify-end" : "justify-start")}>
        <div
          className={"max-w-[70%] rounded-2xl border border-line px-3 py-2 text-[15px] " + (align === "end" ? "rounded-br-md bg-elevated" : "rounded-bl-md")}
          style={bubblePreview(color, fade)}
        >
          Like this
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={!color}
          onClick={() => onColor("")}
          className={"h-11 rounded-full border px-3 text-sm " + (!color ? "border-accent text-accent" : "border-line text-muted")}
        >
          Default
        </button>
        {COLORS.map((swatch) => (
          <Swatch key={swatch} color={swatch} on={color.toLowerCase() === swatch} onPick={() => onColor(swatch)} />
        ))}
        <CustomColor value={color || "#243044"} onPick={onColor} />
      </div>
      <label className="mt-3 block text-xs text-faint">
        See-through
        <input type="range" min={30} max={100} value={fade} onChange={(event) => onFade(Number(event.target.value))} className="mt-1 w-full accent-[#e23d2b]" />
      </label>
    </section>
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
      className={"size-11 rounded-full border-2 " + (on ? "border-accent" : "border-transparent")}
      style={{ backgroundColor: color }}
    />
  );
}

function CustomColor({ value, onPick }: { value: string; onPick: (color: string) => void }) {
  return (
    <label className="relative grid size-11 cursor-pointer place-items-center overflow-hidden rounded-full border border-accent text-xs text-accent">
      +
      <input type="color" aria-label="Custom color" value={value} onChange={(event) => onPick(event.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
    </label>
  );
}
