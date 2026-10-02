import { initTelemetry } from './common/telemetry/telemetry';

/**
 * Telemetry side-effect module.
 *
 * This MUST be the first import in the entrypoint (`main.ts`). OpenTelemetry
 * instruments libraries by hooking Node's module loader, so it has to run
 * before express, ioredis, pg and bullmq are required - anything already in
 * `require.cache` when the hook is installed is never patched.
 *
 * Keep the body trivial and synchronous; nothing here may throw.
 */
initTelemetry();

export {};
