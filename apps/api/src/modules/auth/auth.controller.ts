import { Controller, Post, Body, HttpCode, HttpStatus, Req, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { EnableTwoFactorDto, DisableTwoFactorDto } from './dto/two-factor.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { SkipTenantCheck } from '../../common/decorators/skip-tenant.decorator';
import { Request } from 'express';

@ApiTags('auth')
@Controller('auth')
@SkipTenantCheck()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Register a new user account' })
  @ApiResponse({ status: 201, description: 'Registration successful' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 409, description: 'User already exists' })
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    const result = await this.authService.register(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return { user: result.user, tokens: result.tokens };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const result = await this.authService.login(
      dto.email,
      dto.password,
      {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
      dto.twoFactorCode,
    );
    return result;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, description: 'Token refreshed' })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    const tokens = await this.authService.refreshTokens(dto.refreshToken, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return tokens;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout current session' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  async logout(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
  ) {
    await this.authService.logout(user.id, dto.refreshToken, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'Logged out successfully' };
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout all devices' })
  @ApiResponse({ status: 200, description: 'All devices logged out' })
  async logoutAll(@CurrentUser() user: CurrentUserData, @Req() req: Request) {
    await this.authService.logoutAllDevices(user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'All devices logged out successfully' };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Request password reset email' })
  @ApiResponse({ status: 200, description: 'Reset email sent if account exists' })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    await this.authService.forgotPassword(dto.email, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'If an account exists with this email, a reset link has been sent' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Reset password with token' })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    await this.authService.resetPassword(dto.token, dto.newPassword, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'Password reset successfully' };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change password (requires current password)' })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  @ApiResponse({ status: 401, description: 'Current password is incorrect' })
  async changePassword(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ) {
    await this.authService.changePassword(user.id, dto.currentPassword, dto.newPassword, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'Password changed successfully. Please login again.' };
  }

  @Public()
  @Get('verify-email/:token')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Verify email address' })
  @ApiResponse({ status: 200, description: 'Email verified' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async verifyEmail(@Param() dto: VerifyEmailDto, @Req() req: Request) {
    await this.authService.verifyEmail(dto.token, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'Email verified successfully' };
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resend email verification' })
  @ApiResponse({ status: 200, description: 'Verification email sent' })
  async resendVerification(@CurrentUser() user: CurrentUserData, @Req() req: Request) {
    await this.authService.resendVerificationEmail(user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'Verification email sent' };
  }

  @Get('2fa/status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get two-factor authentication status' })
  @ApiResponse({ status: 200, description: 'Two-factor authentication status' })
  @ApiResponse({ status: 401, description: 'User not found' })
  async getTwoFactorStatus(@CurrentUser() user: CurrentUserData) {
    return this.authService.getTwoFactorStatus(user.id);
  }

  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate a two-factor authentication secret' })
  @ApiResponse({ status: 200, description: 'TOTP secret generated' })
  @ApiResponse({ status: 400, description: 'Two-factor authentication is already enabled' })
  @ApiResponse({ status: 401, description: 'User not found' })
  async setupTwoFactor(@CurrentUser() user: CurrentUserData) {
    return this.authService.setupTwoFactor(user.id);
  }

  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enable two-factor authentication' })
  @ApiResponse({ status: 200, description: 'Two-factor authentication enabled' })
  @ApiResponse({ status: 400, description: 'Invalid code or already enabled' })
  @ApiResponse({ status: 401, description: 'User not found' })
  async enableTwoFactor(@CurrentUser() user: CurrentUserData, @Body() dto: EnableTwoFactorDto) {
    const result = await this.authService.enableTwoFactor(user.id, dto.code);
    return { message: 'Two-factor authentication enabled', ...result };
  }

  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disable two-factor authentication' })
  @ApiResponse({ status: 200, description: 'Two-factor authentication disabled' })
  @ApiResponse({ status: 400, description: 'Invalid code or not enabled' })
  @ApiResponse({ status: 401, description: 'User not found' })
  async disableTwoFactor(@CurrentUser() user: CurrentUserData, @Body() dto: DisableTwoFactorDto) {
    const result = await this.authService.disableTwoFactor(user.id, dto.code);
    return { message: 'Two-factor authentication disabled', ...result };
  }
}
