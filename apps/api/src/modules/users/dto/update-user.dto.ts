import { IsEmail, IsOptional, IsString, IsEnum, IsIn, IsObject, MaxLength } from 'class-validator';
import { UserRole, UserStatus } from '@prisma/client';
import { TENANT_ASSIGNABLE_ROLES } from '../../../common/rbac/role-policy';

export class UpdateUserDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsIn(TENANT_ASSIGNABLE_ROLES as unknown as string[])
  role?: UserRole;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsObject()
  preferences?: Record<string, unknown>;
}
