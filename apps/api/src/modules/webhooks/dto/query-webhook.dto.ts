import { IsOptional, IsString, IsBoolean } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { ToBoolean } from '../../../common/transform/boolean.transform';

export class QueryWebhookDto extends PaginationDto {
  @IsOptional()
  @IsString()
  event?: string;

  @ToBoolean()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
