CREATE TYPE "public"."movement_reason" AS ENUM('sale', 'sale_cancel', 'restock', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('draft', 'confirmed', 'fulfilled', 'cancelled');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"diff" jsonb,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "member_role" NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone DEFAULT now() + interval '7 days' NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"line_total" numeric(12, 2) GENERATED ALWAYS AS (qty * unit_price) STORED,
	CONSTRAINT "order_items_order_product_key" UNIQUE("order_id","product_id"),
	CONSTRAINT "order_items_qty_positive" CHECK ("order_items"."qty" > 0),
	CONSTRAINT "order_items_price_nonneg" CHECK ("order_items"."unit_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" integer,
	"customer_id" uuid,
	"status" "order_status" DEFAULT 'draft' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "orders_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "orders_org_number_key" UNIQUE("org_id","number")
);
--> statement-breakpoint
CREATE TABLE "org_counters" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"next_order_no" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"user_id" uuid PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid,
	"price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"stock_qty" integer DEFAULT 0 NOT NULL,
	"reorder_level" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "products_org_sku_key" UNIQUE("org_id","sku"),
	CONSTRAINT "products_price_nonneg" CHECK ("products"."price" >= 0),
	CONSTRAINT "products_cost_nonneg" CHECK ("products"."cost" >= 0),
	CONSTRAINT "products_stock_nonneg" CHECK ("products"."stock_qty" >= 0),
	CONSTRAINT "products_reorder_nonneg" CHECK ("products"."reorder_level" >= 0)
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"full_name" text,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" "movement_reason" NOT NULL,
	"order_id" uuid,
	"note" text,
	"created_by" uuid DEFAULT auth.uid(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_delta_nonzero" CHECK ("stock_movements"."delta" <> 0)
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_org_id_order_id_orders_org_id_id_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "public"."orders"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_org_id_product_id_products_org_id_id_fk" FOREIGN KEY ("org_id","product_id") REFERENCES "public"."products"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_org_id_customer_id_customers_org_id_id_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_counters" ADD CONSTRAINT "org_counters_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_org_id_category_id_categories_org_id_id_fk" FOREIGN KEY ("org_id","category_id") REFERENCES "public"."categories"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_org_id_product_id_products_org_id_id_fk" FOREIGN KEY ("org_id","product_id") REFERENCES "public"."products"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_org_id_order_id_orders_org_id_id_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "public"."orders"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_org_created_idx" ON "audit_log" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_open_email_key" ON "invitations" USING btree ("org_id",lower("email")) WHERE "invitations"."accepted_at" is null;--> statement-breakpoint
CREATE INDEX "orders_org_confirmed_idx" ON "orders" USING btree ("org_id","confirmed_at");--> statement-breakpoint
CREATE INDEX "stock_movements_product_idx" ON "stock_movements" USING btree ("product_id","created_at");