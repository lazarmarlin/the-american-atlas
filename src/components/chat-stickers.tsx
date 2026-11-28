/**
 * Chat stickers: goofy road-trip art drawn in SVG, with a white die-cut edge
 * like a real sticker. The "you" ones put the sender's own map avatar in the
 * scene. Each one does a little move when it shows up, and again when tapped.
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { STICKERS, stickerInfo, type StickerInfo } from "@/lib/stickers";
import { paintYouMarker } from "@/lib/you-marker";

const INK = "#1d1b19";
const YELLOW = "#f6c343";
const RED = "#e23d2b";
const BLUE = "#3d8fd4";
const GREEN = "#5bb26a";
const PINK = "#f08fb0";
const ORANGE = "#f08a3c";
const CREAM = "#f7ecd2";
const BROWN = "#8a5a3b";

/** Big outlined words, like a sticker's caption. */
function Word({ y, size = 20, fill = "#fff", rotate = -4, x = 60, children }: { y: number; size?: number; fill?: string; rotate?: number; x?: number; children: ReactNode }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      fontSize={size}
      fontWeight={900}
      fontFamily="Outfit, ui-sans-serif, system-ui, sans-serif"
      fill={fill}
      stroke={INK}
      strokeWidth={size * 0.24}
      strokeLinejoin="round"
      paintOrder="stroke"
      letterSpacing={0.4}
      transform={`rotate(${rotate} ${x} ${y})`}
    >
      {children}
    </text>
  );
}

function heart(cx: number, cy: number, s: number) {
  return `M${cx} ${cy + 0.6 * s} C${cx - 1.1 * s} ${cy - 0.1 * s} ${cx - 0.55 * s} ${cy - 0.95 * s} ${cx} ${cy - 0.3 * s} C${cx + 0.55 * s} ${cy - 0.95 * s} ${cx + 1.1 * s} ${cy - 0.1 * s} ${cx} ${cy + 0.6 * s}Z`;
}

/** A four-point sparkle. */
function sparkle(cx: number, cy: number, r: number) {
  const k = r * 0.28;
  return `M${cx} ${cy - r} Q${cx + k} ${cy - k} ${cx + r} ${cy} Q${cx + k} ${cy + k} ${cx} ${cy + r} Q${cx - k} ${cy + k} ${cx - r} ${cy} Q${cx - k} ${cy - k} ${cx} ${cy - r}Z`;
}

function Eye({ x, y, r = 5, look = 0 }: { x: number; y: number; r?: number; look?: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="#fff" />
      <circle cx={x + look * r * 0.4} cy={y + r * 0.1} r={r * 0.5} fill={INK} stroke="none" />
    </g>
  );
}

const avatarCache = new Map<string, string>();
/** The map avatar as a picture, for the "you" stickers. */
function avatarUrl(icon: string, color: string) {
  const key = `${icon}|${color}`;
  const hit = avatarCache.get(key);
  if (hit) return hit;
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext("2d");
  if (!g) return "";
  paintYouMarker(g, icon, color, 128);
  const url = canvas.toDataURL("image/png");
  avatarCache.set(key, url);
  return url;
}

function Avatar({ url, x, y, size }: { url: string; x: number; y: number; size: number }) {
  return url ? <image href={url} x={x} y={y} width={size} height={size} /> : <circle cx={x + size / 2} cy={y + size / 2} r={size * 0.42} fill={BLUE} />;
}

