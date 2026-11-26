/**
 * How a chat looks on this phone: bubble colors, wallpaper strength, a plain
 * background, text size, a private name, and whether it stays quiet.
 * Nothing here is sent except when "Same colors for both of us" is on.
 */
import { useEffect, useState } from "react";
import type { Thread } from "@/lib/messages";

export type TextSize = "sm" | "md" | "lg";

export type ChatLook = {
  their: string;
  mine: string;
  theirFade: number;
  mineFade: number;
  /** 0 is a bright wallpaper, 100 is nearly black. 55 matches the old look. */
  dim: number;
  plain: string;
  text: TextSize;
  nick: string;
  quiet: boolean;
  /** Publish the two bubble colors so the other phone uses them too. */
  shared: boolean;
};

export const LOOK_DEFAULT: ChatLook = {
  their: "",
  mine: "",
  theirFade: 100,
  mineFade: 100,
  dim: 55,
  plain: "",
  text: "md",
  nick: "",
  quiet: false,
  shared: false,
};

const HEX = /^#[0-9a-fA-F]{6}$/;

const lookKey = (meId: string, thread: Thread) => `atlas.look.${meId}.${thread.kind}.${thread.id}`;
const quietKey = (meId: string) => `atlas.quiet.${meId}`;

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function readLook(meId: string, thread: Thread): ChatLook {
  try {
    const raw = JSON.parse(localStorage.getItem(lookKey(meId, thread)) ?? "null") as Partial<ChatLook> | null;
    const look: ChatLook = {
      ...LOOK_DEFAULT,
      ...(raw ?? {}),
      their: HEX.test(String(raw?.their ?? "")) ? String(raw?.their) : "",
      mine: HEX.test(String(raw?.mine ?? "")) ? String(raw?.mine) : "",
      plain: HEX.test(String(raw?.plain ?? "")) ? String(raw?.plain) : "",
      theirFade: clamp(Number(raw?.theirFade ?? 100), 30, 100),
      mineFade: clamp(Number(raw?.mineFade ?? 100), 30, 100),
      dim: clamp(Number(raw?.dim ?? 55), 0, 100),
      text: raw?.text === "sm" || raw?.text === "lg" ? raw.text : "md",
      nick: String(raw?.nick ?? "").slice(0, 40),
      quiet: raw?.quiet === true,
      shared: raw?.shared === true,
    };
    if (!look.their) {
      const old = localStorage.getItem(`atlas.bubble.${meId}.${thread.kind}.${thread.id}`) ?? "";
      if (HEX.test(old)) look.their = old;
    }
    return look;
  } catch {
    return { ...LOOK_DEFAULT };
  }
}

export function writeLook(meId: string, thread: Thread, look: ChatLook) {
  const next = readLook(meId, thread);
  const saved: ChatLook = { ...next, ...look, nick: look.nick.slice(0, 40) };
  try {
    localStorage.setItem(lookKey(meId, thread), JSON.stringify(saved));
    const quiet: string[] = [];
    const prefix = `atlas.look.${meId}.`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      try {
        const row = JSON.parse(localStorage.getItem(key) ?? "null") as { quiet?: boolean } | null;
        const rest = key.slice(prefix.length);
        const dot = rest.indexOf(".");
        if (dot < 1) continue;
        if (row?.quiet) quiet.push(`${rest.slice(0, dot)}:${rest.slice(dot + 1)}`);
      } catch {
        /* skip a bad row */
      }
    }
    localStorage.setItem(quietKey(meId), JSON.stringify(quiet));
  } catch {
    /* this phone keeps the last look */
  }
  window.dispatchEvent(new Event("atlas-look"));
  void import("@/lib/message-watch").then((mod) => mod.setQuietThreads(quietList(meId))).catch(() => undefined);
  return saved;
}

export function quietList(meId: string) {
  try {
    const rows = JSON.parse(localStorage.getItem(quietKey(meId)) ?? "[]") as unknown;
    return Array.isArray(rows) ? rows.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function isQuiet(meId: string, thread: Thread) {
  return quietList(meId).includes(`${thread.kind}:${thread.id}`);
}

/** The name on this phone, or the real one when you haven't set one. */
export function nickOf(meId: string, kind: Thread["kind"], id: string, fallback: string) {
  if (!meId) return fallback;
  const nick = readLook(meId, { kind, id }).nick.trim();
  return nick || fallback;
}

export function useLookVersion() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const bump = () => setN((v) => v + 1);
    window.addEventListener("atlas-look", bump);
    return () => window.removeEventListener("atlas-look", bump);
  }, []);
  return n;
}

export function withAlpha(hex: string, fade: number) {
  const a = Math.round((clamp(fade, 0, 100) / 100) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
}

/** Overlay darkness for a wallpaper. 55 is the look chats had before the slider. */
export function wallVeil(dim: number) {
  const t = clamp(dim, 0, 100) / 100;
  return { top: (0.12 + t * 0.72).toFixed(2), bottom: (0.22 + t * 0.7).toFixed(2) };
}
