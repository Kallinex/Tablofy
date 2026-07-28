import { Controller, Get, Post, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { InvitationsService } from './invitations.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SkipTenantCheck } from '../../common/decorators/skip-tenant.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Request } from 'express';
import { Req } from '@nestjs/common';
import { InvitationStatus } from '@prisma/client';

@ApiTags('invitations')
@ApiBearerAuth()
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post()
  @Roles('OWNER', 'MANAGER')
  async create(
    @Body() dto: CreateInvitationDto,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.invitationsService.create(dto, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get()
  @Roles('OWNER', 'MANAGER')
  async findAll(
    @CurrentUser() user: CurrentUserData,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: InvitationStatus,
  ) {
    return this.invitationsService.findAllByTenant({
      tenantId: user.tenantId!,
      page,
      limit,
      status,
    });
  }

  @Get('token/:token')
  @Public()
  @SkipTenantCheck()
  async findByToken(@Param('token') token: string) {
    const invitation = await this.invitationsService.findByToken(token);
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    };
  }

  @Post('accept')
  @Public()
  @SkipTenantCheck()
  @HttpCode(HttpStatus.OK)
  async accept(@Body() dto: AcceptInvitationDto, @Req() req: Request) {
    await this.invitationsService.accept(dto.token, dto.password, dto.firstName, dto.lastName, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'Invitation accepted. You can now log in.' };
  }

  @Post(':id/revoke')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  async revoke(@Param('id') id: string, @CurrentUser() user: CurrentUserData, @Req() req: Request) {
    await this.invitationsService.revoke(id, user.tenantId!, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'Invitation revoked' };
  }
}
