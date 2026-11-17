ALTER TABLE "external_identity" ADD COLUMN "access_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "external_access_epoch" integer;