// The Mailer (spec §2.5, "Email (invites only)"; hosted access approval adds
// the request and approval emails, spec §2.6): one interface, picked by
// config (`readConfig`'s `mail`):
// - `resendMailer`: the hosted instance (RESEND_API_KEY, EMAIL_FROM).
// - `logMailer`: tests and local e2e (AUTH_TEST_CREDENTIALS). It never
//   sends, whatever keys `.dev.vars` holds, and logs only the recipient and
//   subject (an invite's body carries its link, a bearer token).
// - `memoryMailer`: unit tests, which read what was "sent".
// - none: invites still work through the copyable link and the Library's
//   "Shared with you" inbox.
// - SMTP (self-host, WP-6.1): `readConfig` reads SMTP_*; apps/server-node
//   implements it (nodemailer needs sockets) and passes it as `mailer`.

export type Email = {
  to: string
  subject: string
  text: string
  html: string
}

export interface Mailer {
  send(email: Email): Promise<void>
  /** False for one that only logs: the share dialog doesn't say "we emailed". */
  readonly delivers?: boolean
}

/** The default sender (the hosted instance's; EMAIL_FROM overrides it). */
export const DEFAULT_EMAIL_FROM = "Seply Learn <invites@mail.seply.app>"

export class MailError extends Error {}

/** Sends through Resend's HTTP API. */
export function resendMailer(opts: {
  apiKey: string
  from: string
  fetch?: typeof fetch
}): Mailer {
  const doFetch = opts.fetch ?? fetch
  return {
    async send(email) {
      const res = await doFetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: opts.from,
          to: [email.to],
          subject: email.subject,
          text: email.text,
          html: email.html,
        }),
      })
      if (!res.ok) {
        // The body says why (never the key); keep it short for the log.
        const why = (await res.text().catch(() => "")).slice(0, 300)
        throw new MailError(`Resend answered ${res.status}: ${why}`)
      }
    },
  }
}

/** Logs that an email would go out; sends nothing. */
export function logMailer(): Mailer {
  return {
    delivers: false,
    async send(email) {
      console.log(`mail (not sent): to ${email.to}: ${email.subject}`)
    },
  }
}

/** Keeps what was sent, for tests. */
export function memoryMailer(): Mailer & { sent: Email[] } {
  const sent: Email[] = []
  return {
    sent,
    async send(email) {
      sent.push(email)
    },
  }
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ]!
  )

/** The invite email (spec §3.9): who, which Expedition, which role, the link. */
export function inviteEmail(args: {
  to: string
  inviter: string
  title: string
  role: "editor" | "viewer"
  link: string
}): Email {
  const title = args.title || "an Expedition"
  const as = args.role === "editor" ? "an editor" : "a viewer"
  const subject = `${args.inviter} shared “${title}” with you`
  const text = [
    `${args.inviter} invited you to “${title}” on Seply Learn as ${as}.`,
    "",
    `Open it: ${args.link}`,
    "",
    "Once you accept, it's under “Shared with you” in your Library.",
  ].join("\n")
  const html = [
    `<p>${escapeHtml(args.inviter)} invited you to <strong>${escapeHtml(title)}</strong> on Seply Learn as ${as}.</p>`,
    `<p><a href="${escapeHtml(args.link)}">Open the Expedition</a></p>`,
    `<p>Once you accept, it's under “Shared with you” in your Library.</p>`,
  ].join("\n")
  return { to: args.to, subject, text, html }
}

/** To each admin when someone asks for access (spec §2.6, WP-7.3). */
export function accessRequestEmail(args: {
  to: string
  name: string
  email: string
  note: string
  link: string
}): Email {
  const who = args.name ? `${args.name} (${args.email})` : args.email
  const subject = `${args.name || args.email} asked for access to Seply Learn`
  const text = [
    `${who} asked for access to Seply Learn.`,
    ...(args.note ? ["", `Their note: ${args.note}`] : []),
    "",
    `Approve or decline: ${args.link}`,
  ].join("\n")
  const html = [
    `<p>${escapeHtml(who)} asked for access to Seply Learn.</p>`,
    ...(args.note
      ? [`<p>Their note: ${escapeHtml(args.note)}</p>`]
      : []),
    `<p><a href="${escapeHtml(args.link)}">Approve or decline</a></p>`,
  ].join("\n")
  return { to: args.to, subject, text, html }
}

/** To the requester once an admin approves them (spec §2.6, WP-7.3). */
export function accessApprovedEmail(args: {
  to: string
  name: string
  link: string
}): Email {
  const hello = args.name ? `Hi ${args.name},` : "Hi,"
  const subject = "You can now create Expeditions on Seply Learn"
  const lines = [
    "Your account has been approved. You can now create your own Expeditions, import them and fork others.",
  ]
  const text = [hello, "", ...lines, "", `Open your Library: ${args.link}`].join(
    "\n"
  )
  const html = [
    `<p>${escapeHtml(hello)}</p>`,
    ...lines.map((l) => `<p>${escapeHtml(l)}</p>`),
    `<p><a href="${escapeHtml(args.link)}">Open your Library</a></p>`,
  ].join("\n")
  return { to: args.to, subject, text, html }
}
