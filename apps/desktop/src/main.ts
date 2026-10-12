// The desktop app's main process (spec §10): one window that loads the chosen
// server's web client, a small shell window for choosing the server and for
// "Can't reach the server", and the menu. The rules it applies live in
// navigation.ts, server-url.ts and settings.ts.
//
// For development and tests: SEPLY_DESKTOP_SERVER opens that server without
// saving it, SEPLY_DESKTOP_USER_DATA moves the user-data folder, and
// SEPLY_DESKTOP_REGISTER_SCHEME=1 makes an unpackaged run the handler of
// seply:// links (a packaged app always is).
import path from "node:path"
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  session,
  shell,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from "electron"

import { BRIDGE_CHANNELS } from "./bridge-api.ts"
import { linkInArgs, parseDeepLink, SCHEME } from "./deep-link.ts"
import { ALLOWED_PERMISSIONS, navigation, onServer } from "./navigation.ts"
import { checkServer, DEFAULT_SERVER, parseServer } from "./server-url.ts"
import { readSettings, writeSettings, type Settings } from "./settings.ts"
import { SHELL_CHANNELS, type ShellMode, type ShellState } from "./shell-api.ts"
import { completeUrl, startSignIn, type PendingSignIn } from "./sign-in.ts"

if (process.env.SEPLY_DESKTOP_USER_DATA)
  app.setPath("userData", process.env.SEPLY_DESKTOP_USER_DATA)

const settingsFile = () => path.join(app.getPath("userData"), "settings.json")

let settings: Settings = { server: DEFAULT_SERVER }
let mainWindow: BrowserWindow | null = null
let shellWindow: BrowserWindow | null = null
let shellMode: ShellMode = "picker"
/** The sign-in the app sent to the browser and is waiting for (§10.3). */
let pendingSignIn: PendingSignIn | null = null
/** A link that arrived before the app was ready. */
let waitingLink: string | undefined

/** Opens a link in the system browser: web and mail links only. */
function openExternal(url: string) {
  if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
}

function saveBounds() {
  if (!mainWindow || mainWindow.isMinimized() || mainWindow.isFullScreen())
    return
  settings = { ...settings, bounds: mainWindow.getBounds() }
  try {
    writeSettings(settingsFile(), settings)
  } catch (e) {
    console.error("settings: couldn't save", e)
  }
}

function loadServer() {
  void mainWindow?.loadURL(`${settings.server}/`).catch(() => {
    // did-fail-load shows "Can't reach the server".
  })
}

function createMainWindow() {
  const server = settings.server
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    ...settings.bounds,
    minWidth: 480,
    minHeight: 400,
    title: "Seply Learn",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      additionalArguments: [`--seply-server=${server}`],
    },
  })
  mainWindow = win
  const contents = win.webContents

  // The window stays on the chosen server (spec §10.5).
  const guard = (event: Electron.Event, url: string) => {
    const where = navigation(url, server)
    if (where === "allow") return
    event.preventDefault()
    if (where === "external") openExternal(url)
  }
  contents.on("will-navigate", guard)
  contents.on("will-redirect", guard)
  contents.setWindowOpenHandler(({ url }) => {
    const where = navigation(url, server)
    if (where === "allow") void win.loadURL(url)
    else if (where === "external") openExternal(url)
    return { action: "deny" }
  })

  contents.on("did-fail-load", (_e, code, _desc, _url, isMainFrame) => {
    // -3: a navigation replaced by another one. Not a failure.
    if (!isMainFrame || code === -3) return
    void win.loadURL("about:blank")
    showShell("unreachable")
  })

  win.on("close", saveBounds)
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null
  })
  loadServer()
}

