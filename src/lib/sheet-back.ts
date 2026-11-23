/** The map screen registers this so Android back can lower the menu before leaving the app. */
let hide: (() => boolean) | null = null;

export function bindSheetBack(next: (() => boolean) | null) {
  hide = next;
}

export function hideCoveringSheet() {
  return hide?.() ?? false;
}
