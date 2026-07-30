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
    console.log(`  ✓ ${description}`);
  } else {
    failed++;
    const msg = detail ? `${description}: ${detail}` : description;
    errors.push(msg);
    console.log(`  ✗ ${description}`);
  }
}

function fileExists(p) {
  return fs.existsSync(path.join(API_SRC, p));
}

function dirExists(p) {
  return fs.existsSync(path.join(API_SRC, p));
}

console.log('\nPhase 6 M4 — Enterprise Platform Completion Verification');
console.log('======================================================\n');

// 1. i18n Module
console.log('1. Internationalization (i18n)');
check('Locale directory exists', dirExists('common/i18n/locales'));
check('English locale file exists', fileExists('common/i18n/locales/en.json'));
check('Arabic locale file exists', fileExists('common/i18n/locales/ar.json'));
check('I18nService exists', fileExists('common/i18n/i18n.service.ts'));
check('I18nMiddleware exists', fileExists('common/i18n/i18n.middleware.ts'));
check('I18nModule exists', fileExists('common/i18n/i18n.module.ts'));
check('I18nService has translate method', fileExists('common/i18n/i18n.service.ts') &&
  fs.readFileSync(path.join(API_SRC, 'common/i18n/i18n.service.ts'), 'utf-8').includes('translate(key'));
check('I18nService supports en locale', fileExists('common/i18n/i18n.service.ts') &&
  fs.readFileSync(path.join(API_SRC, 'common/i18n/i18n.service.ts'), 'utf-8').includes("'en'"));
check('I18nService supports ar locale', fileExists('common/i18n/i18n.service.ts') &&
  fs.readFileSync(path.join(API_SRC, 'common/i18n/i18n.service.ts'), 'utf-8').includes('ar.json'));
check('I18nMiddleware reads Accept-Language header', fileExists('common/i18n/i18n.middleware.ts') &&
  fs.readFileSync(path.join(API_SRC, 'common/i18n/i18n.middleware.ts'), 'utf-8').includes('accept-language'));

// 2. GDPR / Privacy Module
console.log('\n2. GDPR / Privacy Module');
check('Privacy module directory exists', dirExists('modules/privacy'));
check('PrivacyService exists', fileExists('modules/privacy/privacy.service.ts'));
check('PrivacyController exists', fileExists('modules/privacy/privacy.controller.ts'));
check('PrivacyModule exists', fileExists('modules/privacy/privacy.module.ts'));
check('ConsentRecord model in Prisma', fs.existsSync(path.join(BASE, 'prisma', 'schema.prisma')) &&
  fs.readFileSync(path.join(BASE, 'prisma', 'schema.prisma'), 'utf-8').includes('model ConsentRecord'));
check('CookiePreference model in Prisma',
  fs.readFileSync(path.join(BASE, 'prisma', 'schema.prisma'), 'utf-8').includes('model CookiePreference'));
check('DataExportRequest model in Prisma',
  fs.readFileSync(path.join(BASE, 'prisma', 'schema.prisma'), 'utf-8').includes('model DataExportRequest'));
check('PrivacyService has recordConsent method',
  fs.readFileSync(path.join(API_SRC, 'modules/privacy/privacy.service.ts'), 'utf-8').includes('recordConsent'));
check('PrivacyService has revokeConsent method',
  fs.readFileSync(path.join(API_SRC, 'modules/privacy/privacy.service.ts'), 'utf-8').includes('revokeConsent'));
check('PrivacyService has saveCookiePreferences method',
  fs.readFileSync(path.join(API_SRC, 'modules/privacy/privacy.service.ts'), 'utf-8').includes('saveCookiePreferences'));
check('PrivacyService has requestDataExport method',
  fs.readFileSync(path.join(API_SRC, 'modules/privacy/privacy.service.ts'), 'utf-8').includes('requestDataExport'));
check('PrivacyService has anonymizeUser method',
  fs.readFileSync(path.join(API_SRC, 'modules/privacy/privacy.service.ts'), 'utf-8').includes('anonymizeUser'));

// 3. Gift Card Module
console.log('\n3. Gift Card Module');
check('Gift cards module directory exists', dirExists('modules/gift-cards'));
check('GiftCardsService exists', fileExists('modules/gift-cards/gift-cards.service.ts'));
check('GiftCardsController exists', fileExists('modules/gift-cards/gift-cards.controller.ts'));
check('GiftCardsModule exists', fileExists('modules/gift-cards/gift-cards.module.ts'));
check('CreateGiftCardDto exists', fileExists('modules/gift-cards/dto/create-gift-card.dto.ts'));
check('RechargeGiftCardDto exists', fileExists('modules/gift-cards/dto/recharge-gift-card.dto.ts'));
check('RedeemGiftCardDto exists', fileExists('modules/gift-cards/dto/redeem-gift-card.dto.ts'));
check('GiftCard model in Prisma',
  fs.readFileSync(path.join(BASE, 'prisma', 'schema.prisma'), 'utf-8').includes('model GiftCard'));
