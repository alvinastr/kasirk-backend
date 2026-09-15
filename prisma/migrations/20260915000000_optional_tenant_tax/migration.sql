-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "tax_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tax_included" BOOLEAN NOT NULL DEFAULT false;