/** The scenes. Each draws in a 120 × 120 box; strokes are ink unless they say otherwise. */
function art(id: string, me: string): ReactNode {
  switch (id) {
    case "me-hi":
      return (
        <>
          <path d="M96 14 q8 6 6 16 M104 8 q12 10 8 26" fill="none" strokeWidth={3} />
          <path d={sparkle(18, 22, 8)} fill={YELLOW} />
          <path d={sparkle(28, 8, 4)} fill="#fff" />
          <Avatar url={me} x={22} y={18} size={72} />
          <g transform="rotate(22 88 38)">
            <rect x={79} y={30} width={18} height={20} rx={8} fill={YELLOW} />
            <rect x={79} y={17} width={4} height={16} rx={2} fill={YELLOW} />
            <rect x={84} y={14} width={4} height={18} rx={2} fill={YELLOW} />
            <rect x={89} y={15} width={4} height={17} rx={2} fill={YELLOW} />
            <rect x={94} y={19} width={4} height={14} rx={2} fill={YELLOW} />
            <path d="M80 40 q-8 -2 -9 -9" fill={YELLOW} />
          </g>
          <Word y={110} size={26} fill={YELLOW}>
            HI!
          </Word>
        </>
      );
    case "me-omw":
      return (
        <>
          <path d="M2 58 h14 M6 68 h12 M2 78 h14" strokeWidth={3.5} />
          <Avatar url={me} x={40} y={8} size={50} />
          <path d="M16 62 Q18 52 30 52 L44 52 L52 42 L84 42 Q92 42 96 52 L104 56 Q110 58 110 66 L110 76 Q110 82 104 82 L22 82 Q16 82 16 76 Z" fill={RED} />
          <path d="M56 46 L66 46 L66 52 L50 52 Z" fill="#cfe8ff" />
          <rect x={96} y={60} width={10} height={6} rx={2} fill={YELLOW} />
          <circle cx={36} cy={84} r={11} fill="#3a3a3a" />
          <circle cx={36} cy={84} r={4} fill="#ddd" />
          <circle cx={90} cy={84} r={11} fill="#3a3a3a" />
          <circle cx={90} cy={84} r={4} fill="#ddd" />
          <Word y={113} size={22} fill={YELLOW}>
            OMW!
          </Word>
        </>
      );
    case "me-love":
      return (
        <>
          <path d={heart(20, 26, 12)} fill={PINK} />
          <path d={heart(100, 20, 10)} fill={RED} />
          <path d={heart(104, 66, 8)} fill={PINK} />
          <path d={heart(14, 70, 7)} fill={RED} />
          <Avatar url={me} x={24} y={20} size={72} />
          <Word y={111} size={21} fill={PINK}>
            LOVE U
          </Word>
        </>
      );
    case "me-what":
      return (
        <>
          <path d="M14 30 l10 8 M8 54 h12 M16 78 l9 -7 M106 30 l-10 8 M112 54 h-12 M104 78 l-9 -7" strokeWidth={3.5} />
          <Avatar url={me} x={24} y={18} size={72} />
          <Word x={22} y={27} size={24} fill={ORANGE} rotate={-14}>
            ?
          </Word>
          <Word x={100} y={30} size={26} fill={YELLOW} rotate={12}>
            !
          </Word>
          <Word y={111} size={21} fill={ORANGE}>
            WHAT?!
          </Word>
        </>
      );
    case "me-party":
      return (
        <>
          {[
            [14, 20, RED],
            [104, 16, BLUE],
            [12, 62, YELLOW],
            [108, 58, GREEN],
            [30, 6, PINK],
            [92, 84, PINK],
            [20, 88, BLUE],
          ].map(([x, y, fill], i) => (
            <rect key={i} x={Number(x)} y={Number(y)} width={7} height={4} rx={1} fill={String(fill)} strokeWidth={1.5} transform={`rotate(${i * 37} ${Number(x) + 3} ${Number(y) + 2})`} />
          ))}
          <Avatar url={me} x={24} y={24} size={70} />
          <path d="M50 34 L82 28 L74 6 Z" fill={BLUE} />
          <path d="M56 25 L79 21 M63 16 L77 13" stroke={YELLOW} strokeWidth={3} />
          <circle cx={74} cy={6} r={5} fill={PINK} />
          <Word y={111} size={21} fill={YELLOW}>
            PARTY!
          </Word>
        </>
      );
    case "me-sleepy":
      return (
        <>
          <path d="M22 12 A16 16 0 1 0 38 34 A12 12 0 1 1 22 12 Z" fill={YELLOW} />
          <path d={sparkle(48, 10, 4)} fill="#fff" />
          <Avatar url={me} x={20} y={24} size={70} />
          <Word x={82} y={42} size={13} fill="#c9b8ff" rotate={-10}>
            z
          </Word>
          <Word x={93} y={31} size={17} fill="#c9b8ff" rotate={-10}>
            z
          </Word>
          <Word x={104} y={19} size={21} fill="#c9b8ff" rotate={-10}>
            Z
          </Word>
          <Word y={111} size={20} fill="#c9b8ff">
            SLEEPY
          </Word>
        </>
      );
    case "me-brb":
      return (
        <>
          <Avatar url={me} x={32} y={2} size={58} />
          <rect x={14} y={48} width={92} height={46} rx={7} fill="#d9a066" />
          <path d="M18 63 H102 M18 79 H102" stroke="#b07a45" strokeWidth={2} />
          <circle cx={42} cy={49} r={6} fill={YELLOW} />
          <circle cx={80} cy={49} r={6} fill={YELLOW} />
          <Word y={84} size={30} fill="#fff" rotate={-3}>
            BRB
          </Word>
        </>
      );
    case "me-here":
      return (
        <>
          <path d="M60 104 C46 84 22 70 22 46 A38 38 0 0 1 98 46 C98 70 74 84 60 104 Z" fill={RED} />
          <circle cx={60} cy={46} r={30} fill="#fff" />
          <Avatar url={me} x={32} y={18} size={56} />
          <path d={sparkle(12, 18, 7)} fill={YELLOW} />
          <path d={sparkle(108, 26, 6)} fill={YELLOW} />
          <path d={sparkle(104, 84, 4)} fill="#fff" />
          <Word y={113} size={18} fill={YELLOW}>
            MADE IT!
          </Word>
        </>
      );
    case "road-trip":
      return (
        <>
          <rect x={30} y={26} width={28} height={20} rx={4} fill={BROWN} />
          <path d="M38 26 v-5 h12 v5" fill="none" strokeWidth={3} />
          <rect x={60} y={31} width={22} height={15} rx={3} fill={RED} />
          <path d="M26 46 H90" strokeWidth={3.5} />
          <path d="M12 74 L16 56 Q18 48 28 48 L80 48 Q88 48 92 54 L104 62 Q108 64 108 70 L108 78 Q108 84 102 84 L18 84 Q12 84 12 78 Z" fill={BLUE} />
          <path d="M24 56 Q26 52 32 52 L52 52 L52 64 L22 64 Z M58 52 L78 52 Q84 52 88 58 L92 64 L58 64 Z" fill="#cfe8ff" />
          <circle cx={34} cy={86} r={11} fill="#3a3a3a" />
          <circle cx={34} cy={86} r={4} fill="#ddd" />
          <circle cx={86} cy={86} r={11} fill="#3a3a3a" />
          <circle cx={86} cy={86} r={4} fill="#ddd" />
          <Word y={113} size={17} fill={YELLOW}>
            ROAD TRIP!
          </Word>
        </>
      );
    case "hangry": {
      const bits = [];
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI + (Math.PI * i) / 10;
        bits.push(<circle key={i} cx={60 + Math.cos(a) * 44} cy={84 + Math.sin(a) * 44} r={i % 3 === 1 ? 6 : 7} fill={i % 3 === 1 ? RED : GREEN} />);
      }
      return (
        <>
          {bits}
          <path d="M16 84 A44 44 0 0 1 104 84 Z" fill={YELLOW} />
          <circle cx={36} cy={72} r={2} fill={ORANGE} stroke="none" />
          <circle cx={86} cy={68} r={2} fill={ORANGE} stroke="none" />
          <path d="M38 54 L54 61 M82 54 L66 61" strokeWidth={4} />
          <Eye x={47} y={66} r={5} />
          <Eye x={73} y={66} r={5} />
          <rect x={48} y={72} width={24} height={9} rx={2} fill="#fff" />
          <path d="M54 72 v9 M60 72 v9 M66 72 v9" strokeWidth={1.5} />
          <path d="M96 18 q4 6 0 12 M104 20 q-6 2 -12 0 M100 10 v8 M92 26 q6 -2 8 4" stroke={RED} strokeWidth={3.5} fill="none" />
          <Word y={110} size={21} fill={ORANGE}>
            HANGRY
          </Word>
        </>
      );
    }
    case "snack-stop":
      return (
        <g>
          <g transform="rotate(-10 60 60)">
            <rect x={18} y={38} width={84} height={20} rx={10} fill="#d9944d" />
            <rect x={8} y={44} width={104} height={20} rx={10} fill="#c8553d" />
            <path d="M16 50 l8 -4 l8 4 l8 -4 l8 4 l8 -4 l8 4 l8 -4 l8 4 l8 -4 l8 4 l8 -4" fill="none" stroke={YELLOW} strokeWidth={3.5} />
            <rect x={18} y={56} width={84} height={24} rx={12} fill="#e8b26a" />
            <path d="M44 66 q4 -4 8 0 M68 66 q4 -4 8 0" fill="none" strokeWidth={3} />
            <path d="M54 71 q6 6 12 0 Z" fill="#fff" />
            <path d="M58 74 q2 4 4 0" fill={PINK} strokeWidth={1.5} />
          </g>
          <path d={sparkle(102, 22, 7)} fill={YELLOW} />
          <Word y={109} size={16} fill={YELLOW}>
            SNACK STOP
          </Word>
        </g>
      );
    case "lost": {
      const spiral = (cx: number, cy: number) => {
        let d = `M${cx} ${cy}`;
        for (let t = 0; t <= 18; t++) {
          const a = t * 0.7;
          const r = 0.45 * t;
          d += ` L${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`;
        }
        return d;
      };
      return (
        <>
          <path d="M14 30 L42 36 L42 90 L14 84 Z" fill={CREAM} />
          <path d="M42 36 L70 30 L70 84 L42 90 Z" fill="#e6d29a" />
          <path d="M70 30 L98 36 L98 90 L70 84 Z" fill={CREAM} />
          <path d="M20 76 q10 -10 22 -4 t26 -6 t24 -16" fill="none" stroke={RED} strokeWidth={2.5} strokeDasharray="4 4" />
          <circle cx={30} cy={44} r={5} fill={GREEN} strokeWidth={2} />
          <circle cx={88} cy={76} r={4} fill={GREEN} strokeWidth={2} />
          <circle cx={44} cy={58} r={9} fill="#fff" strokeWidth={2.5} />
          <circle cx={68} cy={56} r={9} fill="#fff" strokeWidth={2.5} />
          <path d={spiral(44, 58)} fill="none" strokeWidth={1.8} />
          <path d={spiral(68, 56)} fill="none" strokeWidth={1.8} />
          <path d="M48 76 q4 -4 8 0 t8 0 t8 0" fill="none" strokeWidth={2.5} />
          <Word x={20} y={24} size={20} fill={YELLOW} rotate={-16}>
            ?
          </Word>
          <Word x={104} y={26} size={22} fill="#fff" rotate={14}>
            ?
          </Word>
          <Word y={112} size={22} fill={BLUE}>
            LOST
          </Word>
        </>
      );
    }
    case "yeehaw":
      return (
        <>
          <path d="M34 76 L34 60 Q34 52 42 52 L48 52 M86 66 L86 52 Q86 44 78 44 L72 44" fill="none" stroke={INK} strokeWidth={18} />
          <path d="M34 76 L34 60 Q34 52 42 52 L48 52 M86 66 L86 52 Q86 44 78 44 L72 44" fill="none" stroke={GREEN} strokeWidth={12} />
          <rect x={44} y={34} width={32} height={62} rx={16} fill={GREEN} />
          <path d="M50 48 l-4 -2 M70 50 l4 -2 M50 80 l-4 1 M71 84 l4 1 M60 92 v4" strokeWidth={2} />
          <circle cx={54} cy={56} r={2.6} fill={INK} stroke="none" />
          <circle cx={66} cy={56} r={2.6} fill={INK} stroke="none" />
          <path d="M51 64 Q60 74 69 64 Z" fill="#fff" />
          <circle cx={49} cy={62} r={2.5} fill={PINK} stroke="none" />
          <circle cx={71} cy={62} r={2.5} fill={PINK} stroke="none" />
          <ellipse cx={60} cy={36} rx={34} ry={8} fill={BROWN} />
          <path d="M42 36 Q42 14 52 16 Q60 22 68 16 Q78 14 78 36 Z" fill={BROWN} />
          <path d="M43 31 H77" stroke={RED} strokeWidth={4} />
          <Word y={112} size={20} fill={ORANGE}>
            YEEHAW!
          </Word>
        </>
      );
    case "lol": {
      const rays = [];
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6;
        const x1 = 60 + Math.cos(a) * 34;
        const y1 = 48 + Math.sin(a) * 34;
        const x2 = 60 + Math.cos(a) * 44;
        const y2 = 48 + Math.sin(a) * 44;
        rays.push(<path key={i} d={`M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}`} stroke={ORANGE} strokeWidth={5} />);
      }
      return (
        <>
          {rays}
          <circle cx={60} cy={48} r={30} fill={YELLOW} />
          <path d="M42 40 l8 4 l-8 4 M78 40 l-8 4 l8 4" fill="none" strokeWidth={3.2} />
          <path d="M42 54 Q60 80 78 54 Z" fill="#7a2a1f" />
          <path d="M50 64 Q60 72 70 64 Q64 70 60 70 Q54 70 50 64 Z" fill={PINK} strokeWidth={1.5} />
          <path d="M34 46 q-12 2 -16 12 q8 0 14 -6 Z" fill="#8fd0ff" strokeWidth={2} />
          <path d="M86 46 q12 2 16 12 q-8 0 -14 -6 Z" fill="#8fd0ff" strokeWidth={2} />
          <Word y={112} size={28} fill={YELLOW}>
            LOL
          </Word>
        </>
      );
    }
    case "nope":
      return (
        <>
          <path d="M28 40 L22 14 L46 28 Z M92 40 L98 14 L74 28 Z" fill="#7d838a" />
          <path d="M30 34 L26 20 L40 28 Z M90 34 L94 20 L80 28 Z" fill={PINK} strokeWidth={2} />
          <ellipse cx={60} cy={54} rx={38} ry={32} fill="#9aa0a6" />
          <ellipse cx={60} cy={68} rx={20} ry={14} fill="#fff" />
          <path d="M26 50 Q34 40 48 46 Q60 50 72 46 Q86 40 94 50 Q86 62 72 58 Q60 54 48 58 Q34 62 26 50 Z" fill={INK} />
          <circle cx={44} cy={51} r={5.5} fill="#fff" stroke="none" />
          <circle cx={76} cy={51} r={5.5} fill="#fff" stroke="none" />
          <circle cx={47} cy={52} r={2.6} fill={INK} stroke="none" />
          <circle cx={79} cy={52} r={2.6} fill={INK} stroke="none" />
          <path d="M38 40 L52 43 M68 43 L82 40" strokeWidth={3.5} />
          <ellipse cx={60} cy={64} rx={5} ry={3.5} fill={INK} />
          <path d="M52 76 Q60 71 68 76" fill="none" strokeWidth={3} />
          <Word y={111} size={24} fill={RED}>
            NOPE
          </Word>
        </>
      );
    case "gas-money":
      return (
        <>
          <path d="M76 44 Q96 44 96 60 L96 80 Q96 88 102 88" fill="none" strokeWidth={6} stroke={INK} />
          <path d="M76 44 Q96 44 96 60 L96 80 Q96 88 102 88" fill="none" strokeWidth={3} stroke="#555" />
          <rect x={96} y={84} width={14} height={8} rx={2} fill="#555" />
          <rect x={30} y={18} width={46} height={78} rx={7} fill={RED} />
          <rect x={38} y={26} width={30} height={20} rx={3} fill="#ffe9a8" />
          <text x={53} y={41} textAnchor="middle" fontSize={11} fontWeight={900} fill={INK} stroke="none" fontFamily="Outfit, system-ui, sans-serif">
            $$$
          </text>
          <path d="M42 58 q4 -3 8 0 M58 58 q4 -3 8 0" fill="none" strokeWidth={3} />
          <path d="M44 61 q-1 10 -3 16 M64 61 q1 10 3 16" stroke="#8fd0ff" strokeWidth={4} />
          <path d="M47 76 q6 -6 12 0" fill="none" strokeWidth={3} />
          <rect x={26} y={92} width={54} height={8} rx={3} fill="#555" />
          <Word y={115} size={18} fill={YELLOW}>
            GAS $$?
          </Word>
        </>
      );
    case "wish-here":
      return (
        <>
          <g transform="rotate(-6 60 50)">
            <rect x={12} y={18} width={96} height={64} rx={4} fill={CREAM} />
            <path d="M64 24 V76" stroke="#c9b48a" strokeWidth={2} />
            <rect x={80} y={24} width={22} height={26} rx={1} fill="#fff" strokeWidth={2} strokeDasharray="3 2" />
            <path d={heart(91, 38, 7)} fill={RED} strokeWidth={2} />
            <path d="M20 34 q8 -6 14 0 t14 0 M20 46 q8 -6 14 0 t14 0 M20 58 q8 -6 14 0 t10 0" fill="none" stroke={BLUE} strokeWidth={2.5} />
            <path d="M70 62 H100 M70 70 H96" stroke="#c9b48a" strokeWidth={2} />
          </g>
          <path d={heart(16, 92, 7)} fill={PINK} />
          <Word y={100} size={15} fill={PINK}>
            WISH U WERE
          </Word>
          <Word y={116} size={15} fill={PINK}>
            HERE
          </Word>
        </>
      );
    case "big-mood":
      return (
        <>
          <path d="M30 44 Q16 40 14 24 Q24 30 34 34 Z M90 44 Q104 40 106 24 Q96 30 86 34 Z" fill="#efe4cf" />
          {[
            [34, 40],
            [46, 30],
            [60, 27],
            [74, 30],
            [86, 40],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={13} fill="#4a2c17" />
          ))}
          <ellipse cx={60} cy={60} rx={34} ry={30} fill="#6b4226" />
          <ellipse cx={60} cy={76} rx={18} ry={12} fill="#9a6644" />
          <circle cx={54} cy={76} r={2.4} fill={INK} stroke="none" />
          <circle cx={66} cy={76} r={2.4} fill={INK} stroke="none" />
          <rect x={34} y={48} width={22} height={13} rx={5} fill={INK} />
          <rect x={64} y={48} width={22} height={13} rx={5} fill={INK} />
          <path d="M56 53 H64" strokeWidth={3} />
          <path d="M38 51 l5 0 M68 51 l5 0" stroke="#fff" strokeWidth={2} />
          <path d="M52 86 Q60 90 68 84" fill="none" strokeWidth={3} />
          <Word y={112} size={19} fill={YELLOW}>
            BIG MOOD
          </Word>
        </>
      );
    case "coffee":
      return (
        <>
          <path d="M48 32 q-6 -8 0 -14 q6 -6 0 -14 M62 32 q-6 -8 0 -14 q6 -6 0 -14 M76 32 q-6 -8 0 -14 q6 -6 0 -14" fill="none" stroke="#c9c2b8" strokeWidth={3.5} />
          <rect x={30} y={34} width={60} height={10} rx={4} fill="#fff" />
          <path d="M34 44 L86 44 L80 98 L40 98 Z" fill="#fff" />
          <path d="M36 60 L84 60 L82 80 L38 80 Z" fill={BROWN} />
          <path d="M46 52 q5 3 10 0 M64 52 q5 3 10 0" fill="none" strokeWidth={3} />
          <ellipse cx={60} cy={68} rx={3} ry={4} fill={INK} stroke="none" />
          <Word y={113} size={15} fill={YELLOW}>
            COFFEE PLS
          </Word>
        </>
      );
    case "traffic":
      return (
        <>
          <rect x={56} y={88} width={8} height={12} fill="#555" />
          <rect x={40} y={6} width={40} height={84} rx={10} fill="#2b2b2b" />
          <circle cx={60} cy={26} r={12} fill={RED} />
          <path d="M53 22 l5 2 M67 22 l-5 2" strokeWidth={2.5} />
          <circle cx={55.5} cy={27} r={1.8} fill={INK} stroke="none" />
          <circle cx={64.5} cy={27} r={1.8} fill={INK} stroke="none" />
          <path d="M55 33 q5 -3 10 0" fill="none" strokeWidth={2.5} />
          <circle cx={60} cy={50} r={10} fill="#6b5a20" />
          <circle cx={60} cy={72} r={10} fill="#245a2e" />
          <path d="M22 24 l8 4 M18 40 h10 M98 24 l-8 4 M102 40 h-10" strokeWidth={3.5} />
          <Word y={113} size={15} fill={ORANGE}>
            UGH, TRAFFIC
          </Word>
        </>
      );
    case "squirrel":
      return (
        <>
          <ellipse cx={88} cy={52} rx={18} ry={34} fill="#b8602e" transform="rotate(18 88 52)" />
          <ellipse cx={88} cy={52} rx={9} ry={24} fill="#d9894f" stroke="none" transform="rotate(18 88 52)" />
          <ellipse cx={56} cy={76} rx={20} ry={21} fill="#d47a3f" />
          <ellipse cx={54} cy={80} rx={11} ry={14} fill="#f1c79b" stroke="none" />
          <path d="M40 26 L42 14 L50 24 Z M62 24 L68 12 L72 26 Z" fill="#d47a3f" />
          <circle cx={56} cy={42} r={19} fill="#d47a3f" />
          <circle cx={48} cy={40} r={6.5} fill="#fff" />
          <circle cx={64} cy={40} r={6.5} fill="#fff" />
          <circle cx={48} cy={40} r={2.4} fill={INK} stroke="none" />
          <circle cx={64} cy={40} r={2.4} fill={INK} stroke="none" />
          <circle cx={56} cy={50} r={2.5} fill={INK} stroke="none" />
          <ellipse cx={56} cy={56} rx={3.5} ry={3} fill="#7a2a1f" strokeWidth={2} />
          <ellipse cx={56} cy={74} rx={7} ry={8} fill={BROWN} />
          <path d="M48 70 Q56 60 64 70 Z" fill="#5a3a24" />
          <circle cx={47} cy={74} r={4} fill="#d47a3f" />
          <circle cx={65} cy={74} r={4} fill="#d47a3f" />
          <Word x={24} y={30} size={22} fill={YELLOW} rotate={-12}>
            !!
          </Word>
          <Word y={113} size={17} fill={YELLOW}>
            SQUIRREL!
          </Word>
        </>
      );
    case "bucket-list":
      return (
        <>
          <path d="M34 44 Q60 14 86 44" fill="none" strokeWidth={3} />
          <path d="M30 46 L90 46 L82 96 L38 96 Z" fill="#8fb8de" />
          <ellipse cx={60} cy={46} rx={30} ry={7} fill="#cfe2f3" />
          <path d="M42 62 H78 M44 78 H76" stroke="#6b97c0" strokeWidth={2} />
          <path d="M40 38 L56 56 L98 12" fill="none" stroke={INK} strokeWidth={15} />
          <path d="M40 38 L56 56 L98 12" fill="none" stroke={GREEN} strokeWidth={8} />
          <path d={sparkle(16, 22, 7)} fill={YELLOW} />
          <path d={sparkle(104, 40, 5)} fill={YELLOW} />
          <Word y={113} size={16} fill={YELLOW}>
            BUCKET LIST
          </Word>
        </>
      );
    case "good-morning": {
      const rays = [];
      for (let i = 0; i < 9; i++) {
        const a = Math.PI + (i * Math.PI) / 8;
        rays.push(
          <path
            key={i}
            d={`M${(60 + Math.cos(a) * 30).toFixed(1)} ${(58 + Math.sin(a) * 30).toFixed(1)} L${(60 + Math.cos(a) * 40).toFixed(1)} ${(58 + Math.sin(a) * 40).toFixed(1)}`}
            stroke={ORANGE}
            strokeWidth={4.5}
          />,
        );
      }
      return (
        <>
          {rays}
          <circle cx={60} cy={58} r={24} fill={YELLOW} />
          <path d="M48 54 q4 -4 8 0 M64 54 q4 -4 8 0" fill="none" strokeWidth={3} />
          <path d="M52 62 Q60 70 68 62" fill="none" strokeWidth={3} />
          <path d="M8 96 L38 54 L64 96 Z" fill={GREEN} />
          <path d="M30 65 L38 54 L46 65 L41 62 L38 66 L34 62 Z" fill="#fff" strokeWidth={2} />
          <path d="M48 96 L80 48 L112 96 Z" fill="#3d8f5a" />
          <path d="M72 60 L80 48 L88 60 L84 57 L80 62 L76 57 Z" fill="#fff" strokeWidth={2} />
          <Word y={114} size={14} fill={YELLOW}>
            GOOD MORNING
          </Word>
        </>
      );
    }
    case "on-fire":
      return (
        <>
          <path d="M60 98 C30 98 22 74 30 56 C34 46 40 42 40 32 C48 38 50 46 50 50 C54 38 58 24 54 8 C70 18 78 34 76 50 C80 46 82 40 82 36 C94 50 96 68 90 80 C84 92 72 98 60 98 Z" fill={ORANGE} />
          <path d="M60 94 C42 94 38 80 42 70 C45 63 50 60 50 54 C56 60 56 64 56 66 C60 58 62 50 60 42 C70 50 74 60 72 70 C76 68 78 64 78 62 C84 72 82 82 78 86 C74 92 68 94 60 94 Z" fill={YELLOW} strokeWidth={2.5} />
          <rect x={46} y={66} width={12} height={8} rx={3} fill={INK} />
          <rect x={62} y={66} width={12} height={8} rx={3} fill={INK} />
          <path d="M58 69 H62" strokeWidth={2.5} />
          <path d="M52 80 Q60 86 68 80" fill="none" strokeWidth={3} />
          <Word y={113} size={20} fill={YELLOW}>
            ON FIRE
          </Word>
        </>
      );
    default:
      return <Word y={66}>?</Word>;
  }
}

