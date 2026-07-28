import { IsArray, ArrayMinSize, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignAllergensDto {
  @ApiProperty({ example: ['allergen-id-1', 'allergen-id-2'] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  allergenIds!: string[];
}
