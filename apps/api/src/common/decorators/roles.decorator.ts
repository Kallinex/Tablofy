import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

export const Roles = (...roles: string[]): PropertyDecorator & MethodDecorator =>
  SetMetadata(ROLES_KEY, roles);
