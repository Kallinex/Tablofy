import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { buildAuthUser } from '../../../test/factories/user.factory';
import { testCredentials, testUserId } from '../../../test/fixtures/auth.fixture';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<AuthService>;

  const mockReq = {
    ip: '127.0.0.1',
    headers: { 'user-agent': 'test-agent' },
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            register: jest.fn(),
            login: jest.fn(),
            refreshTokens: jest.fn(),
            logout: jest.fn(),
            logoutAllDevices: jest.fn(),
            forgotPassword: jest.fn(),
            resetPassword: jest.fn(),
            changePassword: jest.fn(),
            verifyEmail: jest.fn(),
            resendVerificationEmail: jest.fn(),
            getTwoFactorStatus: jest.fn(),
            setupTwoFactor: jest.fn(),
            enableTwoFactor: jest.fn(),
            disableTwoFactor: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get(AuthService) as jest.Mocked<AuthService>;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should return user and tokens for new registration', async () => {
      const fakeUser = buildAuthUser();
      authService.register.mockResolvedValue({
        user: fakeUser,
        tokens: { accessToken: 'at', refreshToken: 'rt' },
      });

      const result = await controller.register(
        {
          email: testCredentials.email,
          password: testCredentials.password,
          firstName: 'Test',
          lastName: 'User',
        },
        mockReq as never,
      );

      expect(result).toEqual({ user: fakeUser, tokens: { accessToken: 'at', refreshToken: 'rt' } });
    });

    it('should throw ConflictException for existing user', async () => {
      const { ConflictException } = await import('@nestjs/common');
      authService.register.mockRejectedValue(new ConflictException('User already exists'));

      await expect(
        controller.register(
          {
            email: testCredentials.email,
            password: testCredentials.password,
            firstName: 'Test',
            lastName: 'User',
          },
          mockReq as never,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('should return user and tokens', async () => {
      const fakeUser = buildAuthUser();
      authService.login.mockResolvedValue({
        user: fakeUser,
        tokens: { accessToken: 'at', refreshToken: 'rt' },
      });

      const result = await controller.login(
        { email: testCredentials.email, password: testCredentials.password },
        mockReq as never,
      );

      expect(result.user).toEqual(fakeUser);
      expect(result.tokens.accessToken).toBe('at');
    });
  });

  describe('refresh', () => {
    it('should return new tokens', async () => {
      authService.refreshTokens.mockResolvedValue({
        accessToken: 'new-at',
        refreshToken: 'new-rt',
      });

      const result = await controller.refresh({ refreshToken: 'valid-rt' }, mockReq as never);

      expect(result.accessToken).toBe('new-at');
    });
  });

  describe('logout', () => {
    it('should logout and return message', async () => {
      const result = await controller.logout(
        { id: testUserId, email: 'test@test.com', role: 'OWNER', tenantId: 'tenant-1' },
        { refreshToken: 'rt' },
        mockReq as never,
      );

      expect(result).toEqual({ message: expect.any(String) });
      expect(authService.logout).toHaveBeenCalledWith(
        testUserId,
        'rt',
        expect.any(Object),
        undefined,
      );
    });

    it('should extract the bearer access token for jti blacklisting', async () => {
      await controller.logout(
        { id: testUserId, email: 'test@test.com', role: 'OWNER', tenantId: 'tenant-1' },
        { refreshToken: 'rt' },
        { ...mockReq, headers: { authorization: 'Bearer abc.def.ghi' } } as never,
      );

      expect(authService.logout).toHaveBeenCalledWith(
        testUserId,
        'rt',
        expect.any(Object),
        'abc.def.ghi',
      );
    });
  });

  describe('logoutAll', () => {
    it('should logout all devices', async () => {
      const result = await controller.logoutAll(
        { id: testUserId, email: 'test@test.com', role: 'OWNER', tenantId: 'tenant-1' },
        mockReq as never,
      );

      expect(result).toEqual({ message: expect.any(String) });
      expect(authService.logoutAllDevices).toHaveBeenCalledWith(testUserId, expect.any(Object));
    });
  });

  describe('forgotPassword', () => {
    it('should return confirmation message', async () => {
      const result = await controller.forgotPassword(
        { email: testCredentials.email },
        mockReq as never,
      );

      expect(result).toEqual({ message: expect.any(String) });
    });
  });

  describe('resetPassword', () => {
    it('should return success message', async () => {
      const result = await controller.resetPassword(
        { token: 'reset-token', newPassword: 'NewPass123!' },
        mockReq as never,
      );

      expect(result).toEqual({ message: expect.any(String) });
    });
  });

  describe('changePassword', () => {
    it('should return success message', async () => {
      const result = await controller.changePassword(
        { id: testUserId, email: 'test@test.com', role: 'OWNER', tenantId: 'tenant-1' },
        { currentPassword: 'old', newPassword: 'new' },
        mockReq as never,
      );

      expect(result).toEqual({ message: expect.any(String) });
    });
  });

  describe('verifyEmail', () => {
    it('should return success message', async () => {
      const result = await controller.verifyEmail({ token: 'verify-token' }, mockReq as never);

      expect(result).toEqual({ message: expect.any(String) });
    });
  });

  describe('resendVerification', () => {
    it('should return confirmation message', async () => {
      const result = await controller.resendVerification(
        { id: testUserId, email: 'test@test.com', role: 'OWNER', tenantId: 'tenant-1' },
        mockReq as never,
      );

      expect(result).toEqual({ message: expect.any(String) });
    });
  });

  describe('two-factor authentication', () => {
    it('should return the 2FA status', async () => {
      authService.getTwoFactorStatus.mockResolvedValue({
        enabled: false,
        verified: false,
      } as never);

      const result = await controller.getTwoFactorStatus({
        id: testUserId,
        email: 'test@test.com',
        role: 'OWNER',
        tenantId: 'tenant-1',
      });

      expect(authService.getTwoFactorStatus).toHaveBeenCalledWith(testUserId);
      expect(result).toEqual({ enabled: false, verified: false });
    });

    it('should return the generated 2FA secret', async () => {
      authService.setupTwoFactor.mockResolvedValue({
        secret: 'base32secret',
        qrCodeUrl: 'otpauth://...',
      } as never);

      const result = await controller.setupTwoFactor({
        id: testUserId,
        email: 'test@test.com',
        role: 'OWNER',
        tenantId: 'tenant-1',
      });

      expect(authService.setupTwoFactor).toHaveBeenCalledWith(testUserId);
      expect(result).toEqual({ secret: 'base32secret', qrCodeUrl: 'otpauth://...' });
    });

    it('should enable two-factor authentication', async () => {
      authService.enableTwoFactor.mockResolvedValue({ backupCodes: [] } as never);

      const result = await controller.enableTwoFactor(
        { id: testUserId, email: 'test@test.com', role: 'OWNER', tenantId: 'tenant-1' },
        { code: '123456' },
      );

      expect(authService.enableTwoFactor).toHaveBeenCalledWith(testUserId, '123456');
      expect(result).toEqual({
        message: 'Two-factor authentication enabled',
        backupCodes: [],
      });
    });

    it('should disable two-factor authentication', async () => {
      authService.disableTwoFactor.mockResolvedValue({ recoveryCodesRegenerated: false } as never);

      const result = await controller.disableTwoFactor(
        { id: testUserId, email: 'test@test.com', role: 'OWNER', tenantId: 'tenant-1' },
        { code: '123456' },
      );

      expect(authService.disableTwoFactor).toHaveBeenCalledWith(testUserId, '123456');
      expect(result).toEqual({
        message: 'Two-factor authentication disabled',
        recoveryCodesRegenerated: false,
      });
    });
  });
});
