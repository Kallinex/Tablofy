/* eslint-disable @typescript-eslint/no-explicit-any */
import { validate } from 'class-validator';
import { SalesAnalyticsQueryDto, GroupByPeriod } from '../../dto/sales-analytics-query.dto';

describe('SalesAnalyticsQueryDto', () => {
  it('should pass with valid date strings and enum', async () => {
    const dto = new SalesAnalyticsQueryDto();
    dto.startDate = '2025-01-01T00:00:00Z';
    dto.endDate = '2025-01-31T00:00:00Z';
    dto.groupBy = GroupByPeriod.DAILY;

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass with empty optional fields', async () => {
    const dto = new SalesAnalyticsQueryDto();

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should reject invalid date string', async () => {
    const dto = new SalesAnalyticsQueryDto();
    dto.startDate = 'not-a-date';

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject invalid enum value for groupBy', async () => {
    const dto = new SalesAnalyticsQueryDto();
    (dto as any).groupBy = 'INVALID_PERIOD';

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should accept all valid GroupByPeriod values', async () => {
    for (const period of Object.values(GroupByPeriod)) {
      const dto = new SalesAnalyticsQueryDto();
      dto.groupBy = period;

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    }
  });
});
