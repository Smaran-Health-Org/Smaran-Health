ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "weight_kg" real;
ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "height_cm" real;
ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "blood_pressure" text;
ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "blood_group" text;
ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "has_diabetes" boolean;

ALTER TABLE "patients" ADD CONSTRAINT "patients_weight_kg_range"
  CHECK ("weight_kg" IS NULL OR ("weight_kg" > 0 AND "weight_kg" <= 500));
ALTER TABLE "patients" ADD CONSTRAINT "patients_height_cm_range"
  CHECK ("height_cm" IS NULL OR ("height_cm" > 0 AND "height_cm" <= 300));
