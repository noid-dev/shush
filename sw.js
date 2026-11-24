// Offline mode - service worker (network-first).
//
// On every page load:
//   - try to download the latest app (the page + every file it needs, see below)
//   - done within 1 s   -> serve it
//   - slower            -> serve the stored copy; the download continues and is stored when done
//   - failed / offline  -> serve the stored copy
//   - nothing stored    -> wait for the download; if it fails, the browser shows "can't connect"
// Every other same-origin GET (CSS, JS, fonts, images) is served from the stored copy, so it
// matches the page. A new version is stored only when every file arrived; files that are no
// longer part of the app are then removed from the stored copy.
//
// Turning offline mode off: never just delete this file (browsers keep the old worker when
// sw.js returns 404). Deploy this instead; it reaches users on their next online visit:
//   self.addEventListener('install', () => self.skipWaiting());
//   self.addEventListener('activate', e => e.waitUntil(
//     caches.delete('offline ' + self.registration.scope).then(() => self.registration.unregister())));

const BASE_URL = self.registration.scope;
const OFFLINE_STORE = 'offline ' + BASE_URL;

self.addEventListener('install', e => {
  e.waitUntil(updateStore().then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  if (req.mode === 'navigate') e.respondWith(onPageLoad(e));
  else e.respondWith(onFileLoad(req));
});

// ---- Requests ----

async function onPageLoad(event) {
  const stored = await storedFile(BASE_URL);
  if (stored && !self.navigator.onLine) return stored;

  const update = updateStore();
  event.waitUntil(update.catch(() => {})); // let a slow download finish

  const updated = update.then(() => storedFile(BASE_URL));
  if (!stored) return updated;

  const timeout = new Promise(r => setTimeout(r, 1000, null));
  return (await Promise.race([updated.catch(() => null), timeout])) || stored;
}

async function onFileLoad(req) {
  return (await storedFile(req.url)) || fetch(req);
}

function storedFile(url) {
  return caches.match(url, { cacheName: OFFLINE_STORE });
}

// ---- Updating the stored copy ----

let updating = null;
function updateStore() {
  updating ||= download().finally(() => { updating = null; });
  return updating;
}

async function download() {
  // no-cache: ask the server if changed; 304 reaches this code as a normal 200.
  // redirect:'error': any redirect (301/302/303/307/308) fails the request.
  const options = { cache: 'no-cache', redirect: 'error' };
  const get = async url => {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + url);
    return [url, res];
  };

  // Download in waves: the page, then what it references, then what those reference...
  const files = new Map();   // url -> response
  let wave = [BASE_URL];
  while (wave.length) {
    const next = new Set();
    for (const [url, res] of await Promise.all(wave.map(get))) {
      files.set(url, res);
      for (const ref of await references(url, res)) next.add(ref);
    }
    wave = [...next].filter(url => !files.has(url));
  }

  const cache = await caches.open(OFFLINE_STORE);
  for (const [url, res] of files) if (url !== BASE_URL) await cache.put(url, res);
  await cache.put(BASE_URL, files.get(BASE_URL));
  for (const req of await cache.keys()) if (!files.has(req.url)) await cache.delete(req);
}

async function references(url, res) {
  const path = new URL(url).pathname;
  let text, pattern;
  if (url === BASE_URL || path.endsWith('.html')) {
    text = (await res.clone().text()).replace(/<!--[\s\S]*?-->/g, '');
    pattern = /<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  } else if (path.endsWith('.js') || path.endsWith('.mjs')) {
    text = await res.clone().text();
    pattern = /^[ \t]*(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]|^[ \t]*import\s*['"]([^'"]+)['"]/gm;
  } else if (path.endsWith('.css')) {
    text = (await res.clone().text()).replace(/\/\*[\s\S]*?\*\//g, '');
    pattern = /url\(\s*['"]?([^'")]+)['"]?\s*\)|@import\s+['"]([^'"]+)['"]/gi;
  } else {
    return [];
  }

  const refs = [];
  for (const m of text.matchAll(pattern)) {
    try {
      const ref = new URL(m[1] ?? m[2], url);
      if (ref.origin === location.origin) refs.push(ref.origin + ref.pathname + ref.search);
    } catch { /* not a valid address: ignore */ }
  }
  return refs;
}
