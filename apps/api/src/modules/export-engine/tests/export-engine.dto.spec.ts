import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GenerateExportDto, ExportType } from '../dto/generate-export.dto';
import { ExportQueryDto } from '../dto/export-query.dto';

async function errorsFor(cls: typeof GenerateExportDto | typeof ExportQueryDto, payload: object) {
  const errors = await validate(plainToInstance(cls, payload));
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('ExportEngine DTO validation', () => {
  describe('GenerateExportDto', () => {
    const valid = {
      type: ExportType.CSV,
      reportType: 'SALES',
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-01-31T23:59:59.000Z',
    };

    it('accepts a valid payload', async () => {
      expect(await errorsFor(GenerateExportDto, valid)).toEqual([]);
    });

    // Regression: `reportType` used to be a bare `@IsString()`, so any value passed the
    // boundary and crashed in Prisma with "Invalid value for argument `reportType`.
    // Expected ReportType." -> HTTP 500 on every export generation request.
    it.each(['sales', 'Sales', 'SALE', '', 'unknown', 'sales_report'])(
      'rejects invalid reportType %p instead of failing later in Prisma',
      async (reportType) => {
        const errors = await errorsFor(GenerateExportDto, { ...valid, reportType });
        expect(errors).toContain(
          'reportType must be one of the following values: SALES, INVENTORY, KITCHEN, FINANCIAL, CUSTOM',
        );
      },
    );

    it('rejects an invalid type', async () => {
      const errors = await errorsFor(GenerateExportDto, { ...valid, type: 'HTML' });
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('ExportQueryDto', () => {
    // Same root cause on the list endpoint: `reportType`/`status` were unvalidated
    // strings, so a bogus filter value produced a 500 rather than a 400.
    it('accepts a valid filter payload', async () => {
      const errors = await errorsFor(ExportQueryDto, {
        type: ExportType.CSV,
        reportType: 'INVENTORY',
        status: 'PENDING',
        page: 1,
        limit: 20,
      });
      expect(errors).toEqual([]);
    });

    it('rejects an invalid reportType filter', async () => {
      const errors = await errorsFor(ExportQueryDto, { reportType: 'sales' });
      expect(errors).toContain(
        'reportType must be one of the following values: SALES, INVENTORY, KITCHEN, FINANCIAL, CUSTOM',
      );
    });

    it('rejects an invalid status filter', async () => {
      const errors = await errorsFor(ExportQueryDto, { status: 'done' });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('allows omitting the enum filters', async () => {
      const errors = await errorsFor(ExportQueryDto, { page: 2, limit: 5 });
      expect(errors).toEqual([]);
    });
  });
});
