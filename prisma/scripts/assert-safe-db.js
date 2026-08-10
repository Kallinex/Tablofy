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
 *   reset   — `prisma migrate reset --force`; blocked for protected databases,
 *             and requires PRISMA_ALLOWED_DB=<exact db name> for any other db.
 */

const path = require('path');

try {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
} catch (error) {
  process.stderr.write(`assert-safe-db: dotenv failed to load: ${error.message}\n`);
}

const HARD_BLOCKED_DBS = ['tablofy_prod'];
const PROD_SUFFIX = /(^|[_-])prod(uction)?$/i;

function parseTarget(databaseUrl) {
  const url = new URL(databaseUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  return {
    database,
    host: url.hostname,
    port: url.port || '5432',
    user: url.username || '<unknown>',
  };
}

function isProtected({ database }, nodeEnv) {
  if (HARD_BLOCKED_DBS.includes(database)) return true;
  if (PROD_SUFFIX.test(database)) return true;
  if (nodeEnv === 'production') return true;
  return false;
}

function main() {
  const mode = process.argv[2] || 'report';
  if (!['report', 'dev', 'seed', 'reset'].includes(mode)) {
    process.stderr.write(`assert-safe-db: unknown mode "${mode}".\n`);
    process.exit(2);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write(
      'assert-safe-db: DATABASE_URL is not set. Refusing to proceed without a known target.\n',
    );
    process.exit(1);
  }

  let target;
  try {
    target = parseTarget(databaseUrl);
  } catch (error) {
    process.stderr.write(`assert-safe-db: DATABASE_URL could not be parsed: ${error.message}\n`);
    process.exit(1);
  }

  const nodeEnv = process.env.NODE_ENV || 'development';
  process.stdout.write(
    `Resolved DATABASE_URL target: database "${target.database}" on ${target.user}@${target.host}:${target.port}\n`,
  );

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

  if (mode === 'reset') {
    const allowed = process.env.PRISMA_ALLOWED_DB;
    if (allowed !== target.database) {
      process.stderr.write(
        `BLOCKED: reset target "${target.database}" is not explicitly allowed. ` +
          `Set PRISMA_ALLOWED_DB=${target.database} to opt in to resetting this non-production database.\n`,
      );
      process.exit(1);
    }
  }

  process.exit(0);
}

main();
