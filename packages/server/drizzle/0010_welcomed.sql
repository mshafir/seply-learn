ALTER TABLE "users" ADD COLUMN "welcomed_at" timestamp with time zone;--> statement-breakpoint
-- The welcome step (spec §3.1): every account that exists now counts as
-- welcomed, so only accounts made after this see it.
UPDATE "users" SET "welcomed_at" = "created_at" WHERE "welcomed_at" IS NULL;
