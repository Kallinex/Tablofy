-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ORDER', 'PAYMENT', 'RESERVATION', 'CUSTOMER', 'CAMPAIGN', 'INVENTORY', 'SYSTEM', 'ALERT', 'BILLING', 'SECURITY', 'LOW_STOCK', 'EXPIRY', 'BIRTHDAY', 'REFERRAL', 'MEMBERSHIP', 'GENERAL');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('SALES', 'INVENTORY', 'KITCHEN', 'FINANCIAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'GENERATED', 'FAILED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "GiftCardStatus" AS ENUM ('ACTIVE', 'REDEEMED', 'EXPIRED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "GiftCardIssueType" AS ENUM ('MANUAL', 'SYSTEM', 'BULK');

-- CreateEnum
CREATE TYPE "GiftCardTransactionType" AS ENUM ('ISSUE', 'RECHARGE', 'REDEEM', 'REFUND', 'VOID');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'RETRYING');

-- CreateEnum
CREATE TYPE "WebhookEventType" AS ENUM ('orders.created', 'orders.updated', 'orders.completed', 'orders.cancelled', 'customers.created', 'customers.updated', 'customers.deleted', 'inventory.low_stock', 'inventory.out_of_stock', 'inventory.received', 'payments.completed', 'payments.failed', 'payments.refunded', 'loyalty.points_earned', 'loyalty.points_redeemed', 'loyalty.tier_changed', 'campaigns.sent', 'campaigns.opened', 'campaigns.clicked', 'suppliers.created', 'suppliers.updated', 'transfers.created', 'transfers.completed');

-- CreateEnum
CREATE TYPE "BackupRecordType" AS ENUM ('FULL', 'INCREMENTAL', 'MANUAL', 'AUTOMATED');

-- CreateEnum
CREATE TYPE "BackupRecordStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ExportFormat" AS ENUM ('JSON', 'CSV', 'EXCEL', 'PDF');

-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING');

-- CreateEnum
CREATE TYPE "StockAdjustmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "InventoryCountStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'VERIFIED', 'PENDING');

