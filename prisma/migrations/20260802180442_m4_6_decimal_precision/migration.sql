/*
  Warnings:

  - You are about to alter the column `lifetimeValue` on the `customer_analytics` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `Decimal(10,2)`.
  - You are about to alter the column `averageOrderValue` on the `customer_analytics` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `Decimal(10,2)`.
  - You are about to alter the column `totalSpend` on the `customer_analytics` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `Decimal(10,2)`.
  - You are about to alter the column `totalSpent` on the `memberships` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `Decimal(10,2)`.
  - You are about to alter the column `totalSpent` on the `visit_history` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `Decimal(10,2)`.
  - You are about to alter the column `amount` on the `wallet_transactions` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `Decimal(10,2)`.
  - You are about to alter the column `balanceBefore` on the `wallet_transactions` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `Decimal(10,2)`.
  - You are about to alter the column `balanceAfter` on the `wallet_transactions` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `Decimal(10,2)`.
  - You are about to alter the column `balance` on the `wallets` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `Decimal(10,2)`.

*/
-- AlterTable
ALTER TABLE "public"."customer_analytics" ALTER COLUMN "lifetimeValue" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "averageOrderValue" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "totalSpend" SET DATA TYPE DECIMAL(10,2);

-- AlterTable
ALTER TABLE "public"."memberships" ALTER COLUMN "totalSpent" SET DATA TYPE DECIMAL(10,2);

-- AlterTable
ALTER TABLE "public"."visit_history" ALTER COLUMN "totalSpent" SET DATA TYPE DECIMAL(10,2);

-- AlterTable
ALTER TABLE "public"."wallet_transactions" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "balanceBefore" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "balanceAfter" SET DATA TYPE DECIMAL(10,2);

-- AlterTable
ALTER TABLE "public"."wallets" ALTER COLUMN "balance" SET DATA TYPE DECIMAL(10,2);
