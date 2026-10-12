# desktop

The Seply Learn desktop app (spec [§10](../../docs/spec/v1/10-desktop.md), [ADR 0003](../../docs/adr/0003-desktop-shell-before-local-first.md)). It is a **shell**: an Electron window that loads the web client of one Seply Learn server, `https://learn.seply.app` by default or a self-hosted one the reader chooses. Owning lane: B.

It ships no copy of the web client. A server always gets the client it serves, so there is no version to keep in step.

## Contract

- **The main window loads `<server>/`** and stays on that origin. Other web links open in the system browser; anything else is refused (`src/navigation.ts`).
- **A server's page is untrusted.** The renderer is sandboxed, with context isolation, no Node and no `webview`. It may ask for notifications and clipboard write; every other permission is refused.
- **The bridge** is `window.seplyDesktop`, attached by `src/preload.ts` only on the chosen server's origin. It is the whole native surface:

  | Member                | Does                                                                                                                                                                            | Since  |
  | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
  | `version`             | The bridge version (`1`)                                                                                                                                                        | WP-8.1 |
  | `signInWithBrowser()` | Opens `<server>/desktop/sign-in` in the system browser with a challenge; the `seply://<host>/auth?token=…` link that comes back finishes the sign-in in the window (spec §10.3) | WP-8.2 |

  Notifications and opened files add their members in WP-8.3 and WP-8.4. The web client feature-detects each one.

- **`seply://` links** come from outside, so each is checked first (`src/deep-link.ts`): the host must be the chosen server, and only `seply://<host>/auth?token=…` is handled so far. It finishes a sign-in only if the app started one in the last 10 minutes (`src/sign-in.ts`); the app keeps the verifier the server asks for, so a link from anywhere else signs nobody in. A packaged app registers the scheme; an unpackaged run does with `SEPLY_DESKTOP_REGISTER_SCHEME=1`.
- **The chosen server** is checked before it is saved: the address is reduced to its origin, must be `https` unless it is on this machine or a private network, and must answer `GET /api/instance` as `seply-learn` (`src/server-url.ts`).
- **The setting** is `settings.json` in the user-data folder: the server's origin and the window's bounds. Nothing secret. A broken or edited file reads as the defaults (`src/settings.ts`).
- **The shell page** (`renderer/`) is the only UI the app ships: the server picker (**Server…** in the app menu) and "Can't reach the server". It is built from `@seply/ui` components and loaded from disk in its own small window, with its own preload (`src/shell-preload.ts`). A server's page never sees it.
- **Dependencies:** `@seply/ui` (the shell page) and `@seply/config`, nothing else from the workspace.

## Working on it

```sh
mise exec -- pnpm --filter desktop dev        # build, then open the app
mise exec -- pnpm --filter desktop test       # the rules: addresses, navigation, the setting
mise exec -- pnpm --filter desktop test:e2e   # the built app, headless, against stand-in servers
```

- **Electron's binary** is fetched the first time one of these needs it (`scripts/ensure-electron.mjs`), not by `pnpm install`.
- **Another server:** `SEPLY_DESKTOP_SERVER=http://localhost:3000 pnpm --filter desktop dev` opens it without saving it. `SEPLY_DESKTOP_USER_DATA=<dir>` moves the user-data folder.
- **On Linux,** an unpackaged Electron may refuse to start until its sandbox helper is set up. For development, add `--no-sandbox`: `pnpm --filter desktop start -- --no-sandbox`.
- **Layout:** `src/main.ts` (windows, menu, IPC) is bundled with the two preloads to `dist/*.cjs` by esbuild; a sandboxed preload can't be an ES module. Vite builds `renderer/` to `dist/renderer/`.

Packaging and releases come with WP-8.5.
