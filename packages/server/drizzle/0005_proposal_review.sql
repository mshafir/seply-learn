ALTER TABLE "proposal_items" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "proposal_items" ADD COLUMN "change_id" text;--> statement-breakpoint
ALTER TABLE "proposal_items" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "proposal_items" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proposal_items" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;