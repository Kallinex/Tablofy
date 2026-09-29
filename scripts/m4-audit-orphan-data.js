#!/usr/bin/env node

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const checks = [
    {
      label: 'membership_history.customerId -> customers',
      query: `
        SELECT mh.id AS row_id, mh."customerId" AS fk_value
        FROM "membership_history" mh
        LEFT JOIN "customers" c ON c.id = mh."customerId"
        WHERE c.id IS NULL
      `,
    },
    {
      label: 'membership_history.tenantId -> tenants',
      query: `
        SELECT mh.id AS row_id, mh."tenantId" AS fk_value
        FROM "membership_history" mh
        LEFT JOIN "tenants" t ON t.id = mh."tenantId"
        WHERE t.id IS NULL
      `,
    },
    {
      label: 'event_logs.tenantId -> tenants',
      query: `
        SELECT el.id AS row_id, el."tenantId" AS fk_value
        FROM "event_logs" el
        LEFT JOIN "tenants" t ON t.id = el."tenantId"
        WHERE t.id IS NULL
      `,
    },
    {
      label: 'event_logs.ruleId -> event_rules',
      query: `
        SELECT el.id AS row_id, el."ruleId" AS fk_value
        FROM "event_logs" el
        LEFT JOIN "event_rules" er ON er.id = el."ruleId"
        WHERE el."ruleId" IS NOT NULL AND er.id IS NULL
      `,
    },
  ];

  let totalOrphans = 0;

  console.log('=== M4-01 Orphan-Data Audit (MembershipHistory / EventLog) ===\n');

  for (const check of checks) {
    const rows = await prisma.$queryRawUnsafe(check.query);
    const count = rows.length;
    totalOrphans += count;
    console.log(`${count === 0 ? 'OK' : 'ORPHANS'}  ${check.label}: ${count}`);
    if (count > 0) {
      for (const row of rows.slice(0, 25)) {
        console.log(`    -> row id=${row.row_id} fk_value=${row.fk_value}`);
      }
      if (count > 25) {
        console.log(`    ... and ${count - 25} more`);
      }
    }
  }

  console.log(`\nTotal orphan rows: ${totalOrphans}`);
  if (totalOrphans === 0) {
    console.log('RESULT: PASS (0 orphan rows - M4-01 FK creation is safe)');
  } else {
    console.log(
      'RESULT: FAIL (orphan rows present - cleanup per plan section 9.2/16 step 2 before M4-01)',
    );
  }

  await prisma.$disconnect();
  process.exit(totalOrphans === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error('Orphan-data audit failed:', error);
  await prisma.$disconnect();
  process.exit(2);
});