/** One sticker. `play` changes to make it do its move again. */
export function StickerArt({ id, icon = "", color = "", size = 120, play = 0, still = false }: { id: string; icon?: string; color?: string; size?: number; play?: number; still?: boolean }) {
  const cut = useId().replace(/:/g, "");
  const info = stickerInfo(id);
  const me = useMemo(() => (info?.you ? avatarUrl(icon, color) : ""), [color, icon, info?.you]);
  return (
    <svg
      key={play}
      viewBox="-6 -6 132 132"
      width={size}
      height={size}
      role="img"
      aria-label={info?.label ?? "Sticker"}
      className={still || !info ? "block" : `block sticker-play sticker-${info.motion}`}
    >
      <defs>
        {/* A white edge all the way round, and a soft shadow: a die-cut sticker. */}
        <filter id={cut} x="-10%" y="-10%" width="120%" height="120%">
          <feMorphology in="SourceAlpha" operator="dilate" radius={4} result="grown" />
          <feFlood floodColor="#ffffff" />
          <feComposite in2="grown" operator="in" result="edge" />
          <feGaussianBlur in="grown" stdDeviation={1.6} result="blur" />
          <feOffset in="blur" dy={1.5} result="drop" />
          <feFlood floodColor="#000000" floodOpacity={0.28} />
          <feComposite in2="drop" operator="in" result="shadow" />
          <feMerge>
            <feMergeNode in="shadow" />
            <feMergeNode in="edge" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter={`url(#${cut})`} stroke={INK} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round">
        {art(id, me)}
      </g>
    </svg>
  );
}

