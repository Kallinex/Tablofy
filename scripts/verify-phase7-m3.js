#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

let exitCode = 0;
let passed = 0;
let failed = 0;

function ok(msg) {
  console.log(`  \u2713 ${msg}`);
  passed++;
}

function fail(msg) {
  console.log(`  \u2717 ${msg}`);
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

const NEW_FILES = [
  // Module scaffold
  'apps/api/src/modules/payments/payments.module.ts',
  'apps/api/src/modules/payments/payments.controller.ts',
  'apps/api/src/modules/payments/payments.service.ts',
  'apps/api/src/modules/payments/payment-state-machine.ts',
  // DTOs
  'apps/api/src/modules/payments/dto/create-payment.dto.ts',
  'apps/api/src/modules/payments/dto/refund-payment.dto.ts',
  'apps/api/src/modules/payments/dto/partial-refund.dto.ts',
  'apps/api/src/modules/payments/dto/void-payment.dto.ts',
  'apps/api/src/modules/payments/dto/split-payment.dto.ts',
  'apps/api/src/modules/payments/dto/payment-response.dto.ts',
  'apps/api/src/modules/payments/dto/reconcile-query.dto.ts',
  // Providers
  'apps/api/src/modules/payments/providers/stripe.provider.ts',
  'apps/api/src/modules/payments/providers/paymob.provider.ts',
  // Tests
  'apps/api/src/modules/payments/tests/payments.service.spec.ts',
  'apps/api/src/modules/payments/tests/payment-state-machine.spec.ts',
  'apps/api/src/modules/payments/tests/providers/stripe.provider.spec.ts',
  'apps/api/src/modules/payments/tests/providers/paymob.provider.spec.ts',
  'apps/api/src/modules/payments/tests/integration/payment-flow.integration.spec.ts',
];

const MODIFIED_FILES = [
  'apps/api/src/app/app.module.ts',
  'apps/api/src/modules/orders/orders.service.ts',
  'apps/api/src/modules/orders/orders.module.ts',
  'apps/api/src/common/metrics/metrics.service.ts',
  'apps/api/jest.config.ts',
];

// 1. Verify 22 new files exist
console.log('\n=== New Files (22) ===\n');
for (const f of NEW_FILES) {
  checkFile(path.basename(f), f);
}

// 2. Verify 5 modified files exist
console.log('\n=== Modified Files (5) ===\n');
for (const f of MODIFIED_FILES) {
  checkFile(path.basename(f), f);
}

// 3. Verify modified file contents
console.log('\n=== Modified File Contents ===\n');

const appModule = fs.readFileSync(path.join(ROOT, 'apps/api/src/app/app.module.ts'), 'utf-8');
if (appModule.includes('PaymentsModule')) {
  ok('app.module.ts imports PaymentsModule');
} else {
  fail('app.module.ts missing PaymentsModule import');
}

const ordersService = fs.readFileSync(path.join(ROOT, 'apps/api/src/modules/orders/orders.service.ts'), 'utf-8');
if (ordersService.includes('PaymentsService')) {
  ok('orders.service.ts injects PaymentsService');
} else {
  fail('orders.service.ts missing PaymentsService injection');
}

const ordersModule = fs.readFileSync(path.join(ROOT, 'apps/api/src/modules/orders/orders.module.ts'), 'utf-8');
if (ordersModule.includes('PaymentsModule')) {
  ok('orders.module.ts imports PaymentsModule');
} else {
  fail('orders.module.ts missing PaymentsModule import');
}

const metricsService = fs.readFileSync(path.join(ROOT, 'apps/api/src/common/metrics/metrics.service.ts'), 'utf-8');
for (const method of ['incrementPaymentsCompleted', 'incrementPaymentsFailed', 'incrementPaymentsRefunded']) {
  if (metricsService.includes(method)) {
    ok(`metrics.service.ts includes ${method}()`);
  } else {
    fail(`metrics.service.ts missing ${method}()`);
  }
}

const jestConfig = fs.readFileSync(path.join(ROOT, 'apps/api/jest.config.ts'), 'utf-8');
for (const glob of ['**/src/modules/payments/payments.service.ts', '**/src/modules/payments/payment-state-machine.ts']) {
  if (jestConfig.includes(glob)) {
    ok(`jest.config.ts includes coverage threshold for ${glob}`);
  } else {
    fail(`jest.config.ts missing coverage threshold for ${glob}`);
  }
}
if (jestConfig.includes('!<rootDir>/src/modules/payments/providers/')) {
  ok('jest.config.ts excludes providers from coverage');
} else {
  fail('jest.config.ts missing provider exclusion');
}

// 4. Verify build passes
console.log('\n=== Build ===\n');
try {
  execSync('npx nx build api', { cwd: ROOT, timeout: 120000, stdio: 'pipe' });
  ok('Build passes (0 errors)');
} catch {
  fail('Build failed');
}

// 5. Verify lint on payments module files only
console.log('\n=== Lint (payments module) ===\n');
try {
  execSync('npx eslint apps/api/src/modules/payments/ --ext .ts', { cwd: ROOT, timeout: 120000, stdio: 'pipe' });
  ok('Payments module files pass ESLint (0 errors)');
} catch {
  fail('ESLint errors in payments module files');
}

// 6. Verify test suites pass
console.log('\n=== Tests ===\n');
try {
  execSync('npx nx test api --skip-nx-cache', {
    cwd: ROOT,
    timeout: 180000,
    stdio: 'pipe',
  });
  ok('All test suites pass (exit code 0)');
} catch {
  fail('Test run failed (non-zero exit code)');
}

// 7. Verify payment state machine functions
console.log('\n=== State Machine ===\n');
const stateMachine = fs.readFileSync(path.join(ROOT, 'apps/api/src/modules/payments/payment-state-machine.ts'), 'utf-8');
for (const fn of ['validatePaymentTransition', 'isRefundableStatus', 'isVoidableStatus', 'isTerminalPaymentStatus']) {
  if (stateMachine.includes(`export function ${fn}`)) {
    ok(`State machine exports ${fn}()`);
  } else {
    fail(`State machine missing ${fn}()`);
  }
}

console.log(`\n${'='.repeat(50)}`);
console.log(`Phase 7 \u2014 M3 Verification Complete`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`${'='.repeat(50)}\n`);

process.exit(exitCode);
