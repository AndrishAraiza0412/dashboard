CREATE TYPE "public"."member_role" AS ENUM('admin', 'member', 'viewer');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "categories_org_name_key" UNIQUE("org_id","name")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"currency" text DEFAULT 'MXN' NOT NULL,
	"timezone" text DEFAULT 'America/Mexico_City' NOT NULL,
	"enabled_modules" text[] DEFAULT '{inventory,sales}'::text[] NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_modules_known" CHECK ("organizations"."enabled_modules" <@ '{inventory,sales}'::text[]),
	CONSTRAINT "organizations_sales_needs_inventory" CHECK (not ('sales' = any("organizations"."enabled_modules")) or 'inventory' = any("organizations"."enabled_modules"))
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_user_org_idx" ON "memberships" USING btree ("user_id","org_id");