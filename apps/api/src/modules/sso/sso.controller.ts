import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Redirect,
  Header,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { SsoService } from './sso.service';
import { CreateSsoConnectionDto } from './dto/create-sso-connection.dto';
import { UpdateSsoConnectionDto } from './dto/update-sso-connection.dto';
import { SsoExchangeDto } from './dto/sso-exchange.dto';
import { DiscoverSsoQueryDto } from './dto/discover-sso.dto';
import { Public } from '../../common/decorators/public.decorator';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SkipTenantCheck } from '../../common/decorators/skip-tenant.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';

@ApiTags('auth-sso')
@ApiBearerAuth()
@Controller('auth/sso')
@SkipTenantCheck()
@Authenticated()
export class SsoController {
  constructor(private readonly ssoService: SsoService) {}

  @Post('connections')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Create the tenant OIDC SSO connection' })
  @ApiResponse({ status: 201, description: 'Connection created (client secret hidden)' })
  @ApiResponse({ status: 409, description: 'Tenant already has an SSO connection' })
  async createConnection(
    @Body() dto: CreateSsoConnectionDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.ssoService.createConnection(user.tenantId!, user.id, dto);
  }

  @Get('connections')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'List SSO connections for the tenant' })
  async listConnections(@CurrentUser() user: CurrentUserData) {
    return this.ssoService.listConnections(user.tenantId!);
  }

  @Get('connections/:id')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Get an SSO connection' })
  async getConnection(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.ssoService.getConnection(user.tenantId!, id);
  }

  @Patch('connections/:id')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Update an SSO connection' })
  async updateConnection(
    @Param('id') id: string,
    @Body() dto: UpdateSsoConnectionDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.ssoService.updateConnection(user.tenantId!, user.id, id, dto);
  }

  @Delete('connections/:id')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Delete an SSO connection' })
  async deleteConnection(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.ssoService.deleteConnection(user.tenantId!, user.id, id);
  }

  @Public()
  @Get('discover')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Check whether an email domain has SSO enabled' })
  async discover(@Query() query: DiscoverSsoQueryDto) {
    return this.ssoService.discoverByEmail(query.email);
  }

  @Public()
  @Get('callback')
  @Redirect()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'OIDC redirect callback (IdP -> Tablofy)' })
  async callback(@Query() query: Record<string, string>, @Req() req: Request) {
    try {
      const result = await this.ssoService.handleCallback(query, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return { url: result?.redirectUrl };
    } catch (error) {
      const failure = this.ssoService.failureRedirect('sso_failed');
      if (failure) {
        return { url: failure };
      }
      throw error;
    }
  }

  @Public()
  @Post('exchange')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Exchange a one-time SSO code for Tablofy tokens' })
  @ApiResponse({ status: 200, description: 'Returns the user and token pair' })
  async exchange(@Body() dto: SsoExchangeDto, @Req() req: Request) {
    return this.ssoService.exchangeAuthorizationCode(dto.code, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Public()
  @Get(':connectionId/authorize')
  @Redirect()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Start the OIDC or SAML authorization flow' })
  async authorize(
    @Param('connectionId') connectionId: string,
    @Query('redirect') redirect: string | undefined,
  ) {
    const result = await this.ssoService.beginAuthorization(connectionId, redirect);
    return { url: result?.url };
  }

  @Public()
  @Post('saml/acs')
  @Redirect()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'SAML assertion consumer service (IdP -> Tablofy)' })
  async samlAcs(@Body() body: Record<string, string>, @Req() req: Request) {
    try {
      const result = await this.ssoService.handleSamlResponse(body, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return { url: result?.redirectUrl };
    } catch (error) {
      const failure = this.ssoService.failureRedirect('sso_failed');
      if (failure) {
        return { url: failure };
      }
      throw error;
    }
  }

  @Public()
  @Get(':connectionId/saml/metadata')
  @Header('Content-Type', 'application/xml')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Service provider metadata XML for a SAML connection' })
  async samlMetadata(@Param('connectionId') connectionId: string) {
    return this.ssoService.samlMetadata(connectionId);
  }
}
