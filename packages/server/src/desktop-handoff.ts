// Signing the desktop app in through the system browser (spec §10.3, WP-8.2).
// Google refuses OAuth in an embedded window, so the app sends the reader to
// their browser, and the browser hands the sign-in back:
//
//   1. The app makes a random verifier and opens /desktop/sign-in with its
//      SHA-256 (the challenge).
//   2. The signed-in browser asks for a handoff token for that challenge
//      (POST /api/auth/desktop/handoff) and opens seply://<host>/auth?token=….
//   3. The app's window exchanges the token and the verifier for a session of
//      its own (POST /api/auth/desktop/session).
//
// The token is single-use, lasts 60 seconds and is stored hashed. Without the
// verifier it is worth nothing, so a link that leaks, or one made by somebody
// else's browser, can't sign anyone in. The app gets a new session, so
// signing out there leaves the browser signed in.
import { createAuthEndpoint, sessionMiddleware } from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"
import { generateRandomString } from "better-auth/crypto"
import type { BetterAuthPlugin } from "better-auth"
import * as z from "zod"

/** How long a handoff token lasts. */
export const HANDOFF_TTL_MS = 60_000

const IDENTIFIER = "desktop-handoff:"
/** A SHA-256 in unpadded base64url. */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/

/** SHA-256 of a string, in unpadded base64url (the PKCE S256 transform). */
export async function sha256Url(text: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  )
  let binary = ""
  for (const byte of new Uint8Array(hash)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

type Stored = { userId: string; challenge: string }

function readStored(value: string): Stored | null {
  try {
    const v: unknown = JSON.parse(value)
    if (
      v &&
      typeof v === "object" &&
      typeof (v as Stored).userId === "string" &&
      typeof (v as Stored).challenge === "string"
    )
      return v as Stored
  } catch {
    // Not ours.
  }
  return null
}

export const desktopHandoff = () =>
  ({
    id: "desktop-handoff",
    endpoints: {
      /** The signed-in browser asks for a token to hand to the app. */
      startDesktopHandoff: createAuthEndpoint(
        "/desktop/handoff",
        {
          method: "POST",
          use: [sessionMiddleware],
          body: z.object({ challenge: z.string().regex(CHALLENGE) }),
        },
        async (c) => {
          const token = generateRandomString(32)
          const stored: Stored = {
            userId: c.context.session.user.id,
            challenge: c.body.challenge,
          }
          await c.context.internalAdapter.createVerificationValue({
            identifier: IDENTIFIER + (await sha256Url(token)),
            value: JSON.stringify(stored),
            expiresAt: new Date(Date.now() + HANDOFF_TTL_MS),
          })
          return c.json({ token })
        }
      ),
      /** The app exchanges the token and its verifier for its own session. */
      finishDesktopHandoff: createAuthEndpoint(
        "/desktop/session",
        {
          method: "POST",
          body: z.object({
            token: z.string().min(1).max(200),
            verifier: z.string().min(1).max(200),
          }),
        },
        async (c) => {
          const refuse = () =>
            c.error("BAD_REQUEST", {
              message: "This sign-in link has expired or was already used.",
            })
          // Consumed whatever happens next: a token gets one try.
          const row = await c.context.internalAdapter.consumeVerificationValue(
            IDENTIFIER + (await sha256Url(c.body.token))
          )
          if (!row || row.expiresAt < new Date()) throw refuse()
          const stored = readStored(row.value)
          if (!stored) throw refuse()
          if ((await sha256Url(c.body.verifier)) !== stored.challenge)
            throw refuse()
          const user = await c.context.internalAdapter.findUserById(
            stored.userId
          )
          if (!user) throw refuse()
          const session = await c.context.internalAdapter.createSession(user.id)
          if (!session) throw refuse()
          await setSessionCookie(c, { session, user })
          return c.json({ ok: true })
        }
      ),
    },
  }) satisfies BetterAuthPlugin
