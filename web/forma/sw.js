// Forma — service worker: app offline (só a casca, nunca dados) e notificações com botões.
const VERSAO = 'forma-v1';
const CASCA = ['./', './index.html', './style.css', './app.js', './calc.js', './db.js', './medidas.js', './medidas-core.js', './manifest.webmanifest', './icon.svg', './icon-192.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('forma-') && k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Rede primeiro para os arquivos do app (pega atualização na hora); cache só se estiver offline.
// Nada de API ou dados passa por aqui.
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || !u.pathname.includes('/forma/')) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => { const c = r.clone(); caches.open(VERSAO).then((cc) => cc.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))));
});

function mostrar(d) {
  return self.registration.showNotification(d.titulo, {
    body: d.corpo, tag: d.tag || 'forma', renotify: true, icon: 'icon-192.png', badge: 'icon-192.png',
    actions: (d.acoes || []).slice(0, 2),
    data: { url: d.url, token: d.token, api: d.api },
  });
}

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { titulo: 'Forma', corpo: e.data?.text() || '' }; }
  e.waitUntil(mostrar(d));
});

self.addEventListener('notificationclick', (e) => {
  const n = e.notification, d = n.data || {};
  n.close();
  if (e.action && d.token && d.api) {
    e.waitUntil(fetch(d.api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: d.token, resposta: e.action }) })
      .then((r) => r.json())
      .then((j) => {
        if (j.proxima) return mostrar({ ...j.proxima, tag: 'forma-' + j.proxima.tipo, api: d.api });
        if (j.mensagem) return self.registration.showNotification(j.mensagem, { tag: 'forma-ok', silent: true, icon: 'icon-192.png' }).then(() => setTimeout(() => self.registration.getNotifications({ tag: 'forma-ok' }).then((ns) => ns.forEach((x) => x.close())), 4000));
      })
      .catch(() => self.clients.openWindow(d.url || './')));
    return;
  }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const alvo = new URL(d.url || './', self.registration.scope).href;
    const c = cs.find((x) => x.url.startsWith(self.registration.scope));
    if (c) return c.navigate(alvo).then((cc) => (cc || c).focus());
    return self.clients.openWindow(alvo);
  }));
});
