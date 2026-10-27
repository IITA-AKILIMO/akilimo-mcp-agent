ALTER TABLE "conversations" ADD COLUMN "mode" text DEFAULT 'ai' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "data" jsonb;