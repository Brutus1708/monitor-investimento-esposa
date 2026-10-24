// Service worker: busca sempre na rede primeiro e guarda uma cópia para abrir sem internet.
const CACHE = "monitor-v3";
const ARQUIVOS = ["./", "index.html", "app.css", "core.js", "telas.js", "folhas.js", "main.js", "manifest.json", "icon.svg", "data.json", "noticias.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  const chave = url.origin + url.pathname;  // ignora ?t= e ?v=
  e.respondWith(
    fetch(req)
      .then(r => {
        if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put(chave, copia)); }
        return r;
      })
      .catch(() => caches.match(chave).then(r => r || caches.match(req, { ignoreSearch: true })))
  );
});
