/**
 * Android back inside the app. Screens that cover others (a photo, the photo
 * review, the map's menu and cards) each register a handler while they're
 * open; back asks the newest one first and works down. A handler returns true
 * when it closed something. Only when nothing is left to close does back
 * leave the app (src/routes/__root.tsx).
 */
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
