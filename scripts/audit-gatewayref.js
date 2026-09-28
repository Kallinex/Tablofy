#!/usr/bin/env node

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('=== Payment.gatewayRef Precheck (webhook lookup path) ===\n');

  const [total] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "payments"`,
  );
  const [withRef] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "payments" WHERE "gatewayRef" IS NOT NULL`,
  );
  const [distinctRef] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(DISTINCT "gatewayRef")::int AS n FROM "payments" WHERE "gatewayRef" IS NOT NULL`,
  );

  console.log(`payments rows total          : ${total.n}`);
  console.log(`rows with gatewayRef         : ${withRef.n}`);
  console.log(`distinct gatewayRef values   : ${distinctRef.n}`);

  const dupes = await prisma.$queryRawUnsafe(`
    SELECT "gatewayRef" AS ref, COUNT(*)::int AS n,
           COUNT(DISTINCT "tenantId")::int AS tenants,
           COUNT(DISTINCT "method")::int AS methods
    FROM "payments"
    WHERE "gatewayRef" IS NOT NULL
    GROUP BY "gatewayRef"
    HAVING COUNT(*) > 1
    ORDER BY n DESC, ref ASC
  `);

  console.log(`\nduplicate gatewayRef groups : ${dupes.length}`);
  for (const d of dupes.slice(0, 25)) {
    console.log(`    -> ref=${d.ref} rows=${d.n} tenants=${d.tenants} methods=${d.methods}`);
  }
  if (dupes.length > 25) {
    console.log(`    ... and ${dupes.length - 25} more`);
  }

  const crossTenant = dupes.filter((d) => d.tenants > 1).length;
  const crossMethod = dupes.filter((d) => d.methods > 1).length;
  console.log(`\nduplicates spanning >1 tenant: ${crossTenant}`);
  console.log(`duplicates spanning >1 method: ${crossMethod}`);

  const collisions = await prisma.$queryRawUnsafe(`
    SELECT LEFT(p."gatewayRef", 7) AS prefix, COUNT(DISTINCT p."gatewayRef")::int AS refs
    FROM "payments" p
    WHERE p."gatewayRef" IS NOT NULL
    GROUP BY 1
    ORDER BY refs DESC
    LIMIT 10
  `);
  console.log('\ngatewayRef prefixes (shape check):');
  for (const c of collisions) {
    console.log(`    ${c.prefix}...  ${c.refs} distinct refs`);
  }

  const idx = await prisma.$queryRawUnsafe(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'payments' AND indexdef ILIKE '%gatewayRef%'
  `);
  console.log(`\nexisting indexes mentioning gatewayRef: ${idx.length}`);
  for (const i of idx) {
    console.log(`    ${i.indexname}: ${i.indexdef}`);
  }

  console.log('\nCONCLUSION:');
  if (dupes.length === 0) {
    console.log('  No duplicate gatewayRef values. A unique index is technically possible,');
    console.log('  but Payment has no provider column and is soft-deleted, so a global');
    console.log('  unique constraint would still be a design decision, not a cleanup.');
  } else {
    console.log('  Duplicate gatewayRef values EXIST. A unique index would fail on apply.');
    console.log('  resolve-webhook lookups using findFirst(gatewayRef) are already ambiguous.');
  }
  if (idx.length === 0) {
    console.log('  No index on gatewayRef: every inbound webhook does a sequential scan.');
  }

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error('gatewayRef precheck failed:', error.message);
  await prisma.$disconnect();
  process.exit(2);
});
