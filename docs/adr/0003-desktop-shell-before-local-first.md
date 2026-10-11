# The desktop app starts as a shell that loads the server's web client

The first desktop app is an Electron shell. Its window loads the web client from the server the reader chose: `learn.seply.app` by default, or a self-hosted instance. It adds deep links, files opened from the OS and native notifications through a small preload bridge. The spec had desktop as phase 2 and **local-first** (a bundled client editing offline on SQLite); that is still the direction, and it now comes after the shell rather than instead of it. Spec: [9. Desktop app](../spec/v1/09-desktop.md).

## Why

- **What was asked for** is an installed app with native integration that works against the hosted backend or a self-hosted one. Offline editing wasn't part of it.
- **The web client assumes its own origin everywhere:** relative `/api` calls with the session cookie, the Relay socket from `location.origin`, share links and the MCP URL. Loading it from the server keeps all of that true with no change.
- **Self-hosted servers run many versions.** A client served by the server always matches it. A bundled client would need a compatibility contract with every server version from its first release.
- **Electron gives one Chromium on all three platforms,** the engine the Playwright suite already tests, and Playwright can drive it.

## Considered Options

- **Bundle the client and call the server cross-origin:** needs an API base URL through `apps/web` and `packages/sync`, app-wide CORS, token or cross-site cookie auth, and the version contract above. It buys only an app shell that opens offline, which the service worker already gives after one visit.
- **Local-first now** (the phase 2 sketch): the bundled client's costs plus SQLite, an offline op queue and conflict handling. Too much to put in front of an installable app.
- **Tauri:** installs of about 10 MB instead of about 100 MB, but three system webviews (WebKitGTK, WKWebView, WebView2) that the suite doesn't cover, running React Flow, the WebGL map and IndexedDB, and a Rust toolchain in the repo.
- **Packaging the PWA** for stores: no server choice, no file associations.

## Consequences

- **The app is only as offline as the PWA:** read-only, for Expeditions already opened. It can't start for the first time without the network.
- **A server's code runs inside the app.** The shell treats the page as untrusted: a sandboxed renderer, and a bridge limited to notifications, browser sign-in and files the reader opened ([§9.5](../spec/v1/09-desktop.md#95-trust-boundary)).
- **Google sign-in leaves the window:** it runs in the system browser and returns through a `seply://` link carrying a one-time token. This is the one new credential path on the server.
- **Three small server additions:** `GET /api/instance`, `GET /api/notifications`, and the desktop sign-in page with its token.
- **Local-first later reuses the shell:** the main process, bridge, `seply://` scheme, packaging and release pipeline stay. It changes what the window loads and adds storage, so the bridge is versioned from the start.
- **Installs are about 100 MB,** and the first releases are unsigned.
