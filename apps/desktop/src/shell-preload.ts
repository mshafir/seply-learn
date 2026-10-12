// Preload for the shell page (the server picker): the few calls it makes to
// the main process. Only the shell window loads this.
import { contextBridge, ipcRenderer } from "electron"

import { SHELL_CHANNELS, type ShellApi } from "./shell-api.ts"

const api: ShellApi = {
  state: () => ipcRenderer.invoke(SHELL_CHANNELS.state),
  save: (address) => ipcRenderer.invoke(SHELL_CHANNELS.save, address),
  retry: () => ipcRenderer.invoke(SHELL_CHANNELS.retry),
}

contextBridge.exposeInMainWorld("seplyShell", api)
