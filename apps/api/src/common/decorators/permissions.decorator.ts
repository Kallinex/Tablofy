import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

export const Permissions = (
  ...permissions: string[]
): PropertyDecorator & MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_KEY, permissions);
