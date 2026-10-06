// Invites, the inbox and the Mailer (WP-5.1, spec §3.9). The permissions
// matrix over these routes is permissions-matrix.test.ts.
import { describe, expect, it } from "vitest"
import { readConfig } from "./config.ts"
import type { LibraryCard } from "./expeditions.ts"
import { inviteEmail, memoryMailer, resendMailer } from "./mailer.ts"
import type { InviteCreated, InviteInfo, Sharing } from "./sharing.ts"
import {
  signUp,
  TEST_ENV,
  TEST_ORIGIN,
  testApp,
  testDb,
  type TestUser,
} from "./test-harness.ts"

async function setup() {
  const db = await testDb()
  const mailer = memoryMailer()
  const app = testApp(TEST_ENV, db, undefined, { mailer })
  const ada = await signUp(app, "ada")
  const res = await app.request("/api/expeditions", {
    method: "POST",
    headers: ada.headers,
    body: JSON.stringify({ title: "Compute" }),
  })
  const { id } = (await res.json()) as { id: string }
  const invite = async (
    by: TestUser,
    email: string,
    role: "editor" | "viewer"
  ) => {
    const r = await app.request(`/api/expeditions/${id}/invites`, {
      method: "POST",
      headers: by.headers,
      body: JSON.stringify({ email, role }),
    })
    return { status: r.status, body: (await r.json()) as InviteCreated }
  }
  const library = async (u: TestUser) =>
    (
      (await (
        await app.request("/api/expeditions", { headers: u.headers })
      ).json()) as { expeditions: LibraryCard[] }
    ).expeditions
  const sharing = async (u: TestUser) =>
    (await (
      await app.request(`/api/expeditions/${id}/sharing`, {
        headers: u.headers,
      })
    ).json()) as Sharing
  return { db, app, mailer, ada, id, invite, library, sharing }
}

const tokenOf = (link: string) => link.split("/invite/")[1]!

