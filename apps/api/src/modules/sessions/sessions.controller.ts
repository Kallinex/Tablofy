import { Controller, Get, Post, Delete, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SessionsService } from './sessions.service';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { Request } from 'express';
import { Req } from '@nestjs/common';

@ApiTags('sessions')
@ApiBearerAuth()
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get()
  async findAll(
    @CurrentUser() user: CurrentUserData,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.sessionsService.findAllByUser({
      userId: user.id,
      page,
      limit,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async revoke(@Param('id') id: string, @CurrentUser() user: CurrentUserData, @Req() req: Request) {
    await this.sessionsService.revokeSession(id, user.id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'Session revoked successfully' };
  }

  @Post('revoke-all')
  @HttpCode(HttpStatus.OK)
  async revokeAll(@CurrentUser() user: CurrentUserData, @Req() req: Request) {
    const count = await this.sessionsService.revokeAllSessions(user.id, undefined, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: `${count} sessions revoked` };
  }
}
