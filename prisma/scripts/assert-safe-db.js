'use strict';

/**
 * Prisma database-target safety guard.
 *
 * Prevents database-related npm scripts from silently targeting the wrong
 * (or a production-like) database. Mirrors `prisma.config.ts` env loading:
 * `dotenv` loads the repo-root `.env` and never overrides already-set vars,
 * so the resolved target is the same one `npx prisma` would use.
 *
 * Modes:
 *   report  — print the resolved target, always exit 0 (status/studio/apply).
 *   dev     — `prisma migrate dev`; blocked for protected databases.
 *   seed    — `prisma db seed`; blocked for protected databases.
 *   wipe    — full-table truncate used by the verify-*.js scripts; blocked for
 *             protected databases and requires an explicit opt-in.
 *   reset   — `prisma migrate reset --force`; blocked for protected databases,
 *             and requires PRISMA_ALLOWED_DB=<exact db name> for any other db.
 */

const { resolveTarget, isProtected, describeTarget } = require('./safe-db-target');

function main() {
  const mode = process.argv[2] || 'report';
  if (!['report', 'dev', 'seed', 'wipe', 'reset'].includes(mode)) {
    process.stderr.write(`assert-safe-db: unknown mode "${mode}".\n`);
    process.exit(2);
  }

  let target;
  try {
    target = resolveTarget();
  } catch (error) {
    process.stderr.write(`assert-safe-db: ${error.message}\n`);
    process.exit(1);
  }

  const nodeEnv = process.env.NODE_ENV || 'development';
  process.stdout.write(`Resolved DATABASE_URL target: ${describeTarget(target)}\n`);

  if (mode === 'report') {
    process.exit(0);
  }

  if (isProtected(target, nodeEnv)) {
    process.stderr.write(
      `BLOCKED: "${mode}" targets protected database "${target.database}" (NODE_ENV=${nodeEnv}). ` +
        `Refusing to run. This database is treated as production-like and must never be reset/seeded ` +
        `or have destructive migrations run against it.\n`,
    );
    process.exit(1);
  }

  if (mode === 'reset' || mode === 'wipe') {
    const allowed = process.env.PRISMA_ALLOWED_DB;
    if (allowed !== target.database) {
      process.stderr.write(
        `BLOCKED: ${mode} target "${target.database}" is not explicitly allowed. ` +
          `Set PRISMA_ALLOWED_DB=${target.database} to opt in to ${mode === 'reset' ? 'resetting' : 'wiping'} this non-production database.\n`,
      );
      process.exit(1);
    }
  }

  process.exit(0);
}

main();
