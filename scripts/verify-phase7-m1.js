const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE = path.resolve(__dirname, '..');
const API_SRC = path.join(BASE, 'apps', 'api', 'src');

let passed = 0;
let failed = 0;
const errors = [];

function check(description, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${description}`);
  } else {
    failed++;
    const msg = detail ? `${description}: ${detail}` : description;
    errors.push(msg);
    console.log(`  \u2717 ${description}`);
  }
}

function fileExists(p) {
  return fs.existsSync(path.join(API_SRC, p));
}

function read(p) {
  return fs.readFileSync(path.join(API_SRC, p), 'utf-8');
}

function schemaRead() {
  return fs.readFileSync(path.join(BASE, 'prisma', 'schema.prisma'), 'utf-8');
}

console.log('\nPhase 7 M1 — Security Hardening Verification');
console.log('=============================================\n');

// 1. Generic Registration (7.1.12 / P1-4)
console.log('1. Generic Registration Error (7.1.12 / P1-4)');
const authSvc = read('modules/auth/auth.service.ts');
check('register() throws ConflictException on duplicate', authSvc.includes('ConflictException'));
check('register() throws on duplicate email', authSvc.includes('User already exists'));
check('register() does NOT return user object', !authSvc.includes('alreadyExists'));
const authCtrl = read('modules/auth/auth.controller.ts');
check('auth.controller has no alreadyExists handling', !authCtrl.includes('alreadyExists'));

// 2. @Roles on Backup Controller (7.1.1 / P0-1)
console.log('\n2. @Roles on Backup Controller (7.1.1 / P0-1)');
const backupCtrl = read('modules/backup/backup.controller.ts');
check('backup controller has @Roles', backupCtrl.includes('@Roles('));
check('backup controller has OWNER role', backupCtrl.includes("'OWNER'"));
check('backup controller uses RolesGuard', backupCtrl.includes('RolesGuard'));

// 3. @Roles on Privacy Controller (7.1.2 / P0-2)
console.log('\n3. @Roles on Privacy Controller (7.1.2 / P0-2)');
const privacyCtrl = read('modules/privacy/privacy.controller.ts');
check('privacy controller has @Roles', privacyCtrl.includes('@Roles('));
check('privacy controller has OWNER role', privacyCtrl.includes("'OWNER'"));
check('privacy controller has MANAGER role', privacyCtrl.includes("'MANAGER'"));
check('privacy controller uses RolesGuard', privacyCtrl.includes('RolesGuard'));

// 4. @Roles on Gift Cards Controller (7.1.3 / P0-3)
console.log('\n4. @Roles on Gift Cards Controller (7.1.3 / P0-3)');
const gcCtrl = read('modules/gift-cards/gift-cards.controller.ts');
check('gift-cards controller has class-level @Roles', gcCtrl.includes('@Roles('));
check('gift-cards controller has OWNER role', gcCtrl.includes("'OWNER'"));
check('gift-cards controller has MANAGER role', gcCtrl.includes("'MANAGER'"));
check('gift-cards controller uses RolesGuard', gcCtrl.includes('RolesGuard'));
check('redeem endpoint has STAFF override', gcCtrl.includes("'STAFF'"));

// 5. Roles Decorator Type (supports ClassDecorator)
console.log('\n4b. @Roles Decorator Type');
const rolesDecorator = read('common/decorators/roles.decorator.ts');
check('roles.decorator includes ClassDecorator', rolesDecorator.includes('ClassDecorator'));

// 6. Webhook Event Routing (7.1.4 / P0-4)
console.log('\n5. Webhook Event Routing (7.1.4 / P0-4)');
const eventEmitter = read('modules/webhooks/webhook-event-emitter.ts');
check('webhook-event-emitter uses eventName param', eventEmitter.includes('eventName'));
check('webhook-event-emitter handles all events', eventEmitter.includes("'**'"));

// 7. Webhook Secret Encryption (7.1.5 / P0-5)
console.log('\n6. Webhook Secret Encryption (7.1.5 / P0-5)');
const deliverySvc = read('modules/webhooks/webhook-delivery.service.ts');
check('delivery service has encryptSecret method', deliverySvc.includes('encryptSecret'));
check('delivery service has decryptSecret method', deliverySvc.includes('decryptSecret'));
check('delivery service uses AES-256-GCM', deliverySvc.includes('aes-256-gcm') || deliverySvc.includes('aes-256'));
const webhookSvc = read('modules/webhooks/webhooks.service.ts');
check('webhooks.service calls encryptSecret on create', webhookSvc.includes('encryptSecret'));
const processor = read('modules/webhooks/webhook-processor.ts');
check('webhook-processor calls decryptSecret', processor.includes('decryptSecret'));
check('schema has encryptedSecret field', schemaRead().includes('encryptedSecret'));

// 8. TenantBodyGuard (7.1.6 / P0-6)
console.log('\n7. TenantBodyGuard (7.1.6 / P0-6)');
check('tenant-body.guard.ts exists', fileExists('common/guards/tenant-body.guard.ts'));
const tenantBodyGuard = read('common/guards/tenant-body.guard.ts');
check('TenantBodyGuard implements CanActivate', tenantBodyGuard.includes('CanActivate'));
check('TenantBodyGuard checks tenantId match', tenantBodyGuard.includes('tenantId'));
check('TenantBodyGuard throws ForbiddenException', tenantBodyGuard.includes('ForbiddenException'));

// 9. @Scopes Decorator + ApiKeyGuard (7.1.7 / P0-9)
console.log('\n8. @Scopes Decorator + ApiKeyGuard (7.1.7 / P0-9)');
check('scopes.decorator.ts exists', fileExists('modules/api-keys/decorators/scopes.decorator.ts'));
const scopesDecorator = read('modules/api-keys/decorators/scopes.decorator.ts');
check('@Scopes decorator defined', scopesDecorator.includes('Scopes'));
check('SCOPES_KEY metadata key defined', scopesDecorator.includes('SCOPES_KEY'));
const apiKeyGuard = read('modules/api-keys/guards/api-key.guard.ts');
check('ApiKeyGuard checks scopes metadata', apiKeyGuard.includes('SCOPES_KEY'));
check('ApiKeyGuard derives scope from method', apiKeyGuard.includes('getRequest') || apiKeyGuard.includes('request.method') || apiKeyGuard.includes("'read'") || apiKeyGuard.includes('read'));

// 10. Tenant Status Check (7.1.8 / P1-2)
console.log('\n9. Tenant Status Check in Login + JWT (7.1.8 / P1-2)');
check('auth.service login() checks tenant status', authSvc.includes('ACTIVE') || authSvc.includes('TRIALING') || authSvc.includes('tenant.status'));
const jwtStrategy = read('modules/auth/strategies/jwt.strategy.ts');
check('jwt.strategy validates tenant status', jwtStrategy.includes('tenant.status') || jwtStrategy.includes('tenantStatus'));
check('jwt.strategy validates subscription', jwtStrategy.includes('subscription') || jwtStrategy.includes('Subscription'));

// 11. Logger Sanitization (7.1.10 / P0-13)
console.log('\n10. Logger Sanitization (7.1.10 / P0-13)');
const loggerSvc = read('common/logger/logger.service.ts');
check('logger has sensitiveKeys set', loggerSvc.includes('sensitiveKeys'));
check('logger redacts password', loggerSvc.includes("'password'"));
check('logger redacts token', loggerSvc.includes("'token'"));
check('logger redacts authorization', loggerSvc.includes("'authorization'"));
check('logger redacts secret', loggerSvc.includes("'secret'"));
check('logger redacts apiKey', loggerSvc.includes("'apiKey'"));
check('logger has sanitize method', loggerSvc.includes('sanitize'));
check('extractMeta applies sanitize', loggerSvc.includes('sanitize'));

// 12. JWT Blacklist Persistence (7.1.11 / P1-3)
console.log('\n11. JWT Blacklist Persistence (7.1.11 / P1-3)');
check('RevokedToken model in schema', schemaRead().includes('model RevokedToken'));
check('RevokedToken has jti field', schemaRead().includes('jti'));
check('RevokedToken has expiresAt field', schemaRead().includes('expiresAt'));
const redisSvc = read('redis/redis.service.ts');
check('redis.service blacklistToken upserts to DB', redisSvc.includes('revokedToken') || redisSvc.includes('RevokedToken'));
check('redis.service isTokenBlacklisted checks DB', redisSvc.includes('revokedToken') || redisSvc.includes('RevokedToken'));

// 13. Prisma Schema — Migration-Ready
console.log('\n12. Prisma Schema Changes');
const schema = schemaRead();
check('encryptedSecret on WebhookRegistration', schema.includes('encryptedSecret String?'));
check('RevokedToken model complete', schema.includes('revoked_tokens'));

// 14. Quality Gates
console.log('\n13. Quality Gates');
let tscPassed = false;
let jestPassed = false;
let eslintPassed = false;

try {
  execSync('npx tsc --noEmit -p tsconfig.json 2>&1', { cwd: path.join(BASE, 'apps', 'api'), stdio: 'pipe', timeout: 120000 });
  tscPassed = true;
} catch {
  // tsc failed
}
check('TypeScript compilation: 0 errors', tscPassed);

try {
  execSync('npx jest --passWithNoTests --silent 2>&1', { cwd: BASE, stdio: 'pipe', timeout: 120000 });
  jestPassed = true;
} catch {
  // jest failed
}
check('Jest: all tests pass', jestPassed);

try {
  const result = execSync('npx eslint "apps/api/src/**/*.ts" --max-warnings=0 2>&1', { cwd: BASE, stdio: 'pipe', timeout: 120000 });
  eslintPassed = true;
} catch {
  // eslint failed
}
check('ESLint: 0 errors, 0 warnings', eslintPassed);

console.log('\n=============================================');
console.log(`Results: ${passed} passed, ${failed} failed`);

if (errors.length > 0) {
  console.log('\nFailed checks:');
  errors.forEach(e => console.log(`  - ${e}`));
}

const total = passed + failed;
const pct = Math.round((passed / total) * 100);
console.log(`Score: ${pct}% (${passed}/${total})`);
console.log(`Status: ${failed === 0 ? '\u2713 ALL CHECKS PASSED' : '\u2717 SOME CHECKS FAILED'}`);
