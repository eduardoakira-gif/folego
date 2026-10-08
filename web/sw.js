// Service worker: abre offline com a última versão da interface.
// Dados financeiros NUNCA são guardados em cache — sempre vêm do servidor.
const CACHE = "folego-v2";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // API/Supabase: rede direto
  // "no-cache": sempre confere com o servidor se há versão nova (sem isso o navegador
  // reaproveita a cópia antiga por até 10 minutos e a atualização não aparece)
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then((r) => {
    const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request).then((m) => m || caches.match("index.html"))));
});
