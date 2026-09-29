CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_keys" (
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"last4" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_keys_user_id_provider_pk" PRIMARY KEY("user_id","provider")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text,
	"start" text,
	"key_hash" text NOT NULL,
	"expedition_ids" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "article_sections" (
	"expedition_id" text NOT NULL,
	"id" text NOT NULL,
	"concept_id" text NOT NULL,
	"order_key" text NOT NULL,
	"heading" text DEFAULT '' NOT NULL,
	"md" text DEFAULT '' NOT NULL,
	"prov" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "article_sections_expedition_id_id_pk" PRIMARY KEY("expedition_id","id")
);
--> statement-breakpoint
CREATE TABLE "attribute_defs" (
	"expedition_id" text NOT NULL,
	"id" text NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"unit" text,
	"enum_values" text[],
	"deleted_at" timestamp with time zone,
	CONSTRAINT "attribute_defs_expedition_id_id_pk" PRIMARY KEY("expedition_id","id")
);
--> statement-breakpoint
CREATE TABLE "changes" (
	"expedition_id" text NOT NULL,
	"id" text NOT NULL,
	"author" text NOT NULL,
	"origin" text NOT NULL,
	"label" text NOT NULL,
	"first_seq" bigint NOT NULL,
	"last_seq" bigint NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "changes_expedition_id_id_pk" PRIMARY KEY("expedition_id","id")
);
--> statement-breakpoint
CREATE TABLE "collaborators" (
	"expedition_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "collaborators_expedition_id_user_id_pk" PRIMARY KEY("expedition_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "concept_tags" (
	"expedition_id" text NOT NULL,
	"concept_id" text NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "concept_tags_expedition_id_concept_id_tag_pk" PRIMARY KEY("expedition_id","concept_id","tag")
);
--> statement-breakpoint
CREATE TABLE "concepts" (
	"expedition_id" text NOT NULL,
	"id" text NOT NULL,
	"title" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"kind" text NOT NULL,
	"summary" text,
	"overview" text,
	"overview_prov" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"date" text,
	"date_end" text,
	"date_approx" boolean,
	"lane" text,
	"lat" double precision,
	"lon" double precision,
	"weight_pin" text,
	"prov" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "concepts_expedition_id_id_pk" PRIMARY KEY("expedition_id","id")
);
--> statement-breakpoint
CREATE TABLE "expedition_tags" (
	"expedition_id" text NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "expedition_tags_expedition_id_tag_pk" PRIMARY KEY("expedition_id","tag")
);
--> statement-breakpoint
CREATE TABLE "expeditions" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"forked_from" jsonb,
	"deleted_at" timestamp with time zone,
	"head_seq" bigint DEFAULT 0 NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"best_view_id" text
);
--> statement-breakpoint
CREATE TABLE "kind_defs" (
	"expedition_id" text NOT NULL,
	"id" text NOT NULL,
	"label" text,
	"color" text,
	"icon" text,
	"hidden" boolean DEFAULT false NOT NULL,
	CONSTRAINT "kind_defs_expedition_id_id_pk" PRIMARY KEY("expedition_id","id")
);
--> statement-breakpoint
CREATE TABLE "ops" (
	"expedition_id" text NOT NULL,
	"server_seq" bigint NOT NULL,
	"op_id" text NOT NULL,
	"change_id" text NOT NULL,
	"client_seq" integer NOT NULL,
	"schema_v" integer NOT NULL,
	"kind" text NOT NULL,
	"target" text NOT NULL,
	"path" text,
	"value" jsonb,
	CONSTRAINT "ops_expedition_id_server_seq_pk" PRIMARY KEY("expedition_id","server_seq")
);
--> statement-breakpoint
CREATE TABLE "personal_view_settings" (
	"user_id" text NOT NULL,
	"expedition_id" text NOT NULL,
	"view_id" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "personal_view_settings_user_id_expedition_id_view_id_pk" PRIMARY KEY("user_id","expedition_id","view_id")
);
--> statement-breakpoint
CREATE TABLE "proposal_items" (
	"expedition_id" text NOT NULL,
	"id" text NOT NULL,
	"proposal_id" text NOT NULL,
	"ops" jsonb NOT NULL,
	"base" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "proposal_items_expedition_id_id_pk" PRIMARY KEY("expedition_id","id")
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"expedition_id" text NOT NULL,
	"id" text NOT NULL,
	"author" text NOT NULL,
	"origin" text NOT NULL,
	"rationale" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposals_expedition_id_id_pk" PRIMARY KEY("expedition_id","id")
);
--> statement-breakpoint
CREATE TABLE "reader_position" (
	"user_id" text NOT NULL,
	"expedition_id" text NOT NULL,
	"view_id" text,
	"focus_concept_id" text,
	"step" integer,
	"panel_depth" text,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "reader_position_user_id_expedition_id_pk" PRIMARY KEY("user_id","expedition_id")
);
--> statement-breakpoint
CREATE TABLE "reading_status" (
	"user_id" text NOT NULL,
	"expedition_id" text NOT NULL,
	"concept_id" text NOT NULL,
	"state" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "reading_status_user_id_expedition_id_concept_id_pk" PRIMARY KEY("user_id","expedition_id","concept_id")
);
--> statement-breakpoint
CREATE TABLE "rel_type_defs" (
	"expedition_id" text NOT NULL,
	"id" text NOT NULL,
	"label" text,
	"inverse_label" text,
	"color" text,
	"dashed" boolean,
	"hidden" boolean DEFAULT false NOT NULL,
	CONSTRAINT "rel_type_defs_expedition_id_id_pk" PRIMARY KEY("expedition_id","id")
);
--> statement-breakpoint
CREATE TABLE "relationships" (
	"expedition_id" text NOT NULL,
	"from_id" text NOT NULL,
	"type" text NOT NULL,
	"to_id" text NOT NULL,
	"note" text,
	"prov" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_with" text,
	CONSTRAINT "relationships_expedition_id_from_id_type_to_id_pk" PRIMARY KEY("expedition_id","from_id","type","to_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"expedition_id" text NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"blob_key" text,
	"segments_key" text,
	"mime" text,
	"size" bigint,
	"added_by" text NOT NULL,
	"added_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sources_expedition_id_id_pk" PRIMARY KEY("expedition_id","id")
);
--> statement-breakpoint
CREATE TABLE "trash" (
	"expedition_id" text PRIMARY KEY NOT NULL,
	"deleted_by" text NOT NULL,
	"purge_after" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "views" (
	"expedition_id" text NOT NULL,
	"id" text NOT NULL,
	"view_type" text NOT NULL,
	"label" text NOT NULL,
	"question" text,
	"order_key" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings_version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"fail_reason" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "views_expedition_id_id_pk" PRIMARY KEY("expedition_id","id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_keys" ADD CONSTRAINT "ai_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaborators" ADD CONSTRAINT "collaborators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expeditions" ADD CONSTRAINT "expeditions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_sections_concept_idx" ON "article_sections" USING btree ("expedition_id","concept_id","order_key");--> statement-breakpoint
CREATE INDEX "collaborators_user_idx" ON "collaborators" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "concept_tags_tag_idx" ON "concept_tags" USING btree ("expedition_id","tag");--> statement-breakpoint
CREATE INDEX "concepts_title_idx" ON "concepts" USING btree ("expedition_id","title");--> statement-breakpoint
CREATE UNIQUE INDEX "ops_op_id_idx" ON "ops" USING btree ("expedition_id","op_id");--> statement-breakpoint
CREATE INDEX "ops_change_idx" ON "ops" USING btree ("expedition_id","change_id");--> statement-breakpoint
CREATE INDEX "proposal_items_proposal_idx" ON "proposal_items" USING btree ("expedition_id","proposal_id");--> statement-breakpoint
CREATE INDEX "reader_position_recent_idx" ON "reader_position" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "relationships_to_idx" ON "relationships" USING btree ("expedition_id","to_id");