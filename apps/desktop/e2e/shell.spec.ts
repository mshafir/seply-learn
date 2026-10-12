import { mkdtempSync, readFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test"

// WP-8.1: the shell, driven as a person would, against stand-in servers
// (each a few lines of HTTP: a page and /api/instance). It needs the built
// app (`pnpm --filter desktop build`). The full flow against a real server
// (sign-in, links, files) comes with WP-8.5.

const APP = path.resolve(import.meta.dirname, "..")

/** A stand-in server. `product` is what its /api/instance says it is. */
async function standIn(product: string | null): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.url === "/api/instance" && product) {
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify({ product, desktopBridge: 1, hosted: false }))
    } else if (req.url === "/api/instance") {
      res.statusCode = 404
      res.end("not found")
    } else {
      res.setHeader("content-type", "text/html")
      res.end(
        `<title>Stand-in</title><h1>Stand-in ${product}</h1>
         <a id="out" href="https://example.com/elsewhere">out</a>`
      )
    }
  })
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  return server
}

const originOf = (s: Server) =>
  `http://localhost:${(s.address() as AddressInfo).port}`

async function launch(
  server: string,
  userData = mkdtempSync(path.join(tmpdir(), "seply-desktop-e2e-"))
) {
  const app = await electron.launch({
    cwd: APP,
    // No window on the screen of whoever runs this.
    args: [".", "--headless", "--no-sandbox"],
    env: {
      ...process.env,
      SEPLY_DESKTOP_SERVER: server,
      SEPLY_DESKTOP_USER_DATA: userData,
    },
  })
  return { app, userData }
}

/** The window showing a URL that matches, once it exists. */
async function windowAt(
  app: ElectronApplication,
  match: RegExp
): Promise<Page> {
  await expect
    .poll(() => app.windows().some((w) => match.test(w.url())), {
      timeout: 15_000,
    })
    .toBe(true)
  return app.windows().find((w) => match.test(w.url()))!
}

const servers: Server[] = []
let running: ElectronApplication | null = null
test.afterEach(async () => {
  await running?.close().catch(() => {})
  running = null
  for (const s of servers.splice(0)) s.close()
})

test("opens the chosen server, with the bridge, and keeps other sites out", async () => {
  const seply = await standIn("seply-learn")
  servers.push(seply)
  const { app } = await launch(originOf(seply))
  running = app
  const page = await windowAt(app, /^http:\/\/localhost/)
  await expect(page.locator("h1")).toHaveText("Stand-in seply-learn")

  // The bridge, and nothing of Node.
  expect(await page.evaluate(() => window.seplyDesktop)).toEqual({ version: 1 })
  expect(await page.evaluate(() => [typeof require, typeof process])).toEqual([
    "undefined",
    "undefined",
  ])

  // A link elsewhere doesn't load in the window (it goes to the browser).
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { opened?: string[] }).opened = opened
    shell.openExternal = async (url) => void opened.push(url)
  })
  // The navigation is refused, so there is none to wait for.
  await page.locator("#out").click({ noWaitAfter: true })
  await expect
    .poll(() =>
      app.evaluate(() => (globalThis as { opened?: string[] }).opened)
    )
    .toEqual(["https://example.com/elsewhere"])
  expect(page.url()).toBe(`${originOf(seply)}/`)

  // Camera, microphone and the rest are refused.
  expect(
    await page.evaluate(() =>
      navigator.mediaDevices.getUserMedia({ audio: true }).then(
        () => "allowed",
        () => "refused"
      )
    )
  ).toBe("refused")
})

// Playwright wants its first argument destructured, even with nothing taken.
// eslint-disable-next-line no-empty-pattern
test("an unreachable server shows the shell page; a checked address is saved", async ({}, testInfo) => {
  const seply = await standIn("seply-learn")
  const other = await standIn("something-else")
  const silent = await standIn(null)
  servers.push(seply, other, silent)
  // Nothing listens here.
  const dead = await standIn(null)
  const deadOrigin = originOf(dead)
  await new Promise((done) => dead.close(done))

  const { app, userData } = await launch(deadOrigin)
  running = app
  const shell = await windowAt(app, /^file:/)
  await expect(shell.getByRole("alert")).toContainText("Can't reach")
  await shell.getByRole("button", { name: "Change server" }).click()
  const address = shell.getByLabel("Server address")
  const connect = shell.getByRole("button", { name: "Connect" })

  // Refused, each with its reason; nothing is saved.
  await address.fill("http://learn.example.com")
  await connect.click()
  await expect(shell.getByRole("alert")).toContainText("isn't encrypted")
  const shot = testInfo.outputPath("server-picker.png")
  await shell.screenshot({ path: shot })
  await testInfo.attach("server-picker", {
    path: shot,
    contentType: "image/png",
  })
  await address.fill(deadOrigin)
  await connect.click()
  await expect(shell.getByRole("alert")).toContainText("Nothing answered")
  await address.fill(originOf(other))
  await connect.click()
  await expect(shell.getByRole("alert")).toContainText(
    "isn't a Seply Learn server"
  )
  await address.fill(originOf(silent))
  await connect.click()
  await expect(shell.getByRole("alert")).toContainText(
    "isn't a Seply Learn server"
  )

  // A Seply Learn server: saved (as its origin), and opened.
  await address.fill(`${originOf(seply)}/e/123?x=1`)
  await connect.click()
  const page = await windowAt(
    app,
    new RegExp(`^${originOf(seply).replace(/[.:/]/g, "\\$&")}/`)
  )
  await expect(page.locator("h1")).toHaveText("Stand-in seply-learn")
  expect(await page.evaluate(() => window.seplyDesktop?.version)).toBe(1)
  expect(
    JSON.parse(readFileSync(path.join(userData, "settings.json"), "utf8"))
  ).toMatchObject({ server: originOf(seply) })
})

declare global {
  interface Window {
    seplyDesktop?: { version: number }
  }
}
