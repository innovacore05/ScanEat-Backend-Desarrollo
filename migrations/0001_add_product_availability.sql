ALTER TABLE "products"
ADD COLUMN IF NOT EXISTS "is_available" boolean NOT NULL DEFAULT true;
