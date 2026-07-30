import { IsOptional, IsString, IsBoolean } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryWebhookDto extends PaginationDto {
  @IsOptional()
  @IsString()
  event?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
