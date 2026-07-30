import { Controller, Get, Post, Param, Query, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { ExportEngineService } from './export-engine.service';
import { GenerateExportDto } from './dto/generate-export.dto';
import { ExportQueryDto } from './dto/export-query.dto';

@Controller('export-engine')
export class ExportEngineController {
  constructor(private readonly exportEngineService: ExportEngineService) {}

  @Post('generate')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.CREATED)
  async generate(@Body() dto: GenerateExportDto, @CurrentUser() user: CurrentUserData) {
    return this.exportEngineService.generateExport(user.tenantId!, user.id, dto);
  }

  @Get('exports')
  async listExports(@Query() query: ExportQueryDto, @CurrentUser() user: CurrentUserData) {
    return this.exportEngineService.listExports(user.tenantId!, query);
  }

  @Get('exports/:id')
  async getExport(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.exportEngineService.getExport(user.tenantId!, id);
  }

  @Get('exports/:id/download')
  async downloadExport(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.exportEngineService.downloadExport(user.tenantId!, id);
  }

  @Post('dashboard-snapshot')
  @Roles('OWNER', 'MANAGER')
  @HttpCode(HttpStatus.OK)
  async dashboardSnapshot(
    @Body() config: Record<string, unknown>,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.exportEngineService.getDashboardSnapshot(user.tenantId!, user, config ?? {});
  }
}
