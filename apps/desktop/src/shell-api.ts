// What the shell page (renderer/) can ask the main process, over IPC. The
// page is the app's own, loaded from disk; a server's page never gets this.
import type { ServerCheck } from "./server-url.ts"

export type ShellMode = "picker" | "unreachable"

export type ShellState = {
  mode: ShellMode
  /** The chosen server's origin. */
  server: string
  /** The hosted server's origin. */
  defaultServer: string
}

export type ShellApi = {
  state(): Promise<ShellState>
  /** Checks an address and, if a Seply Learn server answers, switches to it. */
  save(address: string): Promise<ServerCheck>
  /** Loads the chosen server again. */
  retry(): Promise<void>
}

export const SHELL_CHANNELS = {
  state: "shell:state",
  save: "shell:save",
  retry: "shell:retry",
} as const
