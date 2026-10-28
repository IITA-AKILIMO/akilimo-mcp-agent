CREATE TABLE "web_search_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text,
	"base_url" text,
	"api_key_enc" text,
	"key_hint" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
