import { IsOptional, IsBoolean, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { ToBoolean } from '../../../common/transform/boolean.transform';

export class QueryApiKeyDto extends PaginationDto {
  @ToBoolean()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  scope?: string;
}
