/**
 * Android back inside the app. Screens that cover others (a photo, the photo
 * review, the map's menu and cards) each register a handler while they're
 * open; back asks the newest one first and works down. A handler returns true
 * when it closed something. Only when nothing is left to close does back
 * leave the app (src/routes/__root.tsx).
 */
import { useEffect, useRef } from "react";

type Handler = () => boolean;

const stack: Handler[] = [];

/** Register a back handler; call the returned function to remove it. */
export function pushBack(handler: Handler) {
  stack.push(handler);
  return () => {
    const at = stack.lastIndexOf(handler);
    if (at >= 0) stack.splice(at, 1);
  };
}

export function hideCoveringSheet() {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]!()) return true;
  }
  return false;
}

/**
 * Back closes this screen. Registered once, when the screen opens, so it keeps
 * its place in line: re-registering on every redraw (a new onClose each time)
 * used to move it above things opened on top of it later, like the message
 * menu, so back closed the wrong thing.
 */
export function useBackClose(onClose: () => void, active = true) {
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => {
    if (!active) return;
    return pushBack(() => {
      latest.current();
      return true;
    });
  }, [active]);
}
