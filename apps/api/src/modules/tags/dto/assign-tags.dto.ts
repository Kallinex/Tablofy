import { IsArray, ArrayMinSize, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignTagsDto {
  @ApiProperty({ example: ['tag-id-1', 'tag-id-2'] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  tagIds!: string[];
}
