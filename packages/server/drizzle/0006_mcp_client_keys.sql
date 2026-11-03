CREATE TABLE "mcp_client_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_hint" text NOT NULL,
	"per_minute" integer,
	"per_day" integer,
	"expires_at" timestamp (6) with time zone,
	"revoked_at" timestamp (6) with time zone,
	"last_used_at" timestamp (6) with time zone,
	"created_by" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_client_keys" ADD CONSTRAINT "mcp_client_keys_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_client_keys_key_hash_key" ON "mcp_client_keys" USING btree ("key_hash");