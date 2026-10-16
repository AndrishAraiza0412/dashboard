CREATE TYPE "public"."purchase_status" AS ENUM('draft', 'ordered', 'received', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."movement_reason" ADD VALUE 'purchase';--> statement-breakpoint
CREATE TABLE "purchase_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unit_cost" numeric(12, 2) NOT NULL,
	"line_total" numeric(12, 2) GENERATED ALWAYS AS (qty * unit_cost) STORED,
	CONSTRAINT "purchase_order_items_po_product_key" UNIQUE("purchase_order_id","product_id"),
	CONSTRAINT "purchase_order_items_qty_positive" CHECK ("purchase_order_items"."qty" > 0),
	CONSTRAINT "purchase_order_items_cost_nonneg" CHECK ("purchase_order_items"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" integer,
	"supplier_id" uuid,
	"status" "purchase_status" DEFAULT 'draft' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ordered_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	CONSTRAINT "purchase_orders_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "purchase_orders_org_number_key" UNIQUE("org_id","number")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "org_counters" ADD COLUMN "next_purchase_no" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "purchase_order_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_org_id_purchase_order_id_purchase_orders_org_id_id_fk" FOREIGN KEY ("org_id","purchase_order_id") REFERENCES "public"."purchase_orders"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_org_id_product_id_products_org_id_id_fk" FOREIGN KEY ("org_id","product_id") REFERENCES "public"."products"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_org_id_supplier_id_suppliers_org_id_id_fk" FOREIGN KEY ("org_id","supplier_id") REFERENCES "public"."suppliers"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_orders_org_created_idx" ON "purchase_orders" USING btree ("org_id","created_at");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_org_id_purchase_order_id_purchase_orders_org_id_id_fk" FOREIGN KEY ("org_id","purchase_order_id") REFERENCES "public"."purchase_orders"("org_id","id") ON DELETE no action ON UPDATE no action;