describe("invites", () => {
  it("adds an existing account at once, emails them, and shows it as New under Shared with you", async () => {
    const s = await setup()
    const bob = await signUp(s.app, "bob")
    const { status, body } = await s.invite(s.ada, "Bob@Example.com", "viewer")
    expect(status).toBe(201)
    expect(body.added).toBe(true)
    expect(body.emailed).toBe(true)
    expect(body.link).toMatch(new RegExp(`^${TEST_ORIGIN}/invite/[\\w-]{40,}$`))
    expect(s.mailer.sent).toHaveLength(1)
    expect(s.mailer.sent[0]).toMatchObject({
      to: "bob@example.com",
      subject: "ada shared “Compute” with you",
    })
    expect(s.mailer.sent[0]!.text).toContain(body.link)

    const [card] = await s.library(bob)
    expect(card).toMatchObject({ id: s.id, role: "viewer", isNew: true })
    // Opening it clears the badge.
    const seen = await s.app.request(`/api/expeditions/${s.id}/seen`, {
      method: "POST",
      headers: bob.headers,
    })
    expect(seen.status).toBe(204)
    expect((await s.library(bob))[0]!.isNew).toBe(false)
    // The owner's own card is never New.
    expect((await s.library(s.ada))[0]!.isNew).toBe(false)

    const sh = await s.sharing(s.ada)
    expect(sh.collaborators.map((p) => [p.name, p.role])).toEqual([
      ["ada", "owner"],
      ["bob", "viewer"],
    ])
    expect(sh.invites).toEqual([])
    expect(sh.may).toEqual({
      invite: true,
      changeRole: true,
      removeCollaborator: true,
      transferOwnership: true,
    })
    // Bob (a viewer) sees who is on it, but no invites, and may do nothing.
    const bobs = await s.sharing(bob)
    expect(bobs.role).toBe("viewer")
    expect(bobs.may.invite).toBe(false)

    // Inviting a Collaborator again is a conflict.
    expect((await s.invite(s.ada, "bob@example.com", "editor")).status).toBe(
      409
    )
  })

  it("keeps an invite to a new email pending; the link lets them in once", async () => {
    const s = await setup()
    const { body } = await s.invite(s.ada, "cy@example.com", "editor")
    expect(body.added).toBe(false)
    expect((await s.sharing(s.ada)).invites).toMatchObject([
      { email: "cy@example.com", role: "editor", invitedBy: { name: "ada" } },
    ])
    const token = tokenOf(body.link)

    // Anyone holding the link can read what it is, signed in or not.
    const info = (await (
      await s.app.request(`/api/invites/${token}`)
    ).json()) as InviteInfo
    expect(info).toEqual({
      expedition: { id: s.id, title: "Compute" },
      role: "editor",
      invitedBy: "ada",
      email: "cy@example.com",
      status: "pending",
    })
    // Accepting needs a session.
    const anon = await s.app.request(`/api/invites/${token}/accept`, {
      method: "POST",
    })
    expect(anon.status).toBe(401)

    // Cy signs up with another address and accepts through the link.
    const cy = await signUp(s.app, "cy-work")
    const ok = await s.app.request(`/api/invites/${token}/accept`, {
      method: "POST",
      headers: cy.headers,
    })
    expect(await ok.json()).toEqual({ expeditionId: s.id, role: "editor" })
    expect((await s.library(cy))[0]).toMatchObject({
      id: s.id,
      role: "editor",
      isNew: true,
    })
    // Again: idempotent for Cy, gone for anyone else.
    const again = await s.app.request(`/api/invites/${token}/accept`, {
      method: "POST",
      headers: cy.headers,
    })
    expect(again.status).toBe(200)
    const dan = await signUp(s.app, "dan")
    const used = await s.app.request(`/api/invites/${token}/accept`, {
      method: "POST",
      headers: dan.headers,
    })
    expect(used.status).toBe(410)
    expect(
      (
        (await (
          await s.app.request(`/api/invites/${token}`, { headers: cy.headers })
        ).json()) as InviteInfo
      ).status
    ).toBe("yours")
    expect(
      (await s.app.request("/api/invites/not-a-real-token-at-all-xx")).status
    ).toBe(404)
  })

  it("claims invites to your email when you sign up later (the inbox)", async () => {
    const s = await setup()
    await s.invite(s.ada, "eve@example.com", "viewer")
    const eve = await signUp(s.app, "eve")
    expect((await s.library(eve))[0]).toMatchObject({
      id: s.id,
      role: "viewer",
      isNew: true,
    })
    expect((await s.sharing(s.ada)).invites).toEqual([])
  })

  it("never lowers a role, and a fresh invite replaces a pending one", async () => {
    const s = await setup()
    const first = await s.invite(s.ada, "fay@example.com", "viewer")
    const second = await s.invite(s.ada, "fay@example.com", "editor")
    expect((await s.sharing(s.ada)).invites).toHaveLength(1)
    // The first link is gone.
    expect(
      (await s.app.request(`/api/invites/${tokenOf(first.body.link)}`)).status
    ).toBe(404)
    const fay = await signUp(s.app, "fay-other")
    await s.app.request(`/api/invites/${tokenOf(second.body.link)}/accept`, {
      method: "POST",
      headers: fay.headers,
    })
    // A later viewer link doesn't demote her.
    const third = await s.invite(s.ada, "fay2@example.com", "viewer")
    const res = await s.app.request(
      `/api/invites/${tokenOf(third.body.link)}/accept`,
      { method: "POST", headers: fay.headers }
    )
    expect(await res.json()).toEqual({ expeditionId: s.id, role: "editor" })
  })

  it("lets an editor invite and revoke their own invites", async () => {
    const s = await setup()
    const ed = await signUp(s.app, "ed")
    await s.invite(s.ada, "ed@example.com", "editor")
    const mine = await s.invite(ed, "gus@example.com", "viewer")
    expect(mine.status).toBe(201)
    const revoke = await s.app.request(
      `/api/expeditions/${s.id}/invites/${mine.body.invite.id}`,
      { method: "DELETE", headers: ed.headers }
    )
    expect(revoke.status).toBe(204)
    expect(
      (await s.app.request(`/api/invites/${tokenOf(mine.body.link)}`)).status
    ).toBe(404)
  })

  it("still offers the link when the email fails or there is no mailer", async () => {
    const db = await testDb()
    const failing = {
      async send() {
        throw new Error("smtp down")
      },
    }
    for (const mailer of [failing, null]) {
      const app = testApp(TEST_ENV, db, undefined, { mailer })
      const ada = await signUp(app, `ada${mailer ? 1 : 2}`)
      const { id } = (await (
        await app.request("/api/expeditions", {
          method: "POST",
          headers: ada.headers,
          body: "{}",
        })
      ).json()) as { id: string }
      const res = await app.request(`/api/expeditions/${id}/invites`, {
        method: "POST",
        headers: ada.headers,
        body: JSON.stringify({ email: "hal@example.com", role: "viewer" }),
      })
      const body = (await res.json()) as InviteCreated
      expect(res.status).toBe(201)
      expect(body.emailed).toBe(false)
      expect(body.link).toContain("/invite/")
    }
  })

  it("refuses a bad email or role", async () => {
    const s = await setup()
    for (const body of [
      { email: "nope", role: "viewer" },
      { email: "a@example.com", role: "owner" },
    ]) {
      const res = await s.app.request(`/api/expeditions/${s.id}/invites`, {
        method: "POST",
        headers: s.ada.headers,
        body: JSON.stringify(body),
      })
      expect(res.status).toBe(400)
    }
  })
})