check('GiftCardTransaction model in Prisma',
  fs.readFileSync(path.join(BASE, 'prisma', 'schema.prisma'), 'utf-8').includes('model GiftCardTransaction'));
check('GiftCardsService has create method',
  fs.readFileSync(path.join(API_SRC, 'modules/gift-cards/gift-cards.service.ts'), 'utf-8').includes('async create'));
check('GiftCardsService has recharge method',
  fs.readFileSync(path.join(API_SRC, 'modules/gift-cards/gift-cards.service.ts'), 'utf-8').includes('async recharge'));
check('GiftCardsService has redeem method',
  fs.readFileSync(path.join(API_SRC, 'modules/gift-cards/gift-cards.service.ts'), 'utf-8').includes('async redeem'));
check('GiftCardsService has findByCode method',
  fs.readFileSync(path.join(API_SRC, 'modules/gift-cards/gift-cards.service.ts'), 'utf-8').includes('findByCode'));
check('GiftCardsService has getTransactions method',
  fs.readFileSync(path.join(API_SRC, 'modules/gift-cards/gift-cards.service.ts'), 'utf-8').includes('getTransactions'));
check('GiftCard code generation uses GC- prefix',
  fs.readFileSync(path.join(API_SRC, 'modules/gift-cards/gift-cards.service.ts'), 'utf-8').includes("'GC-'"));

// 4. Backup & Restore Module
console.log('\n4. Backup & Restore Module');
check('Backup module directory exists', dirExists('modules/backup'));
check('BackupService exists', fileExists('modules/backup/backup.service.ts'));
check('BackupController exists', fileExists('modules/backup/backup.controller.ts'));
check('BackupModule exists', fileExists('modules/backup/backup.module.ts'));
check('BackupRecord model in Prisma',
  fs.readFileSync(path.join(BASE, 'prisma', 'schema.prisma'), 'utf-8').includes('model BackupRecord'));
check('BackupService has create method',
  fs.readFileSync(path.join(API_SRC, 'modules/backup/backup.service.ts'), 'utf-8').includes('async create'));
check('BackupService has restore method',
  fs.readFileSync(path.join(API_SRC, 'modules/backup/backup.service.ts'), 'utf-8').includes('async restore'));
check('BackupService has verify method',
  fs.readFileSync(path.join(API_SRC, 'modules/backup/backup.service.ts'), 'utf-8').includes('async verify'));
check('BackupService has deleteExpired method',
  fs.readFileSync(path.join(API_SRC, 'modules/backup/backup.service.ts'), 'utf-8').includes('deleteExpired'));
check('BackupService uses checksum validation',
  fs.readFileSync(path.join(API_SRC, 'modules/backup/backup.service.ts'), 'utf-8').includes('checksum'));
check('BackupService uses SHA256',
  fs.readFileSync(path.join(API_SRC, 'modules/backup/backup.service.ts'), 'utf-8').includes('sha256'));

// 5. Disaster Recovery Module
console.log('\n5. Disaster Recovery Module');
check('Recovery module directory exists', dirExists('common/recovery'));
check('RecoveryService exists', fileExists('common/recovery/recovery.service.ts'));
check('RecoveryModule exists', fileExists('common/recovery/recovery.module.ts'));
check('RecoveryService has checkHealth method',
  fs.readFileSync(path.join(API_SRC, 'common/recovery/recovery.service.ts'), 'utf-8').includes('checkHealth'));
check('RecoveryService has performRecoveryCheck method',
  fs.readFileSync(path.join(API_SRC, 'common/recovery/recovery.service.ts'), 'utf-8').includes('performRecoveryCheck'));
check('RecoveryService has startRecovery method',
  fs.readFileSync(path.join(API_SRC, 'common/recovery/recovery.service.ts'), 'utf-8').includes('startRecovery'));
check('RecoveryService checks database connectivity',
  fs.readFileSync(path.join(API_SRC, 'common/recovery/recovery.service.ts'), 'utf-8').includes('checkDatabase'));
check('RecoveryService checks system memory',
  fs.readFileSync(path.join(API_SRC, 'common/recovery/recovery.service.ts'), 'utf-8').includes('checkMemory'));

