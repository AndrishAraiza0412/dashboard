ALTER TABLE "organizations" DROP CONSTRAINT "organizations_modules_known";--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "enabled_modules" SET DEFAULT '{inventory,sales,purchases}'::text[];--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_purchases_needs_inventory" CHECK (not ('purchases' = any("organizations"."enabled_modules")) or 'inventory' = any("organizations"."enabled_modules"));--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_modules_known" CHECK ("organizations"."enabled_modules" <@ '{inventory,sales,purchases}'::text[]);--> statement-breakpoint
-- Purchases used to come with Inventory: orgs that have Inventory keep seeing Compras after the split.
UPDATE "organizations" SET "enabled_modules" = "enabled_modules" || '{purchases}'::text[] WHERE 'inventory' = any("enabled_modules") AND NOT ('purchases' = any("enabled_modules"));
