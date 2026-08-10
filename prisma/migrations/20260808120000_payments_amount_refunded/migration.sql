-- AlterTable
ALTER TABLE "public"."payments" ADD COLUMN "amountRefunded" DECIMAL(10,2) NOT NULL DEFAULT 0;
