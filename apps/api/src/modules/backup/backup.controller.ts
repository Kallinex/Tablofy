import { Controller, Post, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BackupService } from './backup.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Request } from 'express';

@ApiTags('backup')
@ApiBearerAuth()
@Roles('OWNER')
@UseGuards(JwtAuthGuard, RolesGuard, TenantGuard)
@Controller('backup')
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new backup' })
  create(@Req() req: Request & { tenantId: string; lang: string }) {
    return this.backupService.create(req.tenantId, 'FULL', req.lang);
  }

  @Get()
  @ApiOperation({ summary: 'List backups' })
  findAll(
    @Req() req: Request & { tenantId: string },
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.backupService.findAll(req.tenantId, +page, +limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get backup by ID' })
  findOne(@Param('id') id: string, @Req() req: Request & { tenantId: string; lang: string }) {
    return this.backupService.findOne(req.tenantId, id, req.lang);
  }

  @Post(':id/verify')
  @ApiOperation({ summary: 'Verify backup integrity' })
  verify(@Param('id') id: string, @Req() req: Request & { tenantId: string; lang: string }) {
    return this.backupService.verify(req.tenantId, id, req.lang);
  }

  @Post(':id/restore')
  @ApiOperation({ summary: 'Restore from backup' })
  restore(@Param('id') id: string, @Req() req: Request & { tenantId: string; lang: string }) {
    return this.backupService.restore(req.tenantId, id, req.lang);
  }
}
