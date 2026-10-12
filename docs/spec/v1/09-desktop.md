# 9. Desktop app

An installed app for macOS, Windows and Linux. It is a **shell**: an Electron window that loads the web client of one Seply Learn server, `https://learn.seply.app` by default or a self-hosted instance the reader chooses. It adds what a browser tab can't do: links that open in the app, files opened from the OS, and native notifications. The decision and what it defers are in [ADR 0003](../../adr/0003-desktop-shell-before-local-first.md).

**Not in this release:** a bundled client, offline editing, SQLite (the local-first desktop of the [Phase 2 sketch](08-phase-2.md) builds on this shell later), several servers at once, quick capture, folder watching, and app-store distribution.

## 9.1 Shape

- **`apps/desktop`** is an Electron app. It composes only `@seply/config` and, for the picker's tokens and the brand folder, `@seply/ui`, so the dependency rule doesn't change.
  - **Main process:** the window, the server setting, the `seply://` scheme, file-open events, the tray and updates.
  - **Preload bridge:** `window.seplyDesktop`, exposed only to pages on the chosen server's origin (§9.5).
  - **Server picker:** a local page bundled in the app (§9.2). It is the only UI the app ships; it uses the brand tokens and no custom components.
- *As built (WP-7.1):* the picker and "Can't reach" are one shell page in a small window of its own, with its own preload, so a server's page and the app's page never share a window. The workspace install doesn't fetch Electron's binary; the desktop scripts fetch it on first use, so the server image and the other packages' CI never download it. A headless Playwright run drives the built app against stand-in servers (`pnpm --filter desktop test:e2e`).
- **The window loads `<server>/`**, the same SPA a browser gets, from the same origin. So `/api`, the session cookie, the Relay socket, IndexedDB and the service worker all work as on the web, and a self-hosted server always gets the client that matches its version.
- **`apps/web` feature-detects the bridge.** Without `window.seplyDesktop` it behaves exactly as today. Nothing in `packages/*` knows about desktop.
- **Offline** is the PWA's: the service worker opens the app shell, and Expeditions kept in IndexedDB open read-only (§2.9). If the server can't be reached and nothing is cached, the app shows a local "Can't reach `<server>`" page with Retry and Change server.

## 9.2 Choosing a server

