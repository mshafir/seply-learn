import { createServer, type Server } from "node:net"
import type { AddressInfo } from "node:net"
import { inviteEmail, MailError } from "@seply/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { mailerFor, smtpMailer } from "./mailer.ts"

/** Just enough SMTP to take one message: AUTH PLAIN, no TLS. */
function fakeSmtp() {
  const got: {
    auth: string | null
    from: string
    to: string[]
    data: string
  }[] = []
  const server = createServer((sock) => {
    let auth: string | null = null
    let from = ""
    let to: string[] = []
    let data: string | null = null
    let buf = ""
    sock.write("220 fake ESMTP\r\n")
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8")
      if (data !== null) {
        const end = buf.indexOf("\r\n.\r\n")
        if (end < 0) return
        data += buf.slice(0, end)
        buf = buf.slice(end + 5)
        got.push({ auth, from, to, data })
        data = null
        to = []
        sock.write("250 queued\r\n")
      }
      let i: number
      while (data === null && (i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 2)
        const verb = line.split(" ")[0]!.toUpperCase()
        if (verb === "EHLO")
          sock.write("250-fake\r\n250-AUTH PLAIN\r\n250 OK\r\n")
        else if (verb === "AUTH") {
          auth = Buffer.from(line.split(" ")[2] ?? "", "base64").toString(
            "utf8"
          )
          sock.write("235 ok\r\n")
        } else if (verb === "MAIL") {
          from = line
          sock.write("250 ok\r\n")
        } else if (verb === "RCPT") {
          to.push(line)
          sock.write("250 ok\r\n")
        } else if (verb === "DATA") {
          data = ""
          sock.write("354 go\r\n")
        } else if (verb === "QUIT") sock.end("221 bye\r\n")
        else sock.write("250 ok\r\n")
      }
    })
  })
  return { server, got }
}

describe("smtpMailer", () => {
  const smtp = fakeSmtp()
  let port = 0
  beforeAll(async () => {
    await new Promise<void>((r) => smtp.server.listen(0, "127.0.0.1", r))
    port = (smtp.server.address() as AddressInfo).port
  })
  afterAll(() => new Promise((r) => (smtp.server as Server).close(r)))

  it("sends an invite through SMTP with the configured sender and login", async () => {
    const mailer = smtpMailer({
      smtp: {
        host: "127.0.0.1",
        port,
        secure: false,
        user: "learn",
        pass: "pw",
      },
      from: "Seply Learn <learn@example.com>",
    })
    expect(mailer.delivers).not.toBe(false)
    await mailer.send(
      inviteEmail({
        to: "ed@example.com",
        inviter: "Ada",
        title: "Compute",
        role: "editor",
        link: "https://learn.example.com/invite/abc",
      })
    )
    expect(smtp.got).toHaveLength(1)
    const [m] = smtp.got
    expect(m!.auth).toBe("\0learn\0pw")
    expect(m!.from).toContain("<learn@example.com>")
    expect(m!.to).toEqual(["RCPT TO:<ed@example.com>"])
    expect(m!.data).toMatch(/^Subject: =\?UTF-8\?/m) // “Compute”, encoded
    expect(m!.data).toContain("https://learn.example.com/invite/abc")
  })

  it("throws a MailError when the server can't be reached", async () => {
    const mailer = smtpMailer({
      smtp: { host: "127.0.0.1", port: 1, secure: false },
      from: "a@b.c",
    })
    await expect(
      mailer.send({ to: "x@y.z", subject: "s", text: "t", html: "<p>t</p>" })
    ).rejects.toThrow(MailError)
  })
})

describe("mailerFor", () => {
  it("picks SMTP, Resend, or a log-only mailer", async () => {
    expect(
      mailerFor({
        kind: "smtp",
        smtp: { host: "mail", port: 587, secure: false },
        from: "a@b.c",
      }).delivers
    ).not.toBe(false)
    expect(
      mailerFor({ kind: "resend", apiKey: "re_x", from: "a@b.c" }).delivers
    ).not.toBe(false)
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    for (const config of [null, { kind: "log" as const }]) {
      const m = mailerFor(config)
      expect(m.delivers).toBe(false)
      await m.send({
        to: "x@y.z",
        subject: "Hi",
        text: "secret link",
        html: "",
      })
    }
    // Only the recipient and subject: an invite's body carries a bearer link.
    expect(log.mock.calls.flat().join(" ")).not.toContain("secret link")
    log.mockRestore()
  })
})
