#!/usr/bin/env node
/**
 * Phase 6 M3 - Enterprise Integrations & Platform APIs Verification
 *
 * Usage: node scripts/verify-phase6-m3.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const API = path.join(ROOT, 'apps', 'api', 'src');

let exitCode = 0;
let passed = 0;
let failed = 0;

function check(description, condition) {
  if (condition) {
    console.log(`  [PASS] ${description}`);
    passed++;
  } else {
    console.log(`  [FAIL] ${description}`);
    failed++;
    exitCode = 1;
  }
}

function fileExists(rel) {
  return fs.existsSync(path.join(API, rel));
}

function rootFile(rel) {
  return path.join(ROOT, rel);
}

function fileContains(rel, substr) {
  const full = path.join(API, rel);
  if (!fs.existsSync(full)) return false;
  return fs.readFileSync(full, 'utf-8').includes(substr);
}

function rootContains(rel, substr) {
  const full = rootFile(rel);
  if (!fs.existsSync(full)) return false;
  return fs.readFileSync(full, 'utf-8').includes(substr);
}

console.log('\n=== Phase 6 M3 - Enterprise Integrations & Platform APIs Verification ===\n');

// 1. SDK Readiness
console.log('[1] SDK Readiness');
check('common/interfaces/index.ts exists', fileExists('common/interfaces/index.ts'));
check('common/utils/pagination.util.ts exists', fileExists('common/utils/pagination.util.ts'));
check('common/dto/sort.dto.ts exists', fileExists('common/dto/sort.dto.ts'));
check('common/dto/filter.dto.ts exists', fileExists('common/dto/filter.dto.ts'));
check('PaginationMeta interface defined', fileContains('common/interfaces/index.ts', 'PaginationMeta'));
check('pagination util buildPaginationMeta exists', fileContains('common/utils/pagination.util.ts', 'buildPaginationMeta'));

// 2. Webhook Framework
console.log('\n[2] Enterprise Webhook Framework');
check('webhooks.module.ts exists', fileExists('modules/webhooks/webhooks.module.ts'));
check('webhooks.controller.ts exists', fileExists('modules/webhooks/webhooks.controller.ts'));
check('webhooks.service.ts exists', fileExists('modules/webhooks/webhooks.service.ts'));
check('webhook-delivery.service.ts exists', fileExists('modules/webhooks/webhook-delivery.service.ts'));
check('webhook-processor.ts exists', fileExists('modules/webhooks/webhook-processor.ts'));
check('webhook-event-emitter.ts exists', fileExists('modules/webhooks/webhook-event-emitter.ts'));
check('dto/create-webhook.dto.ts exists', fileExists('modules/webhooks/dto/create-webhook.dto.ts'));
check('dto/update-webhook.dto.ts exists', fileExists('modules/webhooks/dto/update-webhook.dto.ts'));
check('dto/query-webhook.dto.ts exists', fileExists('modules/webhooks/dto/query-webhook.dto.ts'));
check('HMAC SHA256 signing', fileContains('modules/webhooks/webhook-delivery.service.ts', 'createHmac'));
check('Exponential backoff', fileContains('modules/webhooks/webhook-delivery.service.ts', 'calculateBackoff'));
check('Dead-letter queue', fileContains('modules/webhooks/webhook-delivery.service.ts', 'DEAD_LETTER'));
check('Secret rotation endpoint', fileContains('modules/webhooks/webhooks.controller.ts', 'rotate-secret'));
check('Webhook processor registered', fileContains('modules/webhooks/webhook-processor.ts', 'registerWorker'));
check('Signature verification', fileContains('modules/webhooks/webhook-delivery.service.ts', 'timingSafeEqual'));
check('Config webhook config exists', fileExists('config/webhook.config.ts'));

// 3. Public REST API
console.log('\n[3] Public REST API (API Keys)');
check('api-keys.module.ts exists', fileExists('modules/api-keys/api-keys.module.ts'));
check('api-keys.controller.ts exists', fileExists('modules/api-keys/api-keys.controller.ts'));
check('api-keys.service.ts exists', fileExists('modules/api-keys/api-keys.service.ts'));
check('guards/api-key.guard.ts exists', fileExists('modules/api-keys/guards/api-key.guard.ts'));
check('dto/create-api-key.dto.ts exists', fileExists('modules/api-keys/dto/create-api-key.dto.ts'));
check('dto/update-api-key.dto.ts exists', fileExists('modules/api-keys/dto/update-api-key.dto.ts'));
check('dto/query-api-key.dto.ts exists', fileExists('modules/api-keys/dto/query-api-key.dto.ts'));
check('API key generation with prefix', fileContains('modules/api-keys/api-keys.service.ts', 'keyPrefix'));
check('API key rotation', fileContains('modules/api-keys/api-keys.controller.ts', 'rotate'));
check('API key scopes validation', fileContains('modules/api-keys/api-keys.service.ts', 'scopes'));
check('Config api-keys config exists', fileExists('config/api-keys.config.ts'));

// 4. Integration Framework
console.log('\n[4] Integration Framework');
check('integrations.module.ts exists', fileExists('modules/integrations/integrations.module.ts'));
check('integrations.service.ts exists', fileExists('modules/integrations/integrations.service.ts'));
check('interfaces/integration-provider.interface.ts exists', fileExists('modules/integrations/interfaces/integration-provider.interface.ts'));
check('interfaces/accounting-provider.interface.ts exists', fileExists('modules/integrations/interfaces/accounting-provider.interface.ts'));
check('interfaces/payment-provider.interface.ts exists', fileExists('modules/integrations/interfaces/payment-provider.interface.ts'));
check('interfaces/communication-provider.interface.ts exists', fileExists('modules/integrations/interfaces/communication-provider.interface.ts'));
check('IntegrationProvider base interface', fileContains('modules/integrations/interfaces/integration-provider.interface.ts', 'IntegrationProvider'));
check('AccountingProvider interface', fileContains('modules/integrations/interfaces/accounting-provider.interface.ts', 'AccountingProvider'));
check('PaymentProvider interface', fileContains('modules/integrations/interfaces/payment-provider.interface.ts', 'PaymentProvider'));
check('EmailProvider interface', fileContains('modules/integrations/interfaces/communication-provider.interface.ts', 'EmailProvider'));
check('SmsProvider interface', fileContains('modules/integrations/interfaces/communication-provider.interface.ts', 'SmsProvider'));
check('WhatsAppProvider interface', fileContains('modules/integrations/interfaces/communication-provider.interface.ts', 'WhatsAppProvider'));

// 5. Prisma Schema
console.log('\n[5] Prisma Schema');
check('WebhookRegistration model', rootContains('prisma/schema.prisma', 'model WebhookRegistration'));
check('WebhookDelivery model', rootContains('prisma/schema.prisma', 'model WebhookDelivery'));
check('ApiKey model', rootContains('prisma/schema.prisma', 'model ApiKey'));

// 6. AppModule
console.log('\n[6] AppModule Integration');
check('AppModule imports WebhooksModule', fileContains('app/app.module.ts', 'WebhooksModule'));
check('AppModule imports ApiKeysModule', fileContains('app/app.module.ts', 'ApiKeysModule'));
check('AppModule imports IntegrationsModule', fileContains('app/app.module.ts', 'IntegrationsModule'));
check('AppModule provides WebhookEventEmitter', fileContains('app/app.module.ts', 'WebhookEventEmitter'));
check('AppModule loads webhookConfig', fileContains('app/app.module.ts', 'webhookConfig'));
check('AppModule loads apiKeysConfig', fileContains('app/app.module.ts', 'apiKeysConfig'));

// 7. Shared Types & Constants
console.log('\n[7] Shared Types & Constants');
check('WebhookEventType type defined', rootContains('libs/shared/types/src/index.ts', 'WebhookEventType'));
check('WebhookDeliveryStatus type defined', rootContains('libs/shared/types/src/index.ts', 'WebhookDeliveryStatus'));
check('ApiKeyScope type defined', rootContains('libs/shared/types/src/index.ts', 'ApiKeyScope'));
check('IntegrationProviderType type defined', rootContains('libs/shared/types/src/index.ts', 'IntegrationProviderType'));
check('WebhookPayload interface defined', rootContains('libs/shared/types/src/index.ts', 'WebhookPayload'));
check('EnvelopeResponse interface defined', rootContains('libs/shared/types/src/index.ts', 'EnvelopeResponse'));
check('WEBHOOK_EVENT_TYPES const', rootContains('libs/shared/constants/src/index.ts', 'WEBHOOK_EVENT_TYPES'));
check('WEBHOOK_DEFAULTS const', rootContains('libs/shared/constants/src/index.ts', 'WEBHOOK_DEFAULTS'));
check('API_KEY_SCOPES const', rootContains('libs/shared/constants/src/index.ts', 'API_KEY_SCOPES'));

// 8. Swagger/OpenAPI
console.log('\n[8] OpenAPI / Swagger');
check('main.ts has webhooks tag', fileContains('main.ts', "'webhooks'"));
check('main.ts has api-keys tag', fileContains('main.ts', "'api-keys'"));

// 9. Quality Gates
console.log('\n[9] Quality Gates');
try {
  execSync('npx nx build api 2>&1', { cwd: ROOT, stdio: 'pipe', timeout: 120000 });
  check('TypeScript build succeeds', true);
} catch {
  check('TypeScript build succeeds', false);
}
try {
  execSync('npx eslint . --ext .ts 2>&1', { cwd: ROOT, stdio: 'pipe', timeout: 60000 });
  check('ESLint passes with 0 errors', true);
} catch {
  check('ESLint passes with 0 errors', false);
}
try {
  execSync('npx jest --config apps/api/jest.config.ts --passWithNoTests 2>&1', { cwd: ROOT, stdio: 'pipe', timeout: 120000 });
  check('All existing tests pass', true);
} catch {
  check('All existing tests pass', false);
}

console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===\n`);
if (failed === 0) {
  console.log('Phase 6 M3 verification complete - ALL CHECKS PASSED');
} else {
  console.log(`Phase 6 M3 verification complete - ${failed} check(s) FAILED`);
}
process.exit(exitCode);
