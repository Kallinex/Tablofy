'use strict';

/**
 * Guard for verification scripts that wipe whole tables.
 *
 * The verify-*.js scripts intentionally start from an empty database, so they
 * call `deleteMany()` with no `where` clause. Without this guard, running one
 * of them against a database that holds anything of value silently destroys
 * every row in every table they touch.
 *
 * Protection (identical to `assert-safe-db.js reset`):
 *   - hard-blocked databases, *_prod / *_production names, and NODE_ENV=production
 *   - any other database still needs an explicit opt-in:
 *       PRISMA_ALLOWED_DB=<exact database name>
 *
 * Usage from a verify script:
 *   const { assertDestructiveWipeAllowed } = require('./prisma/scripts/assert-safe-wipe');
 *   assertDestructiveWipeAllowed('verify-m2.js');
 */

const { resolveTarget, isProtected, describeTarget } = require('./safe-db-target');

function assertDestructiveWipeAllowed(scriptName) {
  let target;
  try {
    target = resolveTarget();
  } catch (error) {
    process.stderr.write(
      `BLOCKED [${scriptName}]: ${error.message}\n` +
        'This script deletes every row in the tables it touches and cannot run against an unknown target.\n',
    );
    process.exit(1);
  }

  const nodeEnv = process.env.NODE_ENV || 'development';
  const label = describeTarget(target);

  if (isProtected(target, nodeEnv)) {
    process.stderr.write(
      `BLOCKED [${scriptName}]: this script wipes whole tables and targets protected ${label} ` +
        `(NODE_ENV=${nodeEnv}). Refusing to run: it would delete every row in those tables.\n` +
        'Point DATABASE_URL at a throwaway database, or re-run with the wipe removed.\n',
    );
    process.exit(1);
  }

  const allowed = process.env.PRISMA_ALLOWED_DB;
  if (allowed !== target.database) {
    process.stderr.write(
      `BLOCKED [${scriptName}]: wiping ${label} is not explicitly allowed. ` +
        `Set PRISMA_ALLOWED_DB=${target.database} to opt in to the full-table wipe.\n`,
    );
    process.exit(1);
  }

  process.stdout.write(`  [guard] ${scriptName}: full-table wipe allowed on ${label}\n`);
}

module.exports = { assertDestructiveWipeAllowed };
