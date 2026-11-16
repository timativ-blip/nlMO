// Сервис-воркер: приложение открывается как программа и запускается без сети.
// Данные из Supabase и Telegram не кешируются — только оболочка сайта.
const CACHE = 'kc-v16-blue-startup-media-writers';
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './icon-192.png', './logo-light.png', './logo-dark.png']))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // файлы сборки с хешем в имени не меняются — берём из кеша
  if (url.pathname.includes('/assets/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })));
    return;
  }
  // остальное — сначала сеть (свежая версия сайта), без сети — из кеша
  e.respondWith(fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))));
});

// Every push produces a visible notification, including on iPhone Home Screen apps.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch { /* Use a safe generic notification. */ }
  const link = typeof data.link === 'string' && /^#\/[a-z]/.test(data.link) ? data.link : '#/home';
  event.waitUntil(self.registration.showNotification(typeof data.title === 'string' ? data.title.slice(0,100) : 'Командный центр', {
    body: typeof data.body === 'string' ? data.body.slice(0,500) : 'В рабочем кабинете новое уведомление.',
    icon: new URL('icon-192.png',self.registration.scope).href,
    badge: new URL('favicon-64.png',self.registration.scope).href,
    tag: typeof data.id === 'string' ? 'kc-'+data.id.slice(0,160) : undefined,
    data: { link },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link;
  const target = new URL(typeof link === 'string' && /^#\/[a-z]/.test(link) ? link : '#/home',self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const app = windows.find(client => client.url.startsWith(self.registration.scope));
    if (app) { await app.navigate(target); await app.focus(); }
    else await self.clients.openWindow(target);
  })());
});
