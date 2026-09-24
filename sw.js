/* ==========================================================================
   Le Bar — Service worker (v2)
   Règle d'or : on ne met en cache QUE les fichiers du site (même origine).
   Les appels réseau vers Supabase, Gemini, etc. passent TOUJOURS directement
   au réseau (jamais de cache) — sinon la liste des bouteilles serait périmée.
   Stratégie pour le site : "réseau d'abord" (toujours la dernière version),
   repli sur le cache uniquement si hors-ligne.
   ========================================================================== */
const CACHE = "le-bar-v2";
const CORE = ["./", "./index.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.allSettled(CORE.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Ne gérer QUE les GET du site lui-même. Tout le reste (API Supabase,
  // Gemini, Storage…) n'est pas intercepté -> réseau direct, jamais mis en cache.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // Réseau d'abord, repli cache si hors-ligne
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html"))),
  );
});
