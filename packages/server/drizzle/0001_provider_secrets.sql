CREATE TABLE "llm_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"base_url" text,
	"api_key_enc" text,
	"key_hint" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_server_keys" (
	"server_id" text PRIMARY KEY NOT NULL,
	"key_enc" text NOT NULL,
	"key_hint" text NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
