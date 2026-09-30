// Web push in the service worker (spec §2.5). Workbox's generated worker
// imports this file (vite.config.ts, `workbox.importScripts`). A push is the
// server's JSON: { title, body, url, tag } (packages/server, JobNotification).
/* global self, clients */

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : "" }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Seply Learn", {
      body: data.body || "",
      tag: data.tag,
      icon: "/icon-192.png",
      badge: "/favicon-32.png",
      data: { url: data.url || "/" },
    })
  )
})

// A click focuses a tab already on that page, or opens one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = new URL(
    (event.notification.data && event.notification.data.url) || "/",
    self.location.origin
  ).href
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((tabs) => {
        const open = tabs.find((t) => t.url === url)
        return open ? open.focus() : clients.openWindow(url)
      })
  )
})
