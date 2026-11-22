const SHELL = "atlas-shell-v1";
// Keep in sync with ATLAS_CACHE in src/lib/atlas-files.ts; bump when atlas data changes.
const FILES = "atlas-files-v5";
const TILES = "atlas-tiles-v1";
const TILE_LIMIT = 2500;
// The Android app (Capacitor) serves the page from https://localhost with the
// atlas files built in, so they are never cached here: a cached copy would
// outlive an app update that ships new data.
const IN_APP = self.location.origin === "https://localhost" || self.location.origin === "capacitor://localhost";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop atlas data cached by older versions so fixed files are fetched again.
      const names = await caches.keys();
      // In the app, drop any atlas copy saved before it stopped caching them.
      await Promise.all(
        names
          .filter((name) => name.startsWith("atlas-files") && (IN_APP || name !== FILES))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/@") || url.pathname.startsWith("/src/") || url.pathname.startsWith("/__vite") || url.pathname.includes("node_modules")) return;
  if (url.origin === self.location.origin && url.pathname.startsWith("/atlas/")) {
    if (IN_APP) return;
    event.respondWith(cacheFirst(FILES, req));
    return;
  }
  if (url.hostname.endsWith("openfreemap.org") || url.hostname.endsWith("openstreetmap.org")) {
    event.respondWith(cacheFirst(TILES, req, TILE_LIMIT));
    return;
  }
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(SHELL, req));
    return;
  }
  if (url.origin === self.location.origin && (req.mode === "navigate" || url.pathname.startsWith("/assets/") || url.pathname.startsWith("/__grok/"))) {
    event.respondWith(networkFirst(SHELL, req));
  }
});

async function cacheFirst(name, req, limit) {
  const cache = await caches.open(name);
  const url = new URL(req.url);
  const fresh = url.searchParams.has("fresh") || req.cache === "no-store";
  if (!fresh) {
    const hit = await cache.match(req);
    if (hit) return hit;
  }
  const networkReq = fresh ? new Request(url.pathname, { cache: "reload" }) : req;
  const res = await fetch(networkReq);
  if (res.ok && !fresh) {
    await cache.put(req, res.clone());
    if (limit) await trim(cache, limit);
  }
  return res;
}

async function networkFirst(name, req) {
  const cache = await caches.open(name);
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(req, res.clone());
    return res;
  } catch {
    const hit = (await cache.match(req)) || (await cache.match("/"));
    if (hit) return hit;
    throw new Error("offline");
  }
}

async function trim(cache, max) {
  const keys = await cache.keys();
  if (keys.length <= max) return;
  await Promise.all(keys.slice(0, keys.length - max).map((key) => cache.delete(key)));
}