function showShell(mode: ShellMode) {
  shellMode = mode
  if (shellWindow) {
    shellWindow.webContents.reload()
    shellWindow.focus()
    return
  }
  const win = new BrowserWindow({
    width: 520,
    height: 520,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    parent: mainWindow ?? undefined,
    title: "Seply Learn",
    webPreferences: {
      preload: path.join(__dirname, "shell-preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  })
  shellWindow = win
  win.setMenuBarVisibility(false)
  // The shell page never leaves itself.
  win.webContents.on("will-navigate", (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  win.on("closed", () => {
    if (shellWindow === win) shellWindow = null
  })
  void win.loadFile(path.join(__dirname, "renderer", "index.html"))
}

/** Brings the main window forward, making it if it was closed. */
function focusMain() {
  if (!mainWindow) createMainWindow()
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.focus()
}

function tell(message: string, detail: string) {
  const options = { type: "info" as const, message, detail }
  if (mainWindow) void dialog.showMessageBox(mainWindow, options)
  else void dialog.showMessageBox(options)
}

/** A seply:// link from outside: checked, then acted on (spec §10.5). */
function handleLink(link: string) {
  const parsed = parseDeepLink(link, settings.server)
  if (parsed.kind === "invalid") return
  focusMain()
  if (parsed.kind === "other-server") {
    tell(
      `This link is for ${parsed.host.slice(0, 80)}`,
      `The app is set to ${new URL(settings.server).host}. To use another server, choose Server… in the menu.`
    )
    return
  }
  const url = completeUrl(pendingSignIn, settings.server, parsed.token)
  pendingSignIn = null
  if (!url) {
    tell(
      "This sign-in link can't be used",
      "It has expired, or it wasn't started from this app. Choose Continue with Google in the app to sign in."
    )
    return
  }
  void mainWindow?.loadURL(url)
}

/** The bridge's IPC: only the server's own page, in the main window. */
function registerBridgeIpc() {
  ipcMain.handle(BRIDGE_CHANNELS.signIn, (event) => {
    const frame = event.senderFrame
    if (
      !mainWindow ||
      event.sender !== mainWindow.webContents ||
      !frame ||
      frame !== mainWindow.webContents.mainFrame ||
      !onServer(frame.url, settings.server)
    )
      throw new Error("not the server's page")
    const { pending, url } = startSignIn(settings.server)
    pendingSignIn = pending
    openExternal(url)
  })
}

/** Makes this app the one seply:// links open. */
function registerScheme() {
  if (app.isPackaged) app.setAsDefaultProtocolClient(SCHEME)
  else if (process.env.SEPLY_DESKTOP_REGISTER_SCHEME === "1" && process.argv[1])
    // Unpackaged, the OS has to start Electron with this app's folder.
    app.setAsDefaultProtocolClient(SCHEME, process.execPath, [
      path.resolve(process.argv[1]),
    ])
}

/** Only the shell window may call the shell's IPC. */
function fromShell(event: IpcMainInvokeEvent) {
  if (!shellWindow || event.sender !== shellWindow.webContents)
    throw new Error("not the shell window")
}

function registerShellIpc() {
  ipcMain.handle(SHELL_CHANNELS.state, (event): ShellState => {
    fromShell(event)
    return {
      mode: shellMode,
      server: settings.server,
      defaultServer: DEFAULT_SERVER,
    }
  })
  ipcMain.handle(SHELL_CHANNELS.save, async (event, address: unknown) => {
    fromShell(event)
    const check = await checkServer(String(address ?? ""), (url, init) =>
      net.fetch(url, { ...init, credentials: "omit" })
    )
    if (!check.ok) return check
    settings = { ...settings, server: check.origin }
    pendingSignIn = null
    writeSettings(settingsFile(), settings)
    // A new window: its preload is bound to the server it was made for.
    const old = mainWindow
    mainWindow = null
    old?.removeListener("close", saveBounds)
    createMainWindow()
    old?.destroy()
    shellWindow?.close()
    return check
  })
  ipcMain.handle(SHELL_CHANNELS.retry, (event) => {
    fromShell(event)
    shellWindow?.close()
    if (mainWindow) loadServer()
    else createMainWindow()
  })
}

function buildMenu() {
  const mac = process.platform === "darwin"
  const serverItem: MenuItemConstructorOptions = {
    label: "Server…",
    click: () => showShell("picker"),
  }
  const history = () => mainWindow?.webContents.navigationHistory
  const template: MenuItemConstructorOptions[] = [
    ...(mac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              serverItem,
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : [
          {
            label: "File",
            submenu: [serverItem, { type: "separator" }, { role: "quit" }],
          } satisfies MenuItemConstructorOptions,
        ]),
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: loadServer },
        {
          label: "Back",
          accelerator: mac ? "Cmd+[" : "Alt+Left",
          click: () => history()?.canGoBack() && history()?.goBack(),
        },
        {
          label: "Forward",
          accelerator: mac ? "Cmd+]" : "Alt+Right",
          click: () => history()?.canGoForward() && history()?.goForward(),
        },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(app.isPackaged
          ? []
          : [{ role: "toggleDevTools" } satisfies MenuItemConstructorOptions]),
      ],
    },
    { role: "windowMenu" },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** A server's page gets notifications and copying; nothing else (spec §10.5). */
function restrictPermissions() {
  const allowed = (permission: string, url: string | undefined) =>
    !!url &&
    onServer(url, settings.server) &&
    ALLOWED_PERMISSIONS.has(permission)
  session.defaultSession.setPermissionRequestHandler(
    (contents, permission, callback, details) =>
      callback(
        contents === mainWindow?.webContents &&
          allowed(permission, details.requestingUrl)
      )
  )
  session.defaultSession.setPermissionCheckHandler(
    (_contents, permission, requestingOrigin) =>
      allowed(permission, requestingOrigin)
  )
}

function start() {
  settings = readSettings(settingsFile())
  const override = parseServer(process.env.SEPLY_DESKTOP_SERVER ?? "")
  if (override.ok) settings = { ...settings, server: override.origin }
  restrictPermissions()
  registerShellIpc()
  registerBridgeIpc()
  registerScheme()
  buildMenu()
  createMainWindow()
  // Started by a link (Windows, Linux), or sent one before it was ready (macOS).
  const link = waitingLink ?? linkInArgs(process.argv)
  waitingLink = undefined
  if (link) handleLink(link)
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  // Windows and Linux hand a link to the running app as a second start.
  app.on("second-instance", (_e, argv) => {
    if (!app.isReady()) return
    const link = linkInArgs(argv)
    if (link) handleLink(link)
    else focusMain()
  })
  // macOS hands it over as an event, sometimes before the app is ready.
  app.on("open-url", (event, link) => {
    event.preventDefault()
    if (app.isReady()) handleLink(link)
    else waitingLink = link
  })
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })
  app.on("activate", () => {
    if (!mainWindow) createMainWindow()
  })
  // No page may add a webview, whatever it tries.
  app.on("web-contents-created", (_e, contents) => {
    contents.on("will-attach-webview", (e) => e.preventDefault())
  })
  void app.whenReady().then(start)
}
