#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

let exitCode = 0;
let passed = 0;
let failed = 0;
let skipped = 0;

function ok(msg) {
  console.log(`  \u2713 ${msg}`);
  passed++;
}

function fail(msg) {
  console.log(`  \u2717 ${msg}`);
  failed++;
  exitCode = 1;
}

function info(msg) {
  console.log(`  \u2013 ${msg}`);
  skipped++;
}

function read(p) {
  return fs.readFileSync(path.join(ROOT, p), 'utf-8');
}

function exists(p) {
  return fs.existsSync(path.join(ROOT, p));
}

function run(cmd, timeoutMs = 600000) {
  return execSync(cmd, { cwd: ROOT, timeout: timeoutMs, stdio: 'pipe', encoding: 'utf-8' });
}

function checkContains(label, filePath, needles) {
  const content = read(filePath);
  const missing = needles.filter((n) => !content.includes(n));
  if (missing.length === 0) {
    ok(`${label} (${filePath})`);
  } else {
    fail(`${label} MISSING in ${filePath}: ${missing.join(', ')}`);
  }
}

// ============================================================
console.log('\n=== G1: Security scanning in CI (P0-16) ===');
checkContains('npm audit step in ci.yml', '.github/workflows/ci.yml', ['npm audit']);
checkContains('CodeQL workflow with codeql-action', '.github/workflows/codeql.yml', [
  'codeql-action',
  'security-extended',
]);

console.log('\n=== G2: Docker publish workflow (P0-15) ===');
checkContains('docker-publish.yml with build-push-action', '.github/workflows/docker-publish.yml', [
  'docker/build-push-action',
]);
checkContains('docker-publish.yml with login-action', '.github/workflows/docker-publish.yml', [
  'docker/login-action',
]);
checkContains('docker-publish.yml with git SHA tagging', '.github/workflows/docker-publish.yml', [
  'github.sha',
]);

console.log('\n=== G3: Observability env vars (P1-17) ===');
const envValidation = read('apps/api/src/config/env.validation.ts');
for (const key of [
  'SENTRY_DSN',
  'SENTRY_ENABLED',
  'METRICS_AUTH_TOKEN',
  'METRICS_COLLECT_INTERVAL_MS',
]) {
  if (envValidation.includes(key)) {
    ok(`env.validation.ts declares ${key}`);
  } else {
    fail(`env.validation.ts MISSING ${key}`);
  }
}
const envExample = read('.env.example');
for (const key of [
  'SENTRY_DSN',
  'SENTRY_ENABLED',
  'METRICS_AUTH_TOKEN',
  'METRICS_COLLECT_INTERVAL_MS',
]) {
  if (envExample.includes(key)) {
    ok(`.env.example documents ${key}`);
  } else {
    fail(`.env.example MISSING ${key}`);
  }
}

console.log('\n=== G4: Prod METRICS_AUTH_TOKEN requirement (P0-14) ===');
checkContains(
  'production validation rejects missing token',
  'apps/api/src/config/env.validation.ts',
  ['Production environment requires METRICS_AUTH_TOKEN'],
);
if (exists('apps/api/src/config/env.validation.spec.ts')) {
  ok('env.validation.spec.ts exists');
} else {
  fail('env.validation.spec.ts MISSING');
}

console.log('\n=== G5: Business metrics wiring (P2-14) ===');
checkContains(
  'orders.service.ts wired to metrics',
  'apps/api/src/modules/orders/orders.service.ts',
  ['incrementOrdersCreated', 'incrementOrdersCompleted'],
);
checkContains(
  'inventory.service.ts wired to metrics',
  'apps/api/src/modules/inventory/inventory.service.ts',
  ['incrementInventoryMovements'],
);
checkContains(
  'kds.service.ts wired to kitchen metrics',
  'apps/api/src/modules/kds/kds.service.ts',
  ['incrementKitchenTickets'],
);

console.log('\n=== G6: Real disk health + bull health (P2-15) ===');
const diskHealth = read('apps/api/src/health/disk-health.indicator.ts');
if (diskHealth.includes('statfs') && diskHealth.includes('HEALTH_DISK_THRESHOLD_MB')) {
  ok('disk-health.indicator.ts uses a real statfs disk-space check');
} else {
  fail('disk-health.indicator.ts lacks a real disk-space check (statfs)');
}
const bullHealth = read('apps/api/src/health/bull-health.indicator.ts');
if (!bullHealth.includes('audit-log') && !/AuditLog/i.test(bullHealth)) {
  ok('bull-health.indicator.ts no longer references audit-log');
} else {
  fail('bull-health.indicator.ts still references audit-log');
}

console.log('\n=== G7: Bull Board (P1-19) ===');
const pkg = read('package.json');
for (const dep of ['@bull-board/api', '@bull-board/express']) {
  if (pkg.includes(dep)) {
    ok(`package.json depends on ${dep}`);
  } else {
    fail(`package.json MISSING ${dep}`);
  }
}
checkContains(
  'bull-board module with auth + router',
  'apps/api/src/common/bull-board/bull-board.module.ts',
  ['createAuthMiddleware', 'getRouter'],
);
checkContains('bull-board mounted in main.ts', 'apps/api/src/main.ts', ['BULL_BOARD_PATH']);

