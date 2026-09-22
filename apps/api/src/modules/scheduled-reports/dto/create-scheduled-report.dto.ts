import {
  IsString,
  IsEnum,
  IsOptional,
  IsObject,
  IsArray,
  IsBoolean,
  IsEmail,
  ArrayNotEmpty,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { CronTime } from 'cron';

export function IsCronExpression(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isCronExpression',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string' || value.length === 0) {
            return false;
          }
          return CronTime.validateCronExpression(value).valid;
        },
        defaultMessage: () => 'schedule must be a valid cron expression',
      },
    });
  };
}

export enum ReportType {
  SALES = 'SALES',
  INVENTORY = 'INVENTORY',
  KITCHEN = 'KITCHEN',
  FINANCIAL = 'FINANCIAL',
  CUSTOM = 'CUSTOM',
}

export enum ReportFormat {
  CSV = 'CSV',
  EXCEL = 'EXCEL',
  PDF = 'PDF',
}

export class CreateScheduledReportDto {
  @IsString()
  name!: string;

  @IsEnum(ReportType)
  type!: ReportType;

  @IsEnum(ReportFormat)
  format!: ReportFormat;

  @IsString()
  @IsCronExpression({ message: 'schedule must be a valid cron expression' })
  schedule!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsEmail({}, { each: true, message: 'each recipient must be a valid email address' })
  recipients!: string[];

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
