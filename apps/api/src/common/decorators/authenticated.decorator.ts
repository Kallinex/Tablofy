import { SetMetadata } from '@nestjs/common';

export const ANY_AUTHENTICATED_KEY = 'anyAuthenticated';

export const Authenticated = (): PropertyDecorator & MethodDecorator & ClassDecorator =>
  SetMetadata(ANY_AUTHENTICATED_KEY, true);
