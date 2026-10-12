// Preload for the main window: the bridge a server's page sees as
// `window.seplyDesktop` (spec §10.5). It is the whole native surface, and it is
// attached only on the chosen server's origin. This work package ships it
// with its version alone; sign-in, notifications and files add their members.
import { contextBridge } from "electron"

import { onServer } from "./navigation.ts"
import { BRIDGE_VERSION } from "./server-url.ts"

const FLAG = "--seply-server="
const server = process.argv.find((a) => a.startsWith(FLAG))?.slice(FLAG.length)

if (server && onServer(location.href, server))
  contextBridge.exposeInMainWorld("seplyDesktop", { version: BRIDGE_VERSION })
