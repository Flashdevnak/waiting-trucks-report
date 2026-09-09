const VERSION = "20260909-03-lower-reference";

// The approved lower-card/table presentation now lives in ms.js + style.css.
// Keep the service worker limited to freshness; do not inject runtime UI patches.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin || event.request.method !== "GET") return;
  url.searchParams.set("__fresh", VERSION);
  event.respondWith(
    fetch(url.toString(), {
      cache: "no-store",
      credentials: event.request.credentials,
      headers: event.request.headers,
      redirect: "follow",
    }).catch(() => fetch(event.request)),
  );
});
