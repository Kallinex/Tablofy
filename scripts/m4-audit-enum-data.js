#!/usr/bin/env node

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const mem = (name, map) => ({ name, map: map || name });

const WEBHOOK_EVENTS = [
  mem('ORDERS_CREATED', 'orders.created'),
  mem('ORDERS_UPDATED', 'orders.updated'),
  mem('ORDERS_COMPLETED', 'orders.completed'),
  mem('ORDERS_CANCELLED', 'orders.cancelled'),
  mem('CUSTOMERS_CREATED', 'customers.created'),
  mem('CUSTOMERS_UPDATED', 'customers.updated'),
  mem('CUSTOMERS_DELETED', 'customers.deleted'),
  mem('INVENTORY_LOW_STOCK', 'inventory.low_stock'),
  mem('INVENTORY_OUT_OF_STOCK', 'inventory.out_of_stock'),
  mem('INVENTORY_RECEIVED', 'inventory.received'),
  mem('PAYMENTS_COMPLETED', 'payments.completed'),
  mem('PAYMENTS_FAILED', 'payments.failed'),
  mem('PAYMENTS_REFUNDED', 'payments.refunded'),
  mem('LOYALTY_POINTS_EARNED', 'loyalty.points_earned'),
  mem('LOYALTY_POINTS_REDEEMED', 'loyalty.points_redeemed'),
  mem('LOYALTY_TIER_CHANGED', 'loyalty.tier_changed'),
  mem('CAMPAIGNS_SENT', 'campaigns.sent'),
  mem('CAMPAIGNS_OPENED', 'campaigns.opened'),
  mem('CAMPAIGNS_CLICKED', 'campaigns.clicked'),
  mem('SUPPLIERS_CREATED', 'suppliers.created'),
  mem('SUPPLIERS_UPDATED', 'suppliers.updated'),
  mem('TRANSFERS_CREATED', 'transfers.created'),
  mem('TRANSFERS_COMPLETED', 'transfers.completed'),
];

const fields = [
  { table: 'notifications', column: 'type', enum: 'NotificationType', default: 'GENERAL',   members: ['ORDER','PAYMENT','RESERVATION','CUSTOMER','CAMPAIGN','INVENTORY','SYSTEM','ALERT','BILLING','SECURITY','LOW_STOCK','EXPIRY','BIRTHDAY','REFERRAL','MEMBERSHIP','GENERAL'].map((n) => mem(n)) },
  { table: 'reports', column: 'type', enum: 'ReportType', default: null, members: ['SALES','INVENTORY','KITCHEN','FINANCIAL','CUSTOM'].map((n) => mem(n)) },
  { table: 'reports', column: 'status', enum: 'ReportStatus', default: 'PENDING', members: ['PENDING','GENERATED','FAILED'].map((n) => mem(n)) },
  { table: 'campaigns', column: 'type', enum: 'CampaignType', default: null, members: ['EMAIL','SMS','PUSH','WHATSAPP'].map((n) => mem(n)) },
  { table: 'campaigns', column: 'status', enum: 'CampaignStatus', default: 'DRAFT', members: ['DRAFT','ACTIVE','PAUSED','COMPLETED','CANCELLED'].map((n) => mem(n)) },
  { table: 'campaign_approvals', column: 'status', enum: 'ApprovalStatus', default: null, members: ['PENDING','APPROVED','REJECTED'].map((n) => mem(n)) },
  { table: 'gift_cards', column: 'status', enum: 'GiftCardStatus', default: 'ACTIVE', members: ['ACTIVE','REDEEMED','EXPIRED','DEACTIVATED'].map((n) => mem(n)) },
  { table: 'gift_cards', column: 'issueType', enum: 'GiftCardIssueType', default: 'MANUAL', members: ['MANUAL','SYSTEM','BULK'].map((n) => mem(n)) },
  { table: 'gift_card_transactions', column: 'type', enum: 'GiftCardTransactionType', default: null, members: ['ISSUE','RECHARGE','REDEEM','REFUND','VOID'].map((n) => mem(n)) },
  { table: 'webhook_deliveries', column: 'status', enum: 'WebhookDeliveryStatus', default: 'PENDING', members: ['PENDING','SENT','FAILED','RETRYING'].map((n) => mem(n)) },
  { table: 'webhook_deliveries', column: 'eventType', enum: 'WebhookEventType', default: null, members: WEBHOOK_EVENTS },
  { table: 'backup_records', column: 'type', enum: 'BackupRecordType', default: 'FULL', members: ['FULL','INCREMENTAL','MANUAL','AUTOMATED'].map((n) => mem(n)) },
  { table: 'backup_records', column: 'status', enum: 'BackupRecordStatus', default: 'PENDING', members: ['PENDING','IN_PROGRESS','COMPLETED','FAILED','EXPIRED'].map((n) => mem(n)) },
  { table: 'data_export_requests', column: 'status', enum: 'BackupRecordStatus', default: 'PENDING', members: ['PENDING','IN_PROGRESS','COMPLETED','FAILED','EXPIRED'].map((n) => mem(n)) },
  { table: 'data_export_requests', column: 'requestType', enum: 'BackupRecordType', default: 'FULL', members: ['FULL','INCREMENTAL','MANUAL','AUTOMATED'].map((n) => mem(n)) },
  { table: 'data_export_requests', column: 'format', enum: 'ExportFormat', default: 'JSON', members: ['JSON','CSV','EXCEL','PDF'].map((n) => mem(n)) },
  { table: 'purchase_order_approvals', column: 'status', enum: 'ApprovalStatus', default: null, members: ['PENDING','APPROVED','REJECTED'].map((n) => mem(n)) },
  { table: 'supplier_details', column: 'status', enum: 'SupplierStatus', default: 'ACTIVE', members: ['ACTIVE','INACTIVE','SUSPENDED','PENDING'].map((n) => mem(n)) },
  { table: 'stock_adjustments', column: 'status', enum: 'StockAdjustmentStatus', default: 'PENDING', members: ['PENDING','APPROVED','REJECTED'].map((n) => mem(n)) },
  { table: 'inventory_counts', column: 'status', enum: 'InventoryCountStatus', default: 'PENDING', members: ['DRAFT','IN_PROGRESS','COMPLETED','CANCELLED','VERIFIED','PENDING'].map((n) => mem(n)) },
  { table: 'expiration_alerts', column: 'alertType', enum: 'ExpirationAlertType', default: 'WARNING', members: ['WARNING','CRITICAL','EXPIRED'].map((n) => mem(n)) },
  { table: 'cycle_counts', column: 'countType', enum: 'CycleCountType', default: 'FULL', members: ['FULL','CYCLE','PHYSICAL','SPOT'].map((n) => mem(n)) },
  { table: 'scheduled_reports', column: 'type', enum: 'ReportType', default: null, members: ['SALES','INVENTORY','KITCHEN','FINANCIAL','CUSTOM'].map((n) => mem(n)) },
  { table: 'scheduled_reports', column: 'format', enum: 'ReportFormat', default: null, members: ['CSV','EXCEL','PDF'].map((n) => mem(n)) },
  { table: 'report_exports', column: 'type', enum: 'ReportFormat', default: null, members: ['CSV','EXCEL','PDF'].map((n) => mem(n)) },
  { table: 'report_exports', column: 'reportType', enum: 'ReportType', default: null, members: ['SALES','INVENTORY','KITCHEN','FINANCIAL','CUSTOM'].map((n) => mem(n)) },
  { table: 'report_exports', column: 'status', enum: 'ReportExportStatus', default: null, members: ['PENDING','PROCESSING','COMPLETED','FAILED'].map((n) => mem(n)) },
  { table: 'consent_records', column: 'type', enum: 'ConsentType', default: null, members: ['MARKETING_EMAIL','SMS','PUSH_NOTIFICATIONS','DATA_PROCESSING','THIRD_PARTY_SHARING'].map((n) => mem(n)) },
];

