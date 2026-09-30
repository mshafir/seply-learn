// Web push (spec §2.5): subscribe this browser so a build that finishes
// while the reader is away can tell them. Asked for on the first "Leave it
// building" (WP-3.7 adds the prompt); the service worker shows the
// notifications (sw/push-sw.js).

export type PushOutcome =
  /** Subscribed, and the server knows. */
  | "enabled"
  /** The reader said no (or blocked notifications before). */
  | "denied"
  /** This browser can't do web push. */
  | "unsupported"
  /** This server has web push off (no VAPID keys). */
  | "unavailable"

export function pushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window
  )
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/")
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

/** Asks for permission (if needed), subscribes, and registers the subscription. */
export async function enablePush(): Promise<PushOutcome> {
  if (!pushSupported()) return "unsupported"
  const res = await fetch("/api/web-push/key")
  if (res.status === 404) return "unavailable"
  if (!res.ok) throw new Error(`web push key: ${res.status}`)
  const { publicKey } = (await res.json()) as { publicKey: string }
  const permission = await Notification.requestPermission()
  if (permission !== "granted") return "denied"
  const reg = await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }))
  const saved = await fetch("/api/web-push/subscriptions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  })
  if (!saved.ok) throw new Error(`web push subscribe: ${saved.status}`)
  return "enabled"
}

/** Unsubscribes this browser and tells the server. */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  await fetch("/api/web-push/subscriptions", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  })
  await sub.unsubscribe()
}
