// The welcome step (spec §3.1): whether an account has seen it is part of
// the account (`users.welcomed_at`). GET /me says `welcomed`; the app marks
// it when it shows the step.
//   POST /me/welcomed   → { welcomed: true }   (idempotent: the first time stays)
import { schema } from "@seply/domain"
import { and, eq, isNull } from "drizzle-orm"
import type { Db } from "./db.ts"

const { users } = schema

/** The account has seen the welcome step. */
export async function isWelcomed(db: Db, userId: string): Promise<boolean> {
  const [u] = await db
    .select({ welcomedAt: users.welcomedAt })
    .from(users)
    .where(eq(users.id, userId))
  return !!u?.welcomedAt
}

/** Marks the account welcomed. Calling it again keeps the first time. */
export async function markWelcomed(db: Db, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ welcomedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.welcomedAt)))
}
