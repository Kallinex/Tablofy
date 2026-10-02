import { ValidationPipe } from '@nestjs/common';
import { ToBoolean, toBoolean } from '../boolean.transform';
import { QueryApiKeyDto } from '../../../modules/api-keys/dto/query-api-key.dto';
import { QueryAllergenDto } from '../../../modules/allergens/dto/query-allergen.dto';
import { QueryProductDto } from '../../../modules/menu/dto/query-product.dto';
import { QueryCustomerDto } from '../../../modules/customers/dto/query-customer.dto';

// Mirrors the global pipe in main.ts. enableImplicitConversion is intentionally
// absent: these tests lock in that query parameters still coerce correctly.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const transformQuery = <T extends object>(
  metatype: new () => T,
  payload: Record<string, unknown>,
) => pipe.transform(payload, { type: 'query', metatype }) as Promise<T>;

describe('toBoolean', () => {
  it('parses explicit truthy strings', () => {
    expect(toBoolean('true')).toBe(true);
    expect(toBoolean('TRUE')).toBe(true);
    expect(toBoolean(' true ')).toBe(true);
    expect(toBoolean('1')).toBe(true);
  });

  it('parses explicit falsy strings, which plain truthiness would invert', () => {
    expect(toBoolean('false')).toBe(false);
    expect(toBoolean('FALSE')).toBe(false);
    expect(toBoolean(' false ')).toBe(false);
    expect(toBoolean('0')).toBe(false);
  });

  it('maps an empty string to undefined so the filter is simply absent', () => {
    expect(toBoolean('')).toBeUndefined();
    expect(toBoolean('   ')).toBeUndefined();
  });

  it('passes through values that are already booleans or numbers', () => {
    expect(toBoolean(true)).toBe(true);
    expect(toBoolean(false)).toBe(false);
    expect(toBoolean(1)).toBe(true);
    expect(toBoolean(0)).toBe(false);
  });

  it('leaves unrecognised input untouched so validation can reject it', () => {
    expect(toBoolean('yes')).toBe('yes');
    expect(toBoolean('maybe')).toBe('maybe');
    expect(toBoolean(7)).toBe(7);
  });

  it('passes nullish values through', () => {
    expect(toBoolean(undefined)).toBeUndefined();
    expect(toBoolean(null)).toBeNull();
  });
});

describe('boolean query parameter coercion without enableImplicitConversion', () => {
  it('keeps ?isActive=false false instead of coercing it to true', async () => {
    const dto = await transformQuery(QueryApiKeyDto, { isActive: 'false' });

    expect(dto.isActive).toBe(false);
  });

  it('keeps ?isActive=true true', async () => {
    const dto = await transformQuery(QueryApiKeyDto, { isActive: 'true' });

    expect(dto.isActive).toBe(true);
  });

  it('leaves the filter absent when no value is supplied', async () => {
    const dto = await transformQuery(QueryApiKeyDto, { scope: 'read' });

    expect(dto.isActive).toBeUndefined();
    expect(dto.scope).toBe('read');
  });

  it('treats an empty value as no filter', async () => {
    const dto = await transformQuery(QueryApiKeyDto, { isActive: '' });

    expect(dto.isActive).toBeUndefined();
  });

  it('still coerces explicit numeric query parameters', async () => {
    const dto = await transformQuery(QueryAllergenDto, { page: '3', limit: '25' });

    expect(dto.page).toBe(3);
    expect(dto.limit).toBe(25);
  });

  it('applies pagination defaults when page and limit are absent', async () => {
    const dto = await transformQuery(QueryApiKeyDto, {});

    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it('coerces multiple booleans on one DTO independently', async () => {
    const dto = await transformQuery(QueryProductDto, { isActive: 'false', isFeatured: 'true' });

    expect(dto.isActive).toBe(false);
    expect(dto.isFeatured).toBe(true);
  });

  it('supports numeric and boolean filters side by side', async () => {
    const dto = await transformQuery(QueryCustomerDto, {
      hasEmail: 'true',
      hasPhone: 'false',
      minVisits: '4',
    });

    expect(dto.hasEmail).toBe(true);
    expect(dto.hasPhone).toBe(false);
    expect(dto.minVisits).toBe(4);
  });

  it('rejects an unrecognised boolean value rather than guessing', async () => {
    await expect(transformQuery(QueryApiKeyDto, { isActive: 'notabool' })).rejects.toThrow();
  });

  it('still strips unknown properties', async () => {
    await expect(transformQuery(QueryApiKeyDto, { bogus: 'x' })).rejects.toThrow();
  });
});

describe('ToBoolean decorator', () => {
  class Sample {
    @ToBoolean()
    flag?: boolean;
  }

  it('is a usable property decorator', () => {
    expect(Sample).toBeDefined();
  });
});
