#!/usr/bin/env node

/**
 * Phase 7 — Milestone 2: Verification Script
 *
 * Validates that the Phase 7 M2 test suite expansion is complete:
 *   1. All 21 new files exist
 *   2. All 3 modified files exist and contain expected changes
 *   3. jest.config.ts has correct setupFiles and coverage thresholds
 *   4. All 36 test suites pass (run via `npx nx test api`)
 *   5. ESLint produces 0 errors on new files
 *
 * Usage:  node scripts/verify-phase7-m2.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const API = path.join(ROOT, 'apps', 'api', 'src');

let exitCode = 0;
let passed = 0;
let failed = 0;

function ok(msg) {
  console.log(`  ✓ ${msg}`);
  passed++;
}

function fail(msg) {
  console.log(`  ✗ ${msg}`);
  failed++;
  exitCode = 1;
}

function fileExists(p) {
  return fs.existsSync(path.join(ROOT, p));
}

function checkFile(label, relativePath) {
  if (fileExists(relativePath)) {
    ok(`${label} exists (${relativePath})`);
  } else {
    fail(`${label} MISSING (${relativePath})`);
  }
}

// ──────────────────────────────────────────
// 1. Verify 21 new files exist
// ──────────────────────────────────────────
console.log('\n=== New Files (21 total) ===\n');

const factories = [
  'user.factory.ts',
  'tenant.factory.ts',
  'order.factory.ts',
  'product.factory.ts',
  'menu-category.factory.ts',
  'branch.factory.ts',
  'inventory-item.factory.ts',
  'customer.factory.ts',
  'payment.factory.ts',
  'index.ts',
];

let factoryCount = 0;
for (const f of factories) {
  const p = `apps/api/src/test/factories/${f}`;
  if (fileExists(p)) {
    factoryCount++;
  }
}
if (factoryCount === factories.length) {
  ok(`All ${factories.length} factory files present`);
} else {
  fail(`Expected ${factories.length} factory files, found ${factoryCount}`);
}

// Individual checks for factories
for (const f of factories) {
  checkFile(`  factory/${f}`, `apps/api/src/test/factories/${f}`);
}

checkFile('Global test setup', 'apps/api/src/test/setup/global-test-setup.ts');

const integrationTests = [
  'auth-flow.integration.spec.ts',
  'tenant-isolation.integration.spec.ts',
  'order-crud.integration.spec.ts',
];

const integrationModules = {
  auth: 'auth',
  tenants: 'tenants',
  orders: 'orders',
};

console.log('\n--- Integration Tests ---\n');
for (const [mod, file] of Object.entries({
  auth: 'auth-flow.integration.spec.ts',
  tenants: 'tenant-isolation.integration.spec.ts',
  orders: 'order-crud.integration.spec.ts',
  backup: 'rbac.integration.spec.ts',
  privacy: 'rbac.integration.spec.ts',
  'gift-cards': 'rbac.integration.spec.ts',
})) {
  checkFile(`integration/${mod}/${file}`, `apps/api/src/modules/${mod}/tests/integration/${file}`);
}

const dtoTests = [
  ['sales-analytics', 'sales-analytics.dto.spec.ts'],
  ['inventory-analytics', 'inventory-analytics.dto.spec.ts'],
  ['customer-analytics', 'customer-analytics.dto.spec.ts'],
  ['crm', 'crm.dto.spec.ts'],
];

console.log('\n--- DTO Unit Tests ---\n');
for (const [mod, file] of dtoTests) {
  checkFile(`dto/${mod}/${file}`, `apps/api/src/modules/${mod}/tests/dto/${file}`);
}

const extendedTests = [
  ['prisma', 'prisma.service.spec.ts', 'src/prisma/tests/prisma.service.spec.ts'],
  ['common/filters', 'http-exception.filter.spec.ts', 'src/common/filters/tests/http-exception.filter.spec.ts'],
];

console.log('\n--- Extended Existing Tests ---\n');
for (const [label, file, apiRelative] of extendedTests) {
  checkFile(`extended/${label}/${file}`, `apps/api/${apiRelative}`);
}

// ──────────────────────────────────────────
// 2. Verify jest.config.ts changes
// ──────────────────────────────────────────
console.log('\n=== Jest Config ===\n');

const jestConfig = fs.readFileSync(path.join(ROOT, 'apps/api/jest.config.ts'), 'utf-8');

if (jestConfig.includes("setupFiles: ['<rootDir>/src/test/setup/global-test-setup.ts']")) {
  ok('jest.config.ts uses setupFiles (not setupFilesAfterSetup)');
} else {
  fail('jest.config.ts missing setupFiles reference to global-test-setup.ts');
}

if (!jestConfig.includes('!<rootDir>/src/**/*.dto.ts')) {
  ok('jest.config.ts no longer excludes dto.ts from coverage');
} else {
  fail('jest.config.ts still excludes dto.ts from coverage');
}