- **Default:** `https://learn.seply.app`. First run opens it directly; the picker is under **Seply Learn → Server…** in the app menu.
- **The picker** takes a URL, reduces it to its origin, and calls `GET <origin>/api/instance` (new, public):

  ```json
  { "product": "seply-learn", "desktopBridge": 1, "hosted": false }
  ```

  It saves the server only if `product` is `seply-learn`. `hosted` is true only on `learn.seply.app`; the setup page uses it ([MCP §6.4](06-mcp.md#64-connecting-an-agent)). `desktopBridge` is the newest bridge version the server's client understands; a shell newer than that still works, because the client only calls what it finds.
- **`https` is required,** except for `localhost`, `*.local` and private-network addresses, so a home self-host isn't blocked. A plain-`http` server shows "not encrypted" beside its name in the picker.
- **One server at a time.** Switching reloads the window on the new origin. Each origin keeps its own cookies and IndexedDB, so switching back finds the reader still signed in.
- **The setting** lives in the app's user-data folder as JSON. It holds the server origin and window bounds, and nothing secret.

## 9.3 Sign-in

- **Email and password** works in the window as on the web.
- **Google** can't run in the window: Google refuses OAuth in embedded browsers. So on desktop the sign-in screen's Google button calls `seplyDesktop.signInWithBrowser()` instead of redirecting:
  1. The app opens `<server>/desktop/sign-in` in the system browser.
  2. That page signs the reader in the normal way (or finds them signed in), asks "Open Seply Learn?", and on confirm asks the server for a **one-time token** for their session.
  3. It redirects to `seply://<server-host>/auth?token=<token>`.
  4. The app checks the host is the chosen server, then loads `<server>/api/auth/one-time-token/verify` in the window. The server sets the ordinary session cookie and the window lands on the Library.
- **The token** is single-use and expires in 60 seconds (Better Auth's `one-time-token` plugin, stored hashed). It is the only new credential path. The app never stores it and never sees the session cookie's value.
- **An auth link for another server** than the chosen one is refused with a message; it never switches servers.
- **Sign-out** is the web client's. MCP and API tokens are unaffected.

## 9.4 Native integration

- **Deep links:** `seply://<server-host>/<path>` opens `https://<server-host>/<path>` in the window, so every route (`/e/<id>`, `/invite/<token>`) works with no per-route code.
  - A link for a server that isn't the chosen one asks "Switch to `<host>`?" and validates it as the picker would.
  - On the web, an Expedition's Share dialog and its public page offer **Open in app**, which links to the `seply://` form.
  - Verified `https` links (Universal Links, App Links) need signed builds and come with signing (§9.6).
- **Local files as Sources:**
  - The app appears under "Open with" for the types Sources accept (`SOURCE_ACCEPT`: PDF, DOCX, Markdown, text, HTML, JSON, ZIP). It never makes itself the default handler.
  - Files opened that way, or dropped on the app icon, reach the page through `seplyDesktop.onOpenFiles`. The page asks **Add to which Expedition?** (the current one first, then recent ones, then New Expedition) and uploads through the existing Source flow, with the same 25 MB cap and checks.
  - Dropping files on the window is the web client's own drag and drop.
- **Notifications:** Electron has no web push, so desktop reads the same events another way.
  - `GET /api/notifications?since=<time>` (new, signed in) answers the caller's jobs that ended since then, as the payloads web push sends (`title`, `body`, `url`, `tag`). It reads the `jobs` table; it adds no table.
  - On desktop the web client polls it every 30 seconds, and on window focus, and passes each new one to `seplyDesktop.notify`. `tag` stops a repeat. Clicking one opens its `url` in the window.
  - The "Leave it building" prompt (§2.5) asks for OS notification permission through the bridge instead of web push. The web push subscription isn't made on desktop.
- **Connecting an agent:** the setup page, `/connect` ([MCP §6.4](06-mcp.md#64-connecting-an-agent)), is the web client's. The shell adds **Connect an agent…** to the app menu. The web client, when it finds the bridge, shows the page once after the first sign-in if the reader has no connected agents; the flag is kept on the device.
- **Tray:** closing the window keeps the app in the tray (the menu bar on macOS) so notifications still arrive. **Quit** stops them. Nothing arrives after a quit in this release.

## 9.5 Trust boundary

A self-hosted server's code runs in the window, so the shell treats the page as untrusted.

- **Renderer settings:** context isolation on, the sandbox on, Node integration off, no `webview` tag, and the default web security.
- **The bridge is the whole native surface,** and is attached only when the top frame's origin is the chosen server:

  | Member | Does |
  |---|---|
  | `version` | The bridge version (1) |
  | `signInWithBrowser()` | Opens `<server>/desktop/sign-in` in the system browser |
  | `notify({ title, body, url, tag })` | Shows a notification; `url` must be a path on the server |
  | `requestNotificationPermission()` | Asks the OS, answers granted or denied |
  | `onOpenFiles(cb)` | Delivers files the reader opened with the app, as name, type and bytes |

  There is no general file read, no shell access and no way to change the server from the page.
- **Navigation:** the window stays on the chosen origin. Any other URL opens in the system browser; new windows are denied.
- **`seply://` links are input from outside.** Only `auth` and plain paths are handled, the host is always checked, and a path is opened as a navigation, never run.
- **Permissions** the page asks for (camera, microphone, location and the rest) are denied, except notifications and clipboard write.

## 9.6 Packaging, updates and tests

- **Packages** (electron-builder): a universal `.dmg`, an NSIS `.exe` (x64 and arm64), and `.AppImage` and `.deb` (x64 and arm64).
- **Releases:** a `desktop-v*` tag runs a GitHub Actions matrix (macOS, Windows, Linux) and attaches the packages to a GitHub Release. The desktop version is its own; it doesn't follow the server image's tags.
- **Unsigned first.** The first releases are for testing and aren't signed: macOS needs right-click → Open, and Windows shows SmartScreen. The download page says so.
- **Signing comes next** (an Apple Developer ID with notarisation, and a Windows certificate). With it come **automatic updates** on macOS and Windows (electron-updater from GitHub Releases), which need signed builds, and verified `https` links. The Linux AppImage updates itself from the first release.
- **The app's name and icons** come from `packages/ui/brand`, as the web's do (§7.5).
- **Tests:**
  - Unit (Vitest): origin reduction and the `https` rule, `/api/instance` validation, `seply://` parsing and host checks, bridge origin gating, navigation rules.
  - Server: `/api/instance`, `/api/notifications`, and the one-time token (single use, expiry, wrong session).
  - One Playwright Electron run against the local Node entry: choose the server, sign in with test credentials, open a `seply://` link, open a file into an Expedition, see a notification call. It runs in CI on Linux; locally it counts as the one Playwright run.
- **Docs:** `apps/desktop/README.md` states the contract (the bridge table above), and [the self-host guide](../../self-host.md) gains "Using the desktop app with your server".

## Assumptions

1. The `jobs` table records when a job ended; if it doesn't, the notifications work package adds the column.
2. `one-time-token` in Better Auth 1.7 can mint a token for the current session from a server route and set the session cookie on verify by navigation. The sign-in work package confirms this first and falls back to a small purpose-built handoff table if not.
3. The service worker and IndexedDB behave in Electron as in Chrome for the server's origin; the Electron e2e run covers the offline open.
