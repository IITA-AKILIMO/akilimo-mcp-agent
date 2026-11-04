CREATE TABLE "key_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"label" text NOT NULL,
	"action" text NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
ALTER TABLE "mcp_client_keys" ADD COLUMN "use_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_server_keys" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "mcp_server_keys" ADD COLUMN "last_used_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "mcp_server_keys" ADD COLUMN "use_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "key_events" ADD CONSTRAINT "key_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "key_events_at_idx" ON "key_events" USING btree ("at" DESC NULLS FIRST);--> statement-breakpoint
ALTER TABLE "mcp_server_keys" ADD CONSTRAINT "mcp_server_keys_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;