-- CreateEnum
CREATE TYPE "ExpirationAlertType" AS ENUM ('WARNING', 'CRITICAL', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CycleCountType" AS ENUM ('FULL', 'CYCLE', 'PHYSICAL', 'SPOT');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('CSV', 'EXCEL', 'PDF');

-- CreateEnum
CREATE TYPE "ReportExportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('MARKETING_EMAIL', 'SMS', 'PUSH_NOTIFICATIONS', 'DATA_PROCESSING', 'THIRD_PARTY_SHARING');

-- AlterTable
ALTER TABLE "backup_records" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "backup_records" ALTER COLUMN "type" SET DATA TYPE "BackupRecordType" USING "type"::"BackupRecordType";
ALTER TABLE "backup_records" ALTER COLUMN "type" SET DEFAULT 'FULL'::"BackupRecordType";

-- AlterTable
ALTER TABLE "backup_records" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "backup_records" ALTER COLUMN "status" SET DATA TYPE "BackupRecordStatus" USING "status"::"BackupRecordStatus";
ALTER TABLE "backup_records" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"BackupRecordStatus";

-- AlterTable
ALTER TABLE "campaign_approvals" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "campaign_approvals" ALTER COLUMN "status" SET DATA TYPE "ApprovalStatus" USING "status"::"ApprovalStatus";
ALTER TABLE "campaign_approvals" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"ApprovalStatus";

-- AlterTable
ALTER TABLE "campaigns" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "campaigns" ALTER COLUMN "type" SET DATA TYPE "CampaignType" USING "type"::"CampaignType";

-- AlterTable
ALTER TABLE "campaigns" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "campaigns" ALTER COLUMN "status" SET DATA TYPE "CampaignStatus" USING "status"::"CampaignStatus";
ALTER TABLE "campaigns" ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"CampaignStatus";

-- AlterTable
ALTER TABLE "consent_records" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "consent_records" ALTER COLUMN "type" SET DATA TYPE "ConsentType" USING "type"::"ConsentType";

-- AlterTable
ALTER TABLE "cycle_counts" ALTER COLUMN "countType" DROP DEFAULT;
ALTER TABLE "cycle_counts" ALTER COLUMN "countType" SET DATA TYPE "CycleCountType" USING "countType"::"CycleCountType";
ALTER TABLE "cycle_counts" ALTER COLUMN "countType" SET DEFAULT 'FULL'::"CycleCountType";

-- AlterTable
ALTER TABLE "data_export_requests" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "data_export_requests" ALTER COLUMN "status" SET DATA TYPE "BackupRecordStatus" USING "status"::"BackupRecordStatus";
ALTER TABLE "data_export_requests" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"BackupRecordStatus";

-- AlterTable
ALTER TABLE "data_export_requests" ALTER COLUMN "requestType" DROP DEFAULT;
ALTER TABLE "data_export_requests" ALTER COLUMN "requestType" SET DATA TYPE "BackupRecordType" USING "requestType"::"BackupRecordType";
ALTER TABLE "data_export_requests" ALTER COLUMN "requestType" SET DEFAULT 'FULL'::"BackupRecordType";

-- AlterTable
ALTER TABLE "data_export_requests" ALTER COLUMN "format" DROP DEFAULT;
ALTER TABLE "data_export_requests" ALTER COLUMN "format" SET DATA TYPE "ExportFormat" USING "format"::"ExportFormat";
ALTER TABLE "data_export_requests" ALTER COLUMN "format" SET DEFAULT 'JSON'::"ExportFormat";

-- AlterTable
ALTER TABLE "expiration_alerts" ALTER COLUMN "alertType" DROP DEFAULT;
ALTER TABLE "expiration_alerts" ALTER COLUMN "alertType" SET DATA TYPE "ExpirationAlertType" USING "alertType"::"ExpirationAlertType";
ALTER TABLE "expiration_alerts" ALTER COLUMN "alertType" SET DEFAULT 'WARNING'::"ExpirationAlertType";

-- AlterTable
ALTER TABLE "gift_card_transactions" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "gift_card_transactions" ALTER COLUMN "type" SET DATA TYPE "GiftCardTransactionType" USING "type"::"GiftCardTransactionType";

-- AlterTable
ALTER TABLE "gift_cards" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "gift_cards" ALTER COLUMN "status" SET DATA TYPE "GiftCardStatus" USING "status"::"GiftCardStatus";
ALTER TABLE "gift_cards" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'::"GiftCardStatus";

-- AlterTable
ALTER TABLE "gift_cards" ALTER COLUMN "issueType" DROP DEFAULT;
ALTER TABLE "gift_cards" ALTER COLUMN "issueType" SET DATA TYPE "GiftCardIssueType" USING "issueType"::"GiftCardIssueType";
ALTER TABLE "gift_cards" ALTER COLUMN "issueType" SET DEFAULT 'MANUAL'::"GiftCardIssueType";

-- AlterTable
ALTER TABLE "inventory_counts" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "inventory_counts" ALTER COLUMN "status" SET DATA TYPE "InventoryCountStatus" USING "status"::"InventoryCountStatus";
ALTER TABLE "inventory_counts" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"InventoryCountStatus";

-- AlterTable
ALTER TABLE "notifications" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "notifications" ALTER COLUMN "type" SET DATA TYPE "NotificationType" USING "type"::"NotificationType";

-- AlterTable
ALTER TABLE "purchase_order_approvals" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "purchase_order_approvals" ALTER COLUMN "status" SET DATA TYPE "ApprovalStatus" USING "status"::"ApprovalStatus";
ALTER TABLE "purchase_order_approvals" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"ApprovalStatus";

-- AlterTable
ALTER TABLE "report_exports" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "report_exports" ALTER COLUMN "type" SET DATA TYPE "ReportFormat" USING "type"::"ReportFormat";

-- AlterTable
ALTER TABLE "report_exports" ALTER COLUMN "reportType" DROP DEFAULT;
ALTER TABLE "report_exports" ALTER COLUMN "reportType" SET DATA TYPE "ReportType" USING "reportType"::"ReportType";

-- AlterTable
ALTER TABLE "report_exports" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "report_exports" ALTER COLUMN "status" SET DATA TYPE "ReportExportStatus" USING "status"::"ReportExportStatus";
ALTER TABLE "report_exports" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"ReportExportStatus";

-- AlterTable
ALTER TABLE "reports" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "reports" ALTER COLUMN "type" SET DATA TYPE "ReportType" USING "type"::"ReportType";

-- AlterTable
ALTER TABLE "reports" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "reports" ALTER COLUMN "status" SET DATA TYPE "ReportStatus" USING "status"::"ReportStatus";
ALTER TABLE "reports" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"ReportStatus";

-- AlterTable
ALTER TABLE "scheduled_reports" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "scheduled_reports" ALTER COLUMN "type" SET DATA TYPE "ReportType" USING "type"::"ReportType";

-- AlterTable
ALTER TABLE "scheduled_reports" ALTER COLUMN "format" DROP DEFAULT;
ALTER TABLE "scheduled_reports" ALTER COLUMN "format" SET DATA TYPE "ReportFormat" USING "format"::"ReportFormat";

-- AlterTable
ALTER TABLE "stock_adjustments" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "stock_adjustments" ALTER COLUMN "status" SET DATA TYPE "StockAdjustmentStatus" USING "status"::"StockAdjustmentStatus";
ALTER TABLE "stock_adjustments" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"StockAdjustmentStatus";

-- AlterTable
ALTER TABLE "supplier_details" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "supplier_details" ALTER COLUMN "status" SET DATA TYPE "SupplierStatus" USING "status"::"SupplierStatus";
ALTER TABLE "supplier_details" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'::"SupplierStatus";

-- AlterTable
ALTER TABLE "webhook_deliveries" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "webhook_deliveries" ALTER COLUMN "status" SET DATA TYPE "WebhookDeliveryStatus" USING "status"::"WebhookDeliveryStatus";
ALTER TABLE "webhook_deliveries" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"WebhookDeliveryStatus";

-- AlterTable
ALTER TABLE "webhook_deliveries" ALTER COLUMN "eventType" DROP DEFAULT;
ALTER TABLE "webhook_deliveries" ALTER COLUMN "eventType" SET DATA TYPE "WebhookEventType" USING "eventType"::"WebhookEventType";
