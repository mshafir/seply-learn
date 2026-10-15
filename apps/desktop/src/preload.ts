// Preload for the main window: the bridge a server's page sees as
// `window.seplyDesktop` (spec §10.5). It is the whole native surface, and it is
// attached only on the chosen server's origin. Notifications and files add
// their members with their work packages.
import { contextBridge, ipcRenderer } from "electron"

import { BRIDGE_CHANNELS } from "./bridge-api.ts"
import { onServer } from "./navigation.ts"
import { BRIDGE_VERSION } from "./server-url.ts"

const FLAG = "--seply-server="
const server = process.argv.find((a) => a.startsWith(FLAG))?.slice(FLAG.length)

if (server && onServer(location.href, server))
  contextBridge.exposeInMainWorld("seplyDesktop", {
    version: BRIDGE_VERSION,
    /** Opens the server's /desktop/sign-in in the system browser (§10.3). */
    signInWithBrowser: (): Promise<void> =>
      ipcRenderer.invoke(BRIDGE_CHANNELS.signIn),
  })
