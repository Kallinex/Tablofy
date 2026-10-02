# Contributing to Tablofy

Thanks for taking the time to contribute. This guide covers the local setup, the
commands the project expects, and the conventions that are easy to miss.

For what the system _is_ (architecture, modules, endpoints, deployment), see
[`README.md`](./README.md). For what has changed, see
[`CHANGELOG.md`](./CHANGELOG.md).

## Prerequisites

| Tool       | Version     | Notes                                                |
| ---------- | ----------- | ---------------------------------------------------- |
| Node.js    | 20 or newer | 22.x is what CI and this guide are exercised against |
| npm        | 10 or newer | ships with Node                                      |
| PostgreSQL | 14 or newer | required; the app will not boot without it           |
| Redis      | 6 or newer  | required for cache and the BullMQ queues             |

You do **not** need Docker for day-to-day work. It is only needed for the
container image build and for the local `docker-compose.yml` stack.

## Getting set up

```bash
npm install                 # postinstall runs `prisma generate`
cp .env.example .env        # then fill in the values you need
npm run prisma:migrate:dev  # create/apply the database schema
npm run prisma:seed         # optional sample data
npm run start:api           # equivalent to: nx serve api
```

`npm install` runs `prisma generate`, so the Prisma client is generated for you.
If you ever need it on its own: `npm run prisma:generate`.

### Destructive database scripts

`prisma migrate reset`, `prisma db push` and `prisma db seed --reset` are guarded
by `prisma/scripts/assert-safe-db.js`. The guard refuses to run against a database
whose name or host does not look local. Do not remove the guard to get past it;
if a script is wrongly blocked, fix the detection.

## Commands

| Command                                      | Purpose                                           |
| -------------------------------------------- | ------------------------------------------------- |
| `npm run start:api`                          | Serve the API with watch mode                     |
| `npm run build:api`                          | Production webpack build                          |
| `npm test`                                   | Run the test suite                                |
| `npm run test:coverage`                      | Test suite with coverage thresholds enforced      |
| `npm run test:watch`                         | Watch mode                                        |
| `npx nx test api --testPathPatterns=<regex>` | Run a single file or pattern                      |
| `npm run lint`                               | Lint every project                                |
| `npm run format`                             | Format with Prettier                              |
| `npm run format:check`                       | Verify formatting without writing                 |
| `npm run prisma:migrate:dev`                 | Apply migrations in development                   |
| `npm run prisma:migrate:prod`                | Apply migrations in production (`migrate deploy`) |
| `npm run prisma:status`                      | Show migration status                             |
| `npm run prisma:generate`                    | Regenerate the Prisma client                      |

### The gate that must pass before you open a pull request

```bash
npm run format:check
npm run lint
npm run build:api
npm run test:coverage -- --maxWorkers=1 --silent
```

All four must exit 0. Coverage thresholds are enforced by the `coverage`
configuration, so a drop in coverage fails the run rather than being noticed
later. `--maxWorkers=1` keeps the suite memory-bounded and its output readable;
please use it for the full run.

Before deploying, read [`docs/launch-readiness.md`](docs/launch-readiness.md).
It records which paths are proven by an executed check, which are verified only
against mocks, and what still has to be validated against real third parties.

## Project layout

```
apps/api/            NestJS API
  src/common/        cross-cutting concerns (auth, cache, logger, telemetry, ...)
  src/config/        typed configuration namespaces and environment validation
  src/modules/       feature modules, one per domain
  src/prisma/        PrismaService
  src/redis/         RedisService and the topology-aware client factory
prisma/              schema, migrations, seed
docker/              compose files, nginx and backup sidecar configuration
docs/                additional documentation
```

## Conventions

### Modules

A module owns one domain. It holds its controller, service and DTOs together:

```
src/modules/<domain>/
  <domain>.controller.ts
  <domain>.service.ts
  dto/
```

Services contain the business logic and talk to `PrismaService` directly.
Controllers stay thin: validate input, call the service, shape the response.

### Multi-tenancy

This is the rule most worth internalising. **Every** database query is scoped
by `tenantId`, taken from the authenticated request rather than from the client.

```ts
// correct
const rows = await this.prisma.product.findMany({ where: { tenantId } });

// never - the client controls this value
const rows = await this.prisma.product.findMany({ where: { tenantId: dto.tenantId } });
```

If you add a query that is not scoped by tenant, it is a data-leak bug and will
be treated as one in review.

### DTOs and validation

Transport shapes are DTOs with class-validator decorators, and every controller
binds them explicitly with the global `ValidationPipe`. Do not rely on implicit
type coercion for query parameters. `?isActive=false` and `?isActive=0` are
strings, and JavaScript truthiness would turn both into `true`. Use the shared
transform instead:

```ts
import { ToBoolean } from '../../../common/transform/boolean.transform';

export class ListProductsDto {
  @IsOptional()
  @ToBoolean()
  isActive?: boolean;
}
```

### Configuration

- Add new settings to a typed namespace in `apps/api/src/config/`, and register
  it in `apps/api/src/config/index.ts` and `ConfigModule.forRoot({ load: [...] })`.
- Environment variables that must exist in production belong in
  `apps/api/src/config/env.validation.ts`, which throws and stops the boot.
- Settings whose absence degrades observability or resilience are _not_ fatal.
  They belong in `collectConfigWarnings()` so they surface as startup warnings.
  Redis topology validation and tracing/OTel configuration are examples.
- Document new variables in `.env.example` with a comment explaining the
  consequence of leaving them unset.

### Caching

Cache reads and writes go through `CacheService`, never a raw Redis client.
Invalidation is pattern-based (`deletePattern`); because that is implemented on
top of `SCAN`, note that cluster mode scans every master. Do not introduce a
key pattern that fans out across a large keyspace on a hot path.

### Queues

Enqueue through `QueueService`. Jobs that exhaust their retries move to the
`dead-letter` queue automatically. A BullMQ client is shared and created lazily;
if you add a new consumer, go through `QueueService.registerWorker` rather than
constructing your own worker.

### Errors and logging

Throw Nest `HttpException`s with an explicit status. Log through `AppLoggerService`
and pass a context so output stays attributable in production JSON. Never log
secrets, tokens or raw API keys - rate-limit buckets are keyed by a truncated
SHA-256 of the key for exactly this reason.

### Tests

- Specs live next to the code (`foo.service.spec.ts`) or in a `tests/` folder for
  larger units; integration specs use `*.integration.spec.ts`.
- Test the behaviour, not the implementation. A test that breaks when you rename
  a private helper is a test that will be deleted rather than fixed.
- For a bug fix, add the test that fails before the fix. For a `SCAN`, coercion
  or retry bug, prefer a test that pins the corrected behaviour over a test that
  only checks the happy path.
- Mocks for third-party clients go through `jest.mock()` factories. Note that
  such factories are hoisted above `const` declarations, so they may only
  reference hoisted functions; capture per-test state on `globalThis` or read
  the module back with `jest.requireMock`.

### Database changes

Schema changes require a migration:

```bash
npm run prisma:migrate:dev -- --name describe_the_change
```

Migrations are generated, never hand-written. Do not edit an applied migration
to fix a typo - add a new one. Prisma Migrate cannot roll back, so anything
destructive needs a staged, additive approach.

## Commits and pull requests

Commit messages follow Conventional Commits:

```
feat(api): add product image uploads
fix(api): stop ?isActive=false being coerced to true
chore(db): squash migrations into two versioned releases
```

Keep the subject imperative and under ~72 characters; the body explains _why_,
not _what_ - the diff already says what.

A pull request should:

1. Target `main` unless the roadmap says otherwise; this work lands on
   `feature/phase7-m5`.
2. Keep to one logical change.
3. State how it was verified (the three gate commands, and what the new tests
   cover).
4. Note anything that could not be verified locally - no Docker daemon, no
   database, no live third-party credentials - rather than implying it passed.
5. Update `PHASE7-VERIFIED-ROADMAP.md` if it closes a roadmap item.

## Reporting bugs

Include the API version, the request (with secrets redacted), the response, and
the relevant log lines. For a data problem, include the tenant id and the
approximate time. Do not paste `.env` values or connection strings.

## Security

Do not commit secrets. `.env` is git-ignored; `.env.example` must only ever
contain placeholders. If you find a vulnerability, report it privately to the
maintainers rather than opening a public issue.

## License

MIT, as stated in [`README.md`](./README.md#license).
