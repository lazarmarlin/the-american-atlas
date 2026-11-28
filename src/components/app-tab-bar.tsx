/**
 * The tabs along the bottom: Map, Chats, the camera, Boards, and You (your
 * places, trips, badges and friends: the menu that used to slide up). Always
 * there, so messages are one tap away from anywhere.
 */
import { useEffect, useRef } from "react";
import { Camera, ListTodo, Map as MapIcon, MessageCircle } from "lucide-react";
import { YouMarkerFace } from "@/components/you-marker-face";

export type AppTab = "map" | "chats" | "boards" | "you";

export function AppTabBar({
  active,
  unread,
  boardsDot,
  icon,
  color,
  onTab,
  onCamera,
}: {
  active: AppTab;
  unread: number;
  /** Something on a board needs a look (car care due). */
  boardsDot: boolean;
  /** Your map avatar, on the You tab. */
  icon: string;
  color: string;
  onTab: (tab: AppTab) => void;
  onCamera: () => void;
}) {
  const bar = useRef<HTMLElement>(null);
  // Chats and Boards open above the bar: they need its height.
  useEffect(() => {
    const node = bar.current;
    if (!node) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty("--tabs-h", `${node.offsetHeight}px`);
    set();
    const watch = new ResizeObserver(set);
    watch.observe(node);
    return () => {
      watch.disconnect();
      root.style.removeProperty("--tabs-h");
    };
  }, []);

  const tab = (id: AppTab, label: string, glyph: React.ReactNode, extra?: React.ReactNode) => (
    <button
      type="button"
      onClick={() => onTab(id)}
      aria-current={active === id ? "page" : undefined}
      aria-label={id === "chats" && unread ? `Chats, ${unread} new` : label}
      className={"relative flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] " + (active === id ? "text-ink" : "text-muted")}
    >
      <span className={"relative grid h-7 w-12 place-items-center rounded-full transition-colors " + (active === id ? "bg-elevated" : "")}>
        {glyph}
        {extra}
      </span>
      <span className={active === id ? "font-medium" : ""}>{label}</span>
    </button>
  );

  return (
    <nav ref={bar} aria-label="Main" className="app-tabs relative z-20 flex items-end border-t border-line bg-surface px-1">
      {tab("map", "Map", <MapIcon className="size-5" strokeWidth={active === "map" ? 2.2 : 1.8} />)}
      {tab(
        "chats",
        "Chats",
        <MessageCircle className="size-5" strokeWidth={active === "chats" ? 2.2 : 1.8} />,
        unread ? (
          <span className="absolute -top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink">{unread > 99 ? "99+" : unread}</span>
        ) : null,
      )}
      <div className="flex h-14 flex-1 items-center justify-center">
        <button
          type="button"
          onClick={onCamera}
          aria-label="Take a picture to send"
          className="-mt-5 grid size-14 place-items-center rounded-full border-4 border-surface bg-accent text-accent-ink shadow-md active:scale-95"
        >
          <Camera className="size-6" strokeWidth={2} />
        </button>
      </div>
      {tab(
        "boards",
        "Boards",
        <ListTodo className="size-5" strokeWidth={active === "boards" ? 2.2 : 1.8} />,
        boardsDot ? <span className="absolute top-0 right-2.5 size-2.5 rounded-full border-2 border-surface bg-accent" aria-label="Car care due" /> : null,
      )}
      {tab(
        "you",
        "You",
        <span className={"grid size-7 place-items-center rounded-full " + (active === "you" ? "" : "opacity-90")}>
          <YouMarkerFace icon={icon} color={color} size={26} />
        </span>,
      )}
    </nav>
  );
}
