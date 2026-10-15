// The web client's service worker (spec §2.9). vite-plugin-pwa builds it
// (`injectManifest`) and fills in the precache list: the app shell's HTML, JS,
// CSS, fonts and icons. It caches no API responses: Expeditions for offline
// reading live in IndexedDB (src/lib/offline.ts).
//
// Pages load from the network first, so a deploy shows on the next load.
// Offline, or after a few seconds without an answer, a page gets the
// precached index.html. Pages are never stored at runtime, so offline always
// gets the index.html that matches the precached JS.
import { clientsClaim } from "workbox-core"
import {
  cleanupOutdatedCaches,
  matchPrecache,
  precacheAndRoute,
} from "workbox-precaching"
import { NavigationRoute, registerRoute } from "workbox-routing"
import { NetworkOnly } from "workbox-strategies"

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Parameters<typeof precacheAndRoute>[0]
}

// Web push: show a job's notification, open its Expedition on click (§2.5).
importScripts("/push-sw.js")

// A new version takes over open tabs at once; they offer a reload
// (src/lib/app-updates.ts).
void self.skipWaiting()
clientsClaim()

/** How long a page waits for the network before the cached shell. */
const NETWORK_TIMEOUT_SECONDS = 3

const network = new NetworkOnly({
  networkTimeoutSeconds: NETWORK_TIMEOUT_SECONDS,
})

// Registered before the precache, so "/" goes to the network too. The
// server's own paths and the live embed are left to the server (the embed is
// Public only, with its own frame-ancestors): never the app shell.
registerRoute(
  new NavigationRoute(
    async (options) => {
      try {
        return await network.handle(options)
      } catch {
        return (await matchPrecache("/index.html")) ?? Response.error()
      }
    },
    {
      denylist: [
        /^\/api\//,
        /^\/mcp$/,
        /^\/\.well-known\//,
        /^\/e\/[^/]+\/embed\/?$/,
      ],
    }
  )
)

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
