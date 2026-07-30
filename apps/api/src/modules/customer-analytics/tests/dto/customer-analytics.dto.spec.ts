/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { validate } from 'class-validator';
import { CustomerAnalyticsQueryDto } from '../../dto/customer-analytics-query.dto';

describe('CustomerAnalyticsQueryDto', () => {
  it('should pass with valid fields', async () => {
    const dto = new CustomerAnalyticsQueryDto();
    dto.startDate = '2025-01-01T00:00:00Z';
    dto.endDate = '2025-01-31T00:00:00Z';
    dto.branchId = 'branch-1';
    dto.customerId = 'customer-1';

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass with empty optional fields', async () => {
    const dto = new CustomerAnalyticsQueryDto();

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should reject invalid date string', async () => {
    const dto = new CustomerAnalyticsQueryDto();
    dto.startDate = 'invalid-date';

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject negative limit', async () => {
    const dto = new CustomerAnalyticsQueryDto();
    (dto as any).limit = -5;

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should accept valid tier string', async () => {
    const dto = new CustomerAnalyticsQueryDto();
    dto.tier = 'GOLD';

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