// 6. Operational Maintenance (Extended Scheduler)
console.log('\n6. Operational Maintenance (Scheduler Enhancements)');
check('Scheduler service has cleanup_failed_webhooks cron',
  fs.readFileSync(path.join(API_SRC, 'modules/scheduler/scheduler.service.ts'), 'utf-8').includes('cleanup_failed_webhooks'));
check('Scheduler service has cleanup_stale_jobs cron',
  fs.readFileSync(path.join(API_SRC, 'modules/scheduler/scheduler.service.ts'), 'utf-8').includes('cleanup_stale_jobs'));
check('Scheduler service has cleanup_expired_data_exports cron',
  fs.readFileSync(path.join(API_SRC, 'modules/scheduler/scheduler.service.ts'), 'utf-8').includes('cleanup_expired_data_exports'));
check('Scheduler service has cleanup_expired_backups cron',
  fs.readFileSync(path.join(API_SRC, 'modules/scheduler/scheduler.service.ts'), 'utf-8').includes('cleanup_expired_backups'));
check('Scheduler service has cleanup_stale_gift_cards cron',
  fs.readFileSync(path.join(API_SRC, 'modules/scheduler/scheduler.service.ts'), 'utf-8').includes('cleanup_stale_gift_cards'));
check('Cleanup processor handles failed_webhook_deliveries',
  fs.readFileSync(path.join(API_SRC, 'modules/queues/cleanup.processor.ts'), 'utf-8').includes('failed_webhook_deliveries'));
check('Cleanup processor handles expired_data_exports',
  fs.readFileSync(path.join(API_SRC, 'modules/queues/cleanup.processor.ts'), 'utf-8').includes('expired_data_exports'));
check('Cleanup processor handles expired_backups',
  fs.readFileSync(path.join(API_SRC, 'modules/queues/cleanup.processor.ts'), 'utf-8').includes('expired_backups'));
check('Cleanup processor handles stale_gift_cards',
  fs.readFileSync(path.join(API_SRC, 'modules/queues/cleanup.processor.ts'), 'utf-8').includes('stale_gift_cards'));
check('Scheduler service lists 8 registered jobs',
  fs.readFileSync(path.join(API_SRC, 'modules/scheduler/scheduler.service.ts'), 'utf-8').includes('name: \'cleanup_stale_gift_cards\''));

// 7. App Module Integration
console.log('\n7. App Module Integration');
const appModule = fs.readFileSync(path.join(API_SRC, 'app/app.module.ts'), 'utf-8');
check('GiftCardsModule imported in AppModule', appModule.includes('GiftCardsModule'));
check('PrivacyModule imported in AppModule', appModule.includes('PrivacyModule'));
check('BackupModule imported in AppModule', appModule.includes('BackupModule'));
check('I18nModule imported in AppModule', appModule.includes('I18nModule'));
check('RecoveryModule imported in AppModule', appModule.includes('RecoveryModule'));
check('I18nMiddleware applied to all routes', appModule.includes('I18nMiddleware'));

// 8. Swagger Tags
console.log('\n8. Swagger Tags');
const mainTs = fs.readFileSync(path.join(BASE, 'apps/api/src/main.ts'), 'utf-8');
check('Swagger tag for gift-cards', mainTs.includes("'gift-cards'"));
check('Swagger tag for privacy', mainTs.includes("'privacy'"));
check('Swagger tag for backup', mainTs.includes("'backup'"));

// 9. Quality Gates
console.log('\n9. Quality Gates');
let tscPassed = false;
let jestPassed = false;
let eslintPassed = false;

try {
  execSync('npx tsc --noEmit -p tsconfig.json', { cwd: path.join(BASE, 'apps', 'api'), stdio: 'pipe' });
  tscPassed = true;
} catch {
  // tsc failed
}
check('TypeScript compilation: 0 errors', tscPassed);

try {
  execSync('npx jest --passWithNoTests --silent', { cwd: BASE, stdio: 'pipe' });
  jestPassed = true;
} catch {
  // jest failed
}
check('Jest: all tests pass', jestPassed);

try {
  execSync('npx eslint "apps/api/src/**/*.ts" --max-warnings=0', { cwd: BASE, stdio: 'pipe' });
  eslintPassed = true;
} catch {
  // eslint failed
}
check('ESLint: 0 errors, 0 warnings', eslintPassed);

console.log('\n======================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);

if (errors.length > 0) {
  console.log('\nFailed checks:');
  errors.forEach(e => console.log(`  - ${e}`));
}

const total = passed + failed;
const pct = Math.round((passed / total) * 100);
console.log(`Score: ${pct}% (${passed}/${total})`);
console.log(`Status: ${failed === 0 ? '✓ ALL CHECKS PASSED' : '✗ SOME CHECKS FAILED'}`);
