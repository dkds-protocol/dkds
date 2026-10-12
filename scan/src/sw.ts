/**
 * The service worker. The application, the QR decoder and the fonts are stored when the
 * worker is installed, so that the verifier opens without a network. pdf.js is stored when it is first
 * used. Requests to other origins, which are the DNS queries, are neither intercepted nor stored.
 */

declare const self: ServiceWorkerGlobalScope;
/** The files stored at installation, relative to the worker; set by the build. */
declare const PRECACHE: readonly string[];
/** The name of this version's cache; set by the build. */
declare const CACHE: string;
/** The name of the cache of pdf.js, which depends only on its version; set by the build. */
declare const PDF_CACHE: string;

const scope = new URL("./", self.location.href);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((path) => new URL(path, scope).href)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE && n !== PDF_CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

/** The addresses of the application's page, relative to the scope, with or without a query. */
const APP_PAGES = ["", "index.html"];

async function respond(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.slice(scope.pathname.length);
  // The application's page is answered from the cache. Other files opened as pages, such as
  // licences.txt, are answered like any other request below.
  if (request.mode === "navigate" && APP_PAGES.includes(path)) {
    const cached = await caches.match(new URL("./", scope).href, { cacheName: CACHE });
    return cached ?? fetch(request);
  }
  if (path.startsWith("pdf/")) {
    const cache = await caches.open(PDF_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  }
  const cached = await caches.match(request, { cacheName: CACHE });
  return cached ?? fetch(request);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  event.respondWith(respond(event.request));
});

export {};
