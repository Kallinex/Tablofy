import { IsEmail, IsOptional, IsIn } from 'class-validator';
import { UserRole } from '@prisma/client';
import { TENANT_ASSIGNABLE_ROLES } from '../../../common/rbac/role-policy';

export class CreateInvitationDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsIn(TENANT_ASSIGNABLE_ROLES as unknown as string[])
  role?: UserRole;
}
