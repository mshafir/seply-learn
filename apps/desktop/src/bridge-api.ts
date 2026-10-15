// The IPC behind the bridge (spec §10.5): what the main window's preload may
// ask the main process for. Each handler checks that the server's own page,
// in the main window's top frame, is asking.
export const BRIDGE_CHANNELS = {
  signIn: "bridge:sign-in",
} as const
