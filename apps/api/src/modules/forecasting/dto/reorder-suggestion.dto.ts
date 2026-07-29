import { IsOptional, IsString } from 'class-validator';

export class ApproveReorderSuggestionDto {
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CompleteReorderSuggestionDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
