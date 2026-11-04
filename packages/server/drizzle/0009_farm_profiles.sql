CREATE TABLE "farm_profiles" (
	"user_id" uuid NOT NULL,
	"country" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "farm_profiles_pkey" PRIMARY KEY("user_id","country")
);
--> statement-breakpoint
ALTER TABLE "farm_profiles" ADD CONSTRAINT "farm_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;