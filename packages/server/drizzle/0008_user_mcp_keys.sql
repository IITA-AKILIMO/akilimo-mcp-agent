CREATE TABLE "user_mcp_keys" (
	"user_id" uuid NOT NULL,
	"server_id" text NOT NULL,
	"key_enc" text NOT NULL,
	"key_hint" text NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp (6) with time zone,
	CONSTRAINT "user_mcp_keys_pkey" PRIMARY KEY("user_id","server_id")
);
--> statement-breakpoint
ALTER TABLE "user_mcp_keys" ADD CONSTRAINT "user_mcp_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;