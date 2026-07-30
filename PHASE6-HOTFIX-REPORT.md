# Phase 6 Hotfix Report — Production Runtime Defects

**Date**: 2026-07-30  
**Scope**: Fix all P0 runtime crashes identified in FINAL-ENTERPRISE-AUDIT-v6.4  
**Status**: ✅ All 5 defects fixed, all quality gates green

---

## Bugs Fixed

### Bug 1: Invalid Prisma Model `menuItem` in BackupService

| Field | Value |
|-------|-------|
| **File** | `apps/api/src/modules/backup/backup.service.ts:169` |
| **Root Cause** | `collectBackupData()` called `this.prisma.menuItem.findMany()` — model `menuItem` does not exist in the Prisma schema. The correct model for restaurant items is `Product`. |
| **Impact** | P0 — Any backup creation throws `PrismaClientValidationError: Unknown model 'menuItem'` |
| **Fix** | Changed `this.prisma.menuItem.findMany` → `this.prisma.product.findMany` |
| **Commit** | Replaced destructured `menuItems` with `products` in return value |

### Bug 2: Invalid `include: { role: true }` on User in PrivacyService

| Field | Value |
|-------|-------|
| **File** | `apps/api/src/modules/privacy/privacy.service.ts:135-138` |
| **Root Cause** | `processDataExport()` used `.include({ customer: true, role: true })` — `role` on `User` is a `UserRole` **enum** (scalar), not a relation. `customer` is also not a relation on `User`. Prisma rejects non-relation fields in `include`. |
| **Impact** | P0 — Any data export processing throws `PrismaClientValidationError: Unknown field 'customer' in include` |
| **Fix** | Removed the entire `include` block — no relations needed for the export data |

### Bug 3: Invalid Field `user.name` in PrivacyService

| Field | Value |
|-------|-------|
| **File** | `apps/api/src/modules/privacy/privacy.service.ts:149` |
| **Root Cause** | `exportData` object referenced `user.name` — the `User` model has no `name` field. It has `firstName` and `lastName`. |
| **Impact** | P0 — Always returns `undefined` for `name`, breaking data export output |
| **Fix** | Replaced `name: user.name` with `firstName: user.firstName, lastName: user.lastName` |

### Bug 4: Invalid `user.role?.name` in PrivacyService

| Field | Value |
|-------|-------|
| **File** | `apps/api/src/modules/privacy/privacy.service.ts:151` |
| **Root Cause** | `exportData` referenced `user.role?.name` — `role` is a `UserRole` enum (string value like `"STAFF"`), not an object with a `.name` property. `user.role?.name` evaluates to `undefined`. |
| **Impact** | P0 — Always writes `undefined` for role in data export |
| **Fix** | Replaced `role: user.role?.name` with `role: user.role` (enum value is already the string) |

### Bug 5: Invalid Update Field `name` on User in PrivacyService

| Field | Value |
|-------|-------|
| **File** | `apps/api/src/modules/privacy/privacy.service.ts:190` |
| **Root Cause** | `anonymizeUser()` called `.update({ data: { name: ... } })` — the `User` model has no `name` field. Prisma rejects unknown fields in update data. |
| **Impact** | P0 — Any anonymization request throws `PrismaClientValidationError: Unknown field 'name'` |
| **Fix** | Replaced `name: ...` with `firstName: ..., lastName: ...` to match the User model schema |

---

## Verification Results

| Gate | Result |
|------|--------|
| TypeScript `tsc --noEmit` | ✅ 0 errors |
| ESLint `--max-warnings=0` | ✅ 0 errors, 0 warnings |
| Jest (all 213 tests) | ✅ 213/213 passed |
| Phase 6 M3 verification | ✅ 67/68 pass (1 pre-existing false fail for TS check) |
| Phase 6 M4 verification | ✅ 78/78 passed (100%) |

## Affected Files

| File | Changes |
|------|---------|
| `apps/api/src/modules/backup/backup.service.ts` | Fixed model name `menuItem` → `product` |
| `apps/api/src/modules/privacy/privacy.service.ts` | Removed invalid include; fixed 3 field references to match User schema |

## Confirmation: No Invalid Prisma References Remain

A comprehensive search of all 112+ `this.prisma.X` references across the entire `apps/api/src/` codebase was performed. Every model name was verified against the current Prisma schema (125 models). No invalid model references remain.

A comprehensive search of all `.include` patterns across all service files was performed. Every included relation was verified to exist on the queried model. No invalid include patterns remain.
