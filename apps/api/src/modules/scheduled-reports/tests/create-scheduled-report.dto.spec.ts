import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateScheduledReportDto } from '../dto/create-scheduled-report.dto';

function baseDto() {
  return {
    name: 'Daily sales',
    type: 'SALES',
    format: 'CSV',
    schedule: '0 9 * * *',
    recipients: ['owner@example.com'],
  };
}

describe('CreateScheduledReportDto validation', () => {
  it('accepts a valid cron schedule and well-formed recipients', () => {
    const dto = plainToInstance(CreateScheduledReportDto, baseDto());
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('accepts common cron variants', () => {
    for (const schedule of [
      '* * * * *',
      '*/5 * * * *',
      '0 0 1 1 *',
      '0 9,17 * * 1-5',
      '30 4 * * 1',
      '0 12 * * MON-FRI',
    ]) {
      const dto = plainToInstance(CreateScheduledReportDto, { ...baseDto(), schedule });
      const errors = validateSync(dto);
      expect(errors).toHaveLength(0);
    }
  });

  it('rejects an invalid cron schedule', () => {
    for (const schedule of ['not a cron', '99 99 99 99 99', '* * *', '']) {
      const dto = plainToInstance(CreateScheduledReportDto, { ...baseDto(), schedule });
      const errors = validateSync(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('schedule');
    }
  });

  it('rejects an empty recipients array', () => {
    const dto = plainToInstance(CreateScheduledReportDto, { ...baseDto(), recipients: [] });
    const errors = validateSync(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('recipients');
  });

  it('rejects invalid recipient email addresses', () => {
    const dto = plainToInstance(CreateScheduledReportDto, {
      ...baseDto(),
      recipients: ['not-an-email', 'valid@example.com'],
    });
    const errors = validateSync(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('recipients');
  });
});
