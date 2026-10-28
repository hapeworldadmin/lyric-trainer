const CACHE = "ktv-shell-v17";
const SHELL = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/app.js",
  "./site.webmanifest",
  "./favicon.svg",
  "./icon-180.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "apply") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;
  if (url.pathname.includes("/.netlify/")) return;
  event.respondWith(
    fetch(event.request).then((response) => response).catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
  );
});
