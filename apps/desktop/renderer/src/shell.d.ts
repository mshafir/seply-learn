import type { ShellApi } from "../../src/shell-api.ts"

declare global {
  interface Window {
    /** The main process, as shell-preload.ts exposes it. */
    seplyShell: ShellApi
  }
}
