# Changelog

All notable changes to Tablofy are recorded here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are tagged (`git tag`, currently up to `v7.5.0`). **Unreleased** holds
work that is committed but not yet tagged.

## [Unreleased]

Phase 7 completion work on `feature/phase7-m5`. Every entry below is covered by
the gate suite (lint, build, and coverage-enforced tests); see
[`PHASE7-VERIFIED-ROADMAP.md`](./PHASE7-VERIFIED-ROADMAP.md) for the
item-by-item record and the caveats that remain open.

### Added

- **Enterprise SSO** - OIDC and SAML 2.0 with per-tenant connections, PKCE,
  state/nonce or signed-assertion handling, JIT provisioning, domain and role
  enforcement, and an SP metadata endpoint.
- **Product image uploads** - multipart upload with memory storage, size limits,
  a MIME and extension allowlist, magic-byte verification and tenant/product
  scoping. Served from `/uploads`.
- **External dependency health checks** - `GET /health/dependencies` probes SMTP,
  an optional SMS gateway, and the configured Stripe/Paymob gateways. Kept out of
  liveness and readiness so a third-party outage does not restart the service.
- **OpenTelemetry tracing and OTLP metrics** - opt-in, auto-instrumenting HTTP,
  Prisma/pg, ioredis and BullMQ, with `ParentBased(TraceIdRatio)` sampling and OTLP
  export. Disabled unless both `OTEL_ENABLED=true` and
  `OTEL_EXPORTER_OTLP_ENDPOINT` are set.
- **Redis high availability** - `sentinel` and `cluster` topologies alongside
  `standalone`. `REDIS_MODE` auto-detects from the topology variables.
- **Configurable per-tenant and per-API-key rate limits** - previously hard-coded
  budgets are now configuration, and `Authorization: ApiKey <key>` is charged to a
  dedicated per-key bucket. Bucket identity is a truncated SHA-256 of the key, so
  the raw key never reaches Redis or the logs.
- **Startup configuration warnings** - production boot now warns when error
  tracking, metrics, structured JSON logging or distributed tracing is disabled,
  or when the Redis topology is incomplete.

### Fixed

- **Boolean query filters were silently inverted** - the global
  `ValidationPipe` used `enableImplicitConversion`, which applies JavaScript
  truthiness to every incoming string. `?isActive=false` was coerced to `true`,
  inverting the filter across all 23 boolean query parameters. Replaced with an
  explicit `@ToBoolean()` transform that parses `true`/`false`/`1`/`0`, maps empty
  strings to "absent", and lets unrecognised values fail validation with a 400.
- **Rate limiting could not be tuned per environment** - limits were hard-coded.
- **Order restoration reused generated ids** - restored orders now keep their
  original identifiers.
- **`/metrics` served an incorrect content type**, breaking scrapers.
- **A clean clone failed to build** - the build now restores what it needs.
- **Plan user limits were not enforced**, allowing over-provisioning past a limit.
- **An E2E deduction race** could double-count.
- **Webhook replay, payment unit handling and loyalty concurrency** were
  hardened; the **refund lifecycle** no longer leaves partial state.

### Changed

- **Prisma migrations squashed** - 28 incremental migrations replaced by two
  versioned releases (`20261003090000_baseline_initial_schema` and
  `20261003100000_add_enterprise_sso`). Both were generated with `migrate diff`
  rather than hand-written, and equivalence was proven by comparing the sorted
  statement set against a full `--from-empty` diff (1061 statements, zero
  missing, zero extra). Safe because the superseded migrations were pure DDL and
  no database was ever deployed from them; they remain in git history.
- **Type-aware ESLint enabled** - `no-floating-promises`, `await-thenable` and
  `no-misused-promises` with type information. The 13 violations this surfaced
  were real defects (unawaited WebSocket `join`/`leave` calls, an unhandled
  `bootstrap()`), all now fixed.
- **`REDIS_URL` is honoured** instead of being validated as required and then
  ignored, which had left URL-only deployments silently connecting to localhost.
- **Destructive Prisma scripts are guarded** against running against a
  non-local database.

### Security

- Redis authentication is enforced in production.
- The container image is scanned with Trivy in CI before it is published;
  results are uploaded as SARIF to the GitHub Security tab and a failing scan
  blocks the push.
- The Dockerfile builder stage copies only build inputs instead of the whole
  context, so nothing sensitive is captured in a build layer.
- Purchase, KDS, auth and reference-uniqueness paths were hardened against
  concurrency issues and TOCTOU races.
- `npm audit` is now clean (0 vulnerabilities, down from 17). The bulk of the
  exposure was `axios`, which is used by the outbound webhook SSRF client and the
  Stripe/Paymob providers: 13 advisories, most of them prototype-pollution or
  SSRF-adjacent gadgets. Upgraded `axios` 1.19.0 → 1.20.0 and `nodemailer`
  9.1.1 → 10.0.13, and lifted the `overrides` floors for `js-yaml`,
  `brace-expansion` and `axios` so the versions Nx pulls in transitively are also
  covered. Two of the axios fixes matter directly to `SsrfClientService`: the
  fetch adapter now honours `maxRedirects: 0` (the service follows redirects
  manually so it can re-validate every hop), and the Node HTTP adapter no longer
  honours an inherited `createConnection`, which is how its pinned-DNS `lookup`
  agents could have been bypassed.
- Dependency pinning was simplified at the same time. `brace-expansion` was
  overridden from eight different grandparent packages, which could not satisfy
  the four `minimatch` majors in the tree at once and left `npm ls` reporting
  `invalid` entries. The overrides are now keyed on the `minimatch` major
  directly (`minimatch@3`/`@5` → `^1.1.21`, `@9` → `^2.1.7`, `@10` →
  `^5.0.12`), which is both shorter and semver-valid.

### Documentation

- `README.md` rewritten from the Nx stub into a real guide: overview, tech stack,
  layout, prerequisites, setup, testing, configuration, architecture, module map,
  observability, payments, SSO, uploads, deployment and security notes.
- Added `CONTRIBUTING.md` (setup, commands, conventions, PR expectations) and this
  changelog.

### Known limitations

These are unresolved and are **not** covered by the test suite:

- No live third-party credentials, so Stripe/Paymob, SMTP and the real
  OIDC/SAML provider flows are verified against mocks only.
- No production PostgreSQL or Redis deployment, so migration replay and Redis
  failover have not been exercised end to end.
- No OTLP collector is deployed, so span export is unverified.
- The container image could not be built locally because the Docker daemon is
  unavailable in the development environment; the build and scan steps are wired
  but have not run here.

## [7.5.0] - 2026-08-03

Earlier tagged releases are listed in the git history:

```bash
git log --oneline v7.4.0..v7.5.0
```

[Unreleased]: https://github.com/Kallinex/Tablofy/compare/v7.5.0...HEAD
[7.5.0]: https://github.com/Kallinex/Tablofy/releases/tag/v7.5.0
