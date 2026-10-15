// A new version of the web client, while a tab is open (spec §2.9). The
// service worker (sw/sw.ts) takes over open tabs as soon as it installs, but a
// tab keeps running the code it loaded. So it offers a reload, and never
// reloads by itself: the reader may be in the middle of something.
import { toast } from "@seply/ui/components/toast"

/** How often an open tab asks the server whether there is a new version. */
const CHECK_EVERY_MS = 60 * 60_000

export function watchForUpdates() {
  if (!("serviceWorker" in navigator)) return
  const workers = navigator.serviceWorker
  // A tab's first service worker isn't an update: nothing it runs is old.
  let current = workers.controller !== null
  let offered = false
  workers.addEventListener("controllerchange", () => {
    if (!current) {
      current = true
      return
    }
    if (offered) return
    offered = true
    toast.add({
      title: "Seply Learn was updated",
      description: "Reload to use the new version.",
      timeout: 0,
      actionProps: {
        children: "Reload",
        onClick: () => window.location.reload(),
      },
    })
  })

  // Browsers look for a new worker on each page load; a tab left open asks
  // too, when it comes back into view and every hour.
  const check = () =>
    void workers
      .getRegistration()
      .then((r) => r?.update())
      .catch(() => {})
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check()
  })
  window.setInterval(check, CHECK_EVERY_MS)
}
