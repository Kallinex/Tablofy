import { IsString, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { NoteType } from '@prisma/client';

export class AddNoteDto {
  @IsOptional()
  @IsEnum(NoteType)
  type?: NoteType;

  @IsString()
  @MaxLength(2000)
  content!: string;
}
