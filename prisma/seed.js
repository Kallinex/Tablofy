/**
 * Idempotent development seed.
 * Safe to run repeatedly: uses upserts keyed on the schema's unique
 * constraints. Running `npx prisma db seed` will not destroy or duplicate records.
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const DEMO = {
  tenantName: 'Demo Restaurant',
  tenantSlug: 'demo',
  userEmail: 'demo@tablofy.local',
  userPassword: 'demo1234',
  restaurantName: 'Demo Restaurant',
  restaurantSlug: 'demo-restaurant',
  branchName: 'Main Branch',
  branchSlug: 'main-branch',
};

async function main() {
  const prisma = new PrismaClient();

  try {
    const tenant = await prisma.tenant.upsert({
      where: { slug: DEMO.tenantSlug },
      update: {},
      create: { name: DEMO.tenantName, slug: DEMO.tenantSlug },
    });

    const passwordHash = await bcrypt.hash(DEMO.userPassword, 10);
    const owner = await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: DEMO.userEmail } },
      update: {},
      create: {
        tenantId: tenant.id,
        email: DEMO.userEmail,
        password: passwordHash,
        firstName: 'Demo',
        lastName: 'Owner',
        role: 'OWNER',
        status: 'ACTIVE',
      },
    });

    await prisma.subscription.upsert({
      where: { tenantId: tenant.id },
      update: {},
      create: { tenantId: tenant.id, plan: 'STANDARD', status: 'ACTIVE' },
    });

    const restaurant = await prisma.restaurant.upsert({
      where: { tenantId_slug: { tenantId: tenant.id, slug: DEMO.restaurantSlug } },
      update: {},
      create: {
        tenantId: tenant.id,
        name: DEMO.restaurantName,
        slug: DEMO.restaurantSlug,
      },
    });

    await prisma.branch.upsert({
      where: { restaurantId_slug: { restaurantId: restaurant.id, slug: DEMO.branchSlug } },
      update: {},
      create: {
        restaurantId: restaurant.id,
        tenantId: tenant.id,
        name: DEMO.branchName,
        slug: DEMO.branchSlug,
      },
    });

    console.log(
      `Seed complete. Tenant "${tenant.name}" (${tenant.id}), owner ${owner.email} ` +
        `(password: ${DEMO.userPassword}).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