describe("the Mailer", () => {
  it("sends through Resend with the sender and key", async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const mailer = resendMailer({
      apiKey: "re_test",
      from: "Seply Learn <invites@mail.seply.app>",
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        return new Response('{"id":"1"}', { status: 200 })
      }) as typeof fetch,
    })
    await mailer.send(
      inviteEmail({
        to: "bob@example.com",
        inviter: "Ada <script>",
        title: "Compute",
        role: "editor",
        link: "https://seply.app/invite/abc",
      })
    )
    expect(calls[0]!.url).toBe("https://api.resend.com/emails")
    expect(
      (calls[0]!.init.headers as Record<string, string>).authorization
    ).toBe("Bearer re_test")
    const sent = JSON.parse(String(calls[0]!.init.body))
    expect(sent).toMatchObject({
      from: "Seply Learn <invites@mail.seply.app>",
      to: ["bob@example.com"],
    })
    expect(sent.html).toContain("Ada &lt;script&gt;")
    expect(sent.text).toContain("as an editor")
  })

  it("throws when Resend refuses", async () => {
    const mailer = resendMailer({
      apiKey: "re_test",
      from: "x@example.com",
      fetch: (async () =>
        new Response("bad", { status: 422 })) as unknown as typeof fetch,
    })
    await expect(
      mailer.send({ to: "a@example.com", subject: "s", text: "t", html: "h" })
    ).rejects.toThrow("Resend answered 422")
  })

  it("is Resend only when configured, and never under test credentials", () => {
    const base = {
      BETTER_AUTH_URL: "https://seply.app",
      BETTER_AUTH_SECRET: "s".repeat(40),
    }
    expect(readConfig(base).mail).toBeNull()
    expect(readConfig({ ...base, RESEND_API_KEY: "re_x" }).mail).toEqual({
      kind: "resend",
      apiKey: "re_x",
      from: "Seply Learn <invites@mail.seply.app>",
    })
    expect(
      readConfig({ ...base, RESEND_API_KEY: "re_x", EMAIL_FROM: "A <a@b.c>" })
        .mail
    ).toMatchObject({ from: "A <a@b.c>" })
    expect(readConfig({ ...TEST_ENV, RESEND_API_KEY: "re_x" }).mail).toEqual({
      kind: "log",
    })
  })
})
