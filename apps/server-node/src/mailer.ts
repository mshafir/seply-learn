// The invite Mailer on Node (spec §2.5): SMTP when SMTP_HOST is set, Resend
// when RESEND_API_KEY is, else a log-only one (invites still work through
// the copyable link and the Library's inbox; the share dialog doesn't say
// "we emailed"). `readConfig`'s `mail` picks which.
import {
  logMailer,
  MailError,
  resendMailer,
  type Mailer,
  type MailConfig,
  type SmtpConfig,
} from "@seply/server"
import nodemailer, { type Transporter } from "nodemailer"

export function smtpMailer(opts: {
  smtp: SmtpConfig
  from: string
  /** Tests pass a nodemailer transport (e.g. `jsonTransport`). */
  transport?: Transporter
}): Mailer {
  const { smtp } = opts
  const transport =
    opts.transport ??
    nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      ...(smtp.user && { auth: { user: smtp.user, pass: smtp.pass ?? "" } }),
    })
  return {
    async send(email) {
      try {
        await transport.sendMail({
          from: opts.from,
          to: email.to,
          subject: email.subject,
          text: email.text,
          html: email.html,
        })
      } catch (err) {
        // Never the credentials: nodemailer's message names the server and why.
        throw new MailError(
          `SMTP send failed: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    },
  }
}

export function mailerFor(mail: MailConfig): Mailer {
  switch (mail?.kind) {
    case "smtp":
      return smtpMailer({ smtp: mail.smtp, from: mail.from })
    case "resend":
      return resendMailer({ apiKey: mail.apiKey, from: mail.from })
    default:
      return logMailer()
  }
}
