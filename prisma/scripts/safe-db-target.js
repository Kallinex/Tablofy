'use strict';

/**
 * Shared Prisma database-target resolution + protection rules.
 *
 * Used by the CLI guard (assert-safe-db.js) and by the destructive-wipe guard
 * (assert-safe-wipe.js) so both resolve the exact same target `npx prisma`
 * would use, and so the two guards can never drift apart.
 *
 * Mirrors `prisma.config.ts` env loading: `dotenv` loads the repo-root `.env`
 * and never overrides already-set vars.
 */

const path = require('path');

const HARD_BLOCKED_DBS = ['tablofy_prod'];
const PROD_SUFFIX = /(^|[_-])prod(uction)?$/i;

function loadRepoEnv() {
  try {
    require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
  } catch (error) {
    process.stderr.write(`safe-db-target: dotenv failed to load: ${error.message}\n`);
  }
}

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

function isProtected(target, nodeEnv) {
  if (HARD_BLOCKED_DBS.includes(target.database)) return true;
  if (PROD_SUFFIX.test(target.database)) return true;
  if (nodeEnv === 'production') return true;
  return false;
}

function describeTarget(target) {
  return `database "${target.database}" on ${target.user}@${target.host}:${target.port}`;
}

/**
 * Resolves the target the current process would operate on.
 * Throws when DATABASE_URL is missing or unparsable.
 */
function resolveTarget() {
  loadRepoEnv();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. Refusing to proceed without a known target.');
  }
  let target;
  try {
    target = parseTarget(databaseUrl);
  } catch (error) {
    throw new Error(`DATABASE_URL could not be parsed: ${error.message}`);
  }
  return target;
}

module.exports = {
  HARD_BLOCKED_DBS,
  PROD_SUFFIX,
  loadRepoEnv,
  parseTarget,
  isProtected,
  describeTarget,
  resolveTarget,
};
