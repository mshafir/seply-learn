CREATE TABLE "job_steps" (
	"job_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"name" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_steps_job_id_attempt_name_pk" PRIMARY KEY("job_id","attempt","name")
);
--> statement-breakpoint
ALTER TABLE "job_steps" ADD CONSTRAINT "job_steps_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;