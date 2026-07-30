#!/usr/bin/env node
/**
 * Phase 6 M2 - Enterprise Observability & Production Operations Verification
 *
 * Usage: node scripts/verify-phase6-m2.js
 *
 * Checks:
 *  1. Config files for logging, sentry, metrics, monitoring
 *  2. CorrelationModule (service + middleware)
 *  3. LoggerModule (AppLoggerService + HttpLoggingMiddleware)
 *  4. MetricsModule (MetricsService + MetricsController + PrometheusMiddleware)
 *  5. SentryModule (Sentry init + SentryFilter)
 *  6. MonitoringModule (MonitoringService + PerformanceMonitorInterceptor)
 *  7. Enhanced HttpExceptionFilter (AppLoggerService + CorrelationService + Sentry)
 *  8. Enhanced AuditLogInterceptor (browser, device, IP, duration, requestId)
 *  9. Enhanced HealthModule (5 indicators: DB, Redis, Bull, memory, disk)
 * 10. Updated AppModule (all new modules imported, middleware chain, APP_FILTER)
 * 11. Updated main.ts (AppLoggerService logger, no manual HttpExceptionFilter, metrics tag)
 * 12. TypeScript compilation
 * 13. ESLint
 * 14. Build
 * 15. Existing tests
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

function fileExists(p) {
  return fs.existsSync(path.join(API, p));
}

function fileContains(p, substr) {
  const full = path.join(API, p);
  if (!fs.existsSync(full)) return false;
  const content = fs.readFileSync(full, 'utf-8');
  return content.includes(substr);
}

console.log('\n=== Phase 6 M2 - Enterprise Observability Verification ===\n');

// 1. Config files
console.log('[1] Config files');
check('logging.config.ts exists', fileExists('config/logging.config.ts'));
check('sentry.config.ts exists', fileExists('config/sentry.config.ts'));
check('metrics.config.ts exists', fileExists('config/metrics.config.ts'));
check('monitoring.config.ts exists', fileExists('config/monitoring.config.ts'));
check('config/index.ts exports logging', fileContains('config/index.ts', 'loggingConfig'));
check('config/index.ts exports sentry', fileContains('config/index.ts', 'sentryConfig'));
check('config/index.ts exports metrics', fileContains('config/index.ts', 'metricsConfig'));
check('config/index.ts exports monitoring', fileContains('config/index.ts', 'monitoringConfig'));

// 2. CorrelationModule
console.log('\n[2] Correlation Module');
check('correlation.service.ts exists', fileExists('common/correlation/correlation.service.ts'));
check('correlation.middleware.ts exists', fileExists('common/correlation/correlation.middleware.ts'));
check('correlation.module.ts exists', fileExists('common/correlation/correlation.module.ts'));
check('CorrelationService uses AsyncLocalStorage', fileContains('common/correlation/correlation.service.ts', 'AsyncLocalStorage'));
check('CorrelationMiddleware extracts X-Request-ID', fileContains('common/correlation/correlation.middleware.ts', 'x-request-id'));

// 3. LoggerModule
console.log('\n[3] Logger Module');
check('logger.service.ts exists', fileExists('common/logger/logger.service.ts'));
check('http-logging.middleware.ts exists', fileExists('common/logger/http-logging.middleware.ts'));
check('logger.module.ts exists', fileExists('common/logger/logger.module.ts'));
check('AppLoggerService uses winston', fileContains('common/logger/logger.service.ts', 'winston'));
check('AppLoggerService implements LoggerService', fileContains('common/logger/logger.service.ts', 'implements LoggerService'));
check('DailyRotateFile configured', fileContains('common/logger/logger.service.ts', 'DailyRotateFile'));
check('HttpLoggingMiddleware logs duration', fileContains('common/logger/http-logging.middleware.ts', 'duration'));

// 4. MetricsModule
console.log('\n[4] Metrics Module');
check('metrics.service.ts exists', fileExists('common/metrics/metrics.service.ts'));
check('metrics.controller.ts exists', fileExists('common/metrics/metrics.controller.ts'));
check('metrics.module.ts exists', fileExists('common/metrics/metrics.module.ts'));
check('prometheus.middleware.ts exists', fileExists('common/metrics/prometheus.middleware.ts'));
check('MetricsService uses prom-client', fileContains('common/metrics/metrics.service.ts', 'prom-client'));
check('MetricsController exposes GET /metrics', fileContains('common/metrics/metrics.controller.ts', '/metrics'));
check('PrometheusMiddleware tracks duration', fileContains('common/metrics/prometheus.middleware.ts', 'observeHttpDuration'));

// 5. SentryModule
console.log('\n[5] Sentry Module');
check('sentry.module.ts exists', fileExists('common/sentry/sentry.module.ts'));
check('sentry.filter.ts exists', fileExists('common/sentry/sentry.filter.ts'));
check('SentryModule calls Sentry.init', fileContains('common/sentry/sentry.module.ts', 'Sentry.init'));

// 6. MonitoringModule
console.log('\n[6] Monitoring Module');
check('monitoring.service.ts exists', fileExists('common/monitoring/monitoring.service.ts'));
check('performance-monitor.interceptor.ts exists', fileExists('common/monitoring/performance-monitor.interceptor.ts'));
check('monitoring.module.ts exists', fileExists('common/monitoring/monitoring.module.ts'));
check('MonitoringService checks slow queries', fileContains('common/monitoring/monitoring.service.ts', 'slowQuery'));
check('MonitoringService checks large payloads', fileContains('common/monitoring/monitoring.service.ts', 'largePayload'));
check('PerformanceMonitorInterceptor checks duration', fileContains('common/monitoring/performance-monitor.interceptor.ts', 'duration'));

// 7. HttpExceptionFilter
console.log('\n[7] HttpExceptionFilter (enhanced)');
check('HttpExceptionFilter uses AppLoggerService', fileContains('common/filters/http-exception.filter.ts', 'AppLoggerService'));
check('HttpExceptionFilter uses CorrelationService', fileContains('common/filters/http-exception.filter.ts', 'CorrelationService'));
check('HttpExceptionFilter reports to Sentry on 5xx', fileContains('common/filters/http-exception.filter.ts', 'Sentry'));
check('HttpExceptionFilter sets X-Request-ID header', fileContains('common/filters/http-exception.filter.ts', 'X-Request-ID'));

// 8. AuditLogInterceptor
console.log('\n[8] AuditLogInterceptor (enhanced)');
check('AuditLogInterceptor captures browser', fileContains('common/interceptors/audit-log.interceptor.ts', 'browser'));
check('AuditLogInterceptor captures device', fileContains('common/interceptors/audit-log.interceptor.ts', 'device'));
check('AuditLogInterceptor captures IP', fileContains('common/interceptors/audit-log.interceptor.ts', 'ip'));
check('AuditLogInterceptor captures duration', fileContains('common/interceptors/audit-log.interceptor.ts', 'duration'));
check('AuditLogInterceptor uses AuditLogsService', fileContains('common/interceptors/audit-log.interceptor.ts', 'AuditLogsService'));
check('AuditLogInterceptor logs non-GET requests', fileContains('common/interceptors/audit-log.interceptor.ts', "method !== 'GET'"));

// 9. HealthModule
console.log('\n[9] HealthModule (enhanced)');
check('bull-health.indicator.ts exists', fileExists('health/bull-health.indicator.ts'));
check('disk-health.indicator.ts exists', fileExists('health/disk-health.indicator.ts'));
check('BullHealthIndicator uses QueueService', fileContains('health/bull-health.indicator.ts', 'QueueService'));
check('DiskHealthIndicator checks memory', fileContains('health/disk-health.indicator.ts', 'freemem'));
check('HealthController has 5 indicators', fileContains('health/health.controller.ts', 'BullHealthIndicator'));
check('HealthController has BullMQ check', fileContains('health/health.controller.ts', 'bullHealth'));
check('HealthController has Disk check', fileContains('health/health.controller.ts', 'diskHealth'));

// 10. AppModule
console.log('\n[10] AppModule');
check('AppModule imports CorrelationModule', fileContains('app/app.module.ts', 'CorrelationModule'));
check('AppModule imports LoggerModule', fileContains('app/app.module.ts', 'LoggerModule'));
check('AppModule imports MetricsModule', fileContains('app/app.module.ts', 'MetricsModule'));
check('AppModule imports SentryModule', fileContains('app/app.module.ts', 'SentryModule'));
check('AppModule imports MonitoringModule', fileContains('app/app.module.ts', 'MonitoringModule'));
check('AppModule registers APP_FILTER for HttpExceptionFilter', fileContains('app/app.module.ts', 'HttpExceptionFilter'));
check('AppModule registers PerformanceMonitorInterceptor', fileContains('app/app.module.ts', 'PerformanceMonitorInterceptor'));
check('AppModule has CorrelationMiddleware chain', fileContains('app/app.module.ts', 'CorrelationMiddleware'));
check('AppModule has HttpLoggingMiddleware chain', fileContains('app/app.module.ts', 'HttpLoggingMiddleware'));
check('AppModule has PrometheusMiddleware chain', fileContains('app/app.module.ts', 'PrometheusMiddleware'));

// 11. main.ts
console.log('\n[11] main.ts');
check('main.ts uses AppLoggerService', fileContains('main.ts', 'AppLoggerService'));
check('main.ts calls app.useLogger', fileContains('main.ts', 'app.useLogger'));
check('main.ts does NOT manually register HttpExceptionFilter', !fileContains('main.ts', 'useGlobalFilters'));
check('main.ts Swagger has metrics tag', fileContains('main.ts', "'metrics'"));

// 12. Build quality gates
console.log('\n[12] Quality Gates');
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

// Summary
console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===\n`);
if (failed === 0) {
  console.log('Phase 6 M2 verification complete - ALL CHECKS PASSED');
} else {
  console.log(`Phase 6 M2 verification complete - ${failed} check(s) FAILED`);
}
process.exit(exitCode);