/** A sticker in a chat: tap it to see it move again. */
export function ChatStickerView({ id, icon, color }: { id: string; icon: string; color: string }) {
  const [play, setPlay] = useState(0);
  return (
    <button type="button" onClick={() => setPlay((n) => n + 1)} aria-label={stickerInfo(id)?.label ?? "Sticker"} className="block">
      <StickerArt id={id} icon={icon} color={color} size={132} play={play} />
    </button>
  );
}

/** The sticker drawer: yours (with your avatar), then the road ones. Tap one to send it. */
export function StickerTray({ icon, color, onPick }: { icon: string; color: string; onPick: (sticker: StickerInfo) => void }) {
  const [tab, setTab] = useState<"you" | "road">("you");
  // Draw a few at a time, so the drawer opens straight away.
  const [shown, setShown] = useState(8);
  useEffect(() => {
    if (shown >= STICKERS.length) return;
    const id = window.setTimeout(() => setShown((n) => n + 8), 40);
    return () => window.clearTimeout(id);
  }, [shown]);
  const list = STICKERS.filter((sticker) => (tab === "you" ? sticker.you : !sticker.you));
  return (
    <div>
      <div className="grid grid-cols-2 rounded-xl bg-bg/60 p-1">
        {(
          [
            ["you", "With you"],
            ["road", "On the road"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)} className={"h-9 rounded-lg text-sm " + (tab === key ? "bg-elevated text-ink shadow-sm" : "text-muted")}>
            {label}
          </button>
        ))}
      </div>
      <div className="mt-3 grid max-h-[46dvh] grid-cols-4 gap-1 overflow-y-auto pb-1">
        {list.map((sticker, index) => (
          <button key={sticker.id} type="button" onClick={() => onPick(sticker)} aria-label={`Send ${sticker.label}`} className="grid aspect-square place-items-center rounded-xl active:bg-elevated">
            {index < shown ? <StickerArt id={sticker.id} icon={icon} color={color} size={76} still /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
