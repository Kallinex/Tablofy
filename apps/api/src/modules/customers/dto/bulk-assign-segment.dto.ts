import { IsArray, IsString } from 'class-validator';

export class BulkAssignSegmentDto {
  @IsArray()
  @IsString({ each: true })
  customerIds!: string[];
}
