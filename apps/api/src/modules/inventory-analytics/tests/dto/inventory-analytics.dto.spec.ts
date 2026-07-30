/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { validate } from 'class-validator';
import { InventoryAnalyticsQueryDto } from '../../dto/inventory-analytics-query.dto';

describe('InventoryAnalyticsQueryDto', () => {
  it('should pass with valid fields', async () => {
    const dto = new InventoryAnalyticsQueryDto();
    dto.startDate = '2025-01-01T00:00:00Z';
    dto.endDate = '2025-01-31T00:00:00Z';
    dto.branchId = 'branch-1';
    dto.categoryId = 'cat-1';

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should pass with empty optional fields', async () => {
    const dto = new InventoryAnalyticsQueryDto();

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should reject invalid date string', async () => {
    const dto = new InventoryAnalyticsQueryDto();
    dto.startDate = 'bad-date';

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should reject negative days value', async () => {
    const dto = new InventoryAnalyticsQueryDto();
    (dto as any).days = -1;

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should accept positive integer days', async () => {
    const dto = new InventoryAnalyticsQueryDto();
    dto.days = 30;

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should accept positive integer limit and page', async () => {
    const dto = new InventoryAnalyticsQueryDto();
    dto.limit = 50;
    dto.page = 2;

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
