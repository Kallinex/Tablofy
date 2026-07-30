import { CurrentUserData } from '../../common/decorators/current-user.decorator';

export function mockRequestWithUser(user: Partial<CurrentUserData> = {}): {
  user: CurrentUserData;
} {
  return {
    user: {
      id: 'user-1',
      email: 'test@example.com',
      role: 'OWNER',
      tenantId: 'tenant-1',
      ...user,
    },
  };
}

export function mockJwtPayload(user: Partial<CurrentUserData> = {}) {
  return {
    sub: 'user-1',
    email: 'test@example.com',
    role: 'OWNER',
    tenantId: 'tenant-1',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 900,
    ...user,
  };
}

export function mockTenantContext(tenantId = 'tenant-1') {
  return {
    tenantId,
    headerName: 'x-tenant-id',
  };
}

export const testCredentials = {
  email: 'test@example.com',
  password: 'TestPass123!',
};

export const testTenantId = 'tenant-1';
export const testUserId = 'user-1';
export const testRestaurantId = 'restaurant-1';
