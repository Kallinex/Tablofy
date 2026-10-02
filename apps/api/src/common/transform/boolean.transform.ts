import { Transform } from 'class-transformer';

const TRUTHY = new Set(['true', '1']);
const FALSY = new Set(['false', '0']);

/**
 * Coerces an incoming value to a boolean using explicit string semantics.
 *
 * Query strings arrive as strings, so `?isActive=false` is the string
 * `"false"`. class-transformer's `@Type(() => Boolean)` cannot be used for
 * this because it applies JavaScript truthiness: every non-empty string
 * becomes `true`, which silently inverts `?isActive=false` into a filter for
 * active records only. `enableImplicitConversion` inherits the same defect.
 *
 * Unrecognised values are passed through untouched so `@IsBoolean()` rejects
 * them with a 400 rather than silently coercing them to `false`.
 */
export const toBoolean = (value: unknown): unknown => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return value;
  }
  if (typeof value !== 'string') return value;

  const normalized = value.trim().toLowerCase();
  if (normalized === '') return undefined;
  if (TRUTHY.has(normalized)) return true;
  if (FALSY.has(normalized)) return false;
  return value;
};

/**
 * `@Transform` wrapper around {@link toBoolean} for boolean DTO properties.
 *
 * Apply this to every boolean query parameter instead of relying on implicit
 * conversion.
 */
export const ToBoolean = (): PropertyDecorator =>
  Transform(({ value }) => toBoolean(value)) as PropertyDecorator;
