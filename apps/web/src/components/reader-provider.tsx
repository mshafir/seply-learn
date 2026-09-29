import * as React from "react"
import {
  fetchReaderTransport,
  IndexedDbReaderStore,
  ReaderClient,
} from "@umbel/sync"

import { ReaderContext } from "@/lib/reader.ts"
import { useSession } from "@/lib/session.ts"

/** One IndexedDB store for the page; marks are scoped by user (or "anon"). */
let sharedStore: IndexedDbReaderStore | null = null
function readerStore(): IndexedDbReaderStore {
  sharedStore ??= new IndexedDbReaderStore()
  return sharedStore
}

/**
 * The page's one reader client, for whoever is reading. A new reader (sign
 * in, sign out) replaces it. On sign-in the anonymous marks move into the
 * account (newest wins) and are saved.
 */
let current: ReaderClient | null = null
function readerFor(userId: string | null): ReaderClient {
  const scope = userId ? `user:${userId}` : "anon"
  if (current?.scope === scope) return current
  current?.dispose()
  const client = new ReaderClient({
    userId,
    transport: userId ? fetchReaderTransport() : undefined,
    store: readerStore(),
    onError: (e) => console.warn("reader:", e),
  })
  if (userId)
    client
      .adoptAnonymous()
      .catch((e) =>
        console.error("reader: keeping your anonymous progress failed", e)
      )
  current = client
  return client
}

/** Provides the reader client for the session (null while it loads). */
export function ReaderProvider({ children }: { children: React.ReactNode }) {
  const { session } = useSession()
  const client =
    session.status === "loading"
      ? null
      : readerFor(session.status === "signed-in" ? session.user.id : null)

  // Marks queued offline are saved when the connection returns.
  React.useEffect(() => {
    if (!client) return
    const online = () => void client.flush()
    window.addEventListener("online", online)
    return () => window.removeEventListener("online", online)
  }, [client])

  return <ReaderContext value={client}>{children}</ReaderContext>
}