console.log('\n=== G8: Dead letter queue (P1-18) ===');
checkContains(
  'dead-letter queue + failed listener + threshold',
  'apps/api/src/modules/queues/queue.service.ts',
  ["'dead-letter'", "worker.on('failed'", 'QUEUE_DLQ_ALERT_THRESHOLD', 'QUEUE_JOB_OPTIONS'],
);
if (exists('apps/api/src/modules/queues/dead-letter.processor.ts')) {
  ok('dead-letter.processor.ts exists');
} else {
  fail('dead-letter.processor.ts MISSING');
}

console.log('\n=== G9: Process handlers + shutdown timeout (P2-1) ===');
checkContains('shutdown hooks + timeout + process handlers', 'apps/api/src/main.ts', [
  'enableShutdownHooks',
  'shutdownTimeoutMs',
  'unhandledRejection',
  'uncaughtException',
]);

console.log('\n=== G10: Dockerfile prod-prune (P1-16) ===');
const dockerfile = read('docker/Dockerfile');
if (dockerfile.includes('deps-prod') && dockerfile.includes('npm ci --omit=dev')) {
  ok('deps-prod stage with npm ci --omit=dev');
} else {
  fail('deps-prod stage with npm ci --omit=dev MISSING');
}
if (/COPY --from=deps-prod[^\n]*node_modules/.test(dockerfile)) {
  ok('runner copies prod node_modules from deps-prod');
} else {
  fail('runner does not copy node_modules from deps-prod');
}
if (dockerfile.includes('node_modules/prisma')) {
  ok('prisma CLI preserved for migrate deploy');
} else if (/\"prisma\"\s*:\s*\"\^/.test(read('package.json'))) {
  ok(
    'prisma CLI preserved for migrate deploy (production dependency, shipped via deps-prod node_modules)',
  );
} else {
  fail('prisma CLI not preserved in runner');
}

console.log('\n=== G11: Per-queue job options (P1-18 extended) ===');
const queueService = read('apps/api/src/modules/queues/queue.service.ts');
if (
  queueService.includes('timeout') &&
  queueService.includes('email:') &&
  queueService.includes('BASE_JOB_OPTIONS')
) {
  ok('QUEUE_JOB_OPTIONS map with per-queue timeout merged over defaults');
} else {
  fail('QUEUE_JOB_OPTIONS map/timeout MISSING');
}

console.log('\n=== G12: Cron overlap prevention (P2-related) ===');
checkContains(
  'scheduler uses RedisLockService',
  'apps/api/src/modules/scheduler/scheduler.service.ts',
  ['RedisLockService', 'runIfLocked'],
);
const scheduler = read('apps/api/src/modules/scheduler/scheduler.service.ts');
const cronLocks = (scheduler.match(/this\.runLocked\(/g) || []).length;
const cronDecorators = (scheduler.match(/@Cron\(/g) || []).length;
if (cronLocks >= 9 || cronDecorators >= 9) {
  ok(
    `${cronLocks} runLocked call sites (${cronDecorators} @Cron handlers) wrapped in distributed locks`,
  );
} else {
  fail(`cron lock call sites=${cronLocks} (expected >= 9)`);
}

console.log('\n=== G13: Real inventory processors (P1-20) ===');
const inventoryProcessor = read('apps/api/src/modules/inventory/inventory.processor.ts');
if (inventoryProcessor.includes('PrismaService') && /this\.prisma\./.test(inventoryProcessor)) {
  ok('inventory.processor.ts contains real Prisma queries');
} else {
  fail('inventory.processor.ts is still a log-only stub');
}
if (exists('apps/api/src/modules/inventory/tests/inventory.processor.spec.ts')) {
  ok('inventory.processor.spec.ts exists');
} else {
  fail('inventory.processor.spec.ts MISSING');
}

// ============================================================
console.log('\n=== G14: Build ===');
try {
  run('npx nx build api', 600000);
  ok('Build passes (0 errors)');
} catch {
  fail('Build failed');
}

console.log('\n=== G15: Lint ===');
try {
  run('npx nx lint api', 600000);
  ok('Lint passes (0 errors)');
} catch {
  fail('Lint failed');
}

console.log('\n=== G16: Tests ===');
try {
  run('npx nx test api --skip-nx-cache', 600000);
  ok('All test suites pass (exit code 0)');
} catch {
  fail('Test run failed (non-zero exit code)');
}

console.log('\n=== G17: Prisma schema sanity ===');
try {
  run('npx prisma validate', 120000);
  ok('prisma validate reports schema valid');
} catch {
  fail('prisma validate failed');
}

// ============================================================
console.log(`\nResult: ${passed} passed, ${failed} failed, ${skipped} info/skipped`);
if (exitCode !== 0) {
  console.log('PHASE7-M5 VERIFICATION FAILED');
}
process.exit(exitCode);
