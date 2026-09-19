/* ==========================================================================
   Le Bar — Service worker (cache hors-ligne)
   Stratégie : "cache-first" avec mise en cache à la volée.
   L'appel à l'IA (api.anthropic.com) n'est jamais mis en cache.
   ========================================================================== */
const CACHE = "le-bar-v1";
const CORE = ["./", "./index.html", "./le-bar.html"];

// Installation : pré-cache du minimum, puis activation immédiate
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(CORE.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

// Activation : nettoyage des anciens caches
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Requêtes : cache d'abord, sinon réseau (et on met en cache au passage)
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                       // pas les POST (ex. IA)
  if (req.url.indexOf("api.anthropic.com") > -1) return;  // jamais mettre l'IA en cache

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("./") || caches.match("./index.html"));
    })
  );
});