const thresholdChecks = [
  ['auth.service.ts', "**/src/modules/auth/auth.service.ts"],
  ['orders.service.ts', "**/src/modules/orders/orders.service.ts"],
  ['tenants.service.ts', "**/src/modules/tenants/tenants.service.ts"],
  ['prisma.service.ts', "**/src/prisma/prisma.service.ts"],
];

for (const [label, glob] of thresholdChecks) {
  if (jestConfig.includes(glob)) {
    ok(`Coverage threshold present for ${label}`);
  } else {
    fail(`Coverage threshold MISSING for ${label}`);
  }
}

// ──────────────────────────────────────────
// 3. Verify test run passes
// ──────────────────────────────────────────
console.log('\n=== Full Test Run ===\n');

try {
  const result = execSync('npx nx test api 2>&1', {
    cwd: ROOT,
    timeout: 180000,
    encoding: 'utf-8',
  });
  const lines = result.split('\n');

  const suiteMatch = lines.find(l => l.includes('Test Suites:'));
  const testMatch = lines.find(l => l.includes('Tests:'));

  if (suiteMatch && suiteMatch.includes('36 passed')) {
    ok('All 36 test suites pass');
  } else {
    fail(`Test suites result unexpected: ${suiteMatch || '(not found)'}`);
  }

  if (testMatch && testMatch.includes('285 passed')) {
    ok('All 285 tests pass');
  } else {
    fail(`Tests result unexpected: ${testMatch || '(not found)'}`);
  }
} catch (err) {
  fail(`Test run failed: ${err.message}`);
}

// ──────────────────────────────────────────
// 4. Verify ESLint on new test files
// ──────────────────────────────────────────
console.log('\n=== ESLint ===\n');

const newTestFiles = [
  'apps/api/src/modules/auth/tests/integration/auth-flow.integration.spec.ts',
  'apps/api/src/modules/tenants/tests/integration/tenant-isolation.integration.spec.ts',
  'apps/api/src/modules/orders/tests/integration/order-crud.integration.spec.ts',
  'apps/api/src/modules/backup/tests/integration/rbac.integration.spec.ts',
  'apps/api/src/modules/privacy/tests/integration/rbac.integration.spec.ts',
  'apps/api/src/modules/gift-cards/tests/integration/rbac.integration.spec.ts',
  'apps/api/src/modules/sales-analytics/tests/dto/sales-analytics.dto.spec.ts',
  'apps/api/src/modules/inventory-analytics/tests/dto/inventory-analytics.dto.spec.ts',
  'apps/api/src/modules/customer-analytics/tests/dto/customer-analytics.dto.spec.ts',
  'apps/api/src/modules/crm/tests/dto/crm.dto.spec.ts',
];

try {
  const eslintResult = execSync(`npx eslint ${newTestFiles.join(' ')} 2>&1`, {
    cwd: ROOT,
    timeout: 120000,
    encoding: 'utf-8',
  });
  ok('All new test files pass ESLint (0 errors)');
} catch (err) {
  const output = err.stdout || err.message || '';
  const errorCount = (output.match(/error/g) || []).length;
  fail(`${errorCount} ESLint errors in new test files`);
  console.error(output);
}

// ──────────────────────────────────────────
// Summary
// ──────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`);
console.log(`Phase 7 — M2 Verification Complete`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`${'='.repeat(50)}\n`);

process.exit(exitCode);
