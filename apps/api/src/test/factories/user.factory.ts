export interface TestUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  tenantId: string | null;
  password: string;
  status: string;
  emailVerified: boolean;
  phone: string | null;
  dataRetentionUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TestAuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  tenantId: string | null;
  emailVerified: boolean;
}

let counter = 0;

export function buildUser(overrides: Partial<TestUser> = {}): TestUser {
  counter += 1;
  const id = overrides.id ?? `user-${counter}`;
  return {
    id,
    email: `user${counter}@test.com`,
    firstName: 'Test',
    lastName: `User${counter}`,
    role: 'OWNER',
    tenantId: `tenant-${counter}`,
    password: '$2b$10$hashedpassword',
    status: 'ACTIVE',
    emailVerified: true,
    phone: null,
    dataRetentionUntil: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

export function buildAuthUser(overrides: Partial<TestAuthUser> = {}): TestAuthUser {
  const user = buildUser(overrides);
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    tenantId: user.tenantId,
    emailVerified: user.emailVerified,
    ...overrides,
  };
}