async function main() {
  console.log('=== M4-05 Pre-Migration Enum Data Audit (28 fields) ===\n');

  let totalDrift = 0;
  let anyHalt = false;

  for (const f of fields) {
    const wireValues = new Set(f.members.map((m) => m.map));
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "${f.column}" AS v, COUNT(*)::int AS n FROM "${f.table}" GROUP BY "${f.column}" ORDER BY "${f.column}"`,
    );

    const drift = rows.filter((r) => r.v !== null && !wireValues.has(r.v));
    const mapped = rows.filter((r) => r.v !== null && wireValues.has(r.v));
    const nullRows = rows.find((r) => r.v === null);

    console.log(`${f.table}.${f.column} -> ${f.enum}  (${drift.length === 0 ? 'OK' : 'DRIFT'})`);
    for (const r of rows) {
      console.log(`    "${r.v}" x ${r.n}`);
    }
    if (f.default) {
      console.log(`    default="${f.default}"`);
    }

    if (drift.length > 0) {
      anyHalt = true;
      totalDrift += drift.reduce((acc, r) => acc + r.n, 0);
      console.log('    DRIFT VALUES (not covered by enum members):');
      for (const r of drift) {
        const def = f.default ? ` -> maps to default "${f.default}"` : ' -> NO DEFAULT DEFINED';
        console.log(`      "${r.v}" x ${r.n}${def}`);
      }
    }
    if (nullRows && !f.default && f.enum !== 'NotificationType') {
      console.log(`    NOTE: ${nullRows.n} NULL values present; field has no default`);
    }
    console.log('');
  }

  console.log('=== Summary ===');
  console.log(`Target columns: ${fields.length}`);
  console.log(`Total affected rows across all fields: ${totalDrift === 0 ? '0 (clean)' : totalDrift}`);
  if (anyHalt) {
    console.log('RESULT: FAIL (drift found - review mapping table above and clean/backfill before M4-05)');
    process.exitCode = 1;
  } else {
    console.log('RESULT: PASS (all distinct values covered by enum members - M4-05 is safe)');
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('Enum data audit failed:', error);
  await prisma.$disconnect();
  process.exit(2);
});
