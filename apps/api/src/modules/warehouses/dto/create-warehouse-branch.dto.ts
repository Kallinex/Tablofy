import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class CreateWarehouseBranchDto {
  @IsString()
  branchId!